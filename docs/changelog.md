# Changelog

All notable changes to the **Personal Budget & Wealth Tracker** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- See [`docs/roadmap.md`](roadmap.md) for the idea backlog.
- [ ] Configure custom domain (optional).

---

## [0.27.0] - 2026-10-08

### Added
- **Your own order for categories**: Settings → Categories & tags → **Reorder**, with ↑ ↓ on each category. Add expense, the Inbox, Activity's filters and Budgets follow it; charts still sort by amount. Existing categories start in alphabetical order; new ones go at the end (migration `2026-10-08_category_order.sql`).
- **Reorder savings accounts** the same way (Settings → Savings accounts), which sets the order they're listed in when you record balances.

---

## [0.26.0] - 2026-10-08

### Changed
- **Instalment plans bought from Goals get their own category, "Instalments"** (renamable, not deletable, starred like the food category), so committed payments don't count as new Shopping or use up a Shopping budget. Bought it → Instalments no longer asks for a category; only a down payment asks for its category and tag. Existing plans bought from Goals move there with their past payments (migration `2026-10-08_instalments_category.sql`); plans made in Settings → Monthly bills stay where you put them.

---

## [0.25.0] - 2026-10-08

### Changed
- **Instalment payments count by amount, not by month.** Paying a month early, two months at once, or part of a month all count toward the plan ("2 of 6 paid · RM 400 left"). Auto-add and reminders skip months already covered and only add what's still short; a missed earlier month is never added on top (migration `2026-10-08_instalments_by_amount.sql` for the nightly auto-add).

### Added
- **Pay off the rest** on a plan (Goals → Paying off, and the plan in Settings → Monthly bills): logs what's left as one payment today, and the plan shows Paid off.

### Fixed
- A plan paid ahead or paid off early no longer gets the monthly amount auto-added again, and no longer shows as due.

---

## [0.24.4] - 2026-10-05

### Added
- **Inbox: the name is editable.** It's filled with the shop as read, or empty ("Shop or note (optional)") when none was found; what you type is saved as the expense's note.
- **Activity: + on each day** adds an expense on that date.

### Changed
- **Clearer "Remember" choices:** "Always food, meal by time" or "Always Food · Coffee" (or "Always Shopping, I pick the tag"), defaulting to what you picked: a meal tag keeps the meal following the time, another tag (e.g. Coffee) is kept as is.

### Fixed
- **ZUS app receipts** get the shop name from "ZUS Wallet Balance" when nothing else names it, and the small raised "RM" read on its own line no longer loses the amount.

---

## [0.24.3] - 2026-10-04

### Added
- **Banking apps that block screenshots** (e.g. Public Bank): a black screenshot now says "Not added: nothing readable on this screen…" instead of "no amount found", and Settings → Automation → *Apps that block screenshots* (also in the guide and Help) shows how to make **Log Receipt**, a copy of the shortcut you share a receipt to from the bank app.

### Fixed
- **Public Bank receipts** are read: the payee under "Recipient Account", "Money Sent" as a transfer, and a time with fractions of a second ("10:07:41.13 PM") keeps its PM. A status code like "U000" is never taken as the payee.

---

## [0.24.2] - 2026-10-04

### Fixed
- **Hong Leong Bank transfers** are read correctly: the amount shown without "RM" ("Transfer Amount (MYR)" above "10.00"), the payee under "To", the payment time, and that it's a transfer.
- **A reference number containing "RM"** (e.g. "…ORM21103782") is no longer read as an amount of millions, on any receipt.
- A masked account number ("****1234") is never taken as the payee.

---

## [0.24.1] - 2026-10-04

### Fixed
- **Banking apps' receipts**: "Payee Name" is no longer read as the payee "Name", "Beneficiary Name" is understood (also when the labels come before the values), and "Transfer Successful" is marked as a transfer.
- **Money set aside** can only be for one of your own goals, like every other link between your data (migration `2026-10-04_goal_contributions_owner.sql`).
- **Monthly bills**: Save no longer stays greyed out after trying to save an instalment plan with missing details.

### Changed
- Dependencies reviewed: nothing that ships to the app has a known vulnerability; the remaining `npm audit` warning is in build tools only (see `docs/decisions.md`).

---

## [0.24.0] - 2026-10-04

### Added
- **Weekly encrypted backups** of the whole database (tables, data, privacy rules, functions and accounts), every Sunday at 2am Malaysia time or on demand (GitHub → Actions → Backup → Run workflow). Each backup is encrypted with the owner's [age](https://age-encryption.org) key before upload, since the repository is public, and kept for 90 days. `scripts/restore-backup.sh` restores into a new, empty Supabase project. Set-up and restore steps: README → Backups.
- **Restores are tested in CI**: every push backs up a sample database on real Postgres 17, restores it into an empty one, re-runs the migrations and checks everything came back (counts, totals, privacy rules, the new-account trigger, the nightly schedule).
- **Background jobs in Settings → Account**: when the nightly reminders, the nightly bill auto-add and the weekly backup last ran, and the error when one failed.
- **A warning on Overview** when a background job failed, missed its run, or a payment from your Shortcut couldn't be saved this week.

### Changed
- The nightly bill auto-add records each run, and records a failure instead of losing it (migration `2026-10-04_job_runs.sql`).
- The roadmap pauses new features while the current app is made sturdier.

---

## [0.23.0] - 2026-10-04

### Added
- **Shops it remembers**: in the Inbox, tick **Remember "SHOP" as** and choose:
  - **Food (meal by time)**, the default for food: the shop is always Food and the meal follows when you paid (8am Breakfast, 9pm Dinner);
  - a **category and tag**, e.g. Transport · Grab;
  - **another category on its own**, e.g. Shopping, with the tag left to you.

  Payments from that shop then arrive already sorted, with a line saying why, and count for **Add all ready**. The phone notification says what was picked ("→ Dinner").
- **Settings → Automation → Shops it remembers**: see, change or forget remembered shops, or add one before you've paid there. Editing a rule updates Inbox items that are still waiting.

### Changed
- Remembering a shop can store a category without a tag (migration `2026-10-04_merchant_rule_categories.sql`; existing rules keep their tag). A rule's tag must be in its category.

---

## [0.22.0] - 2026-10-03

### Added
- **Automated tests**, run by `npm test` (Vitest, 100 tests, about a second) and by GitHub Actions on every push to `chewshen`, `dev` and `main` and on every PR, next to type-check, lint and a production build. Placeholder values only: no secrets in CI.
  - **Database and privacy**: an in-memory Postgres (PGlite) is built the way the real one was (the README's tables, an example import, `secure_rls.sql`, every migration, then every migration again), then two accounts are checked: neither can see, change, delete or point at the other's data in any of the 16 tables, signed-out visitors see nothing, and the nightly auto-add only charges instalments in their months.
  - **Receipt reading**: TnG receipts, success screens and transfers (made-up names), hidden amounts, dates, payment times, references and merchant rules.
  - **The Shortcut's endpoint** (`/api/ingest`): token errors, duplicate receipts, the 500-item Inbox limit and the notification text.
  - **Money and dates**: forecast, budgets, bills, instalment terms and amount owed, reminders, the Add expense date, savings, goals, and the salary and interest results from the original spreadsheet.

### Changed
- `npm test` now runs the test suite. The old formula script is gone: it checked copies of the formulas, not the app's own code.
- The README's Migrations list is the order to run them in (three files from 28 Sep depend on each other); the tests replay it and fail if a migration file isn't listed.

### Fixed
- **Receipt dates**: a shop name that looks like a date ("99 SPEEDMART 1234") no longer hides the receipt's real date, which made older receipts land on today. Found by the new tests.

---

## [0.21.0] - 2026-10-03

### Added
- **Inbox defaults to Food and the meal for when you paid**, like Add expense: the time comes from the receipt ("03/10/2026 09:32:00" → Breakfast), never the phone's clock at the top of the screenshot. It's marked as a guess; shops with a rule get their own tag, and transfers are left for you to choose.

### Changed
- **"Suggest this tag next time" starts unticked** and no longer ticks itself when you change the tag: saving a rule for a shop is your choice.
- **Add all ready** only takes items tagged by a rule or by you; time-of-day guesses get one tap each.

### Fixed
- Token errors say which problem it is: "This token (bt_xxxx…) was revoked" or "Token not recognised (starts bt_…)", with its length when it isn't the 46 characters of a real token.
- Settings → Automation, the guide and Help say what to do when **Add Shortcut** doesn't respond after pasting the token (an iPhone bug): tap **Skip Configuration**, the token is kept.

---

## [0.20.0] - 2026-10-03

### Added
- **Add the Shortcut**: Settings → Automation links to a ready-made **Log Payment** Shortcut. Tap Get Shortcut → Set Up Shortcut and paste your token; no building it by hand.
- **Settings → Automation as 3 steps**: create your token, add the Shortcut, turn on Back Tap (with Show Banner off). Then "Try it", your tokens, and a fold-out **Build it yourself** section.
- **Clearer user guide**: a Quick start at the top, the automation section rewritten around the 3 steps with screenshots, and a table of what each notification means. **Help** gains a Quick start topic and the same screenshots.

### Fixed
- A receipt whose amount was hidden (e.g. under the Back Tap banner) is now added to the Inbox with the amount to fill in, instead of "no amount found". "Transfer To" is read as the payee on TnG transfer receipts.
- The token is accepted as an `x-api-token` header, or in `Authorization` with or without "Bearer". A missing token says where to paste it.

---

## [0.19.2] - 2026-10-03

### Fixed
- **Inbox on phones**: the "You already have RM 10.00 on 3 Oct…" warning sat beside the shop name and cut it short; it now sits below the item's header, and the name gets the full width.
- **Shortcut notification**: two lines instead of one, with what was paid on top ("RM 10.00 · MENG KEE CHAR SIEW RESTAURANT") and the status below ("Added to Inbox → Lunch" / "Not added: already in your Inbox."), so long shop names aren't cut short.

---

## [0.19.1] - 2026-10-03

### Added
- **Transfers are labelled** in the Inbox, with a hint to dismiss money moved to your own account.
- An Inbox item says when it **matches an expense you already have** that day ("You already have RM 10.00 on 3 Oct (Food · Lunch)").
- The Inbox shows an item's **original text in full**, with a **Copy** button.

### Changed
- **Settings is grouped** under Money, Tracking, Alerts & automation and Account; "General" is now **Preferences**.
- Inbox items are **read again with the latest rules**, so an item captured before a fix corrects itself.

### Fixed
- **TnG merchant**: on receipts from your history the DuitNow logo was read as the merchant ("D"); the name now comes from "Payment - NAME" or the Merchant row, and the receipt's own date and time are used.
- **TnG success screens** (right after paying or transferring) are read too: the payee from "Receiver", skipping rows like Recipient Bank/E-Wallet, Account Number and DuitNow Ref No.
- **Accidental double-taps**: a screen with no amount isn't added, and the same receipt sent twice (or the same Apple Pay/Siri entry within 10 minutes) is only added once. The notification says why.
- Shortcut notifications on errors now show the reason instead of nothing.

### Database
- New migration `scripts/migrations/2026-10-03_inbox_reference.sql`: saves a receipt's reference numbers so it's only added once.

---

## [0.19.0] - 2026-10-03

### Added
- **Automation with iPhone Shortcuts**: send payments to the app instead of typing them. Double-tap the back of the phone on a TnG (or any) payment screen and it's read on the phone and sent; Apple Pay purchases can be sent automatically; or use Siri. Setup steps are in **Settings → Automation**.
- **Personal tokens** (Settings → Automation): create one per Shortcut, shown once, with "Send a test", last-used time and **Revoke**. Only a hash is stored, and a token can only add to your own Inbox.
- **Inbox**: captured expenses wait to be confirmed, with amount, merchant, date and a suggested tag filled in (all editable), the original text, Add / Dismiss and "Add all ready". Overview shows "N expenses to confirm" while any are waiting.
- **Merchant rules**: confirming "GRAB → Grab" means the next Grab payment arrives already tagged, even from another branch.
- **User guide** (`docs/user-guide.md`) covering every feature step by step, and **Settings → Help** with searchable short answers linking to it.

### Database
- New migration `scripts/migrations/2026-10-03_inbox.sql`: `api_tokens` (hashed), `inbox_items` and `merchant_rules`, owner-only. The `/api/ingest` endpoint needs `SUPABASE_SERVICE_ROLE_KEY` (already set for reminders).

---

## [0.18.1] - 2026-10-01

### Added
- **Save button at the top of Add expense**, next to the close button, so saving doesn't need a scroll past the tags and numpad. The big button at the bottom stays.

### Fixed
- **The page behind an open sheet no longer scrolls** (Add expense, Bought it, goals, balances): on iPhone a swipe could scroll the page underneath instead of the sheet. The page now stays put and returns to the same spot when the sheet closes.
- On iPhone, the **First payment** month picker in Bought it → Instalments no longer overlaps **Due on** (month and time pickers get the same width fix as date fields).

---

## [0.18.0] - 2026-10-01

### Added
- **Buy a goal on instalments**: Bought it → Instalments takes the price, a down payment (prefilled with what you set aside; clear it to keep that as free money), number of payments, optional interest/fees (default 0%), first payment month, due day and auto-add, and shows the monthly amount and what it costs over paying upfront. The goal moves to **Paying off** ("2 of 12 paid · RM 3,749.20 left · last payment Jul 2027") until the last payment.
- **Instalment plans in Monthly bills**: a bill can end after a number of payments (Settings → Monthly bills → Instalment plan), with its progress shown.
- **Savings shows what's still owed** on instalments and **net worth after what you owe**, counted from when each plan was taken out.

### Changed
- The month-end forecast, budgets, reminders and auto-add count an instalment plan only from its first payment to its last.

### Fixed
- On iPhone, date fields no longer spill into the field next to them (e.g. Add expense's date over One-off).
- Bottom tabs on phones: every tab shows its icon over a label, evenly spaced, instead of a cramped label beside the active one.

### Database
- New migration `scripts/migrations/2026-10-01_instalments.sql`: plan columns on monthly bills (number of payments, first payment month, linked goal, price, down payment), an ownership check for the linked goal, and the daily auto-add job skipping plans outside their months.

---

## [0.17.1] - 2026-10-01

### Fixed
- **The nightly reminders job explains itself.** When it can't run, Vercel's logs now say why under `[reminders]` (e.g. `missing SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET isn't set`, or Supabase rejecting the key) instead of a bare 401/500. Successful runs log a summary, including accounts with nothing due. "Send a test" doesn't use that key, so it could work while the 8pm job failed.

### Docs
- New Supabase projects show a **publishable** and a **secret** key instead of anon and service_role: README, `.env.example` and the release flow say which goes where (`SUPABASE_SERVICE_ROLE_KEY` = the secret key).
- README → Reminders: add variables at project level for Production and redeploy, plus how to check the nightly job (Cron Jobs → Run, and what each log line means).

---

## [0.17.0] - 2026-10-01

### Added
- **Transactions shows 50 expenses at a time**, with "Showing 50 of N" and a **Show 50 more** button, so the All view stays fast with thousands of expenses. Search, category filters and day totals still cover every expense.

### Changed
- **Monthly spending** (Overview) keeps the months after the one you pick: the chart runs up to 2 months past the selected month (never beyond this month) instead of always ending at it. The selected month stays visible even before your first expense.

### Fixed
- **Every expense is loaded**, not just the newest 1,000. Supabase caps each request at 1,000 rows, so older expenses would have silently dropped out of totals, trends and year to date; they're now fetched in batches until none are left.

---

## [0.16.0] - 2026-10-01

### Added
- **Settings shows the app version** under the section list, with a "What's new" link to this changelog.
- Goal cards show the **year** on voucher expiry and trade-in dates ("expires 11 Dec 2026").

### Changed
- **"Same as last entry"** (Settings → General) now follows you through a catch-up session: Add expense stays on the date you last used until that day has a Dinner or Supper entry, then opens on the next day, never later than today. Works with renamed meal tags (the ★ ones).
- The **settings button closes Settings** when it's open, going back to the page you opened it from.

### Fixed
- A goal's target date and a voucher's expiry can be **cleared** once set (the date picker on iPhone had no way to remove one).

---

## [0.15.0] - 2026-09-30

### Added
- **Multiple accounts**: friends can have their own account with completely separate data. New accounts start with a default set of categories and tags. Accounts are added in the Supabase dashboard (see README → Adding a friend).
- **Change password** in Settings → Account.
- **Your own savings accounts** (Settings → Savings accounts): add, rename, archive, and mark each as liquid or locked; any liquid account can have an interest rate. Replaces the fixed Main checking / GXBank / RYT / EPF fields.
- A **Supper** tag in the default set, suggested from 10pm to 5am.

### Changed
- The Food & dining card and the tag Add expense suggests for the time of day are found by a mark (★ in Settings → Categories & tags) instead of by name, so they can be renamed freely. Deleting a starred one asks first.
- Categories and tags belong to each account: names only need to be unique within your own.
- Savings export: one column per account. The JSON backup is now schema 2 (savings as accounts and balances).

### Database
- `scripts/migrations/2026-09-30_multi_user.sql`: owners for categories and tags, owner-only policies, reference checks, and a trigger that sets up new accounts.
- `scripts/migrations/2026-09-30_roles.sql`: food category and meal tag marks.
- `scripts/migrations/2026-09-30_savings_accounts.sql`: `savings_accounts` and `savings_balances`, with existing balances copied over (`monthly_savings` kept as a backup).
- `secure_rls.sql` refuses to run after the multi-user migration, and older migrations no longer undo it when re-run.

---

## [0.14.0] - 2026-09-30

### Added
- **Budgets**: a monthly limit per category in Settings → Budgets (with last month's spend as a hint). Overview shows each budget's spend, pace ("on pace for RM 430"), what's left per day, and flags budgets at risk or over; the worst one leads the insights.
- **Reminders** (phone notifications, around 8pm Malaysia time): bills due tomorrow or overdue, goal vouchers expiring in 3 days or 1 day, budgets at 80% or over, and an optional "nothing logged today" nudge. Each is sent once. Settings → Reminders turns them on per device, picks which ones you get, sends a test, and previews what would go out tonight. On iPhone it works from the Home Screen app (iOS 16.4+).
- Tapping the "nothing logged today" reminder opens Add expense.
- `docs/decisions.md`: why the stack and main design choices were made.

### Changed
- Signing out stops reminders on that device.

### Database
- New migration `scripts/migrations/2026-09-29_budgets.sql`: `budgets` table (one limit per category) with owner-only access.
- New migration `scripts/migrations/2026-09-29_reminders.sql`: `push_subscriptions`, `reminder_settings` and `reminder_log` with owner-only access (the log is written by the sender only).

### Deployment
- Daily Vercel Cron job (`vercel.json`, 12:00 UTC) calling `/api/reminders`. Needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` (see README → Reminders).

---

## [0.13.1] - 2026-09-29

### Fixed
- **iPhone home-screen app**: the top bar (settings, theme, add) sat under the status bar and Dynamic Island and couldn't be tapped. The app now starts below the status bar (readable in light mode too), and safe areas are respected at the top, bottom and sides. Remove and re-add the app to the home screen to pick this up.
- On iPhones with a home bar, the Undo/Retry message no longer overlaps the bottom navigation, and page ends aren't hidden behind it.

### Changed
- **Settings is split into sections** (General, Salary & deductions, Monthly bills, Categories & tags, Account) with a live summary for each: a list on phones, a sidebar on desktop.
- Theme can be chosen in Settings → General, and salary edited in Settings → Salary & deductions.

---

## [0.13.0] - 2026-09-29

### Added
- **Goals**: A new Goals page for things you're saving for, with progress, the monthly amount needed to hit a target date (on track / behind), or when you'll be ready at your pace.
- **Trade-in value** on a goal comes off what you need to save, and shows when the value was last checked.
- **Discounts & vouchers** on a goal (RM or %, with optional expiry): expiring vouchers are flagged; expired ones stop counting.
- **Set aside or take back money** for a goal, with history; reorder goals by priority.
- **Bought it**: logs what you paid as a one-off expense and moves the goal to Completed.
- The Savings page separates money set aside for goals from free money; the emergency fund counts only free money.
- README screenshots and an up-to-date feature list.

### Changed
- The full JSON backup includes goals and their history.

### Database
- New migration `scripts/migrations/2026-09-29_goals.sql` (run once in Supabase; safe to re-run): `goals` and `goal_contributions` tables with owner-only access, and a `discounts` column on goals.

---

## [0.12.0] - 2026-09-29

### Added
- **Continue without an account**: Guest mode from the login page. Guests use the full app with sample data; nothing is saved (no database access, nothing stored in the browser), and a refresh starts over. A banner offers "Sign in to save".

### Changed
- The sample data is now made-up demo data generated relative to today (about three months of realistic spending, bills and balances), used by guest mode and local-only mode.

### Security
- Removed real financial data from the app bundle: the previous sample data was generated from the real budget spreadsheet and was downloadable from the public site. (It still exists in the repository and its history; see `docs/roadmap.md`.)

---

## [0.11.0] - 2026-09-28

### Added
- **Emergency fund**: How many months of spending your liquid money covers, a goal of 3–12 months with progress, and when you'll reach it at your current pace.
- **Since last month, by account**: Each account's balance before and after, and where the change in net worth came from.
- **Savings rate by month**: Monthly savings rate against the 20% target (on target, below target, overspent), with the average and how many months hit the target.
- **Roadmap**: `docs/roadmap.md` collects ideas for future versions.

### Changed
- The salary profile loads all columns and saves only salary fields, so new profile settings can't break salary edits.

### Database
- New migration `scripts/migrations/2026-09-28_emergency_goal.sql` (run once in Supabase): adds `user_profiles.emergency_months` for the emergency fund goal (default 6).

---

## [0.10.0] - 2026-09-28

### Added
- **Month-end forecast**: "On pace for RM X by 30 Sep" under the month total, from everyday spending so far plus bills still to come.
- **Compared with usual**: Each category shows how it compares with its average over up to 3 earlier months (pro-rated to today for the current month).
- **Monthly spending trend**: Up to 6 months with an average line; the current month shows its forecast; tap a bar to open that month.
- **Insights**: Up to three plain-English highlights, such as tags above or below usual, no-spend days and weekend-heavy spending.
- **Fixed vs flexible**: The month split into everyday spending, bills and one-offs.
- **Spending calendar**: Days shaded by how much they cost; tap a day for its total.
- **Year to date**: Spent, saved, savings rate and average per month for the year so far.
- **Export menu**: This month, all expenses, savings balances, or a full JSON backup; the Transactions page exports exactly what's shown.

### Fixed
- CSV exports quote fields properly (notes with commas or quotes no longer break columns), open in Excel with the right encoding, and no longer get cut off at a "#".
- Text in exports that a spreadsheet would run as a formula is neutralised.

---

## [0.9.0] - 2026-09-28

### Added
- **Automatic bills**: Switch on "Add automatically" for a bill with an expected amount and due day, and its expense is added on the due day each month (noted "Auto-added monthly bill"), unless you've already logged it.
- Overview shows automatic bills as "Auto on <date>" and counts them separately; Settings marks them with an Auto badge.

### Database
- New migration `scripts/migrations/2026-09-28_auto_bills.sql` (run once in Supabase, needs the `pg_cron` extension): adds the per-bill switch, the `auto_log_bills()` function and a daily job at 00:05 Malaysia time.

---

## [0.8.0] - 2026-09-28

### Added
- **Editable monthly bills** (Settings → Monthly bills): choose which tags are monthly bills, with an optional expected amount and due day.
- **Bill due status** on Overview: Overdue, Due in N days, Due on a date, Missing or Logged, with an overdue count.

### Changed
- Bills are linked to the tag rather than its name, so renaming a tag keeps its bill.
- "Log unpaid bills" uses the expected amount on the due day when set, otherwise last month's payment.

### Fixed
- Renaming an imported category no longer resets its icon.
- Dates always use the same month format ("Sep", not sometimes "Sept").

### Database
- New migration `scripts/migrations/2026-09-28_monthly_bills.sql` (run once in Supabase): adds expected amount and due day to `recurring_sentinel`, one row per bill, and carries over the 8 existing bills.

---

## [0.7.0] - 2026-09-28

### Added
- **Categories & tags in Settings**: Add categories with an icon, add tags, rename either, and delete ones no expense uses. Items in use show how many expenses use them and can only be renamed.
- **"+ New tag" in Add expense**: Create a tag without leaving the sheet; it is selected straight away.

### Changed
- Categories are listed alphabetically.

### Database
- New migration `scripts/migrations/2026-09-28_manage_categories_tags.sql` (run once in Supabase): adds `categories.icon` and lets the signed-in owner add, rename and delete categories and tags.

---

## [0.6.1] - 2026-09-28

### Added
- **CI**: GitHub Actions workflow runs type-check, lint and the Excel formula parity test (`npm test`) on pull requests to `dev` and `main`.

### Changed
- Linting uses the ESLint CLI with a flat config (`eslint.config.mjs`), replacing the deprecated `next lint`.
- Release docs now match the real CI, tagging (normal vs folded releases) and backup options.

### Security
- Updated Next.js to 15.5.26 and forced its bundled PostCSS to 8.5.x, resolving the high-severity PostCSS advisories (`npm audit`: 0 vulnerabilities).

---

## [0.6.0] - 2026-09-28

### Added
- **Monthly savings check**: Compares how much liquid money grew with what you saved from salary, and explains the untracked difference (unlogged spending or income). Shown only for back-to-back recorded months.
- **Net worth over time**: Bar chart of recorded months; tapping a bar opens that month.
- **Update balances sheet**: Pre-filled from the latest earlier month (balances and interest rates), with the earlier value shown under each field and a live net worth total.

### Changed
- Balances are labelled as month-end ("Net worth on 30 Sep 2026"), with each account's share of the total.
- Months with no balances (including the all-zero rows from the Excel import) show "Not recorded yet" instead of RM 0.00; future months can't be recorded.

### Fixed
- Balance fields can be cleared and typed normally (no more snapping to 0 or "05"); non-numeric input is rejected.
- Closing the balances sheet with unsaved changes asks before discarding them.

---

## [0.5.0] - 2026-09-28

### Added
- **Edit expenses**: Tap any transaction to open it in the add sheet, pre-filled. Save changes updates it in place; Delete removes it with the 5-second Undo. Failed edits roll back with a Retry toast.
- **App icons**: Home-screen icons for iOS (`apple-icon.png`) and Android/manifest (192px, 512px, maskable), plus a browser favicon.

### Fixed
- The add sheet now always opens empty, so an amount or note typed earlier can't carry over into a new expense.

---

## [0.4.0] - 2026-09-28

### Added
- **Authentication**: Email + password sign-in at `/login` (no public sign-up), middleware redirect for signed-out visitors, and a sign-out button.
- **Owner-only database access**: `scripts/secure_rls.sql` assigns existing rows to the owner, defaults `user_id` to `auth.uid()`, and replaces every policy with owner-only RLS (including `recurring_sentinel`).
- **Editable salary**: Gross salary, EPF %, SOCSO and EIS can be edited from the Cash flow card and are stored in `user_profiles`.
- **Undo delete**: Deleting a transaction shows an Undo toast for 5 seconds before it reaches the database.
- **Faster entry**: Time-of-day meal tag default, Recent shortcuts (tag + last amount), keyboard amount entry on desktop, and one-tap logging of missing monthly bills with last month's amounts.
- **Light/dark theme toggle**, with dark as the default.
- **Settings page** (`/settings`): choose whether Add expense starts on today's date or the last entry's date (saved per device). Sign out moved here from the top bar.

### Changed
- **Refined dark redesign**: Neutral near-black surfaces with lime as an accent fill only, Inter font, spend hero with daily bar chart and month-over-month change, ranked category and tag lists (replacing the donut chart), transactions grouped by day, net worth hero on Savings, floating mobile nav and bottom-sheet quick add.
- The app opens on the current month instead of a fixed month.
- Data loads only after sign-in; the localStorage cache is used only in local-only mode (no Supabase configured).
- On mouse/trackpad devices, chip rows (Recent, categories, filters) wrap instead of scrolling sideways; touchscreens keep swipeable rows.

### Fixed
- Failed saves no longer fail silently: the optimistic row is rolled back and a Retry toast is shown.
- Saving account balances no longer creates duplicate `monthly_savings` rows.
- Lime text was unreadable on light backgrounds, and `dark:` styles never applied, mixing light and dark colours.

### Security
- Previously all transactions and savings were readable and writable by anyone holding the public anon key. After running `secure_rls.sql`, anonymous requests return no rows and writes are rejected.

---

## [0.3.0] - 2026-09-20

### Added
- **Fintech Brand Redesign**: Redesigned app aesthetic to electric **Lime Spark (`#B6FF2E`)** and deep **Graphite (`#23262F`)** with high-contrast typography, neon chart highlights, and updated mobile PWA theme bars.
- **Architectural Layout Refactor**: Decoupled `layout.tsx` into a proper Server Component using Next.js 15 `metadata` and `viewport` exports, moving client state into `src/components/app-shell.tsx`.
- **Database & RLS Hardening**: Relaxed initial migration constraints on `user_id` and `recurring_sentinel`, and documented strict privacy policies for authenticated user data isolation.

### Fixed
- Resolved `ENOENT` page data collection error during Next.js build by separating client-side state from server-rendered root layout.

---

## [0.2.0] - 2026-09-20

### Added
- **Next.js 15 Web Application**: Scaffolded with TypeScript, Tailwind CSS, App Router, Lucide icons, and Recharts.
- **Mobile Fast-Entry (<5s)**: Created `QuickAddModal` with tactile numpad, category selector, cascading tag chips, and "One-off?" toggle.
- **Interactive Monthly Cockpit**:
  - `MonthSelector` component replacing Excel Timeline Slicers.
  - `KpiCards` (Total Spend, Food & Dining, Daily Average excluding one-offs, Peak Expense spotlight).
  - `CategoryChart` (Donut chart) & `TagsBarChart` (Horizontal bar chart).
  - `SalaryEngine` (Malaysian EPF 11%, SOCSO, EIS, Net Take-home, Net Cash Saved, Savings Rate progress bar).
  - `RecurringSentinel` (Automated checklist tracking Netflix, iCloud, Cuckoo, Water, Electric, Season Parking).
- **Full Transaction Ledger**: `LedgerTable` component with instant search, category filtering, and delete actions.
- **Savings & Asset Management**:
  - `SavingsPage` tracking Main Checking, GXBank, Rize/RYT Bank, and EPF locked balances.
  - Automated daily compounding interest calculator based on calendar month days.
- **Excel Ingestion & Data Seeding**:
  - Extracted 10 categories, 31 tags, 172 transactions, and 5 monthly savings snapshots from `Monthly Budget.xlsm`.
  - Generated `scripts/seed_data.sql` for instant Supabase SQL Editor execution.
  - Generated `src/lib/mock-data.ts` and `src/lib/budget-context.tsx` with offline LocalStorage persistence and Supabase sync.
- **Formula Verification Suite**: Added `scripts/test_formulas.mjs` validating salary deductions and GXBank interest against Excel ground truth.

---

## [0.1.0] - 2026-09-19

### Added
- Comprehensive architectural blueprint and migration specification from Excel (`.xlsm`) to Next.js + Supabase.
- Full PostgreSQL database schema definition with Row-Level Security (RLS) policies.
- Detailed engineering `README.md` with system design, mathematical formulas, and setup guide.
- Release engineering governance documents (`changelog.md`, `version-bump.md`, `release-flow.md`).
