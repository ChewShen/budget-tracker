-- ========================================================
-- Goals (wishlist): things you're saving for, with optional trade-in, and the money
-- you set aside for them. Run once in the Supabase SQL Editor; safe to re-run.
-- ========================================================

CREATE TABLE IF NOT EXISTS public.goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(trim(name)) > 0),
  target_amount    numeric(12, 2) NOT NULL CHECK (target_amount > 0),   -- full price
  trade_in_name    text,                                                -- e.g. "iPhone 13"
  trade_in_value   numeric(12, 2) NOT NULL DEFAULT 0 CHECK (trade_in_value >= 0),
  trade_in_updated date,                                                -- when the value was last checked
  target_date      date,
  link             text,
  priority         integer NOT NULL DEFAULT 0,                          -- lower = higher on the list
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'bought', 'archived')),
  bought_at        date,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Money set aside (positive) or taken back (negative) for a goal.
CREATE TABLE IF NOT EXISTS public.goal_contributions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users ON DELETE CASCADE,
  goal_id    uuid NOT NULL REFERENCES public.goals ON DELETE CASCADE,
  amount     numeric(12, 2) NOT NULL CHECK (amount <> 0),
  date       date NOT NULL DEFAULT current_date,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal ON public.goal_contributions (goal_id);

-- Discounts & vouchers on a goal: [{ id, label, kind: "amount" | "percent", value, expires_on }].
-- Added separately so re-running this file also upgrades a goals table created before it existed.
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS discounts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_discounts_is_array;
ALTER TABLE public.goals ADD CONSTRAINT goals_discounts_is_array CHECK (jsonb_typeof(discounts) = 'array');

-- Owner-only access, like every other table.
ALTER TABLE public.goals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages goals"              ON public.goals;
DROP POLICY IF EXISTS "Owner manages goal contributions" ON public.goal_contributions;

CREATE POLICY "Owner manages goals" ON public.goals
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Money set aside can only be for your own goal (also set by 2026-10-04_goal_contributions_owner.sql).
CREATE POLICY "Owner manages goal contributions" ON public.goal_contributions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.goals g WHERE g.id = goal_id AND g.user_id = auth.uid())
  );

-- Check: both tables exist with RLS on, and goals has the discounts column.
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('goals', 'goal_contributions');
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'goals' AND column_name = 'discounts';
