-- ========================================================
-- Instalment plans get their own category, "Instalments", marked like the food category: it can
-- be renamed but not deleted, and payments already committed don't count as new Shopping.
-- New plans bought from Goals put their tag in it (the app creates the category on first use).
-- This moves existing plans bought from Goals there, with their past payments. Plans made in
-- Settings → Monthly bills keep their own tags and categories.
-- Run once in the Supabase SQL Editor, after 2026-10-08_instalments_by_amount.sql. Safe to re-run.
-- ========================================================

-- 1. A second mark for categories (one of each per account; the unique index already exists).
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_role_check;
ALTER TABLE public.categories ADD CONSTRAINT categories_role_check CHECK (role IN ('food', 'instalments'));

-- 2. Accounts with plans bought from Goals get the category (or their own "Instalments" is marked).
UPDATE public.categories c SET role = 'instalments'
WHERE lower(c.name) = 'instalments' AND c.role IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.categories o WHERE o.user_id = c.user_id AND o.role = 'instalments');

INSERT INTO public.categories (user_id, name, icon, role)
SELECT DISTINCT r.user_id, 'Instalments', 'calendar-clock', 'instalments'
FROM public.recurring_sentinel r
WHERE r.goal_id IS NOT NULL AND r.installment_count IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.categories o WHERE o.user_id = r.user_id AND o.role = 'instalments')
  AND NOT EXISTS (SELECT 1 FROM public.categories o WHERE o.user_id = r.user_id AND lower(o.name) = 'instalments');

-- 3. Move those plans' payments, any merchant rule pointing at them, then their tags (last, since
--    the first two find the plans by their tag's old category). Plans whose tag name is already
--    taken in Instalments stay where they are.
CREATE OR REPLACE VIEW pg_temp.plan_tags_to_move AS
SELECT t.id AS tag_id, ic.id AS category_id
FROM public.recurring_sentinel r
JOIN public.tags t ON t.id = r.tag_id
JOIN public.categories ic ON ic.user_id = r.user_id AND ic.role = 'instalments'
WHERE r.goal_id IS NOT NULL AND r.installment_count IS NOT NULL
  AND t.category_id <> ic.id
  AND NOT EXISTS (SELECT 1 FROM public.tags o WHERE o.category_id = ic.id AND lower(o.name) = lower(t.name));

UPDATE public.transactions x SET category_id = m.category_id FROM pg_temp.plan_tags_to_move m WHERE x.tag_id = m.tag_id;
UPDATE public.merchant_rules mr SET category_id = m.category_id FROM pg_temp.plan_tags_to_move m WHERE mr.tag_id = m.tag_id;
UPDATE public.tags t SET category_id = m.category_id FROM pg_temp.plan_tags_to_move m WHERE t.id = m.tag_id;

-- Check: each plan bought from Goals and its category (should all say Instalments).
SELECT g.name AS goal, t.name AS plan_tag, c.name AS category, c.role
FROM public.recurring_sentinel r
JOIN public.goals g ON g.id = r.goal_id
JOIN public.tags t ON t.id = r.tag_id
JOIN public.categories c ON c.id = t.category_id
WHERE r.installment_count IS NOT NULL
ORDER BY g.name;
