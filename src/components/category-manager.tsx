"use client";

import { useState } from "react";
import { ArrowUpDown, Check, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBudget } from "@/lib/budget-context";
import { CATEGORY_ICON_OPTIONS, categoryIcon, categoryIconKey, categoryLabel } from "@/lib/categories";
import { roleDescription } from "@/lib/roles";
import { ReorderList } from "@/components/reorder-list";
import { Category, Tag } from "@/lib/types";

// Marks the category and tags the app uses (Food & dining card, meal suggestions).
function RoleStar({ role }: { role: Category["role"] | Tag["role"] }) {
  const description = roleDescription(role);
  if (!description) return null;
  return (
    <span title={description} role="img" aria-label={description} className="inline-flex">
      <Star className="h-3 w-3 shrink-0 fill-current text-highlight" aria-hidden />
    </span>
  );
}

// Which inline editor is open (only one at a time).
type Editor =
  | { kind: "none" }
  | { kind: "new-category" }
  | { kind: "category"; id: string }
  | { kind: "new-tag"; categoryId: string }
  | { kind: "tag"; id: string };

function IconPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-1.5 sm:grid-cols-11">
      {Object.entries(CATEGORY_ICON_OPTIONS).map(([key, Icon]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          aria-label={key.replace(/-/g, " ")}
          onClick={() => onChange(key)}
          className={cn(
            "flex aspect-square items-center justify-center rounded-lg border transition",
            value === key
              ? "border-transparent bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function CategoryForm({
  initial,
  usedBy,
  onSave,
  onDelete,
  onCancel,
}: {
  initial?: Category;
  usedBy?: number;
  onSave: (name: string, icon: string) => Promise<boolean>;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  // Preselect the icon currently shown, so renaming an imported category doesn't reset it.
  const [icon, setIcon] = useState(categoryIconKey(initial?.name, initial?.icon));
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    const ok = await onSave(name, icon);
    setIsBusy(false);
    if (ok) onCancel();
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-background/40 p-4">
      <input
        autoFocus
        required
        maxLength={40}
        placeholder="Category name"
        aria-label="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="field"
      />
      <IconPicker value={icon} onChange={setIcon} />
      {usedBy !== undefined && (
        <p className="text-xs text-muted-foreground">
          Used by {usedBy} expense{usedBy === 1 ? "" : "s"}
          {usedBy > 0 ? ", so it can be renamed but not deleted." : "."}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={Boolean(usedBy)}
            className="mr-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isBusy || !name.trim()}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
        >
          {initial ? "Save" : "Add category"}
        </button>
      </div>
    </form>
  );
}

function TagInput({
  initial = "",
  usedBy,
  onSave,
  onDelete,
  onCancel,
}: {
  initial?: string;
  usedBy?: number;
  onSave: (name: string) => Promise<boolean>;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    const ok = await onSave(name);
    setIsBusy(false);
    if (ok) onCancel();
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2 rounded-xl border bg-background/40 p-2">
      <input
        autoFocus
        required
        maxLength={40}
        placeholder="Tag name"
        aria-label="Tag name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none"
      />
      {usedBy !== undefined && (
        <span className="text-xs text-muted-foreground">
          {usedBy} expense{usedBy === 1 ? "" : "s"}
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={Boolean(usedBy)}
          className="rounded-full p-2 text-danger transition hover:bg-danger/10 disabled:opacity-40 disabled:hover:bg-transparent"
          aria-label="Delete tag"
          title={usedBy ? "Used by expenses, rename it instead" : "Delete tag"}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isBusy || !name.trim()}
        className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} /> {initial ? "Save" : "Add"}
      </button>
    </form>
  );
}

export function CategoryManager({ showTitle = true }: { showTitle?: boolean }) {
  const { categories, tags, transactions, addCategory, renameCategory, deleteCategory, addTag, renameTag, deleteTag, moveCategory } =
    useBudget();
  const [editor, setEditor] = useState<Editor>({ kind: "none" });
  const [isReordering, setIsReordering] = useState(false);
  const close = () => setEditor({ kind: "none" });

  const usage = (key: "category_id" | "tag_id", id: string) => transactions.filter((t) => t[key] === id).length;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {showTitle && <h3 className="text-[15px] font-semibold">Categories & tags</h3>}
          <p className={showTitle ? "mt-0.5 text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
            Tap a category or tag to rename it. Anything in use by expenses can&apos;t be deleted.
            <span className="mt-1 flex items-center gap-1">
              <Star className="h-3 w-3 fill-current text-highlight" aria-hidden /> Used by the app (Food &amp; dining card, meal
              suggestions, instalment plans). Rename freely.
            </span>
          </p>
        </div>
        {editor.kind !== "new-category" && !isReordering && (
          <div className="flex flex-wrap gap-2">
            {categories.length > 1 && (
              <button
                onClick={() => {
                  close();
                  setIsReordering(true);
                }}
                className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition hover:bg-secondary"
              >
                <ArrowUpDown className="h-4 w-4" /> Reorder
              </button>
            )}
            <button
              onClick={() => setEditor({ kind: "new-category" })}
              className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition hover:bg-secondary"
            >
              <Plus className="h-4 w-4" /> New category
            </button>
          </div>
        )}
      </div>

      {isReordering && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            Add expense, the Inbox, filters and budgets list categories in this order. Charts still sort by amount.
          </p>
          <ReorderList
            items={categories.map((c) => {
              const Icon = categoryIcon(c.name, c.icon);
              return { id: c.id, label: categoryLabel(c.name), icon: <Icon className="h-4 w-4" /> };
            })}
            onMove={moveCategory}
            onDone={() => setIsReordering(false)}
          />
        </>
      )}

      {editor.kind === "new-category" && (
        <div className="mt-4">
          <CategoryForm
            onCancel={close}
            onSave={async (name, icon) => Boolean(await addCategory(name, icon))}
          />
        </div>
      )}

      {!isReordering && (
        <ul className="mt-4 divide-y divide-border/70">
          {categories.map((cat) => {
            const Icon = categoryIcon(cat.name, cat.icon);
            const catTags = tags.filter((t) => t.category_id === cat.id);
            const isEditingCat = editor.kind === "category" && editor.id === cat.id;
            return (
              <li key={cat.id} className="py-4 first:pt-0 last:pb-0">
                {isEditingCat ? (
                  <CategoryForm
                    initial={cat}
                    usedBy={usage("category_id", cat.id)}
                    onCancel={close}
                    onSave={(name, icon) => renameCategory(cat.id, name, icon)}
                    onDelete={cat.role === "instalments" ? undefined : async () => {
                      const warning = cat.role === "food" ? "\n\nIt's your food category: the Food & dining card and meal suggestions will stop." : "";
                      if (window.confirm(`Delete ${categoryLabel(cat.name)} and its ${catTags.length} tags?${warning}`)) {
                        if (await deleteCategory(cat.id)) close();
                      }
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setEditor({ kind: "category", id: cat.id })}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-secondary/40"
                    aria-label={`Edit category ${categoryLabel(cat.name)}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-1 items-center gap-1.5 text-sm font-medium">
                      {categoryLabel(cat.name)}
                      <RoleStar role={cat.role} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {catTags.length} tag{catTags.length === 1 ? "" : "s"}
                    </span>
                  </button>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5 pl-11">
                  {catTags.map((tag) =>
                    editor.kind === "tag" && editor.id === tag.id ? (
                      <TagInput
                        key={tag.id}
                        initial={tag.name}
                        usedBy={usage("tag_id", tag.id)}
                        onCancel={close}
                        onSave={(name) => renameTag(tag.id, name)}
                        onDelete={async () => {
                          const description = roleDescription(tag.role);
                          if (description && !window.confirm(`Delete ${tag.name}? ${description}, so that will stop.`)) return;
                          if (await deleteTag(tag.id)) close();
                        }}
                      />
                    ) : (
                      <button
                        key={tag.id}
                        onClick={() => setEditor({ kind: "tag", id: tag.id })}
                        className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
                        aria-label={`Edit tag ${tag.name}`}
                      >
                        <RoleStar role={tag.role} />
                        {tag.name}
                      </button>
                    )
                  )}
                  {editor.kind === "new-tag" && editor.categoryId === cat.id ? (
                    <TagInput onCancel={close} onSave={async (name) => Boolean(await addTag(cat.id, name))} />
                  ) : (
                    <button
                      onClick={() => setEditor({ kind: "new-tag", categoryId: cat.id })}
                      className="flex items-center gap-1 rounded-lg border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
                      aria-label={`Add tag to ${categoryLabel(cat.name)}`}
                    >
                      <Plus className="h-3 w-3" /> Tag
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
