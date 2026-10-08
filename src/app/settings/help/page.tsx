"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, Search } from "lucide-react";

// Short, searchable answers. The full guide (docs/user-guide.md) has the details; each topic links
// to its section there.
const GUIDE = "https://github.com/ChewShen/budget-tracker/blob/main/docs/user-guide.md";

interface Topic {
  title: string;
  anchor: string; // section in the full guide
  points: string[];
  images?: { src: string; alt: string }[]; // from /public/help
}

const TOPICS: Topic[] = [
  {
    title: "Quick start",
    anchor: "quick-start",
    points: [
      "Install it: iPhone Safari → Share → Add to Home Screen; Android Chrome → ⋮ → Install app.",
      "Change your temporary password in Settings → Account.",
      "Add an expense: tap +, type the amount, tap a category and tag, Save.",
      "Set up once, under Money in Settings: salary, savings accounts, monthly bills and (optional) budgets.",
      "Optional: let your iPhone send TnG payments for you (see Automation below).",
    ],
  },
  {
    title: "Getting started",
    anchor: "1-getting-started",
    points: [
      "Change your temporary password in Settings → Account.",
      "iPhone: open the site in Safari → Share → Add to Home Screen, then use the home-screen icon. Android: Chrome → ⋮ → Install app.",
      "The bottom bar has Overview, Activity, Savings, Goals and + to add an expense. The gear opens Settings; tap it again to close.",
    ],
  },
  {
    title: "Adding an expense",
    anchor: "2-adding-expenses",
    points: [
      "Tap +, type the amount, pick a category and tag (or tap one under Recent), then Save at the top or bottom.",
      "Mark unusual purchases as One-off so they don't skew your daily average and forecast.",
      "The sheet picks the meal tag for the time of day (breakfast, lunch, tea time, dinner, late night).",
      "Tap any expense to edit or delete it. Deleting gives you a few seconds to Undo.",
    ],
  },
  {
    title: "Which date new expenses start on",
    anchor: "2-adding-expenses",
    points: [
      "Settings → Preferences → Adding expenses.",
      "Today: always today. Same as last entry: stays on the date you last used until that day has a Dinner or Supper entry, then moves to the next day (never past today).",
    ],
  },
  {
    title: "Categories, tags and the ★",
    anchor: "3-categories-and-tags",
    points: [
      "Settings → Categories & tags: tap to rename. Anything used by expenses can't be deleted; rename it instead.",
      "Reorder: put the categories you use most first. Add expense, the Inbox, filters and Budgets follow your order; charts sort by amount. Savings accounts have Reorder too.",
      "★ marks your food category and meal tags, which power the Food & dining card and meal suggestions. Rename them freely; the star follows.",
    ],
  },
  {
    title: "Reading the Overview",
    anchor: "4-overview-reading-your-month",
    points: [
      "\"On pace for RM X\" stretches everyday spending to month end and adds bills still to come. Bills and one-offs aren't stretched.",
      "Tap a bar in Monthly spending to open that month. The faded part of this month's bar is the forecast.",
      "Monthly bills shows what's logged, due or overdue; Log unpaid bills adds the known ones in one tap.",
    ],
  },
  {
    title: "Monthly bills and auto-add",
    anchor: "5-monthly-bills",
    points: [
      "Settings → Monthly bills → Add bill: choose the tag, and optionally an expected amount and due day.",
      "Add automatically (needs amount and due day) adds it on the due day unless you've logged it already.",
      "A bill counts as paid once an expense with its tag is logged that month.",
    ],
  },
  {
    title: "Budgets",
    anchor: "6-budgets",
    points: [
      "Settings → Budgets: a monthly limit per category (blank = none).",
      "Overview shows spent, where you're heading and what's left per day. Amber = on pace to go over, red = over.",
    ],
  },
  {
    title: "Goals, trade-ins and vouchers",
    anchor: "7-goals",
    points: [
      "Goals → New goal. A trade-in and vouchers come off what you need to save; expired vouchers stop counting.",
      "Set aside money as you go. It's kept separate from your emergency fund.",
      "Bought it: Paid in full logs a one-off expense; Instalments starts a plan.",
    ],
  },
  {
    title: "Instalments (Atome, SPayLater, 0% plans)",
    anchor: "8-instalments",
    points: [
      "Goals → Bought it → Instalments: price, down payment (starts at what you set aside; clear it to keep that money free), fees (0% for most pay-later plans), number of payments, first month and due day.",
      "Each payment is a monthly bill until the last one; the goal shows Paying off with what's left.",
      "Payments go under the Instalments category (renamable, not deletable), so they don't count as new Shopping; the down payment uses the category you pick.",
      "Paid early, two months at once, or part of one? Log it with the plan's tag: payments count by amount, and auto-add skips months already covered. Pay off the rest logs what's left in one go.",
      "No goal? Settings → Monthly bills → Add bill → Instalment plan.",
      "Savings shows what you still owe and your net worth after it.",
    ],
  },
  {
    title: "Savings accounts and balances",
    anchor: "9-savings",
    points: [
      "Settings → Savings accounts: add each bank, e-wallet, EPF or investment. Liquid = usable money; Locked (EPF) = net worth only. Archive closed accounts.",
      "Each month: Savings → Record balances. It starts from last month's figures, so only change what moved.",
      "A large Untracked amount in the monthly check usually means spending you didn't log.",
    ],
  },
  {
    title: "Reminders",
    anchor: "10-reminders",
    points: [
      "Settings → Reminders → Turn on (on each device), then Send a test.",
      "iPhone: only works from the home-screen app (iOS 16.4+).",
      "Around 8pm: bills due tomorrow or overdue, vouchers expiring, budgets at 80% or over. Most nights there's nothing to send.",
    ],
  },
  {
    title: "Automation: TnG payments with a double-tap",
    anchor: "11-automation-and-the-inbox",
    points: [
      "1. Settings → Automation → Create token, then copy it (it's shown once).",
      "2. Tap Add the Shortcut → Get Shortcut → Set Up Shortcut, and paste the token. If Add Shortcut doesn't respond, tap Skip Configuration: the token is kept.",
      "3. iPhone Settings → Accessibility → Touch → Back Tap → Double Tap → Log Payment, and turn Show Banner off.",
      "Try it: open a TnG receipt and double-tap the back of your phone. Then confirm it in the Inbox.",
      "New items default to Food and the meal for the time you paid (marked as a guess). Shops you've taught it get their own tag.",
      "Tick \"Remember …\" (it starts unticked) and that shop's payments arrive already sorted: \"Always food, meal by time\" keeps the meal following when you paid; \"Always Food · Coffee\" fixes the tag.",
      "The name at the top of an Inbox item can be changed or left blank; it's saved as the expense's note.",
      "See, change or forget remembered shops (or add one) in Settings → Automation → Shops it remembers.",
      "Items labelled Transfer may be money moved to your own account. That isn't spending, so dismiss them.",
      "Double-tapped by accident? Screens without an amount and receipts already sent aren't added.",
      "Banking apps that block screenshots (e.g. Public Bank): make a Log Receipt copy of the shortcut (Settings → Automation → Apps that block screenshots), then Share the receipt → Log Receipt.",
      "Lost your phone? Revoke the token.",
    ],
    images: [
      { src: "/help/automation.png", alt: "Settings → Automation: the 3 setup steps" },
      { src: "/help/back-tap.png", alt: "Back Tap: Double Tap set to Log Payment" },
      { src: "/help/notification.png", alt: "Notification after a double-tap" },
      { src: "/help/inbox.png", alt: "An Inbox item ready to add" },
    ],
  },
  {
    title: "Export and backup",
    anchor: "12-transactions-export-and-backup",
    points: [
      "Overview → Export: this month or all expenses (CSV for Excel/Sheets), savings balances, or a full backup (JSON).",
      "Activity lists 50 expenses at a time; search and filters cover all of them. Tap + on a day to add an expense on that date.",
    ],
  },
  {
    title: "Privacy",
    anchor: "13-your-data-and-privacy",
    points: [
      "Only you see your data; other people using the app can't.",
      "The database is backed up weekly, encrypted so only whoever runs the app can open it. Settings → Account shows the last backup.",
      "Whoever runs the app can technically see the database. Ask them to delete your account to remove everything.",
    ],
  },
  {
    title: "Something's not working",
    anchor: "14-troubleshooting",
    points: [
      "Old version after an update: close the home-screen app completely and reopen it.",
      "No reminders: check Settings → Reminders shows On and Send a test arrives; on iPhone use the home-screen app.",
      "\"Run the latest migrations\": the app was updated but its database wasn't yet. Tell whoever runs it.",
      "Shortcut says \"Missing token\" or \"Invalid or revoked token\": create a new token and paste it into the first box of the Log Payment shortcut (or add the Shortcut again; it asks).",
      "\"No amount found\" on a real receipt: turn Show Banner off in Back Tap; the banner can cover the amount.",
      "A warning on Overview about a background job: Settings → Account → Background jobs shows which one failed or stopped, and the error. Tell whoever runs the app.",
    ],
  },
];

export default function HelpPage() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? TOPICS.filter((t) => `${t.title} ${t.points.join(" ")}`.toLowerCase().includes(q))
    : TOPICS;

  return (
    <>
      <section className="card p-5 sm:p-6">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search help, e.g. instalment, reminder, TnG"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field rounded-full pl-10"
            aria-label="Search help"
          />
        </div>

        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing matches “{query}”. Try another word, or read the{" "}
            <a href={GUIDE} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              full guide
            </a>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70">
            {shown.map((t) => (
              <li key={t.title}>
                <details className="group py-1" open={Boolean(q)}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    {t.title}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
                  </summary>
                  <ul className="mb-3 space-y-1.5 pl-1">
                    {t.points.map((p) => (
                      <li key={p} className="flex gap-2 text-sm text-muted-foreground">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                  {t.images && (
                    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {t.images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={img.src}
                          src={img.src}
                          alt={img.alt}
                          loading="lazy"
                          className="w-full rounded-xl border"
                        />
                      ))}
                    </div>
                  )}
                  <a
                    href={`${GUIDE}#${t.anchor}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    More in the full guide <ExternalLink className="h-3 w-3" />
                  </a>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="px-1 text-xs text-muted-foreground">
        The{" "}
        <a href={GUIDE} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
          full user guide
        </a>{" "}
        covers every feature step by step.
      </p>
    </>
  );
}
