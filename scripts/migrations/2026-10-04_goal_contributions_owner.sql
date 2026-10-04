-- ========================================================
-- Money set aside for a goal can only be for one of your own goals, like every other reference
-- (an expense's tag, a bill's goal, a balance's account). Before, only the owner of the
-- contribution itself was checked.
-- Run once in the Supabase SQL Editor, after 2026-09-29_goals.sql. Safe to re-run.
-- ========================================================

DROP POLICY IF EXISTS "Owner manages goal contributions" ON public.goal_contributions;

CREATE POLICY "Owner manages goal contributions" ON public.goal_contributions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.goals g WHERE g.id = goal_id AND g.user_id = auth.uid())
  );

-- Check: should be 0 (money set aside pointing at someone else's goal).
SELECT count(*) AS cross_account_contributions
FROM public.goal_contributions c
JOIN public.goals g ON g.id = c.goal_id
WHERE g.user_id <> c.user_id;
