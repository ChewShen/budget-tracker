import { format, getDaysInMonth, parseISO } from "date-fns";
import { RecurringBill, Tag, Transaction } from "./types";
import { billActiveIn, planShortfall } from "./instalments";

export const AUTO_BILL_NOTE = "Auto-added monthly bill";

// A bill's due date in a given month (YYYY-MM); due days past the month's end fall on its last day.
export function dueDateIn(month: string, dueDay: number): string {
  const days = getDaysInMonth(parseISO(`${month}-01`));
  return `${month}-${String(Math.min(dueDay, days)).padStart(2, "0")}`;
}

export const canAutoLog = (b: Pick<RecurringBill, "expected_amount" | "due_day">) =>
  Boolean(b.expected_amount && b.due_day);

// Expenses the daily job would add today: active auto bills that are due this month
// and have no expense with their tag yet. Mirrors public.auto_log_bills() in
// scripts/migrations/2026-09-28_auto_bills.sql (used in local-only mode, which has no scheduler).
export function dueAutoBills(
  bills: RecurringBill[],
  tags: Tag[],
  transactions: Transaction[],
  today: Date = new Date()
): Omit<Transaction, "id">[] {
  const todayStr = format(today, "yyyy-MM-dd");
  const month = todayStr.slice(0, 7);
  return bills.flatMap((bill) => {
    if (!bill.is_active || !bill.auto_log || !bill.expected_amount || !bill.due_day) return [];
    if (!billActiveIn(bill, month)) return []; // instalment plan not running this month
    const tag = tags.find((t) => t.id === bill.tag_id);
    const date = dueDateIn(month, bill.due_day);
    if (!tag || date > todayStr) return [];
    // Plans: only what's still short by this month (nothing when paid ahead or off).
    const short = planShortfall(bill, transactions, month);
    if (short !== null) {
      if (short <= 0) return [];
    } else if (transactions.some((t) => t.tag_id === bill.tag_id && t.date.startsWith(month))) return [];
    return [
      {
        date,
        category_id: tag.category_id,
        tag_id: tag.id,
        amount: short ?? bill.expected_amount,
        description: AUTO_BILL_NOTE,
        is_one_off: false,
      },
    ];
  });
}
