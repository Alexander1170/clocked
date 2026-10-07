import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarDays, ChartPie, PiggyBank, Store, TrendingUp, Utensils } from 'lucide-react';
import type { LocalDate } from '../../shared/types.ts';
import { buildSegments, tally } from '../../shared/accrual.ts';
import { upcomingPaychecks } from '../../shared/bills.ts';
import { CHECKS_PER_YEAR, paydaysBetween } from '../../shared/pay.ts';
import { addDays, dayStart, diffDays, eachDay, endOfMonth, startOfMonth, startOfWeek, toLocalDate } from '../../shared/dates.ts';
import {
  isScheduled,
  useBills,
  useCategoryMap,
  useCategoryOf,
  useEngineData,
  useJobs,
  useNow,
  useSavings,
  useSetAsidePlan,
  useSettings,
  useSpendCheck,
  useTransactions,
  useUntilPayday,
} from '../lib/hooks.ts';
import { checkAmount, spentBetween } from '../lib/money.ts';
import {
  cumulative,
  ENOUGH_HISTORY_DAYS,
  FOOD_SHARE,
  foodPlan,
  gigPayBetween,
  isFoodCategory,
  monthlyBills,
  monthlySavings,
  monthlyTakeHome,
  monthSplit,
  saveIdea,
  setAsideBetween,
} from '../lib/insights.ts';
import { clock, dayLabel, daysUntil, minus, money, monthLong, signed } from '../lib/format.ts';
import { categoryIcon } from '../lib/categories.ts';
import { openSheet, toast } from '../lib/ui.ts';
import { useData } from '../lib/store.ts';
import { Card, MoneyInput, parseMoney } from '../components/ui.tsx';
import { Donut } from '../components/Donut.tsx';
import { LineChart } from '../components/LineChart.tsx';
import { MonthHeatmap } from '../components/MonthHeatmap.tsx';
import { BUDGET_COLORS } from '../components/NetChart.tsx';
import { LeftoverCard } from '../components/LeftoverCard.tsx';

/** Validated together for color blindness, light and dark. */
const SPLIT_COLORS = { bills: 'var(--s7)', saving: 'var(--c-save)', spent: 'var(--s8)', free: 'var(--c-left)' };

function CardTitle({ icon, children, aside }: { icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold">
        <span className="text-ink-2">{icon}</span>
        {children}
      </h2>
      {aside && <span className="shrink-0 text-[13px] text-ink-2">{aside}</span>}
    </div>
  );
}

function Line({ label, value, strong, swatch }: { label: string; value: string; strong?: boolean; swatch?: string }) {
  return (
    <div className={clsx('flex items-center justify-between gap-3 text-[14px]', strong ? 'font-semibold' : 'text-ink-2')}>
      <span className="flex min-w-0 items-center gap-2">
        {swatch && <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: swatch }} />}
        <span className="truncate">{label}</span>
      </span>
      <span className={clsx('num shrink-0', strong ? 'text-ink' : 'text-ink')}>{value}</span>
    </div>
  );
}

/** "2:15 PM" today, or the day it was. */
const asOf = (t: number, today: LocalDate) => (toLocalDate(t) === today ? clock(t) : dayLabel(toLocalDate(t)));

function Meter({ value, of, over }: { value: number; of: number; over?: boolean }) {
  return (
    <span className="mt-3 block h-2.5 overflow-hidden rounded-full bg-raised">
      <span
        className="block h-full rounded-full transition-[width] duration-500"
        style={{ width: `${of > 0 ? Math.min(100, (value / of) * 100) : 0}%`, background: over ? 'var(--s8)' : 'var(--c-left)' }}
      />
    </span>
  );
}

export function Insights() {
  const now = useNow(60_000);
  const today = toLocalDate(now);
  const settings = useSettings();
  const put = useData((s) => s.put);
  const data = useEngineData();
  const jobs = useJobs();
  const bills = useBills();
  const savings = useSavings();
  const txs = useTransactions();
  const cats = useCategoryMap();
  const catOf = useCategoryOf();
  const counts = useSpendCheck();
  const job = jobs.filter(isScheduled).find((j) => j.takeHome > 0);

  // The paycheck stretch you're in.
  const stretch = useUntilPayday(now);

  // ---- This month ----------------------------------------------------------
  const monthFrom = startOfMonth(today);
  const monthTo = endOfMonth(today);
  const monthName = monthLong(Number(today.slice(5, 7)));
  const monthPlan = useSetAsidePlan(monthFrom, monthTo);
  const monthDays = useMemo(() => eachDay(monthFrom, monthTo), [monthFrom, monthTo]);

  const month = useMemo(() => {
    const paydays = job ? paydaysBetween(job, monthFrom, monthTo) : [];
    const checks = job ? paydays.reduce((t, p) => t + checkAmount(job, data, p, now), 0) : 0;
    const gig = gigPayBetween(data.gigs, monthFrom, monthTo, now);
    const billTotal = job && paydays.length ? upcomingPaychecks(job, bills, data.jobs, monthFrom, paydays.length).reduce((t, c) => t + c.billTotal, 0) : 0;
    const saving = setAsideBetween(monthPlan, monthFrom, monthTo);
    const spent = spentBetween(txs, monthFrom, monthTo, counts);
    const pay = checks + gig;
    return { paydays: paydays.length, pay, bills: billTotal, saving, spent, ...monthSplit({ pay, bills: billTotal, saving, spent }) };
  }, [job, monthFrom, monthTo, data, now, bills, monthPlan, txs, counts]);

  // ---- Averages for suggestions --------------------------------------------
  const takeHome = monthlyTakeHome(jobs);
  const billsMonthly = monthlyBills(bills);
  const savingsMonthly = monthlySavings(savings, jobs);
  const food = foodPlan(takeHome, billsMonthly, savingsMonthly, settings.foodWeekly);
  const firstSpend = useMemo(() => txs.filter(counts).reduce<LocalDate | null>((m, t) => (!m || t.date < m ? t.date : m), null), [txs, counts]);
  const tracked = firstSpend ? diffDays(firstSpend, today) + 1 : 0;
  const recent = useMemo(() => {
    const from = addDays(today, -29);
    let all = 0;
    let foodSpent = 0;
    for (const tx of txs) {
      // Bills are counted on their own, so their payments don't count as your usual spending.
      if (tx.date < from || tx.date > today || !counts(tx) || tx.billId) continue;
      all += tx.amount;
      if (isFoodCategory(cats[catOf(tx.categoryId)])) foodSpent += tx.amount;
    }
    return { all, food: foodSpent };
  }, [txs, today, counts, cats, catOf]);
  const enough = tracked >= ENOUGH_HISTORY_DAYS;
  const span = Math.min(30, tracked);
  const spendingMonthly = enough ? (recent.all / span) * (365 / 12) : undefined;
  const foodWeeklyLately = enough ? (recent.food / span) * 7 : undefined;
  const idea = saveIdea({
    takeHomeMonthly: takeHome,
    billsMonthly,
    savingsMonthly,
    foodMonthly: (food.weekly * 52) / 12,
    spendingMonthly,
    checksPerYear: job ? CHECKS_PER_YEAR[job.frequency] : 0,
  });

  // ---- Food this week ------------------------------------------------------
  const weekFrom = startOfWeek(today, settings.weekStartsOn);
  const foodThisWeek = useMemo(
    () => txs.filter((tx) => tx.date >= weekFrom && tx.date <= today && counts(tx) && isFoodCategory(cats[catOf(tx.categoryId)])).reduce((t, tx) => t + tx.amount, 0),
    [txs, weekFrom, today, counts, cats, catOf],
  );
  const [editingFood, setEditingFood] = useState(false);
  const [foodDraft, setFoodDraft] = useState('');
  const saveFood = (v: number | undefined) => {
    put('settings', { ...settings, foodWeekly: v });
    setEditingFood(false);
    toast({ title: v ? `Food budget set to ${money(v)} a week` : 'Using the suggested food budget' });
  };

  // ---- Earning vs spending, day by day --------------------------------------
  const pace = useMemo(() => {
    const segs = buildSegments(data, monthFrom, monthTo, now);
    const spentByDay = new Map<LocalDate, number>();
    for (const tx of txs) if (tx.date >= monthFrom && tx.date <= monthTo && counts(tx)) spentByDay.set(tx.date, (spentByDay.get(tx.date) ?? 0) + tx.amount);
    const earned: number[] = [];
    const out: number[] = [];
    for (const d of monthDays) {
      const t = tally(segs, dayStart(d), dayStart(addDays(d, 1)), now);
      earned.push(t.value + (d > today ? t.projected : 0));
      out.push((spentByDay.get(d) ?? 0) + (monthPlan.byDay.get(d) ?? 0));
    }
    const todayIndex = monthDays.indexOf(today);
    const earnedC = cumulative(earned);
    const outC = cumulative(out);
    const spentSoFar = [...spentByDay].filter(([d]) => d <= today).reduce((t, [, v]) => t + v, 0);
    const daysSoFar = todayIndex + 1;
    const daysLeft = monthDays.length - daysSoFar;
    const ahead = earnedC[todayIndex] - outC[todayIndex];
    // At this pace: keep spending like you have this month, on top of what's scheduled and planned.
    const end = earnedC[earnedC.length - 1] - outC[outC.length - 1] - (daysSoFar > 0 ? (spentSoFar / daysSoFar) * daysLeft : 0);
    return { earnedC, outC, todayIndex, ahead, end, spentByDay };
  }, [data, monthFrom, monthTo, now, txs, counts, monthDays, monthPlan, today]);

  // ---- Where the money went this month -------------------------------------
  const where = useMemo(() => {
    const byCat = new Map<string, number>();
    const byPlace = new Map<string, { name: string; total: number; visits: number }>();
    for (const tx of txs) {
      if (tx.date < monthFrom || tx.date > monthTo || !counts(tx) || tx.amount <= 0) continue;
      const c = catOf(tx.categoryId);
      byCat.set(c, (byCat.get(c) ?? 0) + tx.amount);
      const key = tx.merchant.trim().toLowerCase() || '(no name)';
      const p = byPlace.get(key) ?? { name: tx.merchant.trim() || 'No name', total: 0, visits: 0 };
      p.total += tx.amount;
      p.visits += 1;
      byPlace.set(key, p);
    }
    const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
    const top = cats.slice(0, 6);
    const rest = cats.slice(6).reduce((t, [, v]) => t + v, 0);
    const total = cats.reduce((t, [, v]) => t + v, 0);
    return { top, rest, total, places: [...byPlace.values()].sort((a, b) => b.total - a.total).slice(0, 5) };
  }, [txs, monthFrom, monthTo, counts, catOf]);

  const [pickedDay, setPickedDay] = useState<LocalDate | null>(null);
  const pickedTxs = pickedDay ? txs.filter((tx) => tx.date === pickedDay && counts(tx)) : [];

  const split = [
    { key: 'bills', name: 'Bills', value: month.bills, color: SPLIT_COLORS.bills },
    { key: 'saving', name: 'Savings', value: month.saving, color: SPLIT_COLORS.saving },
    { key: 'spent', name: 'Spent so far', value: month.spent, color: SPLIT_COLORS.spent },
    { key: 'free', name: 'Still free', value: month.free, color: SPLIT_COLORS.free },
  ].filter((s) => s.key === 'bills' || s.key === 'free' || s.value > 0.005);
  const pct = (v: number) => (month.pay > 0 ? `${Math.round((v / month.pay) * 100)}%` : '');
  const foodLeft = food.weekly - foodThisWeek;

  return (
    <div>
      <header className="py-2">
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Insights</h1>
      </header>
      <p className="mt-1 text-[15px] text-ink-2">The big picture: what you have, where it goes, and what you can put away.</p>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {stretch && <LeftoverCard stretch={stretch} now={now} />}
        {stretch && (
          <Card className="p-5">
            <CardTitle icon={<CalendarDays size={17} />} aside={`${dayLabel(stretch.nextPayday)}, ${daysUntil(stretch.nextPayday, today)}`}>
              Until payday
            </CardTitle>
            <p className={clsx('num mt-3 text-[40px] leading-none font-bold tracking-tight', stretch.free >= 0 ? 'text-money' : 'text-spend')}>{money(stretch.free)}</p>
            <p className="num mt-2 text-[15px] text-ink-2">
              {stretch.free >= 0 ? (
                <>
                  About <span className="font-semibold text-ink">{money(stretch.perDay)} a day</span> for {stretch.daysLeft} {stretch.daysLeft === 1 ? 'day' : 'days'}
                </>
              ) : stretch.fromBank ? (
                'Checking doesn’t cover what’s still to come out. Go easy until payday.'
              ) : (
                'More than this check had. Go easy until payday.'
              )}
            </p>
            {stretch.fromBank ? (
              <Meter value={stretch.fromBank.balance - stretch.free} of={Math.max(1, stretch.fromBank.balance)} over={stretch.free < 0} />
            ) : (
              <Meter value={Math.max(0, stretch.spent - stretch.gig - stretch.carry)} of={Math.max(1, stretch.start)} over={stretch.free < 0} />
            )}
            {stretch.carry < -0.005 && (
              <p className="num mt-3 rounded-2xl bg-raised px-3.5 py-2.5 text-[13px] text-ink-2">
                Last paycheck ran {money(-stretch.carry)} short, so it comes out of this one. That's about{' '}
                <span className="font-semibold text-ink">{money(-stretch.carry / stretch.daysLeft)} a day less</span> until payday.
              </p>
            )}
            <div className="mt-4 space-y-1.5 border-t border-line pt-3">
              {stretch.fromBank ? (
                <>
                  <Line label={`In checking, as of ${asOf(stretch.fromBank.asOf, today)}`} value={money(stretch.fromBank.balance)} />
                  {stretch.fromBank.unpaid.map((b, i) => (
                    <Line key={i} label={`${b.name}, not paid yet`} value={minus(b.amount)} />
                  ))}
                </>
              ) : (
                <>
                  <Line label={`Paycheck ${dayLabel(stretch.lastPayday)}`} value={money(stretch.check)} />
                  <Line label="Bills paid from it" value={minus(stretch.bills)} />
                </>
              )}
              {stretch.saving > 0.005 && <Line label="Savings and wish list" value={minus(stretch.saving)} />}
              {!stretch.fromBank && (
                <>
                  {stretch.carry < -0.005 && <Line label="Short from last paycheck" value={minus(-stretch.carry)} />}
                  {stretch.gig > 0.005 && <Line label="Gig pay since then" value={signed(stretch.gig)} />}
                  <Line label="Spent since then" value={minus(stretch.spent)} />
                </>
              )}
              <Line label="Free until payday" value={money(stretch.free)} strong />
            </div>
          </Card>
        )}

        {job && (
          <Card className="p-5">
            <CardTitle icon={<ChartPie size={17} />} aside={`${month.paydays} ${month.paydays === 1 ? 'paycheck' : 'paychecks'} · ${money(month.pay)}`}>
              Where {monthName}’s pay goes
            </CardTitle>
            <div className="mt-4 grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
              <Donut
                segments={split}
                format={money}
                size={168}
                ariaLabel={`Where ${monthName}'s pay goes`}
                center={
                  month.over > 0.005 ? (
                    <div>
                      <p className="text-[12px] text-ink-2">Over by</p>
                      <p className="num text-[20px] font-bold tracking-tight text-spend">{money(month.over)}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[12px] text-ink-2">Still free</p>
                      <p className="num text-[20px] font-bold tracking-tight">{money(month.free)}</p>
                    </div>
                  )
                }
              />
              <div className="space-y-2">
                {split.map((s) => (
                  <Line key={s.key} label={`${s.name} · ${pct(s.value)}`} value={money(s.value)} swatch={s.color} />
                ))}
                <p className="pt-1 text-[13px] text-ink-2">
                  {month.pay > 0 && `Bills take ${pct(month.bills)} of your pay this month.`}
                  {month.paydays > 2 && ' You get an extra paycheck this month.'}
                </p>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-5">
          <CardTitle
            icon={<Utensils size={17} />}
            aside={
              !editingFood && (
                <button
                  className="font-medium text-ink-2 hover:text-ink"
                  onClick={() => {
                    setFoodDraft(String(food.weekly));
                    setEditingFood(true);
                  }}
                >
                  Change
                </button>
              )
            }
          >
            Food this week
          </CardTitle>
          {editingFood ? (
            <div className="mt-3">
              <span className="label">Your weekly food budget</span>
              <MoneyInput value={foodDraft} onChange={setFoodDraft} placeholder="135" ariaLabel="Weekly food budget" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-sm btn-primary" onClick={() => parseMoney(foodDraft) > 0 && saveFood(parseMoney(foodDraft))}>
                  Save
                </button>
                {food.mine && (
                  <button className="btn btn-sm btn-secondary" onClick={() => saveFood(undefined)}>
                    Use the suggestion
                  </button>
                )}
                <button className="btn btn-sm btn-secondary" onClick={() => setEditingFood(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className={clsx('num mt-3 text-[32px] leading-none font-bold tracking-tight', foodLeft < 0 && 'text-spend')}>
                {foodLeft >= 0 ? `${money(foodLeft)} left` : `${money(-foodLeft)} over`}
              </p>
              <Meter value={foodThisWeek} of={food.weekly} over={foodLeft < 0} />
              <p className="num mt-2 text-[14px] text-ink-2">
                {money(foodThisWeek)} of {money(food.weekly)} on groceries and eating out
              </p>
              <p className="mt-3 text-[13px] text-ink-2">
                {food.mine
                  ? `Your budget: ${money(food.weekly)} a week, about ${money(food.weekly / 7)} a day.`
                  : `Suggested: about ${money(food.weekly)} a week (${money(food.weekly / 7)} a day). That's around ${Math.round(FOOD_SHARE * 100)}% of your take-home, which leaves room for gas, fun, and savings.`}
                {foodWeeklyLately != null && ` Lately you've spent about ${money(foodWeeklyLately)} a week.`}
              </p>
            </>
          )}
        </Card>

        <Card className="p-5">
          <CardTitle icon={<PiggyBank size={17} />}>Put money away</CardTitle>
          {idea ? (
            <>
              <p className="num mt-3 text-[32px] leading-none font-bold tracking-tight">
                {money(idea.monthly)}
                <span className="text-[16px] font-semibold text-ink-2"> a month</span>
              </p>
              <p className="num mt-2 text-[14px] text-ink-2">That's {money(idea.perCheck)} from each paycheck.</p>
              <p className="mt-3 text-[13px] text-ink-2">
                {idea.basis === 'spending'
                  ? 'Half of what’s usually left after bills and spending, so you still have room to breathe.'
                  : 'About 10% of your take-home, and it fits after bills and food. Once you’ve tracked a few weeks of spending, this follows your real numbers.'}
                {savingsMonthly > 0.005 && ` That's on top of the ${money(savingsMonthly)} a month you already save.`}
              </p>
              <button className="btn btn-primary mt-4 w-full" onClick={() => openSheet({ kind: 'saving', amount: idea.perCheck })}>
                Save {money(idea.perCheck)} every paycheck
              </button>
            </>
          ) : (
            <p className="mt-3 text-[14px] text-ink-2">
              {takeHome > 0
                ? 'Right now bills and spending use up your pay, so there’s nothing extra to put away yet. Trimming food or fun a little is the easiest place to start.'
                : 'Add your job and its paycheck, and this suggests how much you can save.'}
            </p>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
          <CardTitle icon={<TrendingUp size={17} />} aside={monthName}>
            Earning vs. spending
          </CardTitle>
          <p className="num mt-3 text-[15px]">
            {pace.ahead >= 0 ? (
              <>
                You're <span className="font-semibold text-money">{money(pace.ahead)} ahead</span> so far.
              </>
            ) : (
              <>
                Spending is <span className="font-semibold text-spend">{money(-pace.ahead)} ahead</span> of earning so far.
              </>
            )}{' '}
            <span className="text-ink-2">
              At this pace you'll end {monthName} about {pace.end >= 0 ? `${money(pace.end)} ahead` : `${money(-pace.end)} behind`}.
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-4 rounded-full" style={{ background: BUDGET_COLORS.left }} /> Earned
            </span>
            <span className="flex items-center gap-2">
              <span className="h-0.5 w-4 rounded-full" style={{ background: BUDGET_COLORS.spent }} /> Spent and set aside
            </span>
            <span className="text-ink-3">Dashed = still to come</span>
          </div>
          <div className="mt-4">
            <LineChart
              ariaLabel={`Earning and spending through ${monthName}`}
              series={[
                { key: 'earned', name: 'Earned', color: BUDGET_COLORS.left, values: pace.earnedC },
                { key: 'out', name: 'Spent and set aside', color: BUDGET_COLORS.spent, values: pace.outC },
              ]}
              labels={monthDays.map((d) => String(Number(d.slice(8))))}
              titles={monthDays.map((d) => dayLabel(d))}
              actualUntil={pace.todayIndex}
              labelEvery={5}
              format={money}
            />
          </div>
        </Card>

        <Card className="p-5">
          <CardTitle icon={<Store size={17} />} aside={monthName}>
            Where you spend
          </CardTitle>
          {where.total <= 0.005 ? (
            <p className="mt-3 text-[14px] text-ink-2">Nothing spent yet this month. Spending shows up here as you add it or your bank sends it.</p>
          ) : (
            <>
              <div className="mt-3 space-y-3">
                {[...where.top, ...(where.rest > 0.005 ? [['__rest', where.rest] as [string, number]] : [])].map(([id, v]) => {
                  const cat = cats[id];
                  const Icon = categoryIcon(id === '__rest' ? 'other' : cat?.icon);
                  return (
                    <div key={id}>
                      <div className="flex items-center justify-between gap-2 text-[14px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon size={16} className="shrink-0 text-ink-2" />
                          <span className="truncate font-medium">{id === '__rest' ? 'Everything else' : (cat?.name ?? 'Other')}</span>
                        </span>
                        <span className="num shrink-0">
                          <span className="font-semibold">{money(v)}</span>
                          <span className="text-ink-3"> · {Math.round((v / where.total) * 100)}%</span>
                        </span>
                      </div>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-raised">
                        <span className="block h-full rounded-full bg-[var(--s8)]" style={{ width: `${Math.min(100, (v / where.top[0][1]) * 100)}%` }} />
                      </span>
                    </div>
                  );
                })}
              </div>
              <h3 className="mt-5 text-[13px] font-semibold text-ink-2">Top places</h3>
              <div className="mt-2 space-y-1.5">
                {where.places.map((p) => (
                  <Line key={p.name} label={`${p.name}${p.visits > 1 ? ` · ${p.visits} times` : ''}`} value={money(p.total)} />
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="p-5">
          <CardTitle icon={<CalendarDays size={17} />} aside={monthName}>
            Your month at a glance
          </CardTitle>
          <p className="mt-1 text-[13px] text-ink-2">Darker days are bigger spending days. Tap one to see it.</p>
          <div className="mt-4">
            <MonthHeatmap
              month={today}
              values={pace.spentByDay}
              today={today}
              weekStartsOn={settings.weekStartsOn}
              selected={pickedDay}
              onSelect={setPickedDay}
              format={money}
            />
          </div>
          {pickedDay && (
            <div className="mt-4 border-t border-line pt-3">
              <Line label={dayLabel(pickedDay)} value={money(pace.spentByDay.get(pickedDay) ?? 0)} strong />
              <p className="mt-1 text-[13px] text-ink-2">
                {pickedTxs.length ? [...new Set(pickedTxs.map((t) => t.merchant || 'No name'))].join(', ') : 'Nothing spent. Nice.'}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
