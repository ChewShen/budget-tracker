# Roadmap & Idea Backlog

Ideas discussed but not built yet, so they aren't lost. Roughly most useful first within each group.
When one is picked up, move it to `docs/changelog.md` under the version that ships it.

---

## Now: strengthen what's there (agreed 2026-10-04)

New features are paused while the current app is made sturdier, in this order:
1. ~~**Data safety**: weekly encrypted backups with a tested restore, and background job health in the app~~ (v0.24.0).
2. ~~**Known rough edges**: bank-app receipt labels ("Payee Name" read as "Name", "Beneficiary Name", "Transfer Successful"), the goal-ownership gap on money set aside, the bill form's save button that can stay greyed out, and the `npm audit` warnings~~ (v0.24.1; the audit warnings are dev-only, see decisions).
3. **Browser tests (Playwright)** in CI: add an expense, confirm an Inbox item, record balances, edit a bill.
4. **Shortcut endpoint hardening**: a rate limit per token; security headers (CSP) on the site.
5. **Clean-up**: Recharts v3; Tailwind 4 (also clears the dev-only `braces` audit warning); check the August 2026 imported balances, then drop the `monthly_savings` backup table.

## Paused new features (agreed order; tests shipped in v0.22.0, shops it remembers in v0.23.0)

1. **Other income:** log bonuses, side income, refunds and money received, so the savings rate and the untracked-cash check stay right (only the fixed salary counts today). Transfers *in* could later arrive through the Inbox.
2. **Bank alerts by email:** forward Maybank/CIMB card and DuitNow alert emails to a private address (needs an email-receiving service, e.g. Cloudflare Email Routing → a worker → `/api/ingest`), so card and online spending the TnG double-tap misses lands in the Inbox too.

---

## Savings analytics

- **12-month projection**: "At your average saving of RM X/month plus interest, you'd have about RM Y by <month next year>". State the assumptions; only show with at least 2 recorded months.
- **Interest summary**: Estimated interest earned so far this year, and a nudge when money is sitting at 0% (e.g. "RM 500 in checking would earn about RM 17.75/year in GXBank at 3.55%").
- **Untracked cash history**: The monthly "untracked" amount over time, to see whether unlogged spending is a pattern or a one-off.
- **Reorder savings accounts**: Accounts are listed in the order they were added; let them be moved up and down in Settings → Savings accounts.

## Budgeting

- **Salary history**: Salary changes apply to all months today; keep a dated history so past savings rates stay correct.

## Faster entry

- **Offline adding**: Service worker + queue so the installed app opens without signal and syncs expenses later.
- **Duplicate warning**: Ask before saving the same tag, amount and date twice within a minute.
- **Tune TnG parsing** with real TnG success screens and notifications (the Inbox's "original" text shows what was read).
- **Bank app receipts (iPhone double-tap)**: the common labels (Payee Name, Beneficiary Name, Recipient Name, Merchant Name, To:, Transfer Successful) are read since v0.24.1. Still worth real samples from each bank app (copied from an Inbox item, names and numbers swapped for fake ones) to add to `tests/ingest.test.ts`.
- **Android capture (later)**: the endpoint works from any device; only capturing differs. Android lets automation apps read other apps' notifications, so it can be fully automatic: MacroDroid (or Tasker) "Notification received" from TnG/bank apps → HTTP POST to `/api/ingest` with the `x-api-token` header and `{"text": title + text, "source": "android"}`. Needs: a sentence rule for the payee ("You have paid RM10.00 to NAME"; today's rules expect a label at the start of a line), sample notification texts per app, an Android section in Settings → Automation, the guide and Help. Banks that hide details in notifications ("You have a new transaction") can't be captured this way. Only worth doing once someone using the app has an Android phone.
- **Bank statement CSV import**: Match against logged expenses and suggest anything missing.
- **Rename from the bill form**: A "Rename" field in Settings → Monthly bills that renames the underlying tag.

## Robustness

- See "Now: strengthen what's there" at the top for the agreed list (browser tests, Recharts v3, …).

## Data housekeeping

- **Keep real data out of git**: `*.xlsm`, `*.xlsx`, `scripts/seed_data.sql` and `private/` are gitignored, and local git hooks (pre-commit, commit-msg, pre-push, using a gitignored list in `private/guard/`) block commits and pushes containing real personal data. Hooks live only in `.git/hooks`: when cloning elsewhere, copy `private/` and reinstall them. The earlier private repository (with the original, unscrubbed history) is archived and no longer used.

- Check August 2026 balances from the Excel import (Main checking RM 0, EPF RM 10 look wrong).
- Once the new savings accounts look right, `monthly_savings` (kept as a backup by `2026-09-30_savings_accounts.sql`) can be dropped.

## Later, bigger

- **Local-first native app** (discussed, not started): an Expo (React Native) app with the data in SQLite on the phone, so nothing is readable by whoever runs the server, it works offline, and reminders become on-device notifications (no VAPID, cron or service-role key). The pure logic in `src/lib/` carries over as is; the screens and the data layer would be rewritten. Optional end-to-end encrypted sync later for multiple devices (PowerSync / ElectricSQL or encrypted backups). First step whenever it's picked up: put the data layer behind an interface (load, save expense, save balances…) with Supabase and local storage as two implementations. **Capturing payments natively:** on Android the app itself could read TnG and bank notifications (a notification listener the user allows under Notification access; needs a native module in an Expo dev build, Play Store review of the permission, or "Allow restricted settings" when installed outside the Play Store), so no MacroDroid and no server needed for capture. On iPhone a native app gains nothing here: iOS never lets apps read other apps' notifications, so Shortcuts (double-tap, Apple Pay automation) or a Share-sheet extension ("share screenshot to the app", read on the phone) stay the way in.
- **Optional end-to-end encryption** for accounts that want privacy from the database owner, accepting that server features (nightly reminders, auto-add) wouldn't work for them.
