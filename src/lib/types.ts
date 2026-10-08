export interface Category {
  id: string;
  name: string;
  color?: string;
  icon?: string | null; // key into CATEGORY_ICON_OPTIONS; null = pick by name
  // Marked categories the app relies on (see lib/roles.ts): "food" for the Food & dining card and
  // meal suggestions; "instalments" for plans bought from Goals (can be renamed, not deleted).
  role?: "food" | "instalments" | null;
  position?: number | null; // your order (Settings → Reorder); none = after the ordered ones, by name
}

export interface Tag {
  id: string;
  category_id: string;
  name: string;
  role?: "breakfast" | "lunch" | "snack" | "dinner" | "supper" | null; // meal suggested by time of day
}

export interface RecurringBill {
  id: string;
  tag_id: string;
  is_active: boolean;
  expected_amount?: number | null; // used by "Log missing bills" instead of last month's amount
  due_day?: number | null; // 1-31, clamped to the month's length
  auto_log?: boolean; // added automatically on the due day (needs expected_amount + due_day)
  // Instalment plan: a bill that runs for installment_count months from start_month, then ends.
  // expected_amount is the monthly payment. Ongoing bills leave these empty.
  installment_count?: number | null;
  start_month?: string | null; // YYYY-MM-01, first payment
  goal_id?: string | null; // the goal it paid for, if bought from Goals
  cash_price?: number | null; // price if paid upfront (to show what the plan costs extra)
  down_payment?: number | null; // paid at purchase, logged as a one-off expense
}

export interface Budget {
  id: string;
  category_id: string;
  monthly_limit: number;
}

export interface GoalDiscount {
  id: string;
  label: string; // e.g. "11.11 voucher", "Card cashback"
  kind: "amount" | "percent"; // RM off, or % of the price
  value: number;
  expires_on?: string | null; // YYYY-MM-DD; expired discounts stop counting
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number; // full price
  trade_in_name?: string | null; // what you'll trade in, e.g. "iPhone 13"
  trade_in_value: number; // expected trade-in value (0 = none)
  trade_in_updated?: string | null; // YYYY-MM-DD, when the value was last checked
  discounts: GoalDiscount[];
  target_date?: string | null; // YYYY-MM-DD
  link?: string | null;
  priority: number; // lower = higher on the list
  status: "active" | "bought" | "archived";
  bought_at?: string | null;
  created_at?: string;
}

export interface GoalContribution {
  id: string;
  goal_id: string;
  amount: number; // positive = set aside, negative = taken back
  date: string; // YYYY-MM-DD
  note?: string | null;
}

export interface Transaction {
  id: string;
  user_id?: string;
  date: string; // YYYY-MM-DD
  day?: string; // Monday, Tuesday, etc.
  category_id: string;
  category_name?: string;
  tag_id: string;
  tag_name?: string;
  amount: number;
  description?: string;
  is_one_off: boolean;
  created_at?: string;
}

export interface TransactionInput {
  date: string;
  category_id: string;
  tag_id: string;
  amount: number;
  description?: string;
  is_one_off?: boolean;
}

// A savings account the person tracks (bank, e-wallet, EPF, investments, …).
export interface SavingsAccount {
  id: string;
  name: string;
  kind: "liquid" | "locked"; // locked (e.g. EPF) counts toward net worth, not the emergency fund
  position: number; // display order
  archived: boolean; // closed: hidden when recording new months, past months keep it
}

// One account's balance at the end of a month.
export interface SavingsBalance {
  id?: string;
  account_id: string;
  month: string; // YYYY-MM-01
  balance: number;
  rate: number; // interest p.a. as a fraction (0.0355 = 3.55%); 0 = none
}

// The old fixed-column shape (monthly_savings table, before 2026-09-30_savings_accounts.sql).
// Only read to convert older data.
export interface LegacyMonthlySavings {
  id?: string;
  month: string; // YYYY-MM-01
  main_checking: number;
  gx_bank: number;
  gx_rate: number;
  ryt_bank: number;
  ryt_rate: number;
  epf_locked: number;
}

export interface UserSalaryProfile {
  default_gross_salary: number; // default RM 3,500
  epf_rate: number; // default 0.11
  socso_rate: number; // default RM 17.25
  eis_rate: number; // default RM 6.90
}

export interface MonthlyKpiSummary {
  month: string;
  totalSpend: number;
  foodSpend: number;
  dailyAverage: number;
  largestExpense: {
    amount: number;
    tag_name: string;
    category_name: string;
  } | null;
  salary: {
    gross: number;
    epf: number;
    socso: number;
    eis: number;
    netSalary: number;
    netCashSaved: number;
    savingsRate: number;
  };
  liquidAssets: {
    total: number;
    monthlyGrowth: number | null;
    estInterest: number;
    untrackedCash: number | null;
  };
  recurringStatus: {
    tag_name: string;
    isLogged: boolean;
  }[];
}
