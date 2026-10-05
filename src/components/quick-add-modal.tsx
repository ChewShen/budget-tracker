"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Delete, Plus, Trash2 } from "lucide-react";
import { categoryIcon, categoryLabel } from "@/lib/categories";
import { format, subDays } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { Category, Transaction } from "@/lib/types";
import { useBudget, type NewTransaction } from "@/lib/budget-context";
import { foodCategory, mealForHour, mealTag } from "@/lib/roles";
import { defaultEntryDate, getDefaultDateMode, getLastEntryDate, setLastEntryDate } from "@/lib/preferences";
import { useScrollLock } from "@/lib/use-scroll-lock";


const RECENT_DAYS = 90;
const RECENT_LIMIT = 6;

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  tags: { id: string; category_id: string; name: string }[];
  transactions: Transaction[];
  // When set, the sheet edits this entry instead of adding a new one.
  editing: Transaction | null;
  // When adding: start on this date (Activity's "+" on a day) instead of the usual default.
  startDate?: string | null;
  onSave: (transaction: NewTransaction) => Promise<void>;
  onUpdate: (id: string, transaction: NewTransaction) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function appendDigit(current: string, digit: string): string {
  if (digit === "." && current.includes(".")) return current;
  if (current.includes(".") && current.split(".")[1].length >= 2) return current;
  if (current.replace(".", "").length >= 7) return current;
  return current + digit;
}

export function QuickAddModal({
  isOpen,
  onClose,
  categories,
  tags,
  transactions,
  editing,
  startDate,
  onSave,
  onUpdate,
  onDelete,
}: QuickAddModalProps) {
  const [amountStr, setAmountStr] = useState("");
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [description, setDescription] = useState("");
  const [isOneOff, setIsOneOff] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTagName, setNewTagName] = useState<string | null>(null); // null = "+ New tag" closed
  const { addTag } = useBudget();

  // Most-used tags in the last 90 days, each with its most recent amount.
  const recents = useMemo(() => {
    const since = format(subDays(new Date(), RECENT_DAYS), "yyyy-MM-dd");
    const byTag = new Map<string, { tx: Transaction; count: number }>();
    [...transactions]
      .filter((t) => t.date >= since)
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((t) => {
        const entry = byTag.get(t.tag_id);
        if (entry) entry.count += 1;
        else byTag.set(t.tag_id, { tx: t, count: 1 });
      });
    return Array.from(byTag.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, RECENT_LIMIT)
      .map(({ tx }) => tx);
  }, [transactions]);

  // Every time the sheet opens: pre-fill from the entry being edited, or start fresh with
  // today's date (or the last entry's date, per Settings) and the meal for the current time
  // (falling back to the last-used tag, then the first category).
  useEffect(() => {
    if (!isOpen || categories.length === 0) return;
    setNewTagName(null);

    if (editing) {
      setAmountStr(Number.isInteger(editing.amount) ? String(editing.amount) : editing.amount.toFixed(2));
      setSelectedDate(editing.date);
      setSelectedCategoryId(editing.category_id);
      setSelectedTagId(editing.tag_id);
      setDescription(editing.description || "");
      setIsOneOff(editing.is_one_off);
      return;
    }

    setAmountStr("");
    setDescription("");
    setIsOneOff(false);
    const today = format(new Date(), "yyyy-MM-dd");
    setSelectedDate(
      startDate ??
      defaultEntryDate({
        mode: getDefaultDateMode(),
        today,
        lastEntryDate: getLastEntryDate(),
        eveningTagIds: (["dinner", "supper"] as const).flatMap((m) => mealTag(categories, tags, m)?.id ?? []),
        transactions,
      })
    );

    // The meal tag for the time of day (e.g. lunch at 1pm), found by its mark so renaming is fine.
    const food = foodCategory(categories);
    const meal = mealTag(categories, tags, mealForHour(new Date().getHours()));
    const lastUsed = [...transactions].sort((a, b) => b.date.localeCompare(a.date))[0];

    if (meal) {
      setSelectedCategoryId(meal.category_id);
      setSelectedTagId(meal.id);
    } else if (lastUsed) {
      setSelectedCategoryId(lastUsed.category_id);
      setSelectedTagId(lastUsed.tag_id);
    } else {
      selectCategory((food || categories[0]).id);
    }
    // Only when the sheet opens; not when data changes while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing, startDate]);

  const applyRecent = (tx: Transaction) => {
    setSelectedCategoryId(tx.category_id);
    setSelectedTagId(tx.tag_id);
    setAmountStr(String(tx.amount));
  };

  // Filter tags by selected category
  const availableTags = tags.filter((t) => t.category_id === selectedCategoryId);

  // Picking a category also picks its first tag (set together to avoid effects racing each other).
  const selectCategory = (categoryId: string) => {
    setNewTagName(null);
    setSelectedCategoryId(categoryId);
    setSelectedTagId(tags.find((t) => t.category_id === categoryId)?.id || "");
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      // Type the amount on a physical keyboard, unless a text field has focus.
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (/^[0-9.]$/.test(e.key)) {
        e.preventDefault();
        setAmountStr((prev) => appendDigit(prev, e.key));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setAmountStr((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useScrollLock(isOpen);

  if (!isOpen) return null;

  const handleNumpad = (digit: string) => {
    setAmountStr((prev) => appendDigit(prev, digit));
  };

  const handleBackspace = () => {
    setAmountStr((prev) => prev.slice(0, -1));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(amountStr);
    if (!amount || isNaN(amount) || amount <= 0) return;
    if (!selectedCategoryId || !selectedTagId) return;

    const payload: NewTransaction = {
      amount,
      date: selectedDate,
      category_id: selectedCategoryId,
      tag_id: selectedTagId,
      description: description.trim() || undefined,
      is_one_off: isOneOff,
    };

    // The change shows instantly; a failed save shows a Retry toast, so there's no need to wait here.
    setIsSubmitting(true);
    if (editing) {
      onUpdate(editing.id, payload).catch((err) => console.error(err));
    } else {
      setLastEntryDate(selectedDate);
      onSave(payload).catch((err) => console.error(err));
    }
    setAmountStr("");
    setDescription("");
    setIsOneOff(false);
    setIsSubmitting(false);
    onClose();
  };

  const createTag = async () => {
    if (!newTagName?.trim()) return setNewTagName(null);
    const tag = await addTag(selectedCategoryId, newTagName);
    if (tag) {
      setSelectedTagId(tag.id);
      setNewTagName(null);
    }
  };

  const handleDelete = () => {
    if (!editing) return;
    onDelete(editing.id).catch((err) => console.error(err));
    onClose();
  };

  const amountDisplay = amountStr || "0";
  const title = editing ? "Edit expense" : "Add expense";

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-sheet w-full overscroll-contain max-w-md animate-sheet-up sm:max-w-lg overflow-y-auto rounded-t-3xl border bg-card px-5 pb-safe pt-3 shadow-2xl sm:rounded-3xl sm:pb-5"
      >
        {/* Grabber (mobile) */}
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border sm:hidden" />

        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <div className="flex items-center gap-1">
            {/* Save without scrolling past the tags and numpad (same as the big button below). */}
            <button
              type="submit"
              form="quick-add-form"
              disabled={!parseFloat(amountStr) || isSubmitting}
              className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.97] disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={onClose}
              className="-mr-1.5 rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <form id="quick-add-form" onSubmit={handleSubmit} className="mt-2 space-y-5 pb-5">
          {/* Amount */}
          <div className="py-3 text-center">
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-xl font-medium text-muted-foreground">RM</span>
              <span
                className={`text-5xl font-semibold tracking-tight tabular-nums ${
                  amountStr ? "text-foreground" : "text-muted-foreground/50"
                }`}
                aria-live="polite"
              >
                {amountDisplay}
              </span>
            </div>
          </div>

          {/* Recent shortcuts: fill tag + amount in one tap */}
          {!editing && recents.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Recent</div>
              <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 scrollbar-none pointer-fine:mx-0 pointer-fine:flex-wrap pointer-fine:overflow-visible pointer-fine:px-0">
                {recents.map((tx) => (
                  <button
                    key={tx.tag_id}
                    type="button"
                    onClick={() => applyRecent(tx)}
                    className="flex shrink-0 items-baseline gap-1.5 rounded-xl border bg-background px-3 py-2 text-xs transition hover:border-foreground/40 active:scale-95"
                  >
                    <span className="font-medium">{tx.tag_name}</span>
                    <span className="tabular-nums text-muted-foreground">{formatCurrency(tx.amount)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Category */}
          <div className="-mx-5 flex gap-1.5 overflow-x-auto px-5 scrollbar-none pointer-fine:mx-0 pointer-fine:flex-wrap pointer-fine:overflow-visible pointer-fine:px-0">
            {categories.map((cat) => {
              const Icon = categoryIcon(cat.name, cat.icon);
              const isActive = selectedCategoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => selectCategory(cat.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {categoryLabel(cat.name)}
                </button>
              );
            })}
          </div>

          {/* Tags */}
          <div className="flex max-h-[5.75rem] flex-wrap gap-1.5 overflow-y-auto pointer-fine:max-h-none">
            {availableTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => setSelectedTagId(tag.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                  selectedTagId === tag.id
                    ? "border-foreground/80 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {tag.name}
              </button>
            ))}
            {newTagName === null ? (
              <button
                type="button"
                onClick={() => setNewTagName("")}
                className="flex items-center gap-1 rounded-lg border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> New tag
              </button>
            ) : (
              <span className="flex items-center gap-1 rounded-lg border border-foreground/60 py-0.5 pl-2.5 pr-1">
                <input
                  autoFocus
                  maxLength={40}
                  placeholder="Tag name"
                  aria-label="New tag name"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter adds the tag instead of saving the expense; Escape closes only this box.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createTag();
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setNewTagName(null);
                    }
                  }}
                  className="w-24 bg-transparent text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={createTag}
                  disabled={!newTagName.trim()}
                  className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                >
                  Add
                </button>
              </span>
            )}
          </div>

          {/* Note, date, one-off */}
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Add a note"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="field"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="field min-w-0"
                aria-label="Date"
              />
              <button
                type="button"
                onClick={() => setIsOneOff((v) => !v)}
                aria-pressed={isOneOff}
                className={`flex items-center justify-between rounded-xl border px-3.5 text-sm transition ${
                  isOneOff ? "border-foreground/80 text-foreground" : "border-input text-muted-foreground"
                }`}
              >
                One-off
                <span
                  className={`relative h-5 w-9 rounded-full transition ${
                    isOneOff ? "bg-primary" : "bg-secondary"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all ${
                      isOneOff ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-1.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "DEL"].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => (key === "DEL" ? handleBackspace() : handleNumpad(key))}
                className="flex h-12 items-center justify-center rounded-xl text-xl font-medium transition hover:bg-secondary active:scale-95 active:bg-secondary"
                aria-label={key === "DEL" ? "Delete digit" : key}
              >
                {key === "DEL" ? <Delete className="h-5 w-5" /> : key}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {editing && (
              <button
                type="button"
                onClick={handleDelete}
                className="flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-full border px-5 text-sm font-medium text-danger transition hover:bg-danger/10"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
            <button
              type="submit"
              disabled={!parseFloat(amountStr) || isSubmitting}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.98] disabled:opacity-40"
            >
              {isSubmitting ? "Saving…" : editing ? "Save changes" : "Save expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
