import { describe, expect, it } from "vitest";
import { calculateDailyAverage, calculateMonthlyInterest, calculateSalaryMetrics, calculateUntrackedCash } from "@/lib/formulas";
import { monthForecast, monthsBefore } from "@/lib/analytics";
import { budgetStatus } from "@/lib/budgets";
import { dueAutoBills, dueDateIn } from "@/lib/bills";
import { billActiveIn, instalmentProgress, lastPaymentMonth, planMonths, planShortfall, planTerms, totalOwed } from "@/lib/instalments";
import { buildReminders, DEFAULT_REMINDER_PREFS, type ReminderData } from "@/lib/reminders";
import { defaultEntryDate } from "@/lib/preferences";
import { mealForHour } from "@/lib/roles";
import { buildSnapshots, draftFor, fromLegacySavings, liquidOf, netWorthOf } from "@/lib/savings";
import { goalProgress, netTarget } from "@/lib/goals";
import type { Goal, RecurringBill, SavingsAccount, Tag, Transaction } from "@/lib/types";

// The money and date logic behind Overview, Budgets, Bills, Goals, Savings and reminders.
// Example figures only.

let n = 0;
const tx = (date: string, amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `tx${++n}`,
  date,
  amount,
  category_id: "cat-food",
  tag_id: "tag-lunch",
  is_one_off: false,
  ...extra,
});
const bill = (extra: Partial<RecurringBill> = {}): RecurringBill => ({
  id: "bill",
  tag_id: "tag-netflix",
  is_active: true,
  expected_amount: 54.9,
  due_day: 5,
  ...extra,
});
const TAGS: Tag[] = [
  { id: "tag-lunch", category_id: "cat-food", name: "Lunch" },
  { id: "tag-netflix", category_id: "cat-subs", name: "Netflix" },
];

describe("formulas (same results as the original spreadsheet)", () => {
  it("salary after EPF, SOCSO and EIS, and the savings rate", () => {
    expect(calculateSalaryMetrics(3500, 2400)).toEqual({
      gross: 3500,
      epf: 385,
      socso: 17.25,
      eis: 6.9,
      netSalary: 3090.85,
      netCashSaved: 690.85,
      savingsRate: 22.35,
    });
  });

  it("a month's interest, compounded daily", () => {
    expect(calculateMonthlyInterest([{ balance: 5000, rate: 0.0355 }], "2026-08")).toBe(15.1);
    expect(calculateMonthlyInterest([{ balance: 5000, rate: 0 }, { balance: -10, rate: 0.03 }], "2026-08")).toBe(0);
  });

  it("daily average leaves out one-offs and counts days so far in the current month", () => {
    const txs = [tx("2026-10-01", 30), tx("2026-10-02", 30), tx("2026-10-02", 900, { is_one_off: true })];
    expect(calculateDailyAverage(txs, "2026-10", new Date(2026, 9, 3))).toBe(20);
    expect(calculateDailyAverage(txs, "2026-09", new Date(2026, 9, 3))).toBe(2); // a past month: all 30 days
  });

  it("untracked cash: savings growth not explained by income minus spending", () => {
    expect(calculateUntrackedCash(5000, 4500, 690.85)).toBe(-190.85);
    expect(calculateUntrackedCash(5000, null, 100)).toBeNull();
  });
});

describe("Overview forecast", () => {
  it("stretches everyday spending to month end and adds bills still to come", () => {
    const txs = [tx("2026-10-01", 20), tx("2026-10-02", 40), tx("2026-10-02", 54.9, { tag_id: "tag-netflix" })];
    // 60 everyday over 2 days = 30/day × 29 days left = 870; + 114.90 spent + 100 to come.
    expect(monthForecast(txs, "2026-10", "2026-10-02", new Set(["tag-netflix"]), 100)).toEqual({
      projected: 1084.9,
      flexibleDaily: 30,
      daysLeft: 29,
      billsToCome: 100,
    });
    expect(monthForecast(txs, "2026-09", "2026-10-02", new Set(), 0)).toBeNull();
  });

  it("lists earlier months across a year end", () => {
    expect(monthsBefore("2026-02", 3)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });
});

describe("budgets", () => {
  const status = (txs: Transaction[], today: string, upcomingBills = 0) =>
    budgetStatus({ limit: 600, categoryTxs: txs, month: "2026-10", today, billTagIds: new Set(["tag-netflix"]), upcomingBills });

  it("is fine when on pace", () => {
    const s = status([tx("2026-10-01", 100)], "2026-10-10");
    expect(s.state).toBe("ok");
    expect(s.projected).toBe(310);
    expect(s.perDayLeft).toBe(22.73); // 500 left over 22 days
  });

  it("warns when the pace would go over, without stretching bills or one-offs", () => {
    expect(status([tx("2026-10-01", 250)], "2026-10-10").state).toBe("at-risk");
    expect(status([tx("2026-10-01", 500, { is_one_off: true })], "2026-10-10").state).toBe("ok");
  });

  it("is over once spending passes the limit, and past months aren't projected", () => {
    const s = budgetStatus({ limit: 600, categoryTxs: [tx("2026-09-03", 650)], month: "2026-09", today: "2026-10-03", billTagIds: new Set(), upcomingBills: 0 });
    expect(s).toMatchObject({ state: "over", projected: 650, remaining: 0, perDayLeft: null });
  });
});

describe("monthly bills", () => {
  it("moves a due day past the month's end to its last day", () => {
    expect(dueDateIn("2026-02", 31)).toBe("2026-02-28");
    expect(dueDateIn("2028-02", 30)).toBe("2028-02-29");
    expect(dueDateIn("2026-10", 5)).toBe("2026-10-05");
  });

  it("auto-adds due bills not logged yet this month (local mode's version of the daily job)", () => {
    const auto = bill({ auto_log: true });
    const today = new Date(2026, 9, 6);
    expect(dueAutoBills([auto], TAGS, [], today)).toEqual([
      { date: "2026-10-05", category_id: "cat-subs", tag_id: "tag-netflix", amount: 54.9, description: "Auto-added monthly bill", is_one_off: false },
    ]);
    expect(dueAutoBills([auto], TAGS, [tx("2026-10-01", 54.9, { tag_id: "tag-netflix" })], today)).toEqual([]);
    expect(dueAutoBills([auto], TAGS, [], new Date(2026, 9, 4))).toEqual([]); // not due yet
    expect(dueAutoBills([bill()], TAGS, [], today)).toEqual([]); // not automatic
    expect(dueAutoBills([{ ...auto, installment_count: 3, start_month: "2026-11-01" }], TAGS, [], today)).toEqual([]);
  });
});

describe("instalments", () => {
  const plan = bill({ installment_count: 3, start_month: "2026-11-01", expected_amount: 100 });

  it("runs from the first to the last payment month", () => {
    expect(planMonths(plan)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(lastPaymentMonth(plan)).toBe("2027-01");
    expect(["2026-10", "2026-11", "2027-01", "2027-02"].map((m) => billActiveIn(plan, m))).toEqual([false, true, true, false]);
    expect(billActiveIn(bill(), "1999-01")).toBe(true); // ongoing bills always run
  });

  it("counts a month as paid when its tag is logged, and what's still owed", () => {
    const paid = [tx("2026-11-05", 100, { tag_id: "tag-netflix" }), tx("2026-12-20", 100, { tag_id: "tag-netflix" })];
    expect(instalmentProgress(plan, paid)).toMatchObject({ total: 3, paid: 2, owed: 100, finished: false });
    expect(instalmentProgress(plan, paid, "2026-11-30")).toMatchObject({ paid: 1, owed: 200 });
    expect(instalmentProgress(bill(), paid)).toBeNull();
  });

  describe("counts payments by amount, however they're paid", () => {
    // 6 × RM 100, Oct to Mar.
    const six = bill({ installment_count: 6, start_month: "2026-10-01", expected_amount: 100, auto_log: true, due_day: 5 });
    const pay = (date: string, amount: number) => tx(date, amount, { tag_id: "tag-netflix" });

    it("two months paid at once count as two", () => {
      const p = instalmentProgress(six, [pay("2026-10-05", 200)]);
      expect(p).toMatchObject({ paid: 2, paidAmount: 200, owed: 400, finished: false });
      expect(planShortfall(six, [pay("2026-10-05", 200)], "2026-11")).toBe(0); // November is covered
      expect(planShortfall(six, [pay("2026-10-05", 200)], "2026-12")).toBe(100);
    });

    it("a month paid early covers that month, and isn't auto-added again", () => {
      const txs = [pay("2026-10-05", 100), pay("2026-10-20", 100)];
      expect(instalmentProgress(six, txs)?.paid).toBe(2);
      expect(dueAutoBills([six], TAGS, txs, new Date(2026, 10, 6))).toEqual([]); // 6 Nov: nothing to add
      expect(dueAutoBills([six], TAGS, txs, new Date(2026, 11, 6))).toHaveLength(1); // 6 Dec: due again
    });

    it("settling the rest early finishes the plan and stops auto-add", () => {
      const txs = [pay("2026-10-05", 100), pay("2026-11-05", 100), pay("2026-11-20", 400)];
      expect(instalmentProgress(six, txs)).toMatchObject({ paid: 6, owed: 0, finished: true });
      expect(dueAutoBills([six], TAGS, txs, new Date(2027, 0, 6))).toEqual([]);
      expect(totalOwed([six], txs, "2026-11-30")).toBe(0);
    });

    it("a part payment leaves only the difference to add", () => {
      const txs = [pay("2026-10-05", 100), pay("2026-11-02", 40)];
      expect(planShortfall(six, txs, "2026-11")).toBe(60);
      expect(dueAutoBills([six], TAGS, txs, new Date(2026, 10, 6))[0].amount).toBe(60);
      expect(instalmentProgress(six, txs)).toMatchObject({ paid: 1, paidAmount: 140, owed: 460 });
    });

    it("never adds more than one payment a month, even after a missed month", () => {
      // October wasn't logged; November still only needs November's payment.
      expect(planShortfall(six, [], "2026-11")).toBe(100);
      expect(planShortfall(six, [pay("2026-11-05", 100)], "2026-11")).toBe(0);
    });

    it("counts a first payment made the month before the plan starts", () => {
      expect(instalmentProgress(six, [pay("2026-09-28", 100)])?.paid).toBe(1);
      expect(instalmentProgress(six, [pay("2026-08-28", 100)])?.paid).toBe(0); // too early: another purchase
    });

    it("doesn't remind about a month already covered", () => {
      const data: ReminderData = {
        today: "2026-11-04",
        bills: [{ ...six, auto_log: false }],
        tags: TAGS,
        categories: [],
        transactions: [pay("2026-10-05", 200), tx("2026-11-04", 1)],
        budgets: [],
        goals: [],
      };
      expect(buildReminders(data, DEFAULT_REMINDER_PREFS)).toEqual([]);
      expect(buildReminders({ ...data, transactions: [pay("2026-10-05", 100)] }, DEFAULT_REMINDER_PREFS).map((r) => r.title)).toEqual([
        "Netflix is due tomorrow · RM\u00a0100.00",
      ]);
    });
  });

  it("only counts what's owed from when the plan was taken out", () => {
    expect(totalOwed([plan], [], "2026-10-31")).toBe(0); // first payment month hasn't come
    expect(totalOwed([plan], [], "2026-10-31", () => "2026-10-15")).toBe(300); // bought on 15 Oct
    expect(totalOwed([plan, bill()], [], "2026-11-30")).toBe(300);
  });

  it("works out the terms in whole sen, so a 0% plan never costs extra", () => {
    expect(planTerms({ price: 5499, downPayment: 0, months: 12, feeRate: 0.06 })).toEqual({
      financed: 5499,
      fees: 329.94,
      monthly: 485.75, // 485.745 exactly; floating point would round it down
      total: 5828.94,
      extra: 329.94,
    });
    expect(planTerms({ price: 100, downPayment: 0, months: 3, feeRate: 0 })).toEqual({
      financed: 100,
      fees: 0,
      monthly: 33.33,
      total: 100,
      extra: 0,
    });
    expect(planTerms({ price: 100, downPayment: 150, months: 3, feeRate: 0 }).financed).toBe(0);
  });
});

describe("reminders", () => {
  const data = (extra: Partial<ReminderData>): ReminderData => ({
    today: "2026-10-04",
    bills: [],
    tags: TAGS,
    categories: [{ id: "cat-food", name: "Food" }],
    transactions: [],
    budgets: [],
    goals: [],
    ...extra,
  });
  const titles = (d: ReminderData) => buildReminders(d, { ...DEFAULT_REMINDER_PREFS, daily_log: true }).map((r) => r.title);

  it("reminds about bills due tomorrow or overdue, but not automatic or paid ones", () => {
    expect(titles(data({ bills: [bill()], transactions: [tx("2026-10-04", 1)] }))).toEqual(["Netflix is due tomorrow · RM 54.90"]);
    expect(titles(data({ today: "2026-10-07", bills: [bill()], transactions: [tx("2026-10-07", 1)] }))).toEqual([
      "Netflix was due on 5 Oct · RM 54.90",
    ]);
    expect(titles(data({ bills: [bill({ auto_log: true })], transactions: [tx("2026-10-04", 1)] }))).toEqual([]);
    expect(titles(data({ bills: [bill()], transactions: [tx("2026-10-01", 54.9, { tag_id: "tag-netflix" }), tx("2026-10-04", 1)] }))).toEqual([]);
  });

  it("doesn't remind about an instalment outside its months", () => {
    const ended = bill({ installment_count: 2, start_month: "2026-07-01" });
    expect(titles(data({ bills: [ended], transactions: [tx("2026-10-04", 1)] }))).toEqual([]);
  });

  it("warns at 80% of a budget and when over", () => {
    const budgets = [{ id: "b", category_id: "cat-food", monthly_limit: 100 }];
    expect(titles(data({ budgets, transactions: [tx("2026-10-04", 85)] }))).toEqual(["Food is at 85% of its budget"]);
    expect(titles(data({ budgets, transactions: [tx("2026-10-04", 120)] }))).toEqual(["Food is over budget"]);
  });

  it("warns about vouchers 3 days and 1 day before they expire", () => {
    const goal: Goal = {
      id: "g",
      name: "New phone",
      target_amount: 3000,
      trade_in_value: 0,
      priority: 0,
      status: "active",
      discounts: [{ id: "d", label: "11.11 voucher", kind: "amount", value: 50, expires_on: "2026-10-07" }],
    };
    const on = (today: string) => titles(data({ today, goals: [goal], transactions: [tx(today, 1)] }));
    expect(on("2026-10-04")).toEqual(["11.11 voucher expires in 3 days"]);
    expect(on("2026-10-05")).toEqual([]);
    expect(on("2026-10-06")).toEqual(["11.11 voucher expires tomorrow"]);
  });

  it("nudges when nothing was logged today, if switched on", () => {
    expect(titles(data({}))).toEqual(["Nothing logged today"]);
    expect(buildReminders(data({}), DEFAULT_REMINDER_PREFS)).toEqual([]);
  });

  it("gives each reminder a key so it's only sent once", () => {
    const keys = buildReminders(data({ bills: [bill()], transactions: [tx("2026-10-04", 1)] }), DEFAULT_REMINDER_PREFS).map((r) => r.key);
    expect(keys).toEqual(["bill:tag-netflix:2026-10-05:soon"]);
  });
});

describe("which date Add expense starts on", () => {
  const base = { today: "2026-10-03", eveningTagIds: ["tag-dinner", "tag-supper"] };

  it("is today in Today mode, or with no last entry", () => {
    expect(defaultEntryDate({ ...base, mode: "today", lastEntryDate: "2026-09-28", transactions: [] })).toBe("2026-10-03");
    expect(defaultEntryDate({ ...base, mode: "last", lastEntryDate: null, transactions: [] })).toBe("2026-10-03");
  });

  it("stays on the last date until it has dinner or supper, then moves to the next day (never past today)", () => {
    const opts = { ...base, mode: "last" as const, lastEntryDate: "2026-09-28" };
    expect(defaultEntryDate({ ...opts, transactions: [{ date: "2026-09-28", tag_id: "tag-lunch" }] })).toBe("2026-09-28");
    expect(defaultEntryDate({ ...opts, transactions: [{ date: "2026-09-28", tag_id: "tag-supper" }] })).toBe("2026-09-29");
    expect(
      defaultEntryDate({ ...opts, lastEntryDate: "2026-10-03", transactions: [{ date: "2026-10-03", tag_id: "tag-dinner" }] })
    ).toBe("2026-10-03");
  });

  it("suggests the meal for the time of day", () => {
    expect([4, 5, 11, 15, 17, 22].map(mealForHour)).toEqual(["supper", "breakfast", "lunch", "snack", "dinner", "supper"]);
  });
});

describe("savings", () => {
  const accounts: SavingsAccount[] = [
    { id: "bank", name: "Bank", kind: "liquid", position: 0, archived: false },
    { id: "epf", name: "EPF", kind: "locked", position: 1, archived: false },
    { id: "old", name: "Old wallet", kind: "liquid", position: 2, archived: true },
  ];
  const snapshots = buildSnapshots([
    { account_id: "bank", month: "2026-08-01", balance: 1000, rate: 0.03 },
    { account_id: "epf", month: "2026-08-01", balance: 5000, rate: 0 },
    { account_id: "old", month: "2026-08-01", balance: 50, rate: 0 },
    { account_id: "bank", month: "2026-09-01", balance: 1200, rate: 0.03 },
  ]);

  it("totals usable money and net worth", () => {
    expect(snapshots.map((s) => s.month)).toEqual(["2026-08-01", "2026-09-01"]);
    expect(liquidOf(snapshots[0], accounts)).toBe(1050);
    expect(netWorthOf(snapshots[0])).toBe(6050);
  });

  it("starts a new month from each account's latest balance, without archived accounts", () => {
    expect(draftFor(accounts, snapshots, "2026-10").map((l) => [l.account.id, l.balance, l.rate])).toEqual([
      ["bank", 1200, 0.03],
      ["epf", 5000, 0],
    ]);
  });

  it("converts the old fixed columns the same way as the migration", () => {
    const { accounts: made, balances } = fromLegacySavings([
      { month: "2026-06-01", main_checking: 0, gx_bank: 0, gx_rate: 0, ryt_bank: 0, ryt_rate: 0, epf_locked: 0 },
      { month: "2026-07-01", main_checking: 1000, gx_bank: 2000, gx_rate: 0.0355, ryt_bank: 0, ryt_rate: 0, epf_locked: 5000 },
    ]);
    expect(made.map((a) => [a.name, a.kind])).toEqual([
      ["Main checking", "liquid"],
      ["GXBank", "liquid"],
      ["EPF & locked", "locked"],
    ]);
    expect(balances.map((b) => b.month)).toEqual(["2026-07-01", "2026-07-01", "2026-07-01"]);
  });
});

describe("goals", () => {
  const goal: Goal = {
    id: "g",
    name: "New phone",
    target_amount: 4000,
    trade_in_value: 800,
    priority: 0,
    status: "active",
    target_date: "2026-12-15",
    discounts: [
      { id: "a", label: "Voucher", kind: "amount", value: 100, expires_on: "2026-12-31" },
      { id: "b", label: "Card", kind: "percent", value: 5 },
      { id: "c", label: "Expired", kind: "amount", value: 999, expires_on: "2026-09-30" },
    ],
  };
  const today = new Date(2026, 9, 3);

  it("takes off the trade-in and discounts that haven't expired", () => {
    expect(netTarget(goal, today)).toBe(2900); // 4000 - 800 - 100 - 200
  });

  it("works out the monthly amount to reach the target date", () => {
    const p = goalProgress(goal, [{ id: "c1", goal_id: "g", amount: 500, date: "2026-10-01" }], today);
    expect(p).toMatchObject({ saved: 500, remaining: 2400, monthsLeft: 3, neededPerMonth: 800, pacePerMonth: 500, readyBy: "2027-03" });
  });
});
