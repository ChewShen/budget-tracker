"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ArrowUpDown, Check, Lock, Plus, Trash2, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBudget } from "@/lib/budget-context";
import { ReorderList } from "@/components/reorder-list";
import type { SavingsAccount } from "@/lib/types";

const KINDS: { value: SavingsAccount["kind"]; label: string; description: string }[] = [
  { value: "liquid", label: "Liquid", description: "Money you can use: counts for the emergency fund and free money" },
  { value: "locked", label: "Locked", description: "Can't touch it yet (e.g. EPF): counts toward net worth only" },
];

function KindPicker({ value, onChange }: { value: SavingsAccount["kind"]; onChange: (k: SavingsAccount["kind"]) => void }) {
  return (
    <div role="radiogroup" aria-label="Account type" className="grid grid-cols-2 gap-2">
      {KINDS.map((k) => (
        <button
          key={k.value}
          type="button"
          role="radio"
          aria-checked={value === k.value}
          onClick={() => onChange(k.value)}
          className={cn(
            "rounded-xl border px-3 py-2.5 text-left transition",
            value === k.value ? "border-foreground/70 bg-secondary/50" : "hover:bg-secondary/40"
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {k.value === "locked" ? <Lock className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
            {k.label}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{k.description}</span>
        </button>
      ))}
    </div>
  );
}

function AccountForm({
  initial,
  months,
  onSave,
  onArchive,
  onDelete,
  onCancel,
}: {
  initial?: SavingsAccount;
  months?: number; // months with a balance; accounts with history are archived, not deleted
  onSave: (name: string, kind: SavingsAccount["kind"]) => Promise<boolean>;
  onArchive?: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<SavingsAccount["kind"]>(initial?.kind ?? "liquid");
  const [isBusy, setIsBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBusy(true);
    const ok = await onSave(name, kind);
    setIsBusy(false);
    if (ok) onCancel();
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border bg-background/40 p-4">
      <input
        autoFocus
        required
        maxLength={40}
        placeholder="e.g. Maybank, TnG eWallet, ASB, EPF"
        aria-label="Account name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        className="field"
      />
      <KindPicker value={kind} onChange={setKind} />
      {months !== undefined && (
        <p className="text-xs text-muted-foreground">
          {months > 0
            ? `Has balances in ${months} month${months === 1 ? "" : "s"}. Archive it when it's closed: past months keep it.`
            : "No balances recorded yet."}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {months !== undefined && months > 0 && onArchive && (
          <button
            type="button"
            onClick={onArchive}
            className="mr-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Archive className="h-4 w-4" /> Archive
          </button>
        )}
        {months === 0 && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="mr-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
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
          className="flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
        >
          <Check className="h-4 w-4" strokeWidth={3} /> {initial ? "Save" : "Add account"}
        </button>
      </div>
    </form>
  );
}

export default function SavingsAccountsSettingsPage() {
  const { savingsAccounts, savingsBalances, addSavingsAccount, updateSavingsAccount, deleteSavingsAccount, moveSavingsAccount, showToast } =
    useBudget();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const close = () => setEditing(null);

  const byOrder = (a: SavingsAccount, b: SavingsAccount) => a.position - b.position || a.name.localeCompare(b.name);
  const active = savingsAccounts.filter((a) => !a.archived).sort(byOrder);
  const archived = savingsAccounts.filter((a) => a.archived).sort(byOrder);
  const monthsOf = (id: string) => new Set(savingsBalances.filter((b) => b.account_id === id).map((b) => b.month)).size;

  return (
    <>
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold">Your accounts</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              What you record at the end of each month on the Savings page. Tap one to rename it.
            </p>
          </div>
          {editing !== "new" && !isReordering && (
            <div className="flex flex-wrap gap-2">
              {active.length > 1 && (
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
                onClick={() => setEditing("new")}
                className="flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition hover:bg-secondary"
              >
                <Plus className="h-4 w-4" /> New account
              </button>
            </div>
          )}
        </div>

        {isReordering && (
          <ReorderList
            items={active.map((a) => ({
              id: a.id,
              label: a.name,
              icon: a.kind === "locked" ? <Lock className="h-4 w-4" /> : <Wallet className="h-4 w-4" />,
            }))}
            onMove={moveSavingsAccount}
            onDone={() => setIsReordering(false)}
          />
        )}

        {editing === "new" && (
          <div className="mt-4">
            <AccountForm
              onCancel={close}
              onSave={async (name, kind) => {
                const created = await addSavingsAccount(name, kind);
                if (created) showToast({ tone: "default", message: `Added ${created.name}` });
                return Boolean(created);
              }}
            />
          </div>
        )}

        {isReordering ? null : active.length === 0 && editing !== "new" ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No accounts yet. Add your bank accounts, e-wallets, EPF or investments.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/70">
            {active.map((account) => {
              const months = monthsOf(account.id);
              return (
                <li key={account.id} className="py-2 first:pt-0 last:pb-0">
                  {editing === account.id ? (
                    <AccountForm
                      initial={account}
                      months={months}
                      onCancel={close}
                      onSave={(name, kind) => updateSavingsAccount(account.id, { name, kind })}
                      onArchive={async () => {
                        if (await updateSavingsAccount(account.id, { archived: true })) {
                          close();
                          showToast({ tone: "default", message: `Archived ${account.name}` });
                        }
                      }}
                      onDelete={async () => {
                        if (window.confirm(`Delete ${account.name}?`) && (await deleteSavingsAccount(account.id))) close();
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => setEditing(account.id)}
                      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-secondary/40"
                      aria-label={`Edit account ${account.name}`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                        {account.kind === "locked" ? <Lock className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{account.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {account.kind === "locked" ? "Locked" : "Liquid"}
                          {months > 0 ? ` · ${months} month${months === 1 ? "" : "s"}` : " · no balances yet"}
                        </span>
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {archived.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h3 className="text-[15px] font-semibold">Archived</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Closed accounts: not asked for in new months, still shown in the months they have balances.
          </p>
          <ul className="mt-3 divide-y divide-border/70">
            {archived.map((account) => (
              <li key={account.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{account.name}</span>
                <button
                  onClick={() => updateSavingsAccount(account.id, { archived: false })}
                  className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition hover:bg-secondary"
                >
                  <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
