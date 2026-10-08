-- ========================================================
-- Your own order for categories (Settings → Categories & tags → Reorder): Add expense, the Inbox,
-- filters and budgets list them in it. Existing categories start in today's order (by name);
-- categories without a position (new ones) come after, by name.
-- Run once in the Supabase SQL Editor, after 2026-09-30_multi_user.sql. Safe to re-run.
-- ========================================================

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS position integer;

-- Number each account's categories by name, once (only accounts that have none numbered yet).
UPDATE public.categories c SET position = n.pos
FROM (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY lower(name)) - 1 AS pos
  FROM public.categories
) n
WHERE c.id = n.id
  AND NOT EXISTS (SELECT 1 FROM public.categories o WHERE o.user_id = c.user_id AND o.position IS NOT NULL);

-- Check: your categories in order.
SELECT name, position FROM public.categories ORDER BY user_id, position NULLS LAST, name;
