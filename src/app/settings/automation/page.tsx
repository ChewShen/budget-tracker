"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ChevronDown, Copy, ExternalLink, KeyRound, Plus } from "lucide-react";
import { useBudget } from "@/lib/budget-context";
import { SHORTCUT_URL, useApiTokens } from "@/lib/automation";
import { MerchantRulesManager } from "@/components/merchant-rules-manager";

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="text-sm font-medium">{title}</div>
        {children && <div className="mt-1 space-y-2 text-sm text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-foreground">{children}</code>
);

export default function AutomationSettingsPage() {
  const { mode, showToast } = useBudget();
  const isCloud = mode === "cloud";
  const { tokens, error, create, revoke } = useApiTokens(isCloud);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [name, setName] = useState("iPhone Shortcut");
  const [isBusy, setIsBusy] = useState(false);
  const [endpoint, setEndpoint] = useState("/api/ingest");

  useEffect(() => setEndpoint(`${window.location.origin}/api/ingest`), []);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast({ tone: "default", message: `${what} copied` });
    } catch {
      showToast({ tone: "error", message: "Couldn't copy. Select it and copy by hand." });
    }
  };

  const sendTest = async () => {
    if (!newToken) return;
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": newToken },
      body: JSON.stringify({
        source: "shortcut",
        text: `Payment Successful\nRM 1.00\nPaid to\nTest Merchant\n${format(new Date(), "d MMM yyyy")}`,
      }),
    });
    const body = await res.json().catch(() => ({}));
    showToast(
      res.ok
        ? { tone: "default", message: (body.message || "Sent to Inbox").replace(/\n/g, " · ") }
        : { tone: "error", message: body.error || "Test failed" }
    );
  };

  if (!isCloud)
    return (
      <section className="card p-5 sm:p-6">
        <h3 className="text-[15px] font-semibold">Automation</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Shortcuts send expenses to your account, so this needs you to be signed in.
        </p>
      </section>
    );

  const active = tokens.filter((t) => !t.revoked_at);

  return (
    <>
      <section className="card p-5 sm:p-6">
        <h3 className="text-[15px] font-semibold">Set up in 3 steps</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          After paying with TnG (or anything that shows a receipt), double-tap the back of your iPhone. The payment
          goes to your <Link href="/inbox" className="underline underline-offset-2">Inbox</Link> to confirm.
        </p>
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}

        <ol className="mt-5 space-y-5">
          <Step n={1} title="Create your token">
            {newToken ? (
              <div className="rounded-xl border border-warning/50 bg-warning/10 p-3">
                <p className="text-xs font-medium text-foreground">Copy it now. It won&apos;t be shown again.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-background px-3 py-2 font-mono text-xs text-foreground">
                    {newToken}
                  </code>
                  <button
                    onClick={() => copy(newToken, "Token")}
                    className="shrink-0 rounded-full border p-2 text-foreground transition hover:bg-secondary"
                    aria-label="Copy token"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={sendTest} className="rounded-full border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-secondary">
                    Send a test to the Inbox
                  </button>
                  <button
                    onClick={() => setNewToken(null)}
                    className="rounded-full px-3 py-1 text-xs font-medium transition hover:bg-secondary"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setIsBusy(true);
                  const token = await create(name);
                  setIsBusy(false);
                  if (token) setNewToken(token);
                }}
                className="flex gap-2"
              >
                <input
                  value={name}
                  maxLength={40}
                  onChange={(e) => setName(e.target.value)}
                  className="field min-w-0 flex-1 py-2"
                  aria-label="Token name"
                  placeholder="e.g. iPhone Shortcut"
                />
                <button
                  type="submit"
                  disabled={isBusy}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> Create token
                </button>
              </form>
            )}
          </Step>

          <Step n={2} title="Add the Log Payment Shortcut">
            {SHORTCUT_URL ? (
              <>
                <a
                  href={SHORTCUT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
                >
                  Add the Shortcut <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <p>
                  On your iPhone: tap <strong className="text-foreground">Get Shortcut</strong>, then{" "}
                  <strong className="text-foreground">Set Up Shortcut</strong>, and paste your token when it asks.
                </p>
                <p className="text-xs">
                  If <strong className="text-foreground">Add Shortcut</strong> doesn&apos;t respond after pasting (an iPhone
                  bug), tap <strong className="text-foreground">Skip Configuration</strong>: your token is kept. Check it&apos;s
                  in the first box of Log Payment.
                </p>
              </>
            ) : (
              <p>
                Build it once in the Shortcuts app, following <strong className="text-foreground">Build it yourself</strong>{" "}
                below. It takes about two minutes.
              </p>
            )}
          </Step>

          <Step n={3} title="Turn on Back Tap">
            <p>
              iPhone <strong className="text-foreground">Settings → Accessibility → Touch → Back Tap → Double Tap</strong> →{" "}
              <strong className="text-foreground">Log Payment</strong>.
            </p>
            <p>
              Then turn <strong className="text-foreground">Show Banner off</strong> on that screen. Otherwise the banner
              can cover the amount at the top of the receipt.
            </p>
          </Step>
        </ol>

        <div className="mt-5 rounded-xl bg-secondary/60 px-4 py-3 text-sm">
          <span className="font-medium">Try it:</span>{" "}
          <span className="text-muted-foreground">
            open a TnG receipt (Activity → any payment) and double-tap the back of your phone. You&apos;ll see a
            notification like “RM 10.00 · Asian Food and Dessert / Added to Inbox”.
          </span>
        </div>
      </section>

      {active.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h3 className="text-[15px] font-semibold">Your tokens</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A token can only add to your Inbox; it can&apos;t read anything. Revoke it if your phone is lost.
          </p>
          <ul className="mt-3 divide-y divide-border/70">
            {active.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.token_prefix}… · created {format(parseISO(t.created_at), "d MMM yyyy")} ·{" "}
                    {t.last_used_at ? `last used ${format(parseISO(t.last_used_at), "d MMM, h:mm a")}` : "never used"}
                  </span>
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Revoke "${t.name}"? Shortcuts using it will stop working.`)) revoke(t.id);
                  }}
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5 sm:p-6">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[15px] font-semibold">Apps that block screenshots</span>
              <span className="block text-xs text-muted-foreground">
                e.g. Public Bank: share the receipt to a “Log Receipt” shortcut instead
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
          </summary>
          <p className="mt-4 text-sm text-muted-foreground">
            Some banking apps turn screenshots black, so a double-tap reads nothing (“Not added: nothing readable on
            this screen”). Their receipts can usually be shared as an image instead. Make a copy of Log Payment that
            takes a shared image, once:
          </p>
          <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-sm text-muted-foreground marker:text-foreground">
            <li>
              In <strong className="text-foreground">Shortcuts</strong>, press and hold{" "}
              <strong className="text-foreground">Log Payment</strong> → <Code>Duplicate</Code>. Rename the copy{" "}
              <Code>Log Receipt</Code>.
            </li>
            <li>
              Open it, tap <Code>ⓘ</Code> at the bottom and turn on{" "}
              <strong className="text-foreground">Show in Share Sheet</strong>.
            </li>
            <li>
              Delete the <Code>Take Screenshot</Code> action.
            </li>
            <li>
              In <Code>Extract Text from Screenshot</Code>, tap the blue <strong className="text-foreground">Screenshot</strong>{" "}
              and choose <strong className="text-foreground">Shortcut Input</strong>.
            </li>
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            Then, after paying: in the bank app tap <strong className="text-foreground">Share</strong> on the receipt →{" "}
            <strong className="text-foreground">Log Receipt</strong>. You get the same notification, and it lands in the Inbox.
            If the bank shares a PDF rather than an image, use <Code>Get Text from PDF</Code> instead of Extract Text.
          </p>
        </details>
      </section>

      <MerchantRulesManager />

      <section className="card p-5 sm:p-6">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-[15px] font-semibold">Build it yourself</span>
              <span className="block text-xs text-muted-foreground">The Log Payment Shortcut, action by action</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
          </summary>
          <ol className="mt-4 list-decimal space-y-2.5 pl-5 text-sm text-muted-foreground marker:text-foreground">
            <li>
              Open <strong className="text-foreground">Shortcuts</strong> → <Code>+</Code>, name it{" "}
              <Code>Log Payment</Code>.
            </li>
            <li>
              Add <Code>Take Screenshot</Code>.
            </li>
            <li>
              Add <Code>Extract Text from Screenshot</Code>.
            </li>
            <li>
              Add <Code>Get Contents of URL</Code> and set the URL to{" "}
              <button onClick={() => copy(endpoint, "URL")} className="break-all text-left font-mono text-[12px] text-foreground underline underline-offset-2">
                {endpoint}
              </button>
              . Tap ▸ to show more:
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                <li>
                  Method: <Code>POST</Code>
                </li>
                <li>
                  Headers → Add new header: left box <Code>x-api-token</Code>, right box your token
                </li>
                <li>
                  Request Body: <Code>JSON</Code> → add <Code>text</Code> = the blue <strong className="text-foreground">Extracted Text</strong>{" "}
                  variable, and <Code>source</Code> = <Code>tng</Code>
                </li>
              </ul>
              <span className="mt-1 block text-xs">
                Check the URL box has only the address. Shortcuts sometimes adds <em>Extracted Text</em> in front of it;
                delete that.
              </span>
            </li>
            <li>
              Add <Code>Get Dictionary Value</Code>: get the value for <Code>message</Code> in{" "}
              <strong className="text-foreground">Contents of URL</strong>.
            </li>
            <li>
              Add <Code>Show Notification</Code> with the <strong className="text-foreground">Dictionary Value</strong>.
            </li>
          </ol>
        </details>
      </section>

      <section className="card p-5 sm:p-6">
        <h3 className="text-[15px] font-semibold">Apple Pay and Siri</h3>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Apple Pay, automatic:</strong> Shortcuts → Automation → <Code>+</Code> →{" "}
            <Code>Transaction</Code> → your cards → Run Immediately. Use <Code>Get Contents of URL</Code> as above, with
            JSON <Code>amount</Code> = Amount, <Code>merchant</Code> = Merchant, <Code>source</Code> ={" "}
            <Code>applepay</Code>.
          </li>
          <li>
            <strong className="text-foreground">Siri:</strong> a Shortcut that asks for a number and some text and sends
            them as <Code>amount</Code> and <Code>merchant</Code>. Name it “Log expense” and say “Hey Siri, log expense”.
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Tick <strong className="text-foreground">Remember</strong> when adding an Inbox item and that shop&apos;s
          payments arrive already sorted (see Shops it remembers above).
        </p>
      </section>
    </>
  );
}
