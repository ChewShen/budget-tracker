"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { Plus, Search, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { CategoryIcon, categoryLabel } from "@/lib/categories";
import { Transaction } from "@/lib/types";
import { useQuickAdd } from "@/components/app-shell";
import { cn } from "@/lib/utils";

interface LedgerTableProps {
  transactions: Transaction[];
  onDeleteTransaction?: (id: string) => Promise<void>;
  showFilters?: boolean;
  pageSize?: number; // rows drawn at first; "Show more" adds this many again
}

// Fixed pattern (not the browser locale, which varies, e.g. "Sep" vs "Sept"): "Mon 31 Aug".
const formatDayHeading = (dateStr: string) => format(parseISO(dateStr), "EEE d MMM");

export function LedgerTable({
  transactions,
  onDeleteTransaction,
  showFilters = true,
  pageSize = 50,
}: LedgerTableProps) {
  const { openEdit, openAddOn } = useQuickAdd();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  // Drawing thousands of rows is what slows a phone down, so only the newest few are drawn
  // until asked for more. Search, filters and day totals still cover every row.
  const [visible, setVisible] = useState(pageSize);

  const categories = Array.from(
    new Set(transactions.map((t) => t.category_name).filter(Boolean))
  ) as string[];

  const query = searchTerm.toLowerCase();
  const filtered = transactions.filter((tx) => {
    const matchesSearch =
      (tx.tag_name || "").toLowerCase().includes(query) ||
      (tx.description || "").toLowerCase().includes(query) ||
      (tx.category_name || "").toLowerCase().includes(query);
    const matchesCat = selectedCategory === "ALL" || tx.category_name === selectedCategory;
    return matchesSearch && matchesCat;
  });

  // Group by date, newest first. Day totals use the whole day even if only part of it is drawn.
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  const dayTotals = new Map<string, number>();
  sorted.forEach((tx) => dayTotals.set(tx.date, (dayTotals.get(tx.date) || 0) + tx.amount));
  const groups = new Map<string, Transaction[]>();
  sorted.slice(0, visible).forEach((tx) => {
    const list = groups.get(tx.date) || [];
    list.push(tx);
    groups.set(tx.date, list);
  });
  const shown = Math.min(visible, sorted.length);

  return (
    <div className="space-y-4">
      {showFilters && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search tags or notes"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setVisible(pageSize);
              }}
              className="field rounded-full bg-card pl-10"
            />
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0 pointer-fine:flex-wrap pointer-fine:overflow-visible">
            {["ALL", ...categories].map((c) => (
              <button
                key={c}
                onClick={() => {
                  setSelectedCategory(c);
                  setVisible(pageSize);
                }}
                className={cn(
                  "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                  selectedCategory === c
                    ? "border-transparent bg-foreground text-background"
                    : "bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {c === "ALL" ? "All" : categoryLabel(c)}
              </button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card py-12 text-center text-sm text-muted-foreground">
          No transactions found
        </div>
      ) : (
        <>
          <div className="card divide-y divide-border/60 overflow-hidden">
            {Array.from(groups.entries()).map(([date, txs]) => {
              const dayTotal = dayTotals.get(date) || 0;
              return (
                <div key={date}>
                  <div className="flex items-center justify-between gap-2 bg-secondary/40 py-1 pl-4 pr-2 text-xs text-muted-foreground sm:pl-5 sm:pr-3">
                    <span className="font-medium">{formatDayHeading(date)}</span>
                    <span className="flex items-center gap-1">
                      <span className="tabular-nums">{formatCurrency(dayTotal)}</span>
                      <button
                        type="button"
                        onClick={() => openAddOn(date)}
                        className="rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                        aria-label={`Add an expense on ${formatDayHeading(date)}`}
                        title="Add an expense on this day"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  <ul>
                    {txs.map((tx) => (
                      <li
                        key={tx.id}
                        className="group flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-secondary/30 sm:px-5"
                      >
                        <button
                          type="button"
                          onClick={() => openEdit(tx)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          aria-label={`Edit ${tx.tag_name} ${formatCurrency(tx.amount)}`}
                        >
                          <CategoryIcon name={tx.category_name} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{tx.tag_name}</span>
                              {tx.is_one_off && (
                                <span className="shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                                  One-off
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {tx.description || categoryLabel(tx.category_name)}
                            </div>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            −{formatCurrency(tx.amount)}
                          </span>
                        </button>
                        {onDeleteTransaction && (
                          <button
                            onClick={() => onDeleteTransaction(tx.id)}
                            className="-mr-1 shrink-0 rounded-full p-1.5 text-muted-foreground/60 transition hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
                            aria-label={`Delete ${tx.tag_name} ${formatCurrency(tx.amount)}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {sorted.length > shown && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">
                Showing {shown} of {sorted.length}
              </span>
              <button
                onClick={() => setVisible((v) => v + pageSize)}
                className="rounded-full border px-4 py-2 text-sm font-medium transition hover:bg-secondary"
              >
                Show {Math.min(pageSize, sorted.length - shown)} more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
