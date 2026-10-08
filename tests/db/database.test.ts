import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATION_FILES, MIGRATIONS, addUser, asUser, buildDatabase, rerunMigrations, rolledBack } from "./harness";

// The database as the app sees it: every migration applied on top of the original tables, then
// checks that each account only ever sees and changes its own data.

let db: PGlite;
let owner: string; // the first account, which owns the imported spreadsheet data
let friend: string; // a second account, added later

const one = async <T>(tx: Transaction | PGlite, sql: string, params: unknown[] = []) =>
  (await tx.query<T>(sql, params)).rows[0];
const count = async (tx: Transaction | PGlite, sql: string, params: unknown[] = []) =>
  Number((await one<{ n: number }>(tx, sql, params)).n);
const idOf = (tx: Transaction | PGlite, sql: string, params: unknown[] = []) =>
  one<{ id: string }>(tx, sql, params).then((r) => r.id);

// Tables holding one account's data, and the column that says whose it is.
const OWNED_TABLES: [string, string][] = [
  ["user_profiles", "id"],
  ["categories", "user_id"],
  ["tags", "user_id"],
  ["transactions", "user_id"],
  ["monthly_savings", "user_id"],
  ["recurring_sentinel", "user_id"],
  ["goals", "user_id"],
  ["goal_contributions", "user_id"],
  ["budgets", "user_id"],
  ["push_subscriptions", "user_id"],
  ["reminder_settings", "user_id"],
  ["savings_accounts", "user_id"],
  ["savings_balances", "user_id"],
  ["api_tokens", "user_id"],
  ["inbox_items", "user_id"],
  ["merchant_rules", "user_id"],
];

beforeAll(async () => {
  ({ db, ownerId: owner } = await buildDatabase());
  friend = await addUser(db, "friend@example.com");

  // Some of the owner's data in every table, so there's something to try to reach.
  const food = await idOf(db, "SELECT id FROM categories WHERE user_id = $1 AND name = 'Food'", [owner]);
  const lunch = await idOf(db, "SELECT id FROM tags WHERE user_id = $1 AND name = 'Lunch'", [owner]);
  const netflix = await idOf(db, "SELECT id FROM tags WHERE user_id = $1 AND name = 'Netflix'", [owner]);
  const goal = await idOf(db, "INSERT INTO goals (user_id, name, target_amount) VALUES ($1, 'New phone', 3000) RETURNING id", [owner]);
  await db.query("INSERT INTO goal_contributions (user_id, goal_id, amount) VALUES ($1, $2, 100)", [owner, goal]);
  await db.query("INSERT INTO budgets (user_id, category_id, monthly_limit) VALUES ($1, $2, 600)", [owner, food]);
  await db.query("INSERT INTO recurring_sentinel (user_id, tag_id, expected_amount, due_day) VALUES ($1, $2, 54.90, 5) ON CONFLICT DO NOTHING", [owner, netflix]);
  await db.query("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://push.example.com/1', 'k', 'a')", [owner]);
  await db.query("INSERT INTO reminder_settings (user_id) VALUES ($1)", [owner]);
  await db.query("INSERT INTO reminder_log (user_id, key) VALUES ($1, 'bill:test')", [owner]);
  await db.query("INSERT INTO api_tokens (user_id, name, token_hash, token_prefix) VALUES ($1, 'Phone', 'hash', 'bt_abcdefg')", [owner]);
  await db.query("INSERT INTO inbox_items (user_id, amount, merchant, suggested_tag_id) VALUES ($1, 9.90, 'Test Cafe', $2)", [owner, lunch]);
  await db.query("INSERT INTO merchant_rules (user_id, pattern, category_id, tag_id) VALUES ($1, 'TEST', $2, $3)", [owner, food, lunch]);
}, 60_000);

describe("migrations", () => {
  it("lists every migration file in the README, in the order to run them", () => {
    expect([...MIGRATIONS].sort()).toEqual(MIGRATION_FILES);
    expect(new Set(MIGRATIONS).size).toBe(MIGRATIONS.length);
  });

  it("can all be run again without changing any data", async () => {
    const snapshot = async () =>
      Promise.all(OWNED_TABLES.map(([t]) => count(db, `SELECT count(*) AS n FROM ${t}`)));
    const before = await snapshot();
    await rerunMigrations(db);
    expect(await snapshot()).toEqual(before);
  });

  it("stops secure_rls.sql from undoing the multi-user setup", async () => {
    const sql = readFileSync(join(__dirname, "..", "..", "scripts/secure_rls.sql"), "utf8");
    await expect(db.exec(sql)).rejects.toThrow(/Already set up for multiple users/);
  });

  it("gives the imported data to the first account", async () => {
    for (const t of ["categories", "tags", "transactions", "monthly_savings"]) {
      expect(await count(db, `SELECT count(*) AS n FROM ${t} WHERE user_id IS NULL`), t).toBe(0);
      expect(await count(db, `SELECT count(*) AS n FROM ${t} WHERE user_id = $1`, [owner]), t).toBeGreaterThan(0);
    }
    // The imported categories stay as they were (plus Instalments, for the plan bought from Goals);
    // the default set is only for new accounts.
    const names = await db.query<{ name: string }>("SELECT name FROM categories WHERE user_id = $1 ORDER BY name", [owner]);
    expect(names.rows.map((r) => r.name)).toEqual(["Bills", "Food", "Instalments"]);
  });

  it("marks the food category and meal tags", async () => {
    const roles = await db.query<{ name: string; role: string }>(
      "SELECT name, role FROM tags WHERE user_id = $1 AND role IS NOT NULL ORDER BY name",
      [owner]
    );
    expect(roles.rows).toEqual([
      { name: "Dinner", role: "dinner" },
      { name: "Lunch", role: "lunch" },
    ]);
    expect(await one(db, "SELECT role FROM categories WHERE user_id = $1 AND name = 'Food'", [owner])).toEqual({ role: "food" });
  });

  it("gives existing merchant rules their tag's category", async () => {
    const rule = await one<{ category: string; tag: string }>(
      db,
      `SELECT c.name AS category, t.name AS tag FROM merchant_rules r
       JOIN categories c ON c.id = r.category_id JOIN tags t ON t.id = r.tag_id WHERE r.pattern = 'OLDRULE'`
    );
    expect(rule).toEqual({ category: "Food", tag: "Lunch" });
  });

  it("moves plans bought from Goals into an Instalments category, with their payments and rules", async () => {
    const where = async (tagId: string) =>
      one<{ tag_cat: string; role: string | null; tx_cats: string; rule_cat: string | null }>(
        db,
        `SELECT c.name AS tag_cat, c.role,
                (SELECT string_agg(DISTINCT xc.name, ',') FROM transactions x JOIN categories xc ON xc.id = x.category_id WHERE x.tag_id = t.id) AS tx_cats,
                (SELECT rc.name FROM merchant_rules mr JOIN categories rc ON rc.id = mr.category_id WHERE mr.tag_id = t.id) AS rule_cat
         FROM tags t JOIN categories c ON c.id = t.category_id WHERE t.id = $1`,
        [tagId]
      );
    expect(await where("00000000-0000-0000-0000-0000000000b1")).toEqual({ tag_cat: "Instalments", role: "instalments", tx_cats: "Instalments", rule_cat: "Instalments" });
    // A plan made in Settings keeps its tag where you put it.
    expect(await where("00000000-0000-0000-0000-0000000000b2")).toEqual({ tag_cat: "Bills", role: null, tx_cats: "Bills", rule_cat: null });
    // Only accounts with such plans get the category.
    expect(await count(db, "SELECT count(*) AS n FROM categories WHERE role = 'instalments' AND user_id = $1", [friend])).toBe(0);
  });

  it("turns the old savings columns into accounts with the same net worth each month", async () => {
    const totals = await db.query<{ month: string; total: string }>(
      `SELECT to_char(month, 'YYYY-MM') AS month, sum(balance)::text AS total
       FROM savings_balances WHERE user_id = $1 GROUP BY month ORDER BY month`,
      [owner]
    );
    expect(totals.rows).toEqual([
      { month: "2026-07", total: "8000.00" },
      { month: "2026-08", total: "9000.00" },
    ]);
  });

  it("keeps row-level security on for every table, with policies only for signed-in users", async () => {
    const off = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`
    );
    expect(off.rows).toEqual([]);
    const policies = await db.query<{ tablename: string; roles: string }>(
      "SELECT tablename, roles::text AS roles FROM pg_policies WHERE schemaname = 'public'"
    );
    expect(policies.rows.length).toBeGreaterThan(0);
    for (const p of policies.rows) expect(p.roles, p.tablename).toBe("{authenticated}");
  });
});

describe("a new account", () => {
  it("starts with a profile and the default categories and tags, with the food marks", async () => {
    expect(await count(db, "SELECT count(*) AS n FROM user_profiles WHERE id = $1", [friend])).toBe(1);
    expect(await count(db, "SELECT count(*) AS n FROM categories WHERE user_id = $1", [friend])).toBe(10);
    const meals = await db.query<{ role: string }>("SELECT role FROM tags WHERE user_id = $1 AND role IS NOT NULL ORDER BY role", [friend]);
    expect(meals.rows.map((r) => r.role)).toEqual(["breakfast", "dinner", "lunch", "snack", "supper"]);
  });

  it("can't run the server-only functions", async () => {
    for (const fn of [`seed_new_user('${friend}')`, "auto_log_bills()"])
      await expect(asUser(db, friend, (tx) => tx.query(`SELECT public.${fn}`)), fn).rejects.toThrow(/permission denied/);
  });
});

describe("privacy between accounts", () => {
  it("shows each account only its own rows", async () => {
    for (const [table, col] of OWNED_TABLES) {
      const others = await asUser(db, friend, (tx) => count(tx, `SELECT count(*) AS n FROM ${table} WHERE ${col} <> $1`, [friend]));
      expect(others, table).toBe(0);
      const mine = await asUser(db, owner, (tx) => count(tx, `SELECT count(*) AS n FROM ${table}`));
      expect(mine, table).toBeGreaterThan(0);
    }
  });

  it("shows nothing when signed out", async () => {
    for (const [table] of OWNED_TABLES) {
      const n = await asUser(db, null, (tx) => count(tx, `SELECT count(*) AS n FROM ${table}`));
      expect(n, table).toBe(0);
    }
  });

  it("keeps the reminder log server-only", async () => {
    expect(await asUser(db, owner, (tx) => count(tx, "SELECT count(*) AS n FROM reminder_log"))).toBe(0);
    await expect(asUser(db, owner, (tx) => tx.query("INSERT INTO reminder_log (user_id, key) VALUES ($1, 'x')", [owner]))).rejects.toThrow();
  });

  it("can't change or delete another account's rows", async () => {
    for (const [table, col] of OWNED_TABLES) {
      const changed = await asUser(db, friend, async (tx) => {
        const u = await tx.query(`UPDATE ${table} SET ${col} = ${col} WHERE ${col} = $1`, [owner]);
        const d = await tx.query(`DELETE FROM ${table} WHERE ${col} = $1`, [owner]);
        return (u.affectedRows ?? 0) + (d.affectedRows ?? 0);
      });
      expect(changed, table).toBe(0);
    }
  });

  it("can't add rows for another account, or hand its own rows over", async () => {
    await expect(
      asUser(db, friend, (tx) => tx.query("INSERT INTO goals (user_id, name, target_amount) VALUES ($1, 'x', 1)", [owner]))
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(db, friend, async (tx) => {
        await tx.query("INSERT INTO goals (name, target_amount) VALUES ('Mine', 1)");
        await tx.query("UPDATE goals SET user_id = $1 WHERE name = 'Mine'", [owner]);
      })
    ).rejects.toThrow(/row-level security/);
  });

  it("fills in the owner from the signed-in user", async () => {
    const who = await asUser(db, friend, (tx) =>
      one<{ user_id: string }>(tx, "INSERT INTO goals (name, target_amount) VALUES ('Trip', 800) RETURNING user_id")
    );
    expect(who.user_id).toBe(friend);
  });

  describe("can't point at another account's categories, tags, goals or accounts", () => {
    type Ids = { category: string; tag: string; goal: string; account: string };
    const ownerIds = async (): Promise<Ids> => ({
      category: await idOf(db, "SELECT id FROM categories WHERE user_id = $1 AND name = 'Food'", [owner]),
      tag: await idOf(db, "SELECT id FROM tags WHERE user_id = $1 AND name = 'Lunch'", [owner]),
      goal: await idOf(db, "SELECT id FROM goals WHERE user_id = $1 LIMIT 1", [owner]),
      account: await idOf(db, "SELECT id FROM savings_accounts WHERE user_id = $1 LIMIT 1", [owner]),
    });
    // The friend's own, made inside their (rolled-back) session.
    const ownIds = async (tx: Transaction): Promise<Ids> => ({
      category: await idOf(tx, "SELECT id FROM categories WHERE name = 'Food'"),
      tag: await idOf(tx, "SELECT id FROM tags WHERE name = 'Lunch'"),
      goal: await idOf(tx, "INSERT INTO goals (name, target_amount) VALUES ('Laptop', 4000) RETURNING id"),
      account: await idOf(tx, "INSERT INTO savings_accounts (name) VALUES ('Wallet') RETURNING id"),
    });

    // Each insert, written so it can be tried with the friend's own ids (works) and the owner's (refused).
    const CASES: [string, (theirs: Ids, mine: Ids) => [string, unknown[]]][] = [
      ["an expense in their category", (o, m) => ["INSERT INTO transactions (category_id, tag_id, amount) VALUES ($1, $2, 5)", [o.category, m.tag]]],
      ["an expense with their tag", (o, m) => ["INSERT INTO transactions (category_id, tag_id, amount) VALUES ($1, $2, 5)", [m.category, o.tag]]],
      ["a tag in their category", (o) => ["INSERT INTO tags (category_id, name) VALUES ($1, 'Sneaky')", [o.category]]],
      ["a budget on their category", (o) => ["INSERT INTO budgets (category_id, monthly_limit) VALUES ($1, 100)", [o.category]]],
      ["a bill with their tag", (o) => ["INSERT INTO recurring_sentinel (tag_id) VALUES ($1)", [o.tag]]],
      ["a bill linked to their goal", (o, m) => ["INSERT INTO recurring_sentinel (tag_id, goal_id) VALUES ($1, $2)", [m.tag, o.goal]]],
      ["money set aside for their goal", (o) => ["INSERT INTO goal_contributions (goal_id, amount) VALUES ($1, 10)", [o.goal]]],
      ["a balance in their savings account", (o) => ["INSERT INTO savings_balances (account_id, month, balance) VALUES ($1, '2026-09-01', 1)", [o.account]]],
      ["a merchant rule with their tag", (o, m) => ["INSERT INTO merchant_rules (pattern, category_id, tag_id) VALUES ('SNEAKY', $1, $2)", [m.category, o.tag]]],
      ["a merchant rule in their category", (o) => ["INSERT INTO merchant_rules (pattern, category_id) VALUES ('SNEAKY2', $1)", [o.category]]],
      ["an Inbox item suggesting their tag", (o) => ["INSERT INTO inbox_items (suggested_tag_id) VALUES ($1)", [o.tag]]],
      ["an Inbox item suggesting their category", (o) => ["INSERT INTO inbox_items (suggested_category_id) VALUES ($1)", [o.category]]],
    ];

    it.each(CASES)("refuses %s", async (_name, build) => {
      const theirs = await ownerIds();
      await expect(
        asUser(db, friend, async (tx) => {
          const [sql, params] = build(theirs, await ownIds(tx));
          return tx.query(sql, params);
        })
      ).rejects.toThrow(/row-level security/);
    });

    it("allows the same with the account's own ids", async () => {
      await asUser(db, friend, async (tx) => {
        const mine = await ownIds(tx);
        for (const [name, build] of CASES) {
          const [sql, params] = build(mine, mine);
          await tx.exec("SAVEPOINT each");
          await expect(tx.query(sql, params), name).resolves.toBeDefined();
          await tx.exec("ROLLBACK TO SAVEPOINT each"); // each case on its own (two bills can't share a tag)
        }
      });
    });
  });
});

describe("job runs", () => {
  it("shows everyone the app-wide runs but only their own events, and only the server writes", async () => {
    await db.query("INSERT INTO job_runs (job, ok) VALUES ('reminders', true)");
    await db.query("INSERT INTO job_runs (job, ok, detail, user_id) VALUES ('ingest', false, 'Couldn''t save', $1)", [owner]);
    const seen = (who: string) =>
      asUser(db, who, (tx) => tx.query<{ job: string }>("SELECT job FROM job_runs WHERE job IN ('reminders', 'ingest')").then((r) => r.rows.map((x) => x.job).sort()));
    expect(await seen(owner)).toEqual(["ingest", "reminders"]);
    expect(await seen(friend)).toEqual(["reminders"]);
    await expect(asUser(db, owner, (tx) => tx.query("INSERT INTO job_runs (job, ok) VALUES ('backup', true)"))).rejects.toThrow(/row-level security/);
  });
});

describe("merchant rules", () => {
  it("can remember a category on its own, or a tag in that category, but not a tag from another category", async () => {
    await asUser(db, friend, async (tx) => {
      const food = await idOf(tx, "SELECT id FROM categories WHERE name = 'Food'");
      const grab = await one<{ id: string; category_id: string }>(tx, "SELECT id, category_id FROM tags WHERE name = 'Grab'");
      await tx.query("INSERT INTO merchant_rules (pattern, category_id) VALUES ('TEALIVE', $1)", [food]);
      await tx.query("INSERT INTO merchant_rules (pattern, category_id, tag_id) VALUES ('GRAB', $1, $2)", [grab.category_id, grab.id]);
      await tx.query("SAVEPOINT mismatch");
      await expect(
        tx.query("INSERT INTO merchant_rules (pattern, category_id, tag_id) VALUES ('ODD', $1, $2)", [food, grab.id])
      ).rejects.toThrow(/row-level security/);
      await tx.query("ROLLBACK TO SAVEPOINT mismatch");
      await expect(tx.query("INSERT INTO merchant_rules (pattern) VALUES ('NONE')")).rejects.toThrow(); // a category is required
    });
  });
});

describe("auto-adding monthly bills", () => {
  // Bills for the friend, relative to the current Malaysian month, as the daily job sees them.
  const setUp = async (tx: Transaction) => {
    const tag = (name: string) => idOf(tx, "SELECT id FROM tags WHERE user_id = $1 AND name = $2", [friend, name]);
    const month = "date_trunc('month', (now() AT TIME ZONE 'Asia/Kuala_Lumpur'))::date";
    const add = (name: string, extra: string) =>
      tag(name).then((id) =>
        tx.query(
          `INSERT INTO recurring_sentinel (user_id, tag_id, expected_amount, due_day, auto_log, installment_count, start_month)
           SELECT $1, $2, 10, 1, true, ${extra}`,
          [friend, id]
        )
      );
    await add("Netflix", "NULL, NULL"); // ongoing
    await add("Spotify", `3, ${month} - interval '1 month'`); // plan, in its 2nd month
    await add("iCloud", `2, ${month} - interval '3 months'`); // plan that has ended
    await add("Internet", `6, ${month} + interval '1 month'`); // plan that starts next month
  };

  it("adds due bills once, only within an instalment plan's months", async () => {
    await rolledBack(db, async (tx) => {
      await setUp(tx);
      const first = await one<{ n: number }>(tx, "SELECT public.auto_log_bills() AS n");
      const again = await one<{ n: number }>(tx, "SELECT public.auto_log_bills() AS n");
      const added = await tx.query<{ name: string }>(
        `SELECT t.name FROM transactions x JOIN tags t ON t.id = x.tag_id
         WHERE x.user_id = $1 AND x.description = 'Auto-added monthly bill' ORDER BY t.name`,
        [friend]
      );
      expect(first.n).toBe(2);
      expect(again.n).toBe(0);
      expect(added.rows.map((r) => r.name)).toEqual(["Netflix", "Spotify"]);
      const runs = await tx.query<{ ok: boolean }>("SELECT ok FROM job_runs WHERE job = 'auto_bills' ORDER BY id DESC LIMIT 2");
      expect(runs.rows).toEqual([{ ok: true }, { ok: true }]);
    });
  });

  it("adds only what a plan is still short this month (paid ahead, part-paid, paid off)", async () => {
    await rolledBack(db, async (tx) => {
      const month = "date_trunc('month', (now() AT TIME ZONE 'Asia/Kuala_Lumpur'))::date";
      // 6 × RM 10 plans that started last month, so RM 20 is due by the end of this month.
      const plan = async (name: string, payments: [string, number][]) => {
        const tag = await one<{ id: string; category_id: string }>(tx, "SELECT id, category_id FROM tags WHERE user_id = $1 AND name = $2", [friend, name]);
        await tx.query(
          `INSERT INTO recurring_sentinel (user_id, tag_id, expected_amount, due_day, auto_log, installment_count, start_month)
           VALUES ($1, $2, 10, 1, true, 6, ${month} - interval '1 month')`,
          [friend, tag.id]
        );
        for (const [when, amount] of payments)
          await tx.query(`INSERT INTO transactions (user_id, date, category_id, tag_id, amount) VALUES ($1, ${when}, $2, $3, $4)`, [
            friend, tag.category_id, tag.id, amount,
          ]);
      };
      await plan("Phone", [[`${month} - interval '1 month'`, 20]]); // paid two at once last month
      await plan("Electric", [[`${month} - interval '1 month'`, 10], [`${month}`, 4]]); // RM 4 so far this month
      await plan("Water", [[`${month} - interval '1 month'`, 60]]); // paid off
      await plan("Internet", [[`${month} - interval '1 month'`, 10]]); // on track: this month's is due
      await one(tx, "SELECT public.auto_log_bills() AS n");
      const added = await tx.query<{ name: string; amount: string }>(
        `SELECT t.name, x.amount::text AS amount FROM transactions x JOIN tags t ON t.id = x.tag_id
         WHERE x.user_id = $1 AND x.description = 'Auto-added monthly bill' ORDER BY t.name`,
        [friend]
      );
      expect(added.rows).toEqual([
        { name: "Electric", amount: "6.00" },
        { name: "Internet", amount: "10.00" },
      ]);
    });
  });

  it("logs a failed run instead of losing it", async () => {
    await rolledBack(db, async (tx) => {
      // Break the job: a check that every insert fails.
      await tx.exec("ALTER TABLE transactions ADD CONSTRAINT always_fails CHECK (amount < 0) NOT VALID");
      await tx.query(
        `INSERT INTO recurring_sentinel (user_id, tag_id, expected_amount, due_day, auto_log)
         SELECT $1, id, 10, 1, true FROM tags WHERE user_id = $1 AND name = 'Water'`,
        [friend]
      );
      expect((await one<{ n: number }>(tx, "SELECT public.auto_log_bills() AS n")).n).toBe(0);
      const run = await one<{ ok: boolean; detail: string }>(tx, "SELECT ok, detail FROM job_runs WHERE job = 'auto_bills' ORDER BY id DESC LIMIT 1");
      expect(run.ok).toBe(false);
      expect(run.detail).toMatch(/always_fails/);
    });
  });

  it("schedules the daily job", async () => {
    expect(await count(db, "SELECT count(*) AS n FROM cron.job WHERE jobname = 'auto-log-monthly-bills'")).toBe(1);
  });
});
