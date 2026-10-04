import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// /api/ingest, the endpoint the Log Payment Shortcut calls, against a small in-memory stand-in
// for the Supabase admin client (just the queries the endpoint makes).

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let noReferenceColumn = false; // as before 2026-10-03_inbox_reference.sql
let inboxBroken = false; // every Inbox insert fails

class Query implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row = {};
  private head = false;
  private single = false;
  private max = Infinity;
  constructor(private table: string) {}

  select(_cols?: string, opts?: { head?: boolean }) {
    this.head = Boolean(opts?.head);
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  gte(col: string, value: string) {
    this.filters.push((r) => String(r[col]) >= value);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private run() {
    const rows = (tables[this.table] ||= []);
    if (noReferenceColumn && this.table === "inbox_items") {
      if (this.op === "insert" && "reference" in this.payload) return { data: null, error: { code: "PGRST204", message: "no column" } };
      if (this.filters.length && this.op === "select" && this.max === 1) return { data: null, error: { code: "42703", message: "no column" } };
    }
    if (this.op === "insert" && inboxBroken && this.table === "inbox_items") return { data: null, error: { code: "XX000", message: "database is down" } };
    if (this.op === "insert") {
      rows.push({ id: `row-${rows.length + 1}`, status: "pending", created_at: new Date().toISOString(), ...this.payload });
      return { data: null, error: null };
    }
    const hits = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "update") {
      hits.forEach((r) => Object.assign(r, this.payload));
      return { data: null, error: null };
    }
    if (this.head) return { data: null, error: null, count: hits.length };
    const data = hits.slice(0, this.max);
    return { data: this.single ? (data[0] ?? null) : data, error: null };
  }

  then<A, B>(ok?: ((v: { data: unknown; error: unknown; count?: number }) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, fail);
  }
}

vi.mock("@/lib/push-server", () => ({
  createAdminClient: () => ({ from: (table: string) => new Query(table) }),
  todayInMalaysia: () => "2026-10-03",
}));

const { POST } = await import("@/app/api/ingest/route");

const TOKEN = `bt_${"A".repeat(43)}`;
const REVOKED = `bt_${"R".repeat(43)}`;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const USER = "user-1";

const RECEIPT = `Payment successful
RM 8.50
Paid to
KEDAI CONTOH
DuitNow Ref No.
20261003TNGDMYNB030OQR12345
3 Oct 2026, 7:15 PM`;

function send(body: unknown, headers: Record<string, string> = { "x-api-token": TOKEN }) {
  const isText = typeof body === "string";
  return POST(
    new NextRequest("https://example.com/api/ingest", {
      method: "POST",
      headers: { "content-type": isText ? "text/plain" : "application/json", ...headers },
      body: isText ? body : JSON.stringify(body),
    })
  ).then(async (res) => {
    const json = await res.json();
    // formatCurrency puts a non-breaking space after "RM".
    return { status: res.status, ...json, message: String(json.message ?? "").replace(/ /g, " ") };
  });
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  noReferenceColumn = false;
  inboxBroken = false;
  tables.api_tokens = [
    { id: "t1", user_id: USER, token_hash: hash(TOKEN), revoked_at: null },
    { id: "t2", user_id: USER, token_hash: hash(REVOKED), revoked_at: "2026-10-01T00:00:00Z" },
  ];
  tables.categories = [
    { id: "cat-food", name: "Food", role: "food", user_id: USER },
    { id: "cat-shop", name: "Shopping", role: null, user_id: USER },
  ];
  tables.tags = [
    { id: "tag-lunch", name: "Lunch", category_id: "cat-food", role: "lunch", user_id: USER },
    { id: "tag-dinner", name: "Dinner", category_id: "cat-food", role: "dinner", user_id: USER },
    { id: "tag-clothes", name: "Clothes", category_id: "cat-shop", role: null, user_id: USER },
  ];
  tables.merchant_rules = [{ pattern: "CONTOH", category_id: "cat-food", tag_id: "tag-lunch", user_id: USER }];
});

describe("tokens", () => {
  it("asks for a token when there isn't one", async () => {
    const res = await send({ text: RECEIPT }, {});
    expect(res.status).toBe(401);
    expect(res.message).toMatch(/^Not added: Missing token/);
  });

  it("accepts the token as x-api-token, Bearer or a bare Authorization value", async () => {
    const forms: Record<string, string>[] = [{ "x-api-token": TOKEN }, { authorization: `Bearer ${TOKEN}` }, { authorization: TOKEN }];
    for (const headers of forms) {
      tables.inbox_items = [];
      expect((await send({ amount: 5, merchant: "Test" }, headers)).status).toBe(200);
    }
  });

  it("says when a token was revoked, showing only its start", async () => {
    const res = await send({ text: RECEIPT }, { "x-api-token": REVOKED });
    expect(res.status).toBe(401);
    expect(res.error).toContain("was revoked");
    expect(res.error).toContain("bt_RRRR…");
    expect(res.error).not.toContain(REVOKED);
  });

  it("says when a token isn't recognised, and when it's the wrong length", async () => {
    const res = await send({ text: RECEIPT }, { "x-api-token": "bt_short" });
    expect(res.status).toBe(401);
    expect(res.error).toContain("Token not recognised (starts bt_shor…)");
    expect(res.error).toContain("It's 8 characters; a token has 46");
    const full = await send({ text: RECEIPT }, { "x-api-token": `bt_${"Z".repeat(43)}` });
    expect(full.error).not.toContain("characters");
  });
});

describe("adding to the Inbox", () => {
  it("adds a receipt with its tag from the merchant rules", async () => {
    const res = await send({ text: RECEIPT, source: "TNG" });
    expect(res).toMatchObject({ status: 200, ok: true, amount: 8.5, merchant: "KEDAI CONTOH", date: "2026-10-03", tag: "Lunch", pending: 1 });
    expect(res.message).toBe("RM 8.50 · KEDAI CONTOH\nAdded to Inbox → Lunch");
    expect(tables.inbox_items[0]).toMatchObject({
      user_id: USER,
      source: "tng",
      suggested_tag_id: "tag-lunch",
      suggested_category_id: "cat-food",
      reference: "20261003TNGDMYNB030OQR12345",
    });
    expect(tables.api_tokens[0].last_used_at).toBeTruthy();
  });

  it("accepts plain text", async () => {
    const res = await send(RECEIPT);
    expect(res.ok).toBe(true);
    expect(tables.inbox_items[0].raw_text).toBe(RECEIPT);
  });

  it("keeps a receipt whose amount is hidden, asking for it", async () => {
    const res = await send({ text: RECEIPT.replace("RM 8.50\n", "") });
    expect(res.ok).toBe(true);
    expect(res.message).toBe("Amount not found · KEDAI CONTOH\nAdded to Inbox: fill in the amount → Lunch");
  });

  it("marks transfers", async () => {
    const res = await send({ text: "Transferred\nRM 50.00\nTransfer to\nALI BIN ABU" });
    expect(res.message).toBe("RM 50.00 · ALI BIN ABU\nAdded to Inbox (transfer)");
  });

  it("saves without a reference before the reference migration", async () => {
    noReferenceColumn = true;
    expect((await send({ text: RECEIPT })).ok).toBe(true);
    expect(tables.inbox_items[0]).not.toHaveProperty("reference");
  });

  it("logs a failed save for the account, so Settings and Overview can show it", async () => {
    inboxBroken = true;
    const res = await send({ text: RECEIPT });
    expect(res.status).toBe(500);
    expect(tables.job_runs).toEqual([
      expect.objectContaining({ job: "ingest", ok: false, user_id: USER, detail: expect.stringContaining("database is down") }),
    ]);
  });

  it("refuses invalid JSON and too much text", async () => {
    const bad = await POST(
      new NextRequest("https://example.com/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-token": TOKEN },
        body: "{oops",
      })
    );
    expect(bad.status).toBe(400);
    expect((await send({ text: "x".repeat(9000) })).status).toBe(413);
  });

  it("stops at 500 waiting items", async () => {
    tables.inbox_items = Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, user_id: USER, status: "pending" }));
    const res = await send({ text: RECEIPT });
    expect(res.status).toBe(429);
    expect(tables.inbox_items).toHaveLength(500);
  });
});

describe("shops it remembers", () => {
  it("uses the meal for the payment time when a shop is remembered as Food alone", async () => {
    tables.merchant_rules = [{ pattern: "CONTOH", category_id: "cat-food", tag_id: null, user_id: USER }];
    const res = await send({ text: RECEIPT }); // paid at 7:15 PM
    expect(res.message).toBe("RM 8.50 · KEDAI CONTOH\nAdded to Inbox → Dinner");
    expect(tables.inbox_items[0]).toMatchObject({ suggested_category_id: "cat-food", suggested_tag_id: "tag-dinner" });
  });

  it("files a shop remembered as another category alone under that category, leaving the tag", async () => {
    tables.merchant_rules = [{ pattern: "CONTOH", category_id: "cat-shop", tag_id: null, user_id: USER }];
    const res = await send({ text: RECEIPT });
    expect(res.message).toBe("RM 8.50 · KEDAI CONTOH\nAdded to Inbox → Shopping");
    expect(tables.inbox_items[0]).toMatchObject({ suggested_category_id: "cat-shop", suggested_tag_id: null });
  });

  it("ignores rules pointing at someone else's tag", async () => {
    tables.tags.push({ id: "tag-other", name: "Other", category_id: "cat-x", role: null, user_id: "user-2" });
    tables.merchant_rules = [{ pattern: "CONTOH", category_id: "cat-x", tag_id: "tag-other", user_id: USER }];
    const res = await send({ text: RECEIPT });
    expect(res.message).toBe("RM 8.50 · KEDAI CONTOH\nAdded to Inbox");
    expect(tables.inbox_items[0]).toMatchObject({ suggested_category_id: null, suggested_tag_id: null });
  });
});

describe("accidental double-taps", () => {
  it("skips a screen with no payment on it", async () => {
    const res = await send({ text: "1:09\nMessages\nPhotos" });
    expect(res).toMatchObject({ status: 200, ok: false, skipped: true });
    expect(res.message).toBe("Not added: no amount found on this screen.");
    expect(tables.inbox_items ?? []).toHaveLength(0);
  });

  it("says when a screen was blank (an app that blocks screenshots)", async () => {
    const res = await send({ text: " \n9:41\n" });
    expect(res).toMatchObject({ status: 200, skipped: true });
    expect(res.message).toContain("Not added: nothing readable on this screen");
    expect(res.message).toContain("share its receipt to Log Receipt");
    expect((await send({ text: "" })).message).toContain("nothing readable"); // a black screenshot reads as nothing
  });

  it("skips the same receipt sent again, saying whether it's still waiting", async () => {
    await send({ text: RECEIPT });
    const again = await send({ text: RECEIPT });
    expect(again.message).toBe("RM 8.50 · KEDAI CONTOH\nNot added: already in your Inbox.");
    tables.inbox_items[0].status = "accepted";
    expect((await send({ text: RECEIPT })).message).toContain("you've already handled this one.");
    expect(tables.inbox_items).toHaveLength(1);
  });

  it("adds a second payment of the same amount at the same shop when its reference is new", async () => {
    await send({ text: RECEIPT });
    const second = await send({ text: RECEIPT.replace("12345", "67890") });
    expect(second.ok).toBe(true);
    expect(tables.inbox_items).toHaveLength(2);
  });

  it("without references (Apple Pay), skips the same amount and shop within 10 minutes", async () => {
    await send({ amount: 12, merchant: "Test Cafe", source: "applepay" });
    expect((await send({ amount: 12, merchant: "Test Cafe", source: "applepay" })).message).toBe(
      "RM 12.00 · Test Cafe\nNot added: already sent a moment ago."
    );
    expect((await send({ amount: 12, merchant: "Other Cafe", source: "applepay" })).ok).toBe(true);
    tables.inbox_items[0].created_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    expect((await send({ amount: 12, merchant: "Test Cafe", source: "applepay" })).ok).toBe(true);
  });
});
