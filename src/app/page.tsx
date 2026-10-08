"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Inbox } from "lucide-react";
import { ExportMenu } from "@/components/export-menu";
import { addMonths, format, getDaysInMonth, parse, subMonths } from "date-fns";
import { useBudget } from "@/lib/budget-context";
import { useInbox } from "@/lib/automation";
import { jobStatuses, jobWarning, recentIngestErrors, useJobRuns } from "@/lib/job-health";
import { MonthSelector } from "@/components/month-selector";
import { KpiCards } from "@/components/kpi-cards";
import { SpendHero } from "@/components/spend-hero";
import { SalaryEngine } from "@/components/salary-engine";
import { RecurringSentinel, type BillStatus } from "@/components/recurring-sentinel";
import { canAutoLog } from "@/lib/bills";
import { billActiveIn, planShortfall } from "@/lib/instalments";
import { categoryLabel } from "@/lib/categories";
import { foodCategory } from "@/lib/roles";
import { formatCurrency } from "@/lib/utils";
import {
  baseline,
  monthForecast,
  monthInsights,
  monthProgress,
  monthlyTotals,
  spendSplit,
  yearToDate,
} from "@/lib/analytics";
import { YearToDateCard } from "@/components/year-to-date";
import { SpendSplitCard } from "@/components/spend-split";
import { SpendingCalendar } from "@/components/spending-calendar";
import { InsightsCard } from "@/components/insights-card";
import { SpendingTrend } from "@/components/spending-trend";
import { BudgetsCard, type BudgetRow } from "@/components/budgets-card";
import { budgetStatus } from "@/lib/budgets";
import type { Insight } from "@/lib/analytics";
import { CategoryChart } from "@/components/category-chart";
import { TagsBarChart } from "@/components/tags-bar-chart";
import { LedgerTable } from "@/components/ledger-table";
import {
  calculateDailyAverage,
  calculateSalaryMetrics,
} from "@/lib/formulas";

export default function DashboardPage() {
  const {
    transactions,
    selectedMonth,
    setSelectedMonth,
    deleteTransaction,
    isSyncedWithSupabase,
    profile,
    updateProfile,
    tags,
    bills,
    budgets,
    categories,
    addTransaction,
    showToast,
    mode,
  } = useBudget();
  // Expenses sent by Shortcuts, waiting in the Inbox (signed-in accounts only).
  const inbox = useInbox(mode === "cloud");
  // A background job that failed or stopped running (signed-in accounts only).
  const jobs = useJobRuns(mode === "cloud");
  const jobProblem = jobWarning(jobStatuses(jobs.runs, new Date()), recentIngestErrors(jobs.runs, new Date()));

  // Filter transactions for currently selected month (YYYY-MM)
  const monthTransactions = transactions.filter((t) =>
    t.date.startsWith(selectedMonth)
  );

  // 1. Calculate Total Spend & Food Spend
  const totalSpend = monthTransactions.reduce((sum, t) => sum + t.amount, 0);
  const foodId = foodCategory(categories)?.id;
  const foodSpend = monthTransactions
    .filter((t) => t.category_id === foodId)
    .reduce((sum, t) => sum + t.amount, 0);

  // 1b. Previous month total & daily series for the hero chart
  const monthDate = parse(`${selectedMonth}-01`, "yyyy-MM-dd", new Date());
  const monthLabel = format(monthDate, "MMMM");
  const previousMonth = format(subMonths(monthDate, 1), "yyyy-MM");
  const previousSpend = transactions
    .filter((t) => t.date.startsWith(previousMonth))
    .reduce((sum, t) => sum + t.amount, 0);
  const dailySeries = Array.from({ length: getDaysInMonth(monthDate) }, (_, i) => ({
    day: i + 1,
    amount: 0,
    count: 0,
  }));
  monthTransactions.forEach((t) => {
    const day = Number(t.date.slice(8, 10));
    if (dailySeries[day - 1]) {
      dailySeries[day - 1].amount += t.amount;
      dailySeries[day - 1].count += 1;
    }
  });

  // 2. Daily Average (excluding one-off)
  const dailyAverage = calculateDailyAverage(
    monthTransactions,
    selectedMonth,
    new Date()
  );

  // 3. Largest Expense
  let largestExpense = null;
  if (monthTransactions.length > 0) {
    const sorted = [...monthTransactions].sort((a, b) => b.amount - a.amount);
    largestExpense = {
      amount: sorted[0].amount,
      tag_name: sorted[0].tag_name || "Unknown",
      category_name: sorted[0].category_name || "Unknown",
    };
  }

  // 4. Salary Engine (gross salary and SOCSO/EIS from the user's profile)
  const salaryMetrics = calculateSalaryMetrics(profile.default_gross_salary, totalSpend, profile);

  // 5. Category Breakdown for Donut Chart
  const catMap: Record<string, number> = {};
  monthTransactions.forEach((t) => {
    const cName = t.category_name || "Others";
    catMap[cName] = (catMap[cName] || 0) + t.amount;
  });
  // Compared with the 3-month average, pro-rated to today for the current month.
  const categoryBaseline = baseline(transactions, selectedMonth, (t) => t.category_name || "Others");
  const progress = monthProgress(selectedMonth, format(new Date(), "yyyy-MM-dd"));
  const categoryChartData = Object.entries(catMap)
    .map(([name, value]) => ({
      name,
      value: Math.round(value * 100) / 100,
      usual: categoryBaseline.monthsUsed
        ? Math.round((categoryBaseline.average.get(name) || 0) * progress * 100) / 100
        : undefined,
    }))
    .sort((a, b) => b.value - a.value);

  // 6. Tag Breakdown for Bar Chart
  const tagMap: Record<string, number> = {};
  monthTransactions.forEach((t) => {
    const tName = t.tag_name || "Misc";
    tagMap[tName] = (tagMap[tName] || 0) + t.amount;
  });
  const tagChartData = Object.entries(tagMap).map(([name, value]) => ({
    name,
    value: Math.round(value * 100) / 100,
  }));

  // 7. Monthly bills: matched by tag id, so renaming a tag doesn't break them.
  const billTagIds = new Set(bills.map((b) => b.tag_id));
  const daysInSelectedMonth = getDaysInMonth(monthDate);
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const currentMonthStr = todayStr.slice(0, 7);
  const loggedTagIds = new Set(monthTransactions.map((t) => t.tag_id));
  const dayStr = (day: number) =>
    `${selectedMonth}-${String(Math.min(day, daysInSelectedMonth)).padStart(2, "0")}`;

  // Instalment plans only count in their own months, so the forecast, budgets and this list
  // include a plan's payment from its first month to its last, and not after.
  const billRows = bills
    .filter((b) => b.is_active && billActiveIn(b, selectedMonth))
    .flatMap((bill) => {
      const tag = tags.find((t) => t.id === bill.tag_id);
      if (!tag) return [];
      // Plans count what's been paid by this month (paid ahead or off = done); other bills, a
      // payment logged this month.
      const short = planShortfall(bill, transactions, selectedMonth);
      const isLogged = short !== null ? short <= 0 : loggedTagIds.has(tag.id);
      const dueDate = bill.due_day ? dayStr(bill.due_day) : null;
      const daysLeft = dueDate
        ? Math.round((new Date(dueDate + "T00:00:00").getTime() - new Date(todayStr + "T00:00:00").getTime()) / 86400000)
        : null;

      // Auto bills are added by the daily job (or on open in local-only mode), so they aren't "due".
      const isAuto = Boolean(bill.auto_log && canAutoLog(bill));

      let status: BillStatus = "missing";
      if (isLogged) status = "logged";
      else if (isAuto && selectedMonth >= currentMonthStr)
        status = selectedMonth > currentMonthStr || (daysLeft ?? 0) > 0 ? "auto" : "auto-pending";
      else if (selectedMonth > currentMonthStr) status = "upcoming";
      else if (selectedMonth === currentMonthStr) {
        if (daysLeft === null) status = "missing";
        else if (daysLeft < 0) status = "overdue";
        else if (daysLeft <= 3) status = "due-soon";
        else status = "upcoming";
      }

      // What "Log missing bills" would enter: expected amount, else the last payment.
      const last = transactions
        .filter((t) => t.tag_id === tag.id && t.date < `${selectedMonth}-01`)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      const amount = short ?? bill.expected_amount ?? last?.amount ?? null;
      const rawDate = dueDate ?? (last ? dayStr(Number(last.date.slice(8, 10))) : null) ?? todayStr;
      return [
        {
          id: bill.id,
          tag_id: tag.id,
          category_id: tag.category_id,
          tag_name: tag.name,
          status,
          daysLeft,
          dueDate,
          amount,
          date: rawDate > todayStr ? todayStr : rawDate,
        },
      ];
    })
    .sort((a, b) => a.tag_name.localeCompare(b.tag_name));

  // Don't offer to log bills into a future month, or ones with no known amount.
  const loggableBills =
    selectedMonth > currentMonthStr
      ? []
      : billRows
          .filter((r) => r.status !== "logged" && r.status !== "auto" && r.status !== "auto-pending" && r.amount !== null)
          .map((r) => ({ ...r, amount: r.amount as number }));

  // 8. Month-end forecast (current month only). Bills still to come use their known amount.
  const forecast = monthForecast(
    monthTransactions,
    selectedMonth,
    todayStr,
    billTagIds,
    billRows.filter((r) => r.status !== "logged" && r.amount !== null).reduce((sum, r) => sum + (r.amount as number), 0)
  );

  // 8b. Budgets: each budgeted category this month; bills still to come in it are included.
  const budgetRows: BudgetRow[] = budgets.flatMap((b) => {
    const category = categories.find((c) => c.id === b.category_id);
    if (!category) return [];
    const upcoming = billRows
      .filter((r) => r.category_id === b.category_id && r.status !== "logged" && r.amount !== null)
      .reduce((sum, r) => sum + (r.amount as number), 0);
    return [
      {
        categoryName: category.name,
        status: budgetStatus({
          limit: b.monthly_limit,
          categoryTxs: monthTransactions.filter((t) => t.category_id === b.category_id),
          month: selectedMonth,
          today: todayStr,
          billTagIds,
          upcomingBills: selectedMonth >= currentMonthStr ? upcoming : 0,
        }),
      },
    ];
  });

  // Insights: the strongest budget warning competes with the general highlights.
  const worstBudget = [...budgetRows]
    .filter((r) => r.status.state !== "ok")
    .sort((a, b) => (b.status.spent - b.status.limit) - (a.status.spent - a.status.limit) || b.status.projected - a.status.projected)[0];
  const budgetInsight: Insight[] = worstBudget
    ? [
        {
          id: "budget",
          tone: "up",
          title:
            worstBudget.status.state === "over"
              ? `${categoryLabel(worstBudget.categoryName)} is ${formatCurrency(worstBudget.status.spent - worstBudget.status.limit)} over budget`
              : `${categoryLabel(worstBudget.categoryName)} is on pace to go over budget`,
          detail:
            worstBudget.status.state === "over"
              ? `Spent ${formatCurrency(worstBudget.status.spent)} of ${formatCurrency(worstBudget.status.limit)}.`
              : `Heading for ${formatCurrency(worstBudget.status.projected)} against ${formatCurrency(worstBudget.status.limit)}.`,
          score: 1000,
        },
      ]
    : [];
  const insights = [...budgetInsight, ...monthInsights(transactions, selectedMonth, todayStr, 3)].slice(0, 3);

  // 9. Monthly trend: 6 months around the selected one, running up to 2 months past it (never
  //    beyond this month), so picking an older bar keeps the months after it on screen.
  //    Average over completed months only.
  const twoAfter = format(addMonths(monthDate, 2), "yyyy-MM");
  const trendEnd = selectedMonth >= currentMonthStr ? selectedMonth : twoAfter < currentMonthStr ? twoAfter : currentMonthStr;
  const trend = monthlyTotals(transactions, trendEnd, 6, selectedMonth).map((m) => {
    const projectedRest = forecast && m.month === selectedMonth ? Math.max(0, forecast.projected - m.total) : 0;
    return { ...m, projectedRest, projectedTotal: m.total + projectedRest };
  });
  const completed = trend.filter((m) => m.month < currentMonthStr && m.total > 0);
  // Needs a completed month other than the selected one, or it only compares the month with itself.
  const trendAverage =
    completed.some((m) => m.month !== selectedMonth)
      ? Math.round((completed.reduce((sum, m) => sum + m.total, 0) / completed.length) * 100) / 100
      : null;

  const handleLogMissingBills = () => {
    loggableBills.forEach((b) =>
      addTransaction({
        amount: b.amount,
        date: b.date,
        category_id: b.category_id,
        tag_id: b.tag_id,
        is_one_off: false,
      })
    );
    showToast({
      tone: "default",
      message: `Logged ${loggableBills.length} bill${loggableBills.length === 1 ? "" : "s"}`,
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthSelector
          currentMonth={selectedMonth}
          onChangeMonth={setSelectedMonth}
        />

        <div className="flex items-center gap-1">
          <span
            className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground"
            title={
              mode === "guest"
                ? "Guest mode: nothing is saved"
                : isSyncedWithSupabase
                  ? "Synced with Supabase"
                  : "Saved on this device only"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                mode === "guest" ? "bg-warning" : isSyncedWithSupabase ? "bg-success" : "bg-muted-foreground"
              }`}
            />
            {mode === "guest" ? "Not saved" : isSyncedWithSupabase ? "Synced" : "Local only"}
          </span>
          <ExportMenu />
        </div>
      </div>

      {jobProblem && (
        <Link
          href="/settings/account"
          className="card flex items-center gap-3 border-warning/50 px-4 py-3 transition hover:bg-secondary/40"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 text-sm">
            {jobProblem}
            <span className="block text-xs text-muted-foreground">See Settings → Account → Background jobs</span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {inbox.items.length > 0 && (
        <Link
          href="/inbox"
          className="card flex items-center gap-3 border-primary/40 px-4 py-3 transition hover:bg-secondary/40"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Inbox className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {inbox.items.length} expense{inbox.items.length === 1 ? "" : "s"} to confirm
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              From your Shortcuts: {inbox.items.slice(0, 3).map((i) => i.merchant || "unknown").join(", ")}
              {inbox.items.length > 3 ? "…" : ""}
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      <SpendHero
        monthLabel={monthLabel}
        totalSpend={totalSpend}
        previousSpend={previousSpend}
        transactionCount={monthTransactions.length}
        daily={dailySeries}
        forecast={forecast}
        monthEndLabel={format(new Date(`${selectedMonth}-${String(daysInSelectedMonth).padStart(2, "0")}T00:00:00`), "d MMM")}
      />

      <KpiCards
        totalSpend={totalSpend}
        foodSpend={foodSpend}
        dailyAverage={dailyAverage}
        largestExpense={largestExpense}
        savingsRate={salaryMetrics.savingsRate}
      />

      <BudgetsCard rows={budgetRows} monthName={monthLabel} />

      <InsightsCard insights={insights} />

      <SpendingTrend
        data={trend}
        average={trendAverage}
        selectedMonth={selectedMonth}
        onSelectMonth={setSelectedMonth}
      />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <CategoryChart
          data={categoryChartData}
          baselineMonths={categoryBaseline.monthsUsed}
          isMonthToDate={progress < 1}
        />
        <TagsBarChart data={tagChartData} />
        <SalaryEngine
          gross={salaryMetrics.gross}
          epf={salaryMetrics.epf}
          socso={salaryMetrics.socso}
          eis={salaryMetrics.eis}
          netSalary={salaryMetrics.netSalary}
          netCashSaved={salaryMetrics.netCashSaved}
          savingsRate={salaryMetrics.savingsRate}
          profile={profile}
          onSaveProfile={updateProfile}
        />
        <RecurringSentinel
          items={billRows}
          loggableBills={loggableBills}
          onLogMissing={handleLogMissingBills}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <SpendingCalendar month={selectedMonth} today={todayStr} days={dailySeries} />
        <div className="space-y-4 sm:space-y-5">
          <SpendSplitCard split={spendSplit(monthTransactions, billTagIds)} />
          <YearToDateCard ytd={yearToDate(transactions, selectedMonth, salaryMetrics.netSalary)} />
        </div>
      </div>

      {/* Recent transactions */}
      <section className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">Recent</h3>
          <Link
            href="/transactions"
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            See all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <LedgerTable
          transactions={[...monthTransactions]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 8)}
          onDeleteTransaction={deleteTransaction}
          showFilters={false}
        />
      </section>
    </div>
  );
}
