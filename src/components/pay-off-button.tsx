"use client";

import { useState } from "react";
import { format } from "date-fns";
import { CheckCheck } from "lucide-react";
import { useBudget } from "@/lib/budget-context";
import { instalmentProgress } from "@/lib/instalments";
import type { RecurringBill } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

// "Pay off the rest": logs what's still owed on a plan as one payment today, with the plan's tag.
// Payments count by amount, so the plan then shows as paid off and nothing more is auto-added.
export function PayOffButton({ bill, name, className }: { bill: RecurringBill; name: string; className?: string }) {
  const { tags, transactions, addTransaction, showToast } = useBudget();
  const [isBusy, setIsBusy] = useState(false);
  const progress = instalmentProgress(bill, transactions);
  const tag = tags.find((t) => t.id === bill.tag_id);
  if (!progress || progress.finished || !tag) return null;

  const payOff = async () => {
    if (!window.confirm(`Log ${formatCurrency(progress.owed)} paid today for ${name}? The plan then counts as paid off.`)) return;
    setIsBusy(true);
    await addTransaction({
      date: format(new Date(), "yyyy-MM-dd"),
      category_id: tag.category_id,
      tag_id: tag.id,
      amount: progress.owed,
      description: "Paid off early",
      is_one_off: false,
    });
    setIsBusy(false);
    showToast({ tone: "default", message: `${name} paid off · ${formatCurrency(progress.owed)} logged` });
  };

  return (
    <button
      type="button"
      onClick={payOff}
      disabled={isBusy}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-secondary disabled:opacity-40"
      }
    >
      <CheckCheck className="h-3.5 w-3.5" /> Pay off the rest ({formatCurrency(progress.owed)})
    </button>
  );
}
