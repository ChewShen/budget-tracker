"use client";

import { useEffect, useState } from "react";
import { addMonths, format } from "date-fns";
import { X } from "lucide-react";
import { categoryLabel } from "@/lib/categories";
import { isExpired, netTarget } from "@/lib/goals";
import { planTerms } from "@/lib/instalments";
import { cn, formatCurrency, ordinal } from "@/lib/utils";
import type { InstalmentPurchase, NewTransaction } from "@/lib/budget-context";
import type { Category, Goal, Tag } from "@/lib/types";
import { useScrollLock } from "@/lib/use-scroll-lock";

interface BoughtSheetProps {
  goal: Goal | null; // open when set
  setAside: number; // money set aside for this goal (offered as the down payment)
  categories: Category[];
  tags: Tag[];
  onClose: () => void;
  onConfirm: (goal: Goal, expense: NewTransaction) => Promise<boolean>;
  onConfirmInstalments: (goal: Goal, plan: InstalmentPurchase) => Promise<boolean>;
}

type Mode = "full" | "instalments";

const MONTH_CHOICES = [3, 6, 12, 24, 36];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const isMoney = (text: string) => /^\d*\.?\d{0,2}$/.test(text);
const toNumber = (text: string) => {
  const n = parseFloat(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

// Default the expense to Shopping (or the first category) and its first tag.
function defaultCategory(categories: Category[]) {
  return categories.find((c) => c.name.toLowerCase() === "shopping") || categories[0];
}

export function BoughtSheet({
  goal,
  setAside,
  categories,
  tags,
  onClose,
  onConfirm,
  onConfirmInstalments,
}: BoughtSheetProps) {
  const [mode, setMode] = useState<Mode>("full");
  const [amount, setAmount] = useState(""); // full: amount paid · instalments: price
  const [categoryId, setCategoryId] = useState("");
  const [tagId, setTagId] = useState("");
  const [date, setDate] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  // Instalments
  const [down, setDown] = useState("");
  const [months, setMonths] = useState("12");
  const [feePct, setFeePct] = useState("0");
  const [startMonth, setStartMonth] = useState(""); // YYYY-MM
  const [dueDay, setDueDay] = useState("1");
  const [autoLog, setAutoLog] = useState(true);

  useEffect(() => {
    if (!goal) return;
    const now = new Date();
    setMode("full");
    setAmount(String(netTarget(goal)));
    const cat = defaultCategory(categories);
    setCategoryId(cat?.id ?? "");
    setTagId(tags.find((t) => t.category_id === cat?.id)?.id ?? "");
    setDate(format(now, "yyyy-MM-dd"));
    // Money already set aside is offered as the down payment; clear it to keep it as free money.
    setDown(setAside > 0 ? String(Math.min(setAside, netTarget(goal))) : "");
    setMonths("12");
    setFeePct("0");
    setStartMonth(format(addMonths(now, 1), "yyyy-MM"));
    setDueDay(String(now.getDate()));
    setAutoLog(true);
    // Reset only when a goal is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal?.id]);

  useEffect(() => {
    if (!goal) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goal, onClose]);

  useScrollLock(Boolean(goal));

  if (!goal) return null;

  const price = toNumber(amount);
  const categoryTags = tags.filter((t) => t.category_id === categoryId);
  const hasOffsets = goal.trade_in_value > 0 || goal.discounts.some((d) => !isExpired(d));

  const downPayment = Math.min(toNumber(down), price);
  const monthCount = Math.max(0, Math.min(120, Math.floor(Number(months) || 0)));
  const terms = planTerms({ price, downPayment, months: monthCount, feeRate: toNumber(feePct) / 100 });
  const lastMonth = startMonth && monthCount ? format(addMonths(new Date(`${startMonth}-01T00:00:00`), monthCount - 1), "MMM yyyy") : "";
  // What the monthly amounts add up to (can differ from the price by a few sen of rounding; at 0%
  // that's still "same as paying upfront"). Matches what Goals shows as left to pay.
  const payments = Math.round(terms.monthly * monthCount * 100) / 100;
  const planValid = price > 0 && monthCount > 0 && terms.monthly > 0 && Boolean(startMonth);
  // What you paid now (in full, or the down payment) is logged under the chosen category and tag;
  // the plan's monthly payments go under Instalments.
  const needsTag = mode === "full" || downPayment > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsTag && !tagId) return;
    setIsBusy(true);
    let ok = false;
    if (mode === "full") {
      if (!(price > 0)) return setIsBusy(false);
      ok = await onConfirm(goal, {
        amount: price,
        date,
        category_id: categoryId,
        tag_id: tagId,
        description: goal.name,
        is_one_off: true,
      });
    } else {
      if (!planValid) return setIsBusy(false);
      ok = await onConfirmInstalments(goal, {
        monthly: terms.monthly,
        installment_count: monthCount,
        start_month: `${startMonth}-01`,
        due_day: Number(dueDay),
        auto_log: autoLog,
        cash_price: price,
        downPayment:
          downPayment > 0
            ? {
                amount: downPayment,
                date,
                category_id: categoryId,
                tag_id: tagId,
                description: `${goal.name} (down payment)`,
                is_one_off: true,
              }
            : null,
      });
    }
    setIsBusy(false);
    if (ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Bought ${goal.name}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-sheet w-full overscroll-contain max-w-md animate-sheet-up overflow-y-auto rounded-t-3xl border bg-card px-5 pb-safe pt-3 shadow-2xl sm:rounded-3xl sm:pb-5"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">Bought {goal.name}?</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {mode === "full"
                ? "Logs what you paid as a one-off expense."
                : "Each monthly payment becomes a bill that ends after the last one."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1.5 rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div role="radiogroup" aria-label="How you paid" className="mt-4 grid grid-cols-2 rounded-full border p-1 text-sm font-medium">
          {(["full", "instalments"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-full py-1.5 transition",
                mode === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m === "full" ? "Paid in full" : "Instalments"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 space-y-4 pb-5">
          <label className="block">
            <span className="text-xs text-muted-foreground">{mode === "full" ? "Amount paid (RM)" : "Price (RM)"}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => isMoney(e.target.value) && setAmount(e.target.value)}
              className="field mt-1 text-lg font-semibold tabular-nums"
              aria-label={mode === "full" ? "Amount paid" : "Price"}
            />
            {hasOffsets && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {formatCurrency(goal.target_amount)} minus
                {goal.trade_in_value > 0 && ` ${formatCurrency(goal.trade_in_value)} trade-in`}
                {goal.trade_in_value > 0 && goal.discounts.some((d) => !isExpired(d)) && " and"}
                {goal.discounts.some((d) => !isExpired(d)) && " discounts"}. Change it if yours was different.
              </span>
            )}
          </label>

          {mode === "instalments" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">Down payment (RM)</span>
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={down}
                    onChange={(e) => isMoney(e.target.value) && setDown(e.target.value)}
                    className="field mt-1 tabular-nums"
                    aria-label="Down payment"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Interest / fees (%)</span>
                  <input
                    inputMode="decimal"
                    value={feePct}
                    onChange={(e) => isMoney(e.target.value) && setFeePct(e.target.value)}
                    className="field mt-1 tabular-nums"
                    aria-label="Interest or fees, percent of the amount financed"
                  />
                </label>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">
                {setAside > 0
                  ? `Down payment starts at the ${formatCurrency(setAside)} you set aside. Clear it to keep that as free money. `
                  : ""}
                Fees: total over the plan, as % of what you borrow (0% for most pay-later plans).
              </p>

              <div>
                <span className="text-xs text-muted-foreground">Number of payments</span>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {MONTH_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMonths(String(m))}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        Number(months) === m ? "border-transparent bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                  <input
                    inputMode="numeric"
                    value={months}
                    onChange={(e) => /^\d{0,3}$/.test(e.target.value) && setMonths(e.target.value)}
                    className="field w-20 py-1.5 text-center tabular-nums"
                    aria-label="Number of monthly payments"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">First payment</span>
                  <input
                    type="month"
                    value={startMonth}
                    onChange={(e) => setStartMonth(e.target.value)}
                    className="field mt-1"
                    aria-label="First payment month"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Due on</span>
                  <select value={dueDay} onChange={(e) => setDueDay(e.target.value)} className="field mt-1" aria-label="Due day">
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {ordinal(d)} of the month
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={autoLog}
                onClick={() => setAutoLog((v) => !v)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left"
              >
                <span>
                  <span className="block text-sm font-medium">Add each payment automatically</span>
                  <span className="block text-xs text-muted-foreground">On its due day, unless you&apos;ve logged it already.</span>
                </span>
                <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${autoLog ? "bg-primary" : "bg-secondary"}`}>
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all ${autoLog ? "left-[18px]" : "left-0.5"}`}
                  />
                </span>
              </button>
            </>
          )}

          {mode !== "full" && (
            <p className="text-xs text-muted-foreground">
              The monthly payments go under <strong className="text-foreground">Instalments</strong>, so they don&apos;t count
              as new shopping each month.
            </p>
          )}
          {needsTag && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-muted-foreground">{mode === "full" ? "Category" : "Down payment category"}</span>
                <select
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setTagId(tags.find((t) => t.category_id === e.target.value)?.id ?? "");
                  }}
                  className="field mt-1"
                  aria-label="Category"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryLabel(c.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">{mode === "full" ? "Tag" : "Down payment tag"}</span>
                <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="field mt-1" aria-label="Tag">
                  {categoryTags.length === 0 && <option value="">No tags in this category</option>}
                  {categoryTags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {(mode === "full" || downPayment > 0) && (
            <label className="block">
              <span className="text-xs text-muted-foreground">{mode === "full" ? "Date" : "Down payment date"}</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mt-1" aria-label="Date" />
            </label>
          )}

          {mode === "instalments" && planValid && (
            <div className="rounded-xl bg-secondary/60 px-4 py-3 text-sm">
              <div className="font-semibold tabular-nums">
                {formatCurrency(terms.monthly)} × {monthCount}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {format(new Date(`${startMonth}-01T00:00:00`), "MMM yyyy")} to {lastMonth}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {downPayment > 0 && `${formatCurrency(downPayment)} down + `}
                {formatCurrency(payments)} in payments = {formatCurrency(downPayment + payments)}
                {terms.fees > 0
                  ? `, ${formatCurrency(downPayment + payments - price)} more than paying upfront`
                  : ", same as paying upfront"}
                . Payments are logged as “{goal.name} instalment”.
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isBusy || !(price > 0) || (needsTag && !tagId) || (mode === "instalments" && !planValid)}
            className="flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
          >
            {mode === "full"
              ? `Mark as bought and log ${price > 0 ? formatCurrency(price) : "expense"}`
              : `Start plan${planValid ? `: ${formatCurrency(terms.monthly)}/month` : ""}`}
          </button>
        </form>
      </div>
    </div>
  );
}
