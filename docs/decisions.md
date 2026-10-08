# Design Decisions

Why the app is built the way it is: the tools, the architecture and the trade-offs behind each feature.
Each entry covers what was chosen, why, and what it costs. For what changed and when, see [`changelog.md`](changelog.md); for ideas not built yet, see [`roadmap.md`](roadmap.md).

---

## 1. Platform & stack

### Web app installed as a PWA, not a native app
- **Why:** One codebase runs on iPhone, Android and desktop. "Add to Home Screen" gives a full-screen app icon without App Store or Play Store accounts, reviews or fees. Updates ship the moment Vercel deploys.
- **Trade-off:** Some iOS features are limited for web apps. Push notifications only work from the Home Screen app (iOS 16.4+), and the layout has to handle the notch and status bar itself (`viewportFit: "cover"`, safe-area padding, `statusBarStyle: "black"`).

### Next.js 15 (App Router) + React 19 + TypeScript
- **Why:** Next.js covers the pages and the small amount of server code the app needs (the reminder API routes and the login middleware) in one project, and Vercel hosts it with no configuration. TypeScript catches data-shape mistakes early, which matters when the same records come from Supabase, localStorage or generated demo data.
- **Trade-off:** Most pages are client components, because the data lives in one client-side store (see [Data layer](#2-data)). Server rendering is barely used, which is fine for a personal app behind a login.

### Tailwind CSS with design tokens
- **Why:** Colours are HSL tokens in `globals.css` (`--primary`, `--danger`, …), so the dark theme (default) and the light theme are the same classes with different values. Lime is an accent fill only; lime-ish text uses `text-highlight`, which is darkened in light mode so it stays readable.
- **Also:** A custom `pointer-fine` variant tells mouse from touch: scroll arrows and hover states for desktop, swipe for phones.

### Recharts, date-fns, lucide-react
- **Recharts** for the trend and savings charts, because it's declarative React and good enough for a handful of charts. Simple visuals (category bars, the spending calendar) are plain HTML/CSS, which is lighter and more accessible. Recharts v2 is deprecated; the upgrade is on the roadmap.
- **date-fns** for month maths (days in month, due dates clamped to the month's end, "3 days to expiry"). It's tree-shakeable and works on plain `Date`s.
- **lucide-react** for icons: consistent stroke style, and only the icons used get bundled. Category icons are stored as keys (`categories.icon`) so they survive renames.

### Supabase (Postgres + Auth)
- **Why:** A real relational database with auth, row-level security, triggers and scheduled jobs (`pg_cron`) on a free tier, with no backend server to maintain. The spreadsheet this app replaced was already relational (transactions → categories → tags).
- **Logic that must always happen lives in the database:** New accounts get their profile and default categories from a trigger on `auth.users` (`seed_new_user`), and due bills are added by `pg_cron`. Neither depends on the app being open or on client code being right.
- **Trade-off:** Security depends on RLS policies being right (see [Security](#3-security--privacy)), and schema changes are hand-written SQL migrations run in the SQL Editor.

### Vercel hosting
- **Why:** Deploys on every push to `main` with preview builds for PRs, runs the API routes, and provides the daily cron for reminders. All on the free tier.
- **Trade-off:** On the free plan the cron can run up to about an hour late, so reminders say "around 8pm".

---

## 2. Data

### One client-side store with optimistic updates (`src/lib/budget-context.tsx`)
- **Why:** One person's data is small (thousands of rows), so the app loads it all when it opens (in batches, see below) and every page computes from memory. Adding, editing and deleting update the screen immediately, then save in the background. If a save fails, the change rolls back and the toast offers **Retry**. Deletes have a 5-second **Undo**.
- **Trade-off:** The context file is large, and it would need paging or server-side queries if the data grew a lot.

### Expenses are fetched in batches, not in one full request
- **What:** `src/lib/supabase/fetch-all.ts` requests expenses 1,000 at a time (`.range(from, to)`, ordered by date then id) and keeps going until a batch comes back empty.
- **Why not one request:** Supabase (PostgREST) caps every response at the project's "max rows", 1,000 by default. A single "select everything" silently returned only the newest 1,000, so past that point older expenses would have quietly disappeared from totals, trends and year to date, with no error.
- **Why stop on an empty batch, not a short one:** If a project's limit were set lower (say 500), a "stop when a batch has fewer than 1,000 rows" loop would end after the first batch. Reading until an empty batch works with any limit, for one tiny extra request.
- **Why date then id:** A stable order means no expense is skipped or repeated between batches, even when many share a date.
- **All or nothing:** If any batch fails, the load fails with an error instead of showing partial data that looks complete.
- **Why not load only 50 (or one month):** The forecast, 3-month averages, 12-month trends, year to date, budgets and reminders all need the history, so loading less would make those numbers silently wrong. The cost of loading everything is small: about 150 bytes per expense, so 5,000 expenses is about 750 KB in 5 batches (plus the final empty one).
- **Drawing is what's paged:** Rendering thousands of rows is what actually slows a phone down, so the Transactions list draws 50 at a time with **Show 50 more**. Search, filters and day totals still use every expense.
- **When to change:** Around 10,000+ expenses, move the totals into SQL (views or RPC functions) and load only recent months up front, fetching older ones when opened.

### Three data modes: cloud, local, guest
- **Cloud:** Supabase configured and signed in. The real app.
- **Local:** Supabase not configured (placeholder `.env.local`). Data is kept in `localStorage`, so the app can be developed and demoed without a database.
- **Guest:** "Continue without an account" on the login page. Generated demo data in memory only: no database requests and nothing in `localStorage`, so a refresh starts fresh. RLS would block a guest anyway; guest mode just avoids the requests.
- **Why:** A portfolio visitor can try the full app without an account, and nothing they do can touch real data.

### Demo data is generated, not real
- **Why:** `src/lib/mock-data.ts` generates plausible months of spending relative to today from a seeded random generator, so the demo always looks current and is the same on every load. Real figures were removed from the codebase and from git history (see [Privacy](#real-data-never-in-the-repo)).

### Migrations as dated, re-runnable SQL files
- **Why:** `scripts/migrations/YYYY-MM-DD_name.sql`, run once in the Supabase SQL Editor in the order the README lists them (files from the same day depend on each other, so file names alone don't give the order). Every file uses `IF NOT EXISTS` / `DROP … IF EXISTS`, so running one twice is harmless, and each ends with a check query that shows it worked.
- **Missing tables are tolerated:** Optional features (bills, goals, budgets, reminders, savings accounts) keep the rest of the app working if their migration hasn't been run yet, and the error message names the file to run. Before the savings-accounts migration, the old balances are shown read-only.
- **Old scripts can't undo new ones:** Once the multi-user migration has run, `secure_rls.sql` refuses to run and the older category and bill migrations skip the steps that would re-open or cross accounts, because "safe to re-run" has to stay true for every file.
- **Tested against real Postgres, in CI:** `tests/db/` replays the whole history on an in-memory Postgres (PGlite): the README's initial tables, an example import, `secure_rls.sql`, every migration in the README's order, then every migration again. It then signs in as two accounts and checks that neither can see, change or point at the other's data. This caught a bug where the savings migration would have created no accounts (`EXECUTE` doesn't set `FOUND` in PL/pgSQL), and found that the README's order, not the file names, is the real order.
- **Trade-off:** No migration tool tracks what has run. For one database, maintained by one person, this is simpler than setting up a migration CLI.

### Savings accounts are rows, not columns
- **Why:** Savings started as one row per month with fixed columns copied from the spreadsheet (main checking, GXBank + rate, RYT + rate, EPF). That only fit one person's banks. Now each person has their own accounts (`savings_accounts`, liquid or locked) and one balance per account per month (`savings_balances`, with that month's interest rate).
- **Liquid vs locked:** Locked money (EPF, fixed deposits) counts toward net worth but not the emergency fund or "free money".
- **Archive, don't delete:** An account with history can't be deleted, because that would rewrite past net worth. Archived accounts aren't asked for in new months but still show in the months they have balances, and in "Since last month" as going to RM 0.
- **Migration keeps the numbers:** Existing months are copied per column, skipping the all-zero months the Excel import created and columns never used. The same conversion runs in the app for local-mode data and the demo, and the migration's check query compares net worth before and after.

### Categories and tags are data, not code, and per account
- **Why:** They started hard-coded from the spreadsheet. They now live in tables that can be edited in Settings, and renaming keeps every past expense linked, because expenses reference ids, not names.
- **Per account:** With one user they were shared lookup tables. Once friends could have accounts, sharing meant anyone could rename or delete everyone's categories, so each account now owns its own (names unique per account). New accounts get a default set from a database trigger, so they can log an expense straight away.
- **References are checked, not just rows:** RLS also checks that an expense, bill or budget points at the account's *own* category and tag, so ids from another account can't be used even if known.
- **Marked, not matched by name:** The Food & dining card and the meal Add expense suggests for the time of day used to look for a category called "Food" and tags called "Lunch", "Dinner" and so on, so renaming them quietly broke both. They're now found by a mark (`categories.role`, `tags.role`), shown as a star in Settings, and can be renamed freely. Locking those names was the alternative, but it would stop friends using their own wording ("Makan"). Deleting a starred one asks first rather than being blocked.

---

## 3. Security & privacy

### Email + password sign-in, no public sign-up
- **Why:** Magic-link (email OTP) sign-in needed a custom SMTP server to be reliable. Email + password works on Supabase's defaults.
- **Accounts are added by hand:** Public sign-up stays off, because the site is public as a portfolio and anyone could otherwise create accounts on the free-tier database. Friends are added in the Supabase dashboard with a temporary password (Supabase's built-in email only reaches the project team, so invite emails wouldn't arrive) and change it in Settings → Account.

### Row-Level Security on every table
- **Why:** The anon key is public: it's in the JavaScript bundle by design. What keeps other people out is RLS. Every table has an owner-only policy (`user_id = auth.uid()`), and `user_id` defaults to `auth.uid()`, so the app never sends it.
- **Middleware is only a convenience:** it redirects signed-out visitors to `/login`, but the data is protected by RLS, not by the redirect. API routes skip the redirect and check auth themselves.

### Real data never in the repo
- **Why:** The repository is public as a portfolio piece. Real finances were in the history of an earlier repository, so the public repo was rebuilt with a scrubbed history (`git filter-repo`), and the old one was made private and retired.
- **Guards:** The Excel file, seed SQL and `private/` are gitignored. Local git hooks (pre-commit, commit-msg, pre-push) block commits and pushes that contain markers of real data. The hooks live in `.git/hooks` and aren't committed, so they have to be reinstalled on a new clone.

### Server secrets stay server-side
- `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS), `VAPID_PRIVATE_KEY` and `CRON_SECRET` are only read in `src/lib/push-server.ts` and the API routes, and are never `NEXT_PUBLIC_`. Because the service role bypasses RLS, the reminder job filters every query for a person's data (expenses, bills, budgets, goals, devices) by `user_id`. Categories and tags are the exception: they're only looked up by id from that person's own rows, which also keeps the job working on databases from before the multi-user migration.
- **`NEXT_PUBLIC_` values are baked in at build time:** The public VAPID key is copied into the JavaScript when the app is built, so changing it needs a redeploy (or a dev-server restart locally), unlike server-only variables.

---

### Weekly backups: pg_dump + age in GitHub Actions
- **Why:** Supabase's free plan gives no backups to download, and the app's only copy was the live database. A scheduled GitHub Actions job (`.github/workflows/backup.yml`) runs `scripts/backup.sh` weekly: `pg_dump` of the public schema (tables, data, policies, functions) and of `auth.users`, so passwords survive a restore.
- **Encrypted before upload:** The repository is public, and Actions artifacts of a public repository can be downloaded by anyone signed in to GitHub. Each backup is encrypted with [age](https://age-encryption.org) for one public key; the private key stays with the owner, off GitHub. Kept 90 days.
- **Restore is tested, not assumed:** `tests/backup/roundtrip.sh` runs in CI on two real Postgres 17 containers: build the database from the README and migrations, back it up, restore into an empty one, re-run the migrations, and compare counts, totals, policies, functions, the sign-up trigger and the cron job. This is how the restore script learned that a new project already has the `public` schema and keeps `uuid-ossp` in `extensions`.
- **What's not in the backup:** the trigger on `auth.users` and the pg_cron schedule live outside `public`; re-running the migrations (safe by design) recreates them, which the round trip checks.
- **Trade-off:** The database connection string is a GitHub secret with full access. It's only exposed to this workflow (schedule or manual start, never fork PRs), and resetting the database password revokes it.

### Background jobs report to the app (`job_runs`)
- **Why:** Vercel keeps logs for about an hour, so a nightly job could fail for weeks unnoticed. The reminder route, the pg_cron auto-add (which now catches its own error so the failure is logged rather than rolled back), the backup workflow and failed Shortcut saves write a row to `job_runs`.
- **Shown where it's noticed:** Settings → Account lists each job's last run; Overview shows a warning when one failed, is late (nightly jobs after 26 hours, the backup after 8 days), or a Shortcut payment couldn't be saved this week. A job that has never run isn't a warning (not set up yet). The rules are pure functions (`src/lib/job-health.ts`), tested.
- **Privacy:** App-wide rows carry no counts or anyone's data, only ok/failed and an error message; a Shortcut error is visible only to its account.

### Dependency audit: runtime first
- **Rule:** `npm audit --omit=dev` (what ships to users and the server) must be clean; anything there is fixed straight away. Dev-only findings are judged on whether untrusted input can reach them.
- **As of v0.24.1:** runtime is clean. `npm audit` reports 7 "high" findings that are all one advisory in `braces` (stack exhaustion from deeply nested glob patterns), pulled in only by Tailwind 3 and `eslint-config-next` at build time, which only ever see the project's own patterns. No fixed `braces` exists; `npm audit fix --force` would jump to Tailwind 4, a breaking rewrite of the styling setup. Left as is; Tailwind 4 is on the roadmap's clean-up list as its own change.

## 4. Features

### Salary and interest maths match the spreadsheet
- **Why:** The app replaced an Excel workbook, so EPF/SOCSO/EIS deductions and daily-compounded interest must give the same numbers. `tests/logic.test.ts` checks the app's own functions against the Excel results, and CI runs it on every push and PR.

### Month-end forecast: stretch only everyday spending
- **Why:** A naive "spent so far ÷ days × month" makes the 1st of the month look terrible after rent. Bills and one-off purchases count once as they are, plus bills still to come. Only everyday spending is projected forward. The Budgets card uses the same rule (`src/lib/budgets.ts`).

### Monthly bills are tags
- **Why:** A bill (Netflix, electricity) is already a tag on its expenses, so a bill is just "this tag, monthly, with an optional amount and due day". Whether it's been paid this month is simply whether an expense with that tag exists this month. There's no separate payment record to keep in sync.

### Auto-add bills with `pg_cron`, in the database
- **Why:** Fixed bills should appear on their due day even if the app isn't opened. A Postgres function run daily by `pg_cron` (00:05 Malaysia time) does it next to the data, with no external scheduler. In local mode the app runs the same rule on load.

### Goals net of trade-in and vouchers
- **Why:** What you actually need to save for a new phone is its price minus the old phone's trade-in value and any vouchers still valid. Expired vouchers stop counting automatically. **Bought it** logs the real price as a one-off expense, so the goal and the spending stay consistent.

### Instalments are bills that end
- **Why:** Buying on instalments means a fixed amount leaves your account each month for N months. That's exactly a monthly bill with an end, and bills already have due days, "Due in 2 days / Overdue", reminders and auto-add. So a plan is a `recurring_sentinel` row with `installment_count` and `start_month` (and `goal_id` when bought from Goals), not a new kind of record.
- **Spending is the payments, not the price:** Each payment counts in the month it's paid, so budgets, the forecast and the savings rate follow real cash flow. Logging the full price at purchase would make that month look terrible and the next ones too good. The down payment is a one-off expense on the day.
- **One rule for "is it running this month":** `billActiveIn()` (`src/lib/instalments.ts`) is used by the Overview bills list (which feeds the forecast and budgets), reminders and local auto-add; the database's `auto_log_bills()` has the same condition. A plan never shows up before its first payment or after its last.
- **Payments count by amount, not by month** (v0.25.0): progress is what's been paid toward the plan (its tag, from the month before the first payment), so paying a month early, two at once or the rest at once all count. Auto-add and reminders use the same rule, `planShortfall()`: this month's amount minus anything paid ahead in earlier months minus what's paid this month. A month missed earlier isn't added on top, so auto-add never adds more than one payment a month; the database test caught a first version that would have re-added every night after a missed month. The SQL mirrors it in `auto_log_bills()`.
- **What's owed is a debt:** Savings shows what's still owed and net worth after it, counted from when the plan was taken out, so past months aren't changed by a later purchase.
- **Money in whole sen:** Plan terms are calculated in integer sen, because decimal ringgit in floating point can land just under a half sen and round the wrong way. The extra cost over paying upfront is the fees only, so a 0% plan never looks more expensive because of rounding.

### Automation: Shortcuts → an Inbox, not straight into spending
- **Why Shortcuts:** Bank linking isn't available to an individual app in Malaysia, but the payment already shows up on the phone. iOS Shortcuts can read the screen (TnG's success page), get Apple Pay purchases, or take a Siri command, and send them over HTTPS. A web app can't add its own Shortcut actions the way App Store apps do, so the Shortcut uses the standard "Get Contents of URL" with a personal token.
- **The phone sends text; the app does the parsing:** Screenshots are read on the iPhone and only the text is sent. Parsing (`src/lib/ingest.ts`: amount, merchant, date, ignoring balance and cashback lines) lives in the app, so it can be improved without anyone rebuilding their Shortcut.
- **An Inbox, not automatic entries:** Screen reading and parsing can be wrong, and a wrong amount quietly corrupts budgets and savings. Items wait to be confirmed (one tap when the suggestion is right). Merchant rules are saved when you tick Remember on an item, keyed on the merchant's first distinctive word (matched as whole words, so other branches match too), and managed in Settings → Automation.
- **A rule is a category, the tag is optional:** "TEALIVE → Food" keeps the meal following the payment time (the same `mealForHour` rule as Add expense), which a fixed tag can't do; "GRAB → Transport · Grab" fixes the tag. A category on its own for anything else files it there and leaves the tag to you. The endpoint and the Inbox share the matching and the defaults (`matchRule` in `ingest.ts`, `inboxDefault` in `src/lib/inbox.ts`), and the Inbox re-applies the current rules to waiting items, so editing a rule in Settings changes them straight away. RLS requires the tag to be in the rule's category.
- **Tokens can only add to your Inbox:** Only a SHA-256 hash is stored (the token is shown once), the endpoint looks it up with the service role and writes only for that token's owner, never returns data beyond what it just parsed, rejects bodies over 8,000 characters, and stops at 500 waiting items. Tokens are revoked rather than deleted, so "last used" stays visible.
- **Order chosen:** TnG first (most common way to pay here), then bank alerts and statements, then Apple Pay. On iPhone, TnG needs the screen-reading route because iOS doesn't let apps read other apps' notifications.

### Budgets are one row per category
- **Why:** A monthly limit per category (`UNIQUE (user_id, category_id)`) covers the common need without the complexity of per-month or rollover budgets. At-risk uses the same forecast rule as the Overview, so the two never disagree.

### Reminders: Web Push + Vercel Cron, rules shared with the UI
- **Web Push (VAPID):** Works on iPhone (Home Screen app), Android and desktop with no third-party notification service or per-message cost. The `web-push` library signs messages on the server.
- **Vercel Cron → `/api/reminders`:** Sending a push needs the VAPID private key and an HTTP call from Node. That's simple in a Next.js route and awkward from `pg_cron`. The route is guarded by `CRON_SECRET`.
- **Shared rules (`src/lib/reminders.ts`):** Pure functions used by both the job and the Settings "Tonight" preview, so what the preview shows is exactly what gets sent.
- **Sent once:** `reminder_log` stores a key per occurrence (e.g. `budget:<category>:2026-09:over`), so a budget warns once when it passes 80% and once when it goes over, not every evening. Devices that have unsubscribed (HTTP 404/410) are removed automatically.
- **Service worker handles push only:** No offline caching, so the app always loads fresh and a stale cache can't cause bugs. Offline use is on the roadmap as its own piece of work.

---

## 5. Process & tooling

### Branches: `chewshen` → `dev` → `main`
- Work happens on `chewshen`, gets integrated on `dev`, and `main` is what Vercel deploys. See [`release-flow.md`](release-flow.md).

### One commit per feature, Conventional Commits
- `feat(scope): …`, `fix(scope): …`, `docs: …`, `chore(release): …`. Each commit builds on its own, so history is easy to read and any commit can be reverted cleanly.

### Semantic versioning, changelog and annotated tags
- `npm version <patch|minor> --no-git-tag-version`, a changelog entry, a `chore(release)` commit and an annotated `vX.Y.Z` tag. See [`version-bump.md`](version-bump.md).

### Changes are verified the way they'll be used
- Besides type-check and lint: UI changes are clicked through in headless Chrome (desktop and phone widths, via the DevTools protocol), server routes are run against an in-memory fake of Supabase, and push notifications were checked end to end through Google's push service. Bugs found this way are fixed before committing and mentioned in the commit.

### Automated tests in CI
- **What:** Vitest (`npm test`, about a second): the money and date logic, receipt reading, the `/api/ingest` endpoint against a stand-in database, and the database itself on PGlite (migrations plus RLS between two accounts). GitHub Actions (`.github/workflows/ci.yml`) runs type-check, lint, the tests and a production build on every push to `chewshen`, `dev` and `main` and on PRs, so a ❌ shows before merging.
- **Why these and not browser tests first:** These are what can quietly go wrong: money maths, privacy between accounts, and the parser that turns screenshots into expenses. They're fast and don't need a real Supabase or any secrets. Browser tests (Playwright) come later.
- **Why tests import the app's own code:** The first formula test copied the formulas into the test file, so it checked the copy, not the app. Tests now import from `src/lib`.
- **Tests must be able to fail:** New checks are proven by breaking the code on purpose (e.g. removing one ownership rule from a migration) and watching the right test go red.
- **Example data only:** Test receipts and accounts use made-up names and numbers, like everything in the repo.
- **Checks run on a clean checkout:** Before pushing, checks run in a separate worktree, so leftover local files (a running dev server's `.next`, uncommitted changes) can't hide a broken commit.
