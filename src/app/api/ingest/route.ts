import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { formatCurrency } from "@/lib/utils";
import { matchRule, parseCapture, referenceFromText, timeFromText } from "@/lib/ingest";
import { mealForHour } from "@/lib/roles";
import { logJobRun } from "@/lib/job-log";
import { createAdminClient, todayInMalaysia } from "@/lib/push-server";

// Adds a captured expense to the token owner's Inbox (Settings → Automation explains the
// Shortcut). Send JSON { text?, amount?, merchant?, date?, source? } or plain text, with
// "Authorization: Bearer <token>". It can only add Inbox items for that token's owner; it never
// returns any of their data beyond what it just parsed.

export const dynamic = "force-dynamic";

const MAX_BODY = 8_000; // characters
const MAX_PENDING = 500; // a runaway automation can't flood the Inbox

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN_LENGTH = 46; // "bt_" + 43 characters (32 random bytes, base64url)
// Errors also carry `message`, which the Shortcut shows as its notification.
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error, message: `Not added: ${error}` }, { status });
// Nothing wrong, just nothing to add (an accidental double-tap): 200, so the Shortcut doesn't error.
// When the payment was read, its amount and name go on the first line and the reason below, so a
// long shop name isn't cut short by the status.
const skip = (reason: string, what?: string) =>
  NextResponse.json({ ok: false, skipped: true, message: [what, `Not added: ${reason}`].filter(Boolean).join("\n") });
// "RM 10.00 · MENG KEE CHAR SIEW RESTAURANT": the first line of the Shortcut's notification.
const describe = (amount: number | null, merchant: string | null) =>
  [amount ? formatCurrency(amount) : "Amount not found", merchant].filter(Boolean).join(" · ");
const REPEAT_WINDOW_MS = 10 * 60 * 1000; // same amount, merchant and date sent again within 10 minutes

const hourInMalaysia = () =>
  Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kuala_Lumpur" }).format(new Date()));

type Db = NonNullable<ReturnType<typeof createAdminClient>>;
type Rule = { pattern: string; tag_id: string | null; category_id: string | null };

// The owner's rules. Before 2026-10-04_merchant_rule_categories.sql they only have a tag.
async function loadRules(db: Db, userId: string): Promise<Rule[]> {
  const res = await db.from("merchant_rules").select("pattern, tag_id, category_id").eq("user_id", userId);
  if (!res.error) return (res.data || []) as Rule[];
  const old = await db.from("merchant_rules").select("pattern, tag_id").eq("user_id", userId);
  return ((old.data || []) as { pattern: string; tag_id: string }[]).map((r) => ({ ...r, category_id: null }));
}

export async function POST(request: NextRequest) {
  // The token can come as "x-api-token: bt_…" (easiest in a shared Shortcut), "Authorization: Bearer bt_…",
  // or just "Authorization: bt_…".
  const strip = (v: string | null) => v?.trim().replace(/^Bearer\s+/i, "") || "";
  const token = strip(request.headers.get("x-api-token")) || strip(request.headers.get("authorization"));
  if (!token)
    return fail(
      "Missing token. Open the Log Payment shortcut and paste your token (Settings → Automation) into the first box.",
      401
    );

  const db = createAdminClient();
  if (!db) {
    console.error("[ingest] Not run: missing SUPABASE_SERVICE_ROLE_KEY.");
    return fail("Not set up on this deployment.", 500);
  }

  const { data: tok } = await db
    .from("api_tokens")
    .select("id, user_id, revoked_at")
    .eq("token_hash", sha256(token))
    .maybeSingle();
  // Say which problem it is, showing only the start of what was sent: enough to spot an old or
  // cut-off token without echoing it.
  const shown = `${token.slice(0, 7)}…`;
  if (tok?.revoked_at) {
    console.warn("[ingest] Refused: revoked token.");
    return fail(
      `This token (${shown}) was revoked. Paste your current token into the first box of the Log Payment shortcut.`,
      401
    );
  }
  if (!tok) {
    console.warn("[ingest] Refused: unknown token.");
    const length = token.length === TOKEN_LENGTH ? "" : ` It's ${token.length} characters; a token has ${TOKEN_LENGTH}.`;
    return fail(
      `Token not recognised (starts ${shown}).${length} Copy it again from Settings → Automation, or create a new one.`,
      401
    );
  }

  // Body: JSON fields, or plain text (e.g. text read off a screenshot).
  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail("Too much text sent.", 413);
  let input: { text?: unknown; amount?: unknown; merchant?: unknown; date?: unknown; source?: unknown } = {};
  try {
    input = (request.headers.get("content-type") || "").includes("json") ? JSON.parse(raw || "{}") : { text: raw };
  } catch {
    return fail("The Shortcut sent invalid JSON.", 400);
  }
  if (typeof input !== "object" || input === null) input = { text: String(input) };

  const userId = tok.user_id as string;
  const { count } = await db
    .from("inbox_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING) return fail(`Inbox is full (${MAX_PENDING} waiting). Confirm or dismiss some first.`, 429);

  const today = todayInMalaysia();
  const captured = parseCapture(input, today);
  const occurredOn = captured.date ?? today;
  const rawText = typeof input.text === "string" ? input.text : "";

  // The same receipt again: its reference numbers were seen before (even if already confirmed).
  const reference = rawText ? referenceFromText(rawText) : null;
  // Accidental double-taps: no amount and nothing that looks like a receipt (no payee, no reference)
  // means it wasn't a payment screen. A receipt whose amount was hidden (e.g. under a banner) is still
  // added, with the amount left for you to fill in.
  if (!captured.amount && !reference && !captured.merchant) {
    // Hardly any text: a black screenshot (some banking apps block them), not just a non-receipt.
    const readable = rawText.replace(/[^A-Za-z0-9]/g, "").length;
    if (typeof input.text === "string" && readable < 12) // sent screen text, but (almost) none was read
      return skip("nothing readable on this screen. If this app blocks screenshots (some banking apps do), share its receipt to Log Receipt instead.");
    return skip("no amount found on this screen.");
  }
  if (reference) {
    const { data: same, error: refError } = await db
      .from("inbox_items")
      .select("status")
      .eq("user_id", userId)
      .eq("reference", reference)
      .limit(1);
    // (refError: the reference migration hasn't been run yet; the time-window check below still works.)
    if (!refError && same?.length)
      return skip(
        same[0].status === "pending" ? "already in your Inbox." : "you've already handled this one.",
        describe(captured.amount, captured.merchant)
      );
  }
  // No reference (Apple Pay, Siri): the same amount, merchant and date a moment ago is a repeat.
  // (With references, a new one means a new payment, e.g. two RM 10 meals at the same stall.)
  if (!reference && captured.amount) {
    const { data: recent } = await db
      .from("inbox_items")
      .select("merchant")
      .eq("user_id", userId)
      .eq("amount", captured.amount)
      .eq("occurred_on", occurredOn)
      .gte("created_at", new Date(Date.now() - REPEAT_WINDOW_MS).toISOString());
    if (recent?.some((r) => (r.merchant ?? "") === (captured.merchant ?? "")))
      return skip("already sent a moment ago.", describe(captured.amount, captured.merchant));
  }

  // Suggest from the owner's merchant rules: the rule's tag, or for a shop remembered as Food alone,
  // the meal for the payment time (as the Inbox does); for another category alone, just the category.
  const rules = await loadRules(db, userId);
  const rule = matchRule(captured.merchant, rules);
  let tag: { id: string; name: string; category_id: string } | null = null;
  let category: { id: string; name: string; role: string | null } | null = null;
  if (rule?.tag_id) {
    ({ data: tag } = await db.from("tags").select("id, name, category_id").eq("id", rule.tag_id).eq("user_id", userId).maybeSingle());
  } else if (rule?.category_id) {
    ({ data: category } = await db.from("categories").select("id, name, role").eq("id", rule.category_id).eq("user_id", userId).maybeSingle());
    if (category?.role === "food") {
      const hour = (rawText ? timeFromText(rawText)?.hour : undefined) ?? hourInMalaysia();
      ({ data: tag } = await db
        .from("tags")
        .select("id, name, category_id")
        .eq("user_id", userId)
        .eq("category_id", category.id)
        .eq("role", mealForHour(hour))
        .maybeSingle());
    }
  }

  const source = typeof input.source === "string" && /^[a-z][a-z0-9_-]{0,19}$/i.test(input.source) ? input.source.toLowerCase() : "shortcut";
  const row = {
    user_id: userId,
    source,
    raw_text: rawText ? rawText.slice(0, 4000) : null,
    amount: captured.amount,
    merchant: captured.merchant,
    occurred_on: occurredOn,
    suggested_tag_id: tag?.id ?? null,
    suggested_category_id: tag?.category_id ?? category?.id ?? null,
  };
  let { error } = await db.from("inbox_items").insert({ ...row, reference });
  // Before 2026-10-03_inbox_reference.sql there's no reference column: save without it.
  if (error && ["42703", "PGRST204"].includes(error.code ?? "")) ({ error } = await db.from("inbox_items").insert(row));
  if (error) {
    console.error("[ingest] Couldn't save:", error.message);
    await logJobRun(db, "ingest", false, error.message, userId);
    return fail("Couldn't save to the Inbox. Try again.", 500);
  }
  await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", tok.id);

  // The Shortcut's notification: what was paid on the first line, what happened below it.
  const status = [
    captured.amount ? "Added to Inbox" : "Added to Inbox: fill in the amount",
    tag ? `→ ${tag.name}` : category ? `→ ${category.name.replace(/_/g, " ")}` : null,
    captured.isTransfer ? "(transfer)" : null,
  ]
    .filter(Boolean)
    .join(" ");
  return NextResponse.json({
    ok: true,
    message: `${describe(captured.amount, captured.merchant)}\n${status}`,
    amount: captured.amount,
    merchant: captured.merchant,
    date: occurredOn,
    tag: tag?.name ?? null,
    category: category?.name ?? null,
    pending: (count ?? 0) + 1,
  });
}
