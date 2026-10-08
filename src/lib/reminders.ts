import { addDays, format, getDaysInMonth, parseISO } from "date-fns";
import { dueDateIn } from "./bills";
import { billActiveIn, planShortfall } from "./instalments";
import { daysToExpiry } from "./goals";
import { formatCurrency } from "./utils";
import type { Budget, Category, Goal, RecurringBill, Tag, Transaction } from "./types";

// Pure rules shared by Settings > Reminders (preview) and the daily sender (/api/reminders).
// No React or browser APIs here: this also runs on the server.

export interface ReminderPrefs {
  bills: boolean;
  vouchers: boolean;
  budgets: boolean;
  daily_log: boolean;
}

export type ReminderKind = keyof ReminderPrefs;

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { bills: true, vouchers: true, budgets: true, daily_log: false };

export const REMINDER_TYPES: { kind: ReminderKind; label: string; description: string }[] = [
  { kind: "bills", label: "Bills", description: "The day before a bill is due, and once if it's overdue. Skips automatic bills." },
  { kind: "vouchers", label: "Expiring vouchers", description: "3 days and 1 day before a goal's voucher or discount expires." },
  { kind: "budgets", label: "Budgets", description: "Once when a budget reaches 80%, and once when it goes over." },
  { kind: "daily_log", label: "Nothing logged today", description: "An evening nudge on days with no expenses." },
];

export const BUDGET_NEAR_RATIO = 0.8;

export interface Reminder {
  key: string; // unique per occurrence; the sender sends each key once
  kind: ReminderKind;
  title: string;
  body: string;
  url: string; // opened when the notification is tapped
}

export interface ReminderData {
  today: string; // YYYY-MM-DD, Malaysia time
  bills: RecurringBill[];
  tags: Tag[];
  categories: Category[];
  transactions: Transaction[]; // at least this month's
  budgets: Budget[];
  goals: Goal[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const label = (name?: string) => (name || "Others").replace(/_/g, " ");

function billReminders({ today, bills, tags, transactions }: ReminderData): Reminder[] {
  const tomorrow = format(addDays(parseISO(today), 1), "yyyy-MM-dd");
  const month = today.slice(0, 7);
  // Paid for a month: an expense with the tag that month; for plans, enough paid by then (early or
  // several at once count).
  const paidFor = (bill: RecurringBill, m: string) => {
    const short = planShortfall(bill, transactions, m);
    return short !== null ? short <= 0 : transactions.some((t) => t.tag_id === bill.tag_id && t.date.startsWith(m));
  };

  return bills.flatMap((bill) => {
    // Automatic bills log themselves on the due day, so there's nothing to remind about.
    if (!bill.is_active || !bill.due_day || bill.auto_log) return [];
    const tag = tags.find((t) => t.id === bill.tag_id);
    if (!tag) return [];
    const amount = bill.expected_amount ? ` · ${formatCurrency(bill.expected_amount)}` : "";

    // Due tomorrow (tomorrow can be in next month).
    // Instalment plans only remind in their own months (first to last payment).
    const nextDue = dueDateIn(tomorrow.slice(0, 7), bill.due_day);
    if (nextDue === tomorrow && billActiveIn(bill, tomorrow.slice(0, 7)) && !paidFor(bill, tomorrow.slice(0, 7)))
      return [
        {
          key: `bill:${tag.id}:${nextDue}:soon`,
          kind: "bills" as const,
          title: `${tag.name} is due tomorrow${amount}`,
          body: "Log it once it's paid.",
          url: "/",
        },
      ];

    // Overdue this month and still not logged: once per month.
    const due = dueDateIn(month, bill.due_day);
    if (due < today && billActiveIn(bill, month) && !paidFor(bill, month))
      return [
        {
          key: `bill:${tag.id}:${due}:overdue`,
          kind: "bills" as const,
          title: `${tag.name} was due on ${format(parseISO(due), "d MMM")}${amount}`,
          body: "It isn't logged yet this month. Paid it? Add it so your month adds up.",
          url: "/",
        },
      ];
    return [];
  });
}

function voucherReminders({ today, goals }: ReminderData): Reminder[] {
  const now = parseISO(today);
  return goals
    .filter((g) => g.status === "active")
    .flatMap((goal) =>
      (goal.discounts || []).flatMap((d) => {
        const days = daysToExpiry(d, now);
        if (days !== 1 && days !== 3) return [];
        return [
          {
            key: `voucher:${goal.id}:${d.id}:${d.expires_on}:${days}`,
            kind: "vouchers" as const,
            title: `${d.label} expires ${days === 1 ? "tomorrow" : "in 3 days"}`,
            body: `On your ${goal.name} goal. Use it or it stops counting toward the price.`,
            url: "/goals",
          },
        ];
      })
    );
}

function budgetReminders({ today, budgets, categories, transactions }: ReminderData): Reminder[] {
  const month = today.slice(0, 7);
  const daysLeft = getDaysInMonth(parseISO(`${month}-01`)) - Number(today.slice(8, 10)) + 1;

  return budgets.flatMap((budget) => {
    const spent = round2(
      transactions
        .filter((t) => t.category_id === budget.category_id && t.date.startsWith(month))
        .reduce((sum, t) => sum + t.amount, 0)
    );
    const name = label(categories.find((c) => c.id === budget.category_id)?.name);
    const limit = budget.monthly_limit;

    if (spent > limit)
      return [
        {
          key: `budget:${budget.category_id}:${month}:over`,
          kind: "budgets" as const,
          title: `${name} is over budget`,
          body: `${formatCurrency(spent)} of ${formatCurrency(limit)} this month, ${formatCurrency(spent - limit)} over.`,
          url: "/",
        },
      ];
    if (spent >= limit * BUDGET_NEAR_RATIO) {
      const left = round2(limit - spent);
      return [
        {
          key: `budget:${budget.category_id}:${month}:near`,
          kind: "budgets" as const,
          title: `${name} is at ${Math.floor((spent / limit) * 100)}% of its budget`,
          body:
            left > 0
              ? `${formatCurrency(left)} left for ${daysLeft} ${daysLeft === 1 ? "day" : "days"} (${formatCurrency(round2(left / daysLeft))}/day).`
              : "Nothing left for the rest of the month.",
          url: "/",
        },
      ];
    }
    return [];
  });
}

function dailyLogReminders({ today, transactions }: ReminderData): Reminder[] {
  if (transactions.some((t) => t.date === today)) return [];
  return [
    {
      key: `log:${today}`,
      kind: "daily_log",
      title: "Nothing logged today",
      body: "Spent anything? It takes a few seconds to add.",
      url: "/?add=1",
    },
  ];
}

// Everything worth a notification today, for the reminder types switched on.
export function buildReminders(data: ReminderData, prefs: ReminderPrefs): Reminder[] {
  return [
    ...(prefs.bills ? billReminders(data) : []),
    ...(prefs.vouchers ? voucherReminders(data) : []),
    ...(prefs.budgets ? budgetReminders(data) : []),
    ...(prefs.daily_log ? dailyLogReminders(data) : []),
  ];
}
