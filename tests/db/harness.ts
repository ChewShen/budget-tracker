import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

// Builds the database the way a real one was built, on an in-memory Postgres (PGlite):
// Supabase stand-ins → the README's initial tables → example data loaded like the spreadsheet
// import → secure_rls.sql → every migration in the README's order. Then tests act as signed-in users.

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

export const OWNER_EMAIL = "owner@example.com";
export const MIGRATION_FILES = readdirSync(join(ROOT, "scripts/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

// The order to run migrations in: as listed in the README's Migrations section (files from the
// same day depend on each other, so file names alone don't give the order).
export function readmeMigrations(): string[] {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("### 4. Migrations"));
  const list = section.slice(0, section.indexOf("\n### ", 1));
  return Array.from(list.matchAll(/^- `([^`]+\.sql)`/gm), (m) => m[1]);
}
export const MIGRATIONS = readmeMigrations();

// The "Initial Tables Setup" SQL from the README, so the docs and the tests can't drift apart.
export function readmeSchema(): string {
  const readme = read("README.md");
  const start = readme.indexOf("### 1. Initial Tables Setup");
  const block = readme.slice(start).match(/```sql\n([\s\S]*?)```/);
  if (start < 0 || !block) throw new Error("README: couldn't find the Initial Tables Setup SQL");
  return block[1];
}

// pg_cron can't be installed here; the stub schema stands in for it.
const forPglite = (sql: string) => sql.replace(/CREATE EXTENSION IF NOT EXISTS pg_cron[^;]*;/gi, "");

export async function run(db: PGlite, label: string, sql: string) {
  try {
    await db.exec(sql);
  } catch (e) {
    throw new Error(`${label}: ${(e as Error).message}`);
  }
}

// Example data in the shape the spreadsheet import leaves it: no owner yet, open policies.
// Placeholder names only.
const LEGACY_DATA = `
  INSERT INTO public.categories (id, name) VALUES
    ('00000000-0000-0000-0000-0000000000c1', 'Food'),
    ('00000000-0000-0000-0000-0000000000c2', 'Bills');
  INSERT INTO public.tags (id, category_id, name) VALUES
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Lunch'),
    ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'Dinner'),
    ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c2', 'Netflix');
  ALTER TABLE public.transactions ALTER COLUMN user_id DROP NOT NULL;
  INSERT INTO public.transactions (date, category_id, tag_id, amount) VALUES
    ('2026-08-03', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 12.50),
    ('2026-08-05', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a3', 54.90);
  INSERT INTO public.monthly_savings (month, main_checking, gx_bank, ryt_bank, epf_locked) VALUES
    ('2026-07-01', 1000, 2000, 0, 5000),
    ('2026-08-01', 1200, 2100, 300, 5400);
`;

// Data a real account would have had by then, so later migrations are tested on it.
const DATA_AFTER: Record<string, (ownerId: string) => string> = {
  // A merchant rule from before rules had a category: the next migration fills in its tag's.
  "2026-10-03_inbox.sql": (ownerId) => `
    INSERT INTO public.merchant_rules (user_id, pattern, tag_id)
    SELECT '${ownerId}', 'OLDRULE', id FROM public.tags WHERE user_id = '${ownerId}' AND name = 'Lunch';`,
  // A plan bought from Goals (its tag filed under Bills, with a payment and a merchant rule) and a
  // plan made in Settings, before plans got their own category.
  "2026-10-08_instalments_by_amount.sql": (ownerId) => `
    INSERT INTO public.goals (id, user_id, name, target_amount, status)
      VALUES ('00000000-0000-0000-0000-0000000000d1', '${ownerId}', 'New phone', 1200, 'bought');
    INSERT INTO public.tags (id, user_id, category_id, name)
      SELECT '00000000-0000-0000-0000-0000000000b1', '${ownerId}', id, 'New phone instalment' FROM public.categories WHERE user_id = '${ownerId}' AND name = 'Bills';
    INSERT INTO public.tags (id, user_id, category_id, name)
      SELECT '00000000-0000-0000-0000-0000000000b2', '${ownerId}', id, 'Atome' FROM public.categories WHERE user_id = '${ownerId}' AND name = 'Bills';
    INSERT INTO public.recurring_sentinel (user_id, tag_id, expected_amount, due_day, installment_count, start_month, goal_id) VALUES
      ('${ownerId}', '00000000-0000-0000-0000-0000000000b1', 100, 5, 12, '2026-09-01', '00000000-0000-0000-0000-0000000000d1'),
      ('${ownerId}', '00000000-0000-0000-0000-0000000000b2', 50, 5, 3, '2026-09-01', NULL);
    INSERT INTO public.transactions (user_id, date, category_id, tag_id, amount)
      SELECT '${ownerId}', '2026-09-05', category_id, id, 100 FROM public.tags WHERE id IN ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
    INSERT INTO public.merchant_rules (user_id, pattern, category_id, tag_id)
      SELECT '${ownerId}', 'PHONESHOP', category_id, id FROM public.tags WHERE id = '00000000-0000-0000-0000-0000000000b1';`,
};

export async function buildDatabase(): Promise<{ db: PGlite; ownerId: string }> {
  const db = await PGlite.create({ extensions: { uuid_ossp } });
  await run(db, "supabase-stub.sql", readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  await run(db, "README schema", readmeSchema());
  await run(db, "legacy data", LEGACY_DATA);

  const owner = await db.query<{ id: string }>("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [OWNER_EMAIL]);
  await run(db, "secure_rls.sql", read("scripts/secure_rls.sql").replace("'you@example.com'", `'${OWNER_EMAIL}'`));

  for (const file of MIGRATIONS) {
    await run(db, file, forPglite(read(`scripts/migrations/${file}`)));
    if (DATA_AFTER[file]) await run(db, `data after ${file}`, DATA_AFTER[file](owner.rows[0].id));
  }
  return { db, ownerId: owner.rows[0].id };
}

// Runs every migration again: each one says it's safe to re-run.
export async function rerunMigrations(db: PGlite) {
  for (const file of MIGRATIONS) await run(db, `${file} (again)`, forPglite(read(`scripts/migrations/${file}`)));
}

// A new account, as created in Supabase → Authentication → Add user (fires the sign-up trigger).
export async function addUser(db: PGlite, email: string): Promise<string> {
  const res = await db.query<{ id: string }>("INSERT INTO auth.users (email) VALUES ($1) RETURNING id", [email]);
  return res.rows[0].id;
}

// Runs `fn` in a transaction that's rolled back afterwards, so tests don't affect each other.
// Errors (e.g. a policy refusing a row) are thrown.
export async function rolledBack<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result: T;
  const rollback = new Error("rollback");
  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  return result!;
}

// Runs `fn` as a signed-in user (or signed out, with null) through the API roles, so RLS applies.
export function asUser<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return rolledBack(db, async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${userId ? "authenticated" : "anon"}`);
    if (userId) await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}
