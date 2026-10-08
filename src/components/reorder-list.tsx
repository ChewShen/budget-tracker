"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

// A list in "reorder" mode: ↑ ↓ on each row (arrows, not dragging: dragging fights with scrolling
// on a phone). Used for categories and savings accounts in Settings.
export function ReorderList({
  items,
  onMove,
  onDone,
}: {
  items: { id: string; label: string; icon?: React.ReactNode }[];
  onMove: (id: string, direction: -1 | 1) => void;
  onDone: () => void;
}) {
  return (
    <div className="mt-4">
      <ul className="divide-y divide-border/70 rounded-xl border">
        {items.map((item, i) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2">
            {item.icon && (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">{item.icon}</span>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
            {[
              { dir: -1 as const, can: i > 0, Icon: ArrowUp, label: "Move up" },
              { dir: 1 as const, can: i < items.length - 1, Icon: ArrowDown, label: "Move down" },
            ].map(({ dir, can, Icon, label }) => (
              <button
                key={dir}
                type="button"
                onClick={() => onMove(item.id, dir)}
                disabled={!can}
                className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-25 disabled:hover:bg-transparent"
                aria-label={`${label}: ${item.label}`}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onDone}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
        >
          Done
        </button>
      </div>
    </div>
  );
}
