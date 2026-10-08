"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Budget,
  Category,
  Goal,
  GoalContribution,
  LegacyMonthlySavings,
  RecurringBill,
  SavingsAccount,
  SavingsBalance,
  Tag,
  Transaction,
  UserSalaryProfile,
} from "./types";
import {
  INITIAL_CATEGORIES,
  INITIAL_TAGS,
  INITIAL_TRANSACTIONS,
  INITIAL_SAVINGS_ACCOUNTS,
  INITIAL_SAVINGS_BALANCES,
  INITIAL_BILLS,
  INITIAL_GOALS,
  INITIAL_GOAL_CONTRIBUTIONS,
  INITIAL_BUDGETS,
} from "./mock-data";
import { disablePush } from "./push";
import { createClient } from "./supabase/client";
import { fetchAllTransactions } from "./supabase/fetch-all";
import { isSupabaseConfigured } from "./supabase/config";
import { exitGuest, isGuestSession } from "./guest";
import { dueAutoBills } from "./bills";
import { fromLegacySavings } from "./savings";
import { instalmentsCategory } from "./roles";

export type NewTransaction = {
  amount: number;
  date: string;
  category_id: string;
  tag_id: string;
  description?: string;
  is_one_off: boolean;
};

export type GoalInput = Pick<
  Goal,
  "name" | "target_amount" | "trade_in_name" | "trade_in_value" | "trade_in_updated" | "target_date" | "link" | "discounts"
>;

export type BillChanges = Partial<
  Pick<
    RecurringBill,
    | "expected_amount"
    | "due_day"
    | "is_active"
    | "auto_log"
    | "installment_count"
    | "start_month"
    | "goal_id"
    | "cash_price"
    | "down_payment"
  >
>;

// Bought a goal on instalments: the monthly plan, plus the down payment paid today (if any).
export interface InstalmentPurchase {
  monthly: number; // the payments go under the Instalments category, with a tag of their own
  installment_count: number;
  start_month: string; // YYYY-MM-01
  due_day: number;
  auto_log: boolean;
  cash_price: number;
  downPayment: NewTransaction | null; // logged as a one-off expense today
}


export interface Toast {
  id: number;
  message: string;
  tone: "default" | "error";
  action?: { label: string; onClick: () => void };
}

export const DEFAULT_PROFILE: UserSalaryProfile = {
  default_gross_salary: 3500,
  epf_rate: 0.11,
  socso_rate: 17.25,
  eis_rate: 6.9,
};

// cloud = Supabase account; local = no Supabase configured (localStorage cache);
// guest = "Continue without an account" (in memory only, wiped on refresh).
export type DataMode = "cloud" | "local" | "guest";

interface BudgetContextType {
  mode: DataMode;
  categories: Category[];
  tags: Tag[];
  transactions: Transaction[];
  savingsAccounts: SavingsAccount[];
  savingsBalances: SavingsBalance[];
  selectedMonth: string; // YYYY-MM
  setSelectedMonth: (month: string) => void;
  addTransaction: (tx: NewTransaction) => Promise<void>;
  updateTransaction: (id: string, tx: NewTransaction) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  // Month-end balances for one month (YYYY-MM), one line per account.
  saveBalances: (month: string, lines: Pick<SavingsBalance, "account_id" | "balance" | "rate">[]) => Promise<boolean>;
  addSavingsAccount: (name: string, kind: SavingsAccount["kind"]) => Promise<SavingsAccount | null>;
  updateSavingsAccount: (id: string, changes: Partial<Pick<SavingsAccount, "name" | "kind" | "archived">>) => Promise<boolean>;
  // Only for accounts with no balances; ones with history are archived instead.
  deleteSavingsAccount: (id: string) => Promise<boolean>;
  profile: UserSalaryProfile;
  updateProfile: (profile: UserSalaryProfile) => Promise<void>;
  emergencyMonths: number; // emergency fund goal, in months of spending
  setEmergencyMonths: (months: number) => Promise<void>;
  toast: Toast | null;
  showToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: () => void;
  bills: RecurringBill[];
  budgets: Budget[];
  // Set a category's monthly limit; null removes the budget.
  setBudget: (categoryId: string, limit: number | null) => Promise<boolean>;
  goals: Goal[];
  goalContributions: GoalContribution[];
  addGoal: (goal: GoalInput) => Promise<Goal | null>;
  updateGoal: (id: string, changes: Partial<GoalInput & Pick<Goal, "status" | "bought_at" | "priority">>) => Promise<boolean>;
  deleteGoal: (id: string) => Promise<boolean>;
  moveGoal: (id: string, direction: -1 | 1) => Promise<void>;
  addContribution: (goalId: string, amount: number, note?: string) => Promise<boolean>;
  deleteContribution: (id: string) => Promise<boolean>;
  markGoalBought: (goalId: string, expense: NewTransaction) => Promise<boolean>;
  // Creates the plan (a monthly bill that ends) and moves the goal to bought.
  markGoalBoughtOnInstalments: (goal: Goal, plan: InstalmentPurchase) => Promise<boolean>;
  addBill: (tagId: string, changes?: BillChanges) => Promise<RecurringBill | null>;
  updateBill: (id: string, changes: BillChanges) => Promise<boolean>;
  removeBill: (id: string) => Promise<boolean>;
  addCategory: (name: string, icon: string) => Promise<Category | null>;
  renameCategory: (id: string, name: string, icon?: string) => Promise<boolean>;
  deleteCategory: (id: string) => Promise<boolean>;
  addTag: (categoryId: string, name: string) => Promise<Tag | null>;
  renameTag: (id: string, name: string) => Promise<boolean>;
  deleteTag: (id: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  isSyncedWithSupabase: boolean;
  isLoaded: boolean;
  loadError: string | null;
}

const BudgetContext = createContext<BudgetContextType | undefined>(undefined);

const STORAGE_KEYS = {
  TRANSACTIONS: "budget_tracker_transactions",
  SAVINGS: "budget_tracker_savings", // old fixed-column format, converted on load
  SAVINGS_ACCOUNTS: "budget_tracker_savings_accounts",
  SAVINGS_BALANCES: "budget_tracker_savings_balances",
  PROFILE: "budget_tracker_profile",
  CATEGORIES: "budget_tracker_categories",
  TAGS: "budget_tracker_tags",
  BILLS: "budget_tracker_bills",
  EMERGENCY_MONTHS: "budget_tracker_emergency_months",
  GOALS: "budget_tracker_goals",
  BUDGETS: "budget_tracker_budgets",
  GOAL_CONTRIBUTIONS: "budget_tracker_goal_contributions",
};

// Postgres / PostgREST codes for "table doesn't exist yet" (a migration hasn't been run).
const MISSING_TABLE = ["42P01", "PGRST205"];

// Turns a Supabase/Postgres error into a message the user can act on.
function describeDbError(error: { code?: string; message?: string }, what: string): string {
  if (error.code === "23505") return `${what} already exists.`;
  if (error.code === "23503") return `${what} is still used by expenses.`;
  // Row-level security said no: usually a migration in scripts/migrations/ hasn't been run yet.
  if (error.code === "42501") return `Not allowed to save ${what.toLowerCase()}. Run the latest migrations in Supabase.`;
  return `Couldn't save ${what.toLowerCase()}.`;
}

const UNDO_MS = 5000;

const currentMonth = () => format(new Date(), "yyyy-MM");

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  // With Supabase, start empty and fill from the database; the mock data is only for local-only mode.
  const [categories, setCategories] = useState<Category[]>(isSupabaseConfigured ? [] : INITIAL_CATEGORIES);
  const [tags, setTags] = useState<Tag[]>(isSupabaseConfigured ? [] : INITIAL_TAGS);
  const [transactions, setTransactions] = useState<Transaction[]>(
    isSupabaseConfigured ? [] : INITIAL_TRANSACTIONS
  );
  const [savingsAccounts, setSavingsAccounts] = useState<SavingsAccount[]>(
    isSupabaseConfigured ? [] : INITIAL_SAVINGS_ACCOUNTS
  );
  const [savingsBalances, setSavingsBalances] = useState<SavingsBalance[]>(
    isSupabaseConfigured ? [] : INITIAL_SAVINGS_BALANCES
  );
  // Cloud database without 2026-09-30_savings_accounts.sql: old balances are shown, saving needs the migration.
  const [savingsNeedsMigration, setSavingsNeedsMigration] = useState(false);
  // Real month is set on mount; using new Date() here would bake the build date into the prerendered HTML.
  const [selectedMonth, setSelectedMonth] = useState<string>("2026-01");
  const [isSyncedWithSupabase, setIsSyncedWithSupabase] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserSalaryProfile>(DEFAULT_PROFILE);
  const [emergencyMonths, setEmergencyMonthsState] = useState(6);
  const [bills, setBills] = useState<RecurringBill[]>(isSupabaseConfigured ? [] : INITIAL_BILLS);
  const [budgets, setBudgets] = useState<Budget[]>(isSupabaseConfigured ? [] : INITIAL_BUDGETS);
  const [goals, setGoals] = useState<Goal[]>(isSupabaseConfigured ? [] : INITIAL_GOALS);
  const [goalContributions, setGoalContributions] = useState<GoalContribution[]>(
    isSupabaseConfigured ? [] : INITIAL_GOAL_CONTRIBUTIONS
  );
  const [mode, setMode] = useState<DataMode>(isSupabaseConfigured ? "cloud" : "local");
  const isCloud = mode === "cloud";
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((t: Omit<Toast, "id">) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ...t, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), t.tone === "error" ? 8000 : UNDO_MS);
  }, []);

  useEffect(() => {
    setSelectedMonth(currentMonth());

    if (isGuestSession()) {
      // Fresh demo data on every load; nothing is read from or written to storage.
      setMode("guest");
      setCategories(INITIAL_CATEGORIES);
      setTags(INITIAL_TAGS);
      setTransactions(INITIAL_TRANSACTIONS);
      setSavingsAccounts(INITIAL_SAVINGS_ACCOUNTS);
      setSavingsBalances(INITIAL_SAVINGS_BALANCES);
      setBills(INITIAL_BILLS);
      setGoals(INITIAL_GOALS);
      setGoalContributions(INITIAL_GOAL_CONTRIBUTIONS);
      setBudgets(INITIAL_BUDGETS);
      setIsLoaded(true);
      return;
    }

    if (!isSupabaseConfigured) {
      // Local-only mode: restore the offline cache over the mock data.
      try {
        const savedTx = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
        if (savedTx) setTransactions(JSON.parse(savedTx));
        const savedAccounts = localStorage.getItem(STORAGE_KEYS.SAVINGS_ACCOUNTS);
        const savedBalances = localStorage.getItem(STORAGE_KEYS.SAVINGS_BALANCES);
        const legacySavings = localStorage.getItem(STORAGE_KEYS.SAVINGS);
        if (savedAccounts) {
          setSavingsAccounts(JSON.parse(savedAccounts));
          setSavingsBalances(savedBalances ? JSON.parse(savedBalances) : []);
        } else if (legacySavings) {
          const converted = fromLegacySavings(JSON.parse(legacySavings));
          setSavingsAccounts(converted.accounts);
          setSavingsBalances(converted.balances);
        }
        const savedCats = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
        if (savedCats) setCategories(JSON.parse(savedCats));
        const savedTags = localStorage.getItem(STORAGE_KEYS.TAGS);
        if (savedTags) setTags(JSON.parse(savedTags));
        const savedBudgets = localStorage.getItem(STORAGE_KEYS.BUDGETS);
        if (savedBudgets) setBudgets(JSON.parse(savedBudgets));
        const savedGoals = localStorage.getItem(STORAGE_KEYS.GOALS);
        if (savedGoals) setGoals(JSON.parse(savedGoals));
        const savedContribs = localStorage.getItem(STORAGE_KEYS.GOAL_CONTRIBUTIONS);
        if (savedContribs) setGoalContributions(JSON.parse(savedContribs));
        const savedBills = localStorage.getItem(STORAGE_KEYS.BILLS);
        if (savedBills) setBills(JSON.parse(savedBills));
        const savedGoal = Number(localStorage.getItem(STORAGE_KEYS.EMERGENCY_MONTHS));
        if (savedGoal >= 1 && savedGoal <= 24) setEmergencyMonthsState(savedGoal);
        const savedProfile = localStorage.getItem(STORAGE_KEYS.PROFILE);
        if (savedProfile) setProfile({ ...DEFAULT_PROFILE, ...JSON.parse(savedProfile) });
      } catch (e) {
        console.error("Failed to read from localStorage", e);
      }
      setIsLoaded(true);
      return;
    }

    // Drop any cache left over from local-only mode so it never mixes with (or outlives) account data.
    try {
      localStorage.removeItem(STORAGE_KEYS.TRANSACTIONS);
      localStorage.removeItem(STORAGE_KEYS.SAVINGS);
      localStorage.removeItem(STORAGE_KEYS.SAVINGS_ACCOUNTS);
      localStorage.removeItem(STORAGE_KEYS.SAVINGS_BALANCES);
    } catch {
      // Storage unavailable; nothing to clear.
    }

    const supabase = createClient();
    Promise.all([
      supabase.from("categories").select("*").order("name"),
      supabase.from("tags").select("*").order("name"),
      fetchAllTransactions(supabase),
      supabase.from("savings_accounts").select("id, name, kind, position, archived").order("position"),
      supabase
        .from("user_profiles")
        .select("*")
        .maybeSingle(),
      supabase.from("recurring_sentinel").select("*"),
      supabase.from("goals").select("*").order("priority"),
      supabase.from("goal_contributions").select("*").order("date"),
      supabase.from("budgets").select("id, category_id, monthly_limit"),
      supabase.from("savings_balances").select("id, account_id, month, balance, rate").order("month"),
    ]).then(async ([cats, tgs, txs, sva, prof, bls, gls, gcs, bgs, svb]) => {
      const error = cats.error || tgs.error || txs.error;
      if (error) {
        console.error("Supabase load error:", error);
        setLoadError("Couldn't load your data. Check your connection and refresh.");
        setIsLoaded(true);
        return;
      }

      setCategories(cats.data || []);
      setTags(tgs.data || []);
      setTransactions(
        (txs.data || []).map((d: any) => ({
          id: d.id,
          date: d.date,
          category_id: d.category_id,
          category_name: d.categories?.name,
          tag_id: d.tag_id,
          tag_name: d.tags?.name,
          amount: Number(d.amount),
          description: d.description,
          is_one_off: Boolean(d.is_one_off),
        }))
      );
      if (sva.error && MISSING_TABLE.includes(sva.error.code)) {
        // Before the savings-accounts migration: show the old fixed columns as accounts.
        setSavingsNeedsMigration(true);
        const legacy = await supabase.from("monthly_savings").select("*").order("month");
        const converted = fromLegacySavings(
          (legacy.data || []).map((r: any) => ({
            month: r.month,
            main_checking: Number(r.main_checking || 0),
            gx_bank: Number(r.gx_bank || 0),
            gx_rate: Number(r.gx_rate || 0),
            ryt_bank: Number(r.ryt_bank || 0),
            ryt_rate: Number(r.ryt_rate || 0),
            epf_locked: Number(r.epf_locked || 0),
          })) as LegacyMonthlySavings[]
        );
        setSavingsAccounts(converted.accounts);
        setSavingsBalances(converted.balances);
      } else {
        if (sva.error || svb.error) console.error("Supabase savings load error:", sva.error || svb.error);
        setSavingsAccounts((sva.data || []).map((a: any) => ({ ...a, archived: Boolean(a.archived) })));
        setSavingsBalances(
          (svb.data || []).map((b: any) => ({ ...b, balance: Number(b.balance), rate: Number(b.rate) }))
        );
      }
      // Bills are optional: before the monthly-bills migration some columns are missing, but rows still load.
      if (bls.error) console.error("Supabase bills load error:", bls.error);
      // Goals are optional: before the goals migration the tables don't exist; everything else still loads.
      if (gls.error || gcs.error) console.error("Supabase goals load error:", gls.error || gcs.error);
      setGoals(
        (gls.data || []).map((g: any) => ({
          ...g,
          target_amount: Number(g.target_amount),
          trade_in_value: Number(g.trade_in_value || 0),
          discounts: Array.isArray(g.discounts) ? g.discounts : [],
        }))
      );
      setGoalContributions((gcs.data || []).map((c: any) => ({ ...c, amount: Number(c.amount) })));
      // Budgets are optional too (table added by the budgets migration).
      if (bgs.error) console.error("Supabase budgets load error:", bgs.error);
      setBudgets((bgs.data || []).map((b: any) => ({ ...b, monthly_limit: Number(b.monthly_limit) })));
      setBills(
        (bls.data || []).map((b: any) => ({
          id: b.id,
          tag_id: b.tag_id,
          is_active: b.is_active !== false,
          expected_amount: b.expected_amount == null ? null : Number(b.expected_amount),
          due_day: b.due_day ?? null,
          auto_log: Boolean(b.auto_log),
          installment_count: b.installment_count ?? null,
          start_month: b.start_month ?? null,
          goal_id: b.goal_id ?? null,
          cash_price: b.cash_price == null ? null : Number(b.cash_price),
          down_payment: b.down_payment == null ? null : Number(b.down_payment),
        }))
      );
      if (prof.data) {
        setProfile({
          default_gross_salary: Number(prof.data.default_gross_salary ?? DEFAULT_PROFILE.default_gross_salary),
          epf_rate: Number(prof.data.epf_rate ?? DEFAULT_PROFILE.epf_rate),
          socso_rate: Number(prof.data.socso_rate ?? DEFAULT_PROFILE.socso_rate),
          eis_rate: Number(prof.data.eis_rate ?? DEFAULT_PROFILE.eis_rate),
        });
        if (prof.data.emergency_months) setEmergencyMonthsState(Number(prof.data.emergency_months));
      }
      setIsSyncedWithSupabase(true);
      setIsLoaded(true);
    });
  }, []);

  // Local-only mode has no scheduler: add due auto bills once when the app opens.
  // (With Supabase, the daily pg_cron job does this; see scripts/migrations/2026-09-28_auto_bills.sql.)
  const autoLogged = useRef(false);
  useEffect(() => {
    if (isCloud || !isLoaded || autoLogged.current) return;
    autoLogged.current = true;
    const due = dueAutoBills(bills, tags, transactions);
    if (due.length === 0) return;
    setTransactions((prev) => [
      ...due.map((tx, i) => ({
        ...tx,
        id: `tx-auto-${Date.now()}-${i}`,
        category_name: categories.find((c) => c.id === tx.category_id)?.name,
        tag_name: tags.find((t) => t.id === tx.tag_id)?.name,
      })),
      ...prev,
    ]);
    showToast({
      tone: "default",
      message: `Auto-added ${due.length} monthly bill${due.length === 1 ? "" : "s"}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // Offline cache for local-only mode.
  useEffect(() => {
    if (mode !== "local" || !isLoaded) return; // guests never persist
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
      localStorage.setItem(STORAGE_KEYS.SAVINGS_ACCOUNTS, JSON.stringify(savingsAccounts));
      localStorage.setItem(STORAGE_KEYS.SAVINGS_BALANCES, JSON.stringify(savingsBalances));
      localStorage.removeItem(STORAGE_KEYS.SAVINGS);
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
      localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
      localStorage.setItem(STORAGE_KEYS.TAGS, JSON.stringify(tags));
      localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(bills));
      localStorage.setItem(STORAGE_KEYS.GOALS, JSON.stringify(goals));
      localStorage.setItem(STORAGE_KEYS.BUDGETS, JSON.stringify(budgets));
      localStorage.setItem(STORAGE_KEYS.GOAL_CONTRIBUTIONS, JSON.stringify(goalContributions));
    } catch (e) {
      console.error("Failed to save to localStorage", e);
    }
  }, [
    transactions,
    savingsAccounts,
    savingsBalances,
    profile,
    categories,
    tags,
    bills,
    goals,
    goalContributions,
    budgets,
    isLoaded,
    mode,
  ]);

  const addTransaction = async (txInput: NewTransaction) => {
    const cat = categories.find((c) => c.id === txInput.category_id);
    const tag = tags.find((t) => t.id === txInput.tag_id);

    // Optimistic temporary ID
    const tempId = `tx-${Date.now()}`;
    const newTx: Transaction = {
      id: tempId,
      date: txInput.date,
      category_id: txInput.category_id,
      category_name: cat?.name || "Unknown",
      tag_id: txInput.tag_id,
      tag_name: tag?.name || "Unknown",
      amount: txInput.amount,
      description: txInput.description,
      is_one_off: txInput.is_one_off,
    };

    // 1. Optimistic UI update, and show the month the expense landed in
    setTransactions((prev) => [newTx, ...prev]);
    setSelectedMonth(txInput.date.slice(0, 7));

    // 2. Persist to Supabase in the background (user_id defaults to auth.uid() in the database)
    if (isCloud) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("transactions")
        .insert({
          date: txInput.date,
          category_id: txInput.category_id,
          tag_id: txInput.tag_id,
          amount: txInput.amount,
          description: txInput.description,
          is_one_off: txInput.is_one_off,
        })
        .select()
        .single();

      if (error) {
        console.error("Supabase insert error:", error);
        // Roll back the optimistic row so the screen never shows data the database doesn't have.
        setTransactions((prev) => prev.filter((t) => t.id !== tempId));
        showToast({
          tone: "error",
          message: `Couldn't save ${newTx.tag_name} (RM ${txInput.amount.toFixed(2)})`,
          action: { label: "Retry", onClick: () => addTransaction(txInput) },
        });
      } else if (data) {
        // Upgrade temporary client ID to permanent Supabase UUID
        setTransactions((prev) =>
          prev.map((t) => (t.id === tempId ? { ...t, id: data.id } : t))
        );
      }
    }
  };

  const updateTransaction = async (id: string, txInput: NewTransaction) => {
    const previous = transactions.find((t) => t.id === id);
    if (!previous) return;

    // A just-added row keeps its temporary id until the insert returns; updating it now would miss.
    if (isCloud && id.startsWith("tx-")) {
      showToast({ tone: "error", message: "Still saving that entry. Try again in a moment." });
      return;
    }

    const cat = categories.find((c) => c.id === txInput.category_id);
    const tag = tags.find((t) => t.id === txInput.tag_id);
    const updated: Transaction = {
      ...previous,
      ...txInput,
      description: txInput.description,
      category_name: cat?.name || previous.category_name,
      tag_name: tag?.name || previous.tag_name,
    };

    setTransactions((prev) => prev.map((t) => (t.id === id ? updated : t)));
    setSelectedMonth(txInput.date.slice(0, 7));

    if (isCloud) {
      const { error } = await createClient()
        .from("transactions")
        .update({
          date: txInput.date,
          category_id: txInput.category_id,
          tag_id: txInput.tag_id,
          amount: txInput.amount,
          description: txInput.description ?? null,
          is_one_off: txInput.is_one_off,
        })
        .eq("id", id);

      if (error) {
        console.error("Supabase update error:", error);
        setTransactions((prev) => prev.map((t) => (t.id === id ? previous : t)));
        showToast({
          tone: "error",
          message: `Couldn't save changes to ${updated.tag_name}`,
          action: { label: "Retry", onClick: () => updateTransaction(id, txInput) },
        });
      }
    }
  };

  // Deletes are delayed by UNDO_MS so the Undo toast can cancel them before they reach the database.
  const pendingDelete = useRef<{ tx: Transaction; timer: ReturnType<typeof setTimeout> } | null>(null);

  const commitDelete = useCallback(
    async (tx: Transaction) => {
      // Temp ids ("tx-...") were never saved remotely; local-only mode has nothing to delete remotely.
      if (!isCloud || tx.id.startsWith("tx-")) return;
      const { error } = await createClient().from("transactions").delete().eq("id", tx.id);
      if (error) {
        console.error("Supabase delete error:", error);
        setTransactions((prev) => [tx, ...prev]);
        showToast({ tone: "error", message: `Couldn't delete ${tx.tag_name}. It has been restored.` });
      }
    },
    [showToast, isCloud]
  );

  const flushPendingDelete = useCallback(() => {
    const pending = pendingDelete.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingDelete.current = null;
    commitDelete(pending.tx);
  }, [commitDelete]);

  // Don't lose a pending delete when the app is backgrounded or closed.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flushPendingDelete();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flushPendingDelete]);

  const deleteTransaction = async (id: string) => {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    flushPendingDelete();

    setTransactions((prev) => prev.filter((t) => t.id !== id));
    const timer = setTimeout(() => {
      pendingDelete.current = null;
      commitDelete(tx);
    }, UNDO_MS);
    pendingDelete.current = { tx, timer };

    showToast({
      tone: "default",
      message: `Deleted ${tx.tag_name} · RM ${tx.amount.toFixed(2)}`,
      action: {
        label: "Undo",
        onClick: () => {
          if (pendingDelete.current?.tx.id !== id) return;
          clearTimeout(pendingDelete.current.timer);
          pendingDelete.current = null;
          setTransactions((prev) => [tx, ...prev]);
          dismissToast();
        },
      },
    });
  };

  // ---- Savings accounts & balances ----
  const savingsError = (error: { code?: string }, fallback: string) =>
    MISSING_TABLE.includes(error.code || "")
      ? "Run scripts/migrations/2026-09-30_savings_accounts.sql in Supabase first."
      : error.code === "23505"
        ? "An account with that name already exists."
        : fallback;
  const needsSavingsMigration = () => {
    if (!isCloud || !savingsNeedsMigration) return false;
    showToast({ tone: "error", message: "Run scripts/migrations/2026-09-30_savings_accounts.sql in Supabase first." });
    return true;
  };

  const saveBalances = async (
    month: string,
    lines: Pick<SavingsBalance, "account_id" | "balance" | "rate">[]
  ): Promise<boolean> => {
    if (needsSavingsMigration()) return false;
    const monthDate = `${month.slice(0, 7)}-01`;
    const rows = lines.map((l) => ({ ...l, month: monthDate }));
    if (isCloud) {
      const { error } = await createClient()
        .from("savings_balances")
        .upsert(rows, { onConflict: "account_id,month" });
      if (error) {
        console.error("Supabase savings upsert error:", error);
        showToast({
          tone: "error",
          message: savingsError(error, "Couldn't save balances"),
          action: { label: "Retry", onClick: () => saveBalances(month, lines) },
        });
        return false;
      }
    }
    setSavingsBalances((prev) => [
      ...prev.filter((b) => !(b.month.startsWith(month.slice(0, 7)) && rows.some((r) => r.account_id === b.account_id))),
      ...rows.map((r) => ({ id: `bal-${r.account_id}-${month.slice(0, 7)}`, ...r })),
    ]);
    return true;
  };

  const addSavingsAccount = async (name: string, kind: SavingsAccount["kind"]) => {
    if (needsSavingsMigration()) return null;
    const trimmed = name.trim();
    const position = savingsAccounts.reduce((max, a) => Math.max(max, a.position + 1), 0);
    let created: SavingsAccount = { id: `acct-${Date.now()}`, name: trimmed, kind, position, archived: false };
    if (isCloud) {
      const { data, error } = await createClient()
        .from("savings_accounts")
        .insert({ name: trimmed, kind, position })
        .select("id, name, kind, position, archived")
        .single();
      if (error || !data) {
        console.error("Supabase savings account insert error:", error);
        showToast({ tone: "error", message: savingsError(error || {}, `Couldn't add ${trimmed}.`) });
        return null;
      }
      created = data as SavingsAccount;
    } else if (savingsAccounts.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      showToast({ tone: "error", message: "An account with that name already exists." });
      return null;
    }
    setSavingsAccounts((prev) => [...prev, created]);
    return created;
  };

  const updateSavingsAccount = async (
    id: string,
    changes: Partial<Pick<SavingsAccount, "name" | "kind" | "archived">>
  ) => {
    if (needsSavingsMigration()) return false;
    const next = changes.name !== undefined ? { ...changes, name: changes.name.trim() } : changes;
    if (isCloud) {
      const { error } = await createClient().from("savings_accounts").update(next).eq("id", id);
      if (error) {
        console.error("Supabase savings account update error:", error);
        showToast({ tone: "error", message: savingsError(error, "Couldn't save the account.") });
        return false;
      }
    } else if (
      next.name &&
      savingsAccounts.some((a) => a.id !== id && a.name.toLowerCase() === next.name?.toLowerCase())
    ) {
      showToast({ tone: "error", message: "An account with that name already exists." });
      return false;
    }
    setSavingsAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...next } : a)));
    return true;
  };

  const deleteSavingsAccount = async (id: string) => {
    if (needsSavingsMigration()) return false;
    // Deleting would take its past balances (and net worth history) with it.
    if (savingsBalances.some((b) => b.account_id === id)) {
      showToast({ tone: "error", message: "This account has balances. Archive it instead to keep your history." });
      return false;
    }
    if (isCloud) {
      const { error } = await createClient().from("savings_accounts").delete().eq("id", id);
      if (error) {
        console.error("Supabase savings account delete error:", error);
        showToast({ tone: "error", message: savingsError(error, "Couldn't delete the account.") });
        return false;
      }
    }
    setSavingsAccounts((prev) => prev.filter((a) => a.id !== id));
    return true;
  };

  const updateProfile = async (next: UserSalaryProfile) => {
    const previous = profile;
    setProfile(next);
    if (!isCloud) return;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from("user_profiles")
      .upsert(
        {
          id: user.id,
          email: user.email,
          default_gross_salary: next.default_gross_salary,
          epf_rate: next.epf_rate,
          socso_rate: next.socso_rate,
          eis_rate: next.eis_rate,
        },
        { onConflict: "id" }
      );
    if (error) {
      console.error("Supabase profile upsert error:", error);
      setProfile(previous);
      showToast({
        tone: "error",
        message: "Couldn't save salary settings",
        action: { label: "Retry", onClick: () => updateProfile(next) },
      });
    }
  };

  // ---- Monthly bills (recurring_sentinel) ----
  const billError = (error: { code?: string }) =>
    error.code === "42703" || error.code === "PGRST204"
      ? "Run the latest migrations in scripts/migrations/ in Supabase first (instalments need 2026-10-01_instalments.sql)."
      : error.code === "23514"
        ? "Auto-add needs an expected amount and a due day."
      : error.code === "23505"
        ? "That tag is already a monthly bill."
        : "Couldn't save the bill.";

  const addBill = async (tagId: string, changes: BillChanges = {}): Promise<RecurringBill | null> => {
    if (bills.some((b) => b.tag_id === tagId)) {
      showToast({ tone: "error", message: "That tag is already a monthly bill." });
      return null;
    }
    let created: RecurringBill = { id: `bill-${Date.now()}`, tag_id: tagId, is_active: true, ...changes };
    if (isCloud) {
      const { data, error } = await createClient()
        .from("recurring_sentinel")
        .insert({ tag_id: tagId, is_active: true, ...changes })
        .select()
        .single();
      if (error || !data) {
        console.error("Supabase bill insert error:", error);
        showToast({ tone: "error", message: billError(error || {}) });
        return null;
      }
      created = {
        ...data,
        expected_amount: data.expected_amount == null ? null : Number(data.expected_amount),
        cash_price: data.cash_price == null ? null : Number(data.cash_price),
        down_payment: data.down_payment == null ? null : Number(data.down_payment),
      };
    }
    setBills((prev) => [...prev, created]);
    return created;
  };

  const updateBill = async (id: string, changes: BillChanges) => {
    if (isCloud) {
      const { error } = await createClient().from("recurring_sentinel").update(changes).eq("id", id);
      if (error) {
        console.error("Supabase bill update error:", error);
        showToast({ tone: "error", message: billError(error) });
        return false;
      }
    }
    setBills((prev) => prev.map((b) => (b.id === id ? { ...b, ...changes } : b)));
    return true;
  };

  const removeBill = async (id: string) => {
    if (isCloud) {
      const { error } = await createClient().from("recurring_sentinel").delete().eq("id", id);
      if (error) {
        console.error("Supabase bill delete error:", error);
        showToast({ tone: "error", message: billError(error) });
        return false;
      }
    }
    setBills((prev) => prev.filter((b) => b.id !== id));
    return true;
  };

  // ---- Budgets ----
  const setBudget = async (categoryId: string, limit: number | null) => {
    if (isCloud) {
      const supabase = createClient();
      const { error } =
        limit === null
          ? await supabase.from("budgets").delete().eq("category_id", categoryId)
          : await supabase
              .from("budgets")
              .upsert({ category_id: categoryId, monthly_limit: limit }, { onConflict: "user_id,category_id" });
      if (error) {
        console.error("Supabase budget error:", error);
        showToast({
          tone: "error",
          message:
            error.code === "42P01" || error.code === "PGRST205"
              ? "Run scripts/migrations/2026-09-29_budgets.sql in Supabase first."
              : "Couldn't save the budget.",
        });
        return false;
      }
    }
    setBudgets((prev) => {
      const rest = prev.filter((b) => b.category_id !== categoryId);
      return limit === null ? rest : [...rest, { id: `budget-${categoryId}`, category_id: categoryId, monthly_limit: limit }];
    });
    return true;
  };

  // ---- Goals ----
  const goalError = (error: { code?: string }, what: string) =>
    error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST204"
      ? "Run scripts/migrations/2026-09-29_goals.sql in Supabase first."
      : `Couldn't save ${what}.`;
  const toGoal = (g: any): Goal => ({
    ...g,
    target_amount: Number(g.target_amount),
    trade_in_value: Number(g.trade_in_value || 0),
    discounts: Array.isArray(g.discounts) ? g.discounts : [],
  });

  const addGoal = async (input: GoalInput) => {
    const priority = goals.filter((g) => g.status === "active").reduce((max, g) => Math.max(max, g.priority + 1), 0);
    let created: Goal = { id: `goal-${Date.now()}`, ...input, priority, status: "active" };
    if (isCloud) {
      const { data, error } = await createClient()
        .from("goals")
        .insert({ ...input, priority, status: "active" })
        .select()
        .single();
      if (error || !data) {
        console.error("Supabase goal insert error:", error);
        showToast({ tone: "error", message: goalError(error || {}, "the goal") });
        return null;
      }
      created = toGoal(data);
    }
    setGoals((prev) => [...prev, created]);
    return created;
  };

  const updateGoal: BudgetContextType["updateGoal"] = async (id, changes) => {
    if (isCloud) {
      const { error } = await createClient().from("goals").update(changes).eq("id", id);
      if (error) {
        console.error("Supabase goal update error:", error);
        showToast({ tone: "error", message: goalError(error, "the goal") });
        return false;
      }
    }
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...changes } : g)));
    return true;
  };

  const deleteGoal = async (id: string) => {
    if (isCloud) {
      // Contributions cascade with the goal.
      const { error } = await createClient().from("goals").delete().eq("id", id);
      if (error) {
        console.error("Supabase goal delete error:", error);
        showToast({ tone: "error", message: goalError(error, "the goal") });
        return false;
      }
    }
    setGoals((prev) => prev.filter((g) => g.id !== id));
    setGoalContributions((prev) => prev.filter((c) => c.goal_id !== id));
    return true;
  };

  // Move a goal up/down: renumber the active list 0..n-1 with the swap applied, saving only goals that moved.
  const moveGoal = async (id: string, direction: -1 | 1) => {
    const ordered = goals.filter((g) => g.status === "active").sort((a, b) => a.priority - b.priority);
    const i = ordered.findIndex((g) => g.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    for (const [position, goal] of ordered.entries()) {
      if (goal.priority !== position && !(await updateGoal(goal.id, { priority: position }))) return;
    }
  };

  const addContribution = async (goalId: string, amount: number, note?: string) => {
    const date = format(new Date(), "yyyy-MM-dd");
    let created: GoalContribution = { id: `gc-${Date.now()}`, goal_id: goalId, amount, date, note: note || null };
    if (isCloud) {
      const { data, error } = await createClient()
        .from("goal_contributions")
        .insert({ goal_id: goalId, amount, date, note: note || null })
        .select()
        .single();
      if (error || !data) {
        console.error("Supabase contribution insert error:", error);
        showToast({ tone: "error", message: goalError(error || {}, "the amount") });
        return false;
      }
      created = { ...data, amount: Number(data.amount) };
    }
    setGoalContributions((prev) => [...prev, created]);
    return true;
  };

  const deleteContribution = async (id: string) => {
    if (isCloud) {
      const { error } = await createClient().from("goal_contributions").delete().eq("id", id);
      if (error) {
        console.error("Supabase contribution delete error:", error);
        showToast({ tone: "error", message: goalError(error, "the change") });
        return false;
      }
    }
    setGoalContributions((prev) => prev.filter((c) => c.id !== id));
    return true;
  };

  // Log what was actually paid as a one-off expense, then mark the goal bought.
  const markGoalBought = async (goalId: string, expense: NewTransaction) => {
    const ok = await updateGoal(goalId, { status: "bought", bought_at: expense.date });
    if (!ok) return false;
    await addTransaction({ ...expense, is_one_off: true });
    return true;
  };

  // The Instalments category (renamable, not deletable), created on first use. Before
  // 2026-10-08_instalments_category.sql the mark can't be saved, so it's created without one.
  const ensureInstalmentsCategory = async (): Promise<Category | null> => {
    const existing = instalmentsCategory(categories);
    if (existing) return existing;
    const row = { name: "Instalments", icon: "calendar-clock", role: "instalments" as const };
    let created: Category = { id: `cat-${Date.now()}`, ...row };
    if (isCloud) {
      const supabase = createClient();
      let res = await supabase.from("categories").insert(row).select().single();
      if (res.error?.code === "23514") res = await supabase.from("categories").insert({ name: row.name, icon: row.icon }).select().single();
      if (res.error || !res.data) {
        console.error("Supabase category insert error:", res.error);
        showToast({ tone: "error", message: describeDbError(res.error || {}, "The Instalments category") });
        return null;
      }
      created = res.data;
    }
    setCategories((prev) => [...prev, created].sort(byName));
    return created;
  };

  const markGoalBoughtOnInstalments = async (goal: Goal, plan: InstalmentPurchase) => {
    // The plan gets its own tag ("iPhone 17 Pro instalment") in the Instalments category, so its
    // payments are easy to find and don't count as new spending in the category of the purchase.
    const category = await ensureInstalmentsCategory();
    if (!category) return false;
    const base = `${goal.name} instalment`.slice(0, 40);
    const taken = (n: string) =>
      tags.some((t) => t.category_id === category.id && t.name.toLowerCase() === n.toLowerCase());
    let name = base;
    for (let i = 2; taken(name); i++) name = `${base.slice(0, 36)} ${i}`;
    const tag = await addTag(category.id, name);
    if (!tag) return false;

    const bill = await addBill(tag.id, {
      expected_amount: plan.monthly,
      due_day: plan.due_day,
      auto_log: plan.auto_log,
      installment_count: plan.installment_count,
      start_month: plan.start_month,
      goal_id: goal.id,
      cash_price: plan.cash_price,
      down_payment: plan.downPayment?.amount ?? 0,
    });
    if (!bill) return false;

    const today = format(new Date(), "yyyy-MM-dd");
    if (!(await updateGoal(goal.id, { status: "bought", bought_at: plan.downPayment?.date ?? today }))) return false;
    // Money set aside for the goal stops being earmarked once it's bought; the down payment
    // (prefilled with that amount) is what actually leaves your account today.
    if (plan.downPayment && plan.downPayment.amount > 0) await addTransaction({ ...plan.downPayment, is_one_off: true });
    return true;
  };

  // ---- Categories & tags ----
  // Creation waits for the database (the new id is needed right away); edits are applied after success.
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  const addCategory = async (rawName: string, icon: string) => {
    const name = rawName.trim();
    if (!name) return null;
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      showToast({ tone: "error", message: `Category "${name}" already exists.` });
      return null;
    }
    let created: Category = { id: `cat-${Date.now()}`, name, icon };
    if (isCloud) {
      const { data, error } = await createClient().from("categories").insert({ name, icon }).select().single();
      if (error || !data) {
        console.error("Supabase category insert error:", error);
        showToast({ tone: "error", message: describeDbError(error || {}, `Category "${name}"`) });
        return null;
      }
      created = data;
    }
    setCategories((prev) => [...prev, created].sort(byName));
    return created;
  };

  const renameCategory = async (id: string, rawName: string, icon?: string) => {
    const name = rawName.trim();
    const current = categories.find((c) => c.id === id);
    if (!name || !current) return false;
    if (categories.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
      showToast({ tone: "error", message: `Category "${name}" already exists.` });
      return false;
    }
    const changes = { name, icon: icon ?? current.icon ?? null };
    if (isCloud) {
      const { error } = await createClient().from("categories").update(changes).eq("id", id);
      if (error) {
        console.error("Supabase category update error:", error);
        showToast({ tone: "error", message: describeDbError(error, `Category "${name}"`) });
        return false;
      }
    }
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)).sort(byName));
    setTransactions((prev) => prev.map((t) => (t.category_id === id ? { ...t, category_name: name } : t)));
    return true;
  };

  const deleteCategory = async (id: string) => {
    const current = categories.find((c) => c.id === id);
    if (!current) return false;
    if (current.role === "instalments") {
      showToast({ tone: "error", message: `${current.name} holds your instalment plans. Rename it instead.` });
      return false;
    }
    const used = transactions.filter((t) => t.category_id === id).length;
    if (used > 0) {
      showToast({
        tone: "error",
        message: `${current.name} is used by ${used} expense${used === 1 ? "" : "s"}. Rename it instead.`,
      });
      return false;
    }
    const billTag = tags.find((t) => t.category_id === id && bills.some((b) => b.tag_id === t.id));
    if (billTag) {
      showToast({ tone: "error", message: `${billTag.name} is a monthly bill. Remove it from Monthly bills first.` });
      return false;
    }
    if (isCloud) {
      // Tags cascade with the category.
      const { error } = await createClient().from("categories").delete().eq("id", id);
      if (error) {
        console.error("Supabase category delete error:", error);
        showToast({ tone: "error", message: describeDbError(error, current.name) });
        return false;
      }
    }
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setTags((prev) => prev.filter((t) => t.category_id !== id));
    setBudgets((prev) => prev.filter((b) => b.category_id !== id));
    showToast({ tone: "default", message: `Deleted category ${current.name}` });
    return true;
  };

  const addTag = async (categoryId: string, rawName: string) => {
    const name = rawName.trim();
    if (!name || !categoryId) return null;
    if (tags.some((t) => t.category_id === categoryId && t.name.toLowerCase() === name.toLowerCase())) {
      showToast({ tone: "error", message: `Tag "${name}" already exists in this category.` });
      return null;
    }
    let created: Tag = { id: `tag-${Date.now()}`, category_id: categoryId, name };
    if (isCloud) {
      const { data, error } = await createClient()
        .from("tags")
        .insert({ category_id: categoryId, name })
        .select()
        .single();
      if (error || !data) {
        console.error("Supabase tag insert error:", error);
        showToast({ tone: "error", message: describeDbError(error || {}, `Tag "${name}"`) });
        return null;
      }
      created = data;
    }
    setTags((prev) => [...prev, created].sort(byName));
    return created;
  };

  const renameTag = async (id: string, rawName: string) => {
    const name = rawName.trim();
    const current = tags.find((t) => t.id === id);
    if (!name || !current) return false;
    if (tags.some((t) => t.id !== id && t.category_id === current.category_id && t.name.toLowerCase() === name.toLowerCase())) {
      showToast({ tone: "error", message: `Tag "${name}" already exists in this category.` });
      return false;
    }
    if (isCloud) {
      const { error } = await createClient().from("tags").update({ name }).eq("id", id);
      if (error) {
        console.error("Supabase tag update error:", error);
        showToast({ tone: "error", message: describeDbError(error, `Tag "${name}"`) });
        return false;
      }
    }
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, name } : t)).sort(byName));
    setTransactions((prev) => prev.map((t) => (t.tag_id === id ? { ...t, tag_name: name } : t)));
    return true;
  };

  const deleteTag = async (id: string) => {
    const current = tags.find((t) => t.id === id);
    if (!current) return false;
    const used = transactions.filter((t) => t.tag_id === id).length;
    if (used > 0) {
      showToast({
        tone: "error",
        message: `${current.name} is used by ${used} expense${used === 1 ? "" : "s"}. Rename it instead.`,
      });
      return false;
    }
    if (bills.some((b) => b.tag_id === id)) {
      showToast({ tone: "error", message: `${current.name} is a monthly bill. Remove it from Monthly bills first.` });
      return false;
    }
    if (isCloud) {
      const { error } = await createClient().from("tags").delete().eq("id", id);
      if (error) {
        console.error("Supabase tag delete error:", error);
        showToast({ tone: "error", message: describeDbError(error, current.name) });
        return false;
      }
    }
    setTags((prev) => prev.filter((t) => t.id !== id));
    showToast({ tone: "default", message: `Deleted tag ${current.name}` });
    return true;
  };

  // Saved on its own (not with the salary) so salary edits never depend on the goal's migration.
  const setEmergencyMonths = async (months: number) => {
    const previous = emergencyMonths;
    setEmergencyMonthsState(months);
    if (!isCloud) {
      if (mode === "guest") return;
      try {
        localStorage.setItem(STORAGE_KEYS.EMERGENCY_MONTHS, String(months));
      } catch {
        // Storage unavailable; the goal applies for this session only.
      }
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("user_profiles").update({ emergency_months: months }).eq("id", user.id);
    if (error) {
      console.error("Supabase emergency goal update error:", error);
      setEmergencyMonthsState(previous);
      showToast({
        tone: "error",
        message:
          error.code === "42703" || error.code === "PGRST204"
            ? "Run scripts/migrations/2026-09-28_emergency_goal.sql in Supabase first."
            : "Couldn't save the emergency fund goal",
      });
    }
  };

  const signOut = async () => {
    if (mode === "guest") return exitGuest();
    if (!isCloud) return;
    // Signed-out devices shouldn't keep getting this account's reminders.
    await disablePush().catch(() => {});
    await createClient().auth.signOut();
    window.location.replace("/login");
  };

  return (
    <BudgetContext.Provider
      value={{
        mode,
        categories,
        tags,
        transactions,
        savingsAccounts,
        savingsBalances,
        selectedMonth,
        setSelectedMonth,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        saveBalances,
        addSavingsAccount,
        updateSavingsAccount,
        deleteSavingsAccount,
        profile,
        updateProfile,
        emergencyMonths,
        setEmergencyMonths,
        toast,
        showToast,
        dismissToast,
        bills,
        budgets,
        setBudget,
        goals,
        goalContributions,
        addGoal,
        updateGoal,
        deleteGoal,
        moveGoal,
        addContribution,
        deleteContribution,
        markGoalBought,
        markGoalBoughtOnInstalments,
        addBill,
        updateBill,
        removeBill,
        addCategory,
        renameCategory,
        deleteCategory,
        addTag,
        renameTag,
        deleteTag,
        signOut,
        isSyncedWithSupabase,
        isLoaded,
        loadError,
      }}
    >
      {children}
    </BudgetContext.Provider>
  );
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) {
    throw new Error("useBudget must be used within a BudgetProvider");
  }
  return ctx;
}
