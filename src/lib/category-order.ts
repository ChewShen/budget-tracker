// Categories in your order: by position (Settings → Categories & tags → Reorder), then any
// without one (added since) by name.
export const byCategoryOrder = (a: { name: string; position?: number | null }, b: { name: string; position?: number | null }) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);
