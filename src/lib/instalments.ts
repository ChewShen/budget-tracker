import { addMonths, format, parseISO } from "date-fns";
import type { RecurringBill, Transaction } from "./types";

// Instalment plans are monthly bills that end: `installment_count` payments of `expected_amount`
// from `start_month`. Pure functions, shared by Overview, Goals, Savings, reminders and auto-add
// (and mirrored by public.auto_log_bills() in the database).

const round2 = (n: number) => Math.round(n * 100) / 100;
const ym = (date: string) => date.slice(0, 7);

export const isInstalment = (b: Pick<RecurringBill, "installment_count" | "start_month">) =>
  Boolean(b.installment_count && b.start_month);

// YYYY-MM of the last payment.
export function lastPaymentMonth(b: Pick<RecurringBill, "installment_count" | "start_month">): string | null {
  if (!isInstalment(b)) return null;
  return format(addMonths(parseISO(b.start_month as string), (b.installment_count as number) - 1), "yyyy-MM");
}

// Whether a bill is running in a month (YYYY-MM): ongoing bills always are, plans only between
// their first and last payment.
export function billActiveIn(b: Pick<RecurringBill, "installment_count" | "start_month">, month: string): boolean {
  if (!isInstalment(b)) return true;
  return month >= ym(b.start_month as string) && month <= (lastPaymentMonth(b) as string);
}

// The plan's months, first to last (YYYY-MM).
export function planMonths(b: Pick<RecurringBill, "installment_count" | "start_month">): string[] {
  if (!isInstalment(b)) return [];
  const start = parseISO(b.start_month as string);
  return Array.from({ length: b.installment_count as number }, (_, i) => format(addMonths(start, i), "yyyy-MM"));
}

// Payments are counted by amount, not by month: paying two months at once, paying a month early
// or settling the rest early all just count toward the total. A plan's payments are the expenses
// with its tag from the month before its first payment (an early first payment counts).
const TOLERANCE = 0.05; // monthly amounts are rounded; plans settle the odd sen in the last payment
const sen = (n: number) => Math.round(n * 100);
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

// First day counted toward a plan: the 1st of the month before its first payment.
export function planWindowStart(b: Pick<RecurringBill, "start_month">): string {
  return format(addMonths(parseISO(b.start_month as string), -1), "yyyy-MM-dd");
}

// What's been paid toward a plan, up to a date (YYYY-MM-DD) if given.
export function planPaid(
  bill: Pick<RecurringBill, "tag_id" | "start_month">,
  transactions: Pick<Transaction, "tag_id" | "date" | "amount">[],
  asOf?: string
): number {
  const from = planWindowStart(bill);
  return (
    transactions
      .filter((t) => t.tag_id === bill.tag_id && t.date >= from && (!asOf || t.date <= asOf))
      .reduce((sum, t) => sum + sen(t.amount), 0) / 100
  );
}

// How much should be paid by the end of a month (YYYY-MM): one monthly amount per plan month so far.
export function planDueBy(b: Pick<RecurringBill, "installment_count" | "start_month" | "expected_amount">, month: string): number {
  if (!isInstalment(b)) return 0;
  const months = Math.min(b.installment_count as number, Math.max(0, monthIndex(month) - monthIndex(ym(b.start_month as string)) + 1));
  return (sen(b.expected_amount ?? 0) * months) / 100;
}

// Still to pay this month (YYYY-MM): the monthly amount, minus anything paid ahead in earlier
// months, minus what's been paid this month. 0 when covered (paid ahead or off). A month missed
// earlier isn't added on top: auto-add never adds more than one payment a month.
// Ongoing bills: null (they go by "logged this month").
export function planShortfall(
  bill: RecurringBill,
  transactions: Pick<Transaction, "tag_id" | "date" | "amount">[],
  month: string
): number | null {
  if (!isInstalment(bill)) return null;
  const monthStart = `${month}-01`;
  const monthEnd = format(addMonths(parseISO(monthStart), 1), "yyyy-MM-dd");
  const previous = format(addMonths(parseISO(monthStart), -1), "yyyy-MM");
  const paidBefore = planPaid(bill, transactions.filter((t) => t.date < monthStart));
  const paidThisMonth = planPaid(bill, transactions.filter((t) => t.date >= monthStart && t.date < monthEnd));
  const ahead = Math.max(0, paidBefore - planDueBy(bill, previous));
  const short = (bill.expected_amount ?? 0) - ahead - paidThisMonth;
  return short > TOLERANCE ? Math.round(short * 100) / 100 : 0;
}

export interface InstalmentProgress {
  total: number; // number of payments
  paid: number; // payments covered by what's been paid (paying 2 at once counts 2)
  paidAmount: number; // RM paid toward the plan (up to asOf)
  totalAmount: number; // monthly × payments
  monthly: number;
  owed: number; // still to pay
  firstMonth: string; // YYYY-MM
  lastMonth: string; // YYYY-MM
  finished: boolean; // paid off, on time or early
}

// How far a plan is, by what's been paid toward it. `asOf` (YYYY-MM-DD) ignores later payments,
// e.g. for a past month's net worth.
export function instalmentProgress(
  bill: RecurringBill,
  transactions: Pick<Transaction, "tag_id" | "date" | "amount">[],
  asOf?: string
): InstalmentProgress | null {
  if (!isInstalment(bill)) return null;
  const months = planMonths(bill);
  const total = months.length;
  const monthly = bill.expected_amount ?? 0;
  const totalAmount = (sen(monthly) * total) / 100;
  const paidAmount = planPaid(bill, transactions, asOf);
  const finished = paidAmount >= totalAmount - TOLERANCE;
  return {
    total,
    paid: finished ? total : monthly > 0 ? Math.min(total, Math.floor((paidAmount + TOLERANCE) / monthly)) : 0,
    paidAmount,
    totalAmount,
    monthly,
    owed: finished ? 0 : round2(totalAmount - paidAmount),
    firstMonth: months[0],
    lastMonth: months[total - 1],
    finished,
  };
}

// Everything still owed across plans, as of a date. A plan only counts from when it was taken
// out (`openedOn`: the goal's bought date, else its first payment month), so a past month's net
// worth doesn't include a debt that didn't exist yet.
export function totalOwed(
  bills: RecurringBill[],
  transactions: Pick<Transaction, "tag_id" | "date" | "amount">[],
  asOf: string, // YYYY-MM-DD
  openedOn: (b: RecurringBill) => string | null | undefined = (b) => b.start_month
): number {
  return round2(
    bills.reduce((sum, b) => {
      const opened = openedOn(b) ?? b.start_month;
      if (!isInstalment(b) || (opened && opened > asOf)) return sum;
      return sum + (instalmentProgress(b, transactions, asOf)?.owed ?? 0);
    }, 0)
  );
}

export interface PlanTerms {
  financed: number; // price minus down payment
  fees: number; // interest / fees over the whole plan
  monthly: number;
  total: number; // down payment + amount financed + fees
  extra: number; // what paying by instalment costs over paying upfront (the fees)
}

// Monthly payment for a price, down payment, number of months and total fee rate (0.06 = 6% of
// the amount financed, over the whole plan; 0 for most buy-now-pay-later plans).
export function planTerms(opts: { price: number; downPayment: number; months: number; feeRate: number }): PlanTerms {
  // Worked in whole sen: decimal ringgit in floating point can land just under a half sen
  // ((5,499 + 329.94) / 12 = 485.744999…) and round the wrong way.
  const sen = (rm: number) => Math.round(rm * 100);
  const financed = Math.max(0, sen(opts.price) - sen(opts.downPayment));
  const fees = Math.round(financed * Math.max(0, opts.feeRate));
  const monthly = opts.months > 0 ? Math.round((financed + fees) / opts.months) : 0;
  // Total and extra come from the fees, not monthly × months: rounding the monthly amount can make
  // that a few sen off (plans settle it in the last payment), and a 0% plan must never look like it
  // costs more.
  const total = sen(opts.downPayment) + financed + fees;
  return { financed: financed / 100, fees: fees / 100, monthly: monthly / 100, total: total / 100, extra: fees / 100 };
}
