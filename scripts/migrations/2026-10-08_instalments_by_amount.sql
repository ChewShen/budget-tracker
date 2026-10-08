-- ========================================================
-- Instalment plans count payments by amount, not by month: paying two months at once, paying a
-- month early or settling the rest early all count toward the total. The nightly auto-add only
-- adds what's still short for the month (nothing when you've paid ahead or paid off; never more
-- than one payment a month), the same rule the app uses (src/lib/instalments.ts: planShortfall).
-- Run once in the Supabase SQL Editor, after 2026-10-04_job_runs.sql. Safe to re-run.
-- ========================================================

CREATE OR REPLACE FUNCTION public.auto_log_bills()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  today       date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  month_start date := date_trunc('month', today)::date;
  month_end   date := (date_trunc('month', today) + interval '1 month - 1 day')::date;
  added       integer;
BEGIN
  -- One run at a time, so a manual run and the scheduled run can't double-insert.
  PERFORM pg_advisory_xact_lock(hashtext('auto_log_bills'));

  BEGIN
    INSERT INTO public.transactions (user_id, date, category_id, tag_id, amount, description, is_one_off)
    SELECT due.user_id, due.due_date, due.category_id, due.tag_id, due.amount, 'Auto-added monthly bill', false
    FROM (
      SELECT r.user_id, r.tag_id, t.category_id,
             (month_start + (LEAST(r.due_day, EXTRACT(DAY FROM month_end)::int) - 1))::date AS due_date,
             CASE WHEN r.installment_count IS NULL THEN r.expected_amount
                  ELSE LEAST(r.expected_amount, plan.need) END AS amount,
             CASE WHEN r.installment_count IS NULL
                  -- Ongoing bills: nothing logged with the tag this month yet.
                  THEN NOT EXISTS (
                    SELECT 1 FROM public.transactions x
                    WHERE x.user_id = r.user_id AND x.tag_id = r.tag_id
                      AND x.date BETWEEN month_start AND month_end)
                  -- Plans: still short this month (5 sen of rounding allowed).
                  ELSE plan.need > 0.05 END AS needed
      FROM public.recurring_sentinel r
      JOIN public.tags t ON t.id = r.tag_id
      LEFT JOIN LATERAL (
        -- Still to pay this month: the monthly amount, minus anything paid ahead in earlier months,
        -- minus what's been paid this month. A month missed earlier isn't added on top.
        SELECT r.expected_amount
                 - GREATEST(0, paid.before - r.expected_amount * LEAST(r.installment_count, GREATEST(0,
                     (EXTRACT(YEAR FROM month_start) * 12 + EXTRACT(MONTH FROM month_start))::int
                       - (EXTRACT(YEAR FROM r.start_month) * 12 + EXTRACT(MONTH FROM r.start_month))::int)))
                 - paid.this_month AS need
        FROM (
          -- Payments toward the plan: its tag, from the month before the first payment.
          SELECT COALESCE(sum(x.amount) FILTER (WHERE x.date < month_start), 0) AS before,
                 COALESCE(sum(x.amount) FILTER (WHERE x.date BETWEEN month_start AND month_end), 0) AS this_month
          FROM public.transactions x
          WHERE x.user_id = r.user_id AND x.tag_id = r.tag_id
            AND x.date >= (r.start_month - interval '1 month')::date
        ) paid
      ) plan ON r.installment_count IS NOT NULL
      WHERE r.is_active AND r.auto_log
        AND r.expected_amount IS NOT NULL AND r.due_day IS NOT NULL
        -- Instalment plans: only from the first payment month to the last.
        AND (r.installment_count IS NULL
             OR (month_start >= r.start_month
                 AND month_start < (r.start_month + make_interval(months => r.installment_count))::date))
    ) due
    WHERE due.due_date <= today AND due.needed;
    GET DIAGNOSTICS added = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.job_runs (job, ok, detail) VALUES ('auto_bills', false, left(SQLERRM, 300));
    RETURN 0;
  END;

  INSERT INTO public.job_runs (job, ok) VALUES ('auto_bills', true);
  DELETE FROM public.job_runs WHERE ran_at < now() - interval '90 days';
  RETURN added;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_log_bills() FROM PUBLIC, anon, authenticated;

-- Check: each plan's progress by amount.
SELECT t.name AS plan, r.expected_amount AS monthly, r.installment_count AS payments,
       r.expected_amount * r.installment_count AS total,
       COALESCE((SELECT sum(x.amount) FROM public.transactions x
                 WHERE x.user_id = r.user_id AND x.tag_id = r.tag_id
                   AND x.date >= (r.start_month - interval '1 month')::date), 0) AS paid
FROM public.recurring_sentinel r
JOIN public.tags t ON t.id = r.tag_id
WHERE r.installment_count IS NOT NULL
ORDER BY t.name;
