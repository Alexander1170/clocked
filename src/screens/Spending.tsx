import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, CircleAlert, CopyCheck, Landmark, PiggyBank, Plus, Receipt, RefreshCw, Store } from 'lucide-react';
import type { LocalDate, Transaction } from '../../shared/types.ts';
import { buildSegments, tally } from '../../shared/accrual.ts';
import type { SetAsideKind } from '../../shared/plan.ts';
import { toLocalDate } from '../../shared/dates.ts';
import { useBillMap, useCategories, useCategoryMap, useCategoryOf, useCoverage, useEngineData, useNow, useSetAsidePlan, useSettings, useSpendCheck, useTransactions } from '../lib/hooks.ts';
import { bucketIndexAt, bucketsFor, periodBounds, periodTitle, shiftAnchor, type Range } from '../lib/periods.ts';
import { categoryIcon } from '../lib/categories.ts';
import { clock, dayLabel, minus, money, relativeDay, signed } from '../lib/format.ts';
import { findDuplicates, isShown, notCountedReason, setAsideInSpans, spentInSpans } from '../lib/money.ts';
import { bankApi, useBank } from '../lib/bank.ts';
import { go, openSheet, toast } from '../lib/ui.ts';
import { BarChart, type BarDatum } from '../components/BarChart.tsx';
import { BUDGET_COLORS, NetChart, type BudgetDay } from '../components/NetChart.tsx';
import { Card, Chip, EmptyState, Segmented, SectionTitle } from '../components/ui.tsx';

type ChartMode = 'left' | 'spent';

const RANGES: Array<{ value: Range; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

/** What one bar covers in each range. */
const UNIT: Record<Range, string> = { day: 'hour', week: 'day', month: 'day', year: 'month' };

const KINDS: Array<[SetAsideKind, string]> = [
  ['bills', 'Bills'],
  ['savings', 'Savings'],
  ['goals', 'Wish list'],
];

function TxRow({ tx }: { tx: Transaction }) {
  const cats = useCategoryMap();
  const bills = useBillMap();
  const cover = useCoverage();
  const cat = cats[tx.categoryId];
  const Icon = categoryIcon(cat?.icon);
  const reason = notCountedReason(tx, cover);
  const bill = tx.billId ? bills[tx.billId] : undefined;
  const sub =
    reason ??
    [cat?.name ?? 'Other', bill && !bill.deleted ? `${bill.name} payment${tx.billPart ? ' (part)' : ''}` : null, tx.at ? clock(tx.at) : null, tx.pending ? 'Pending' : null]
      .filter(Boolean)
      .join(' · ');
  return (
    <button onClick={() => openSheet({ kind: 'expense', id: tx.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-ink-2">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{tx.merchant || cat?.name || 'Expense'}</span>
        <span className="block truncate text-[13px] text-ink-2">{sub}</span>
      </span>
      <span className={clsx('num shrink-0 text-[15px] font-semibold', reason ? 'text-ink-3' : tx.amount < 0 && 'text-money')}>
        {tx.amount < 0 ? signed(-tx.amount) : minus(tx.amount)}
      </span>
    </button>
  );
}

function BankStrip() {
  const { status, load, set } = useBank();
  const [busy, setBusy] = useState(false);
  useEffect(() => void load(), [load]);
  if (!status) return null;
  const items = status.items;
  if (!items.length) {
    return (
      <button onClick={() => go('bank')} className="flex w-full items-center gap-3 rounded-3xl border border-dashed border-line p-4 text-left transition-colors hover:bg-hover">
        <Landmark size={18} className="shrink-0 text-ink-2" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Connect your bank</span>
          <span className="block text-[13px] text-ink-2">Bring in your debit card purchases automatically.</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-3" />
      </button>
    );
  }
  const problem = items.find((i) => i.status !== 'ok');
  const last = Math.max(...items.map((i) => i.syncedAt ?? 0));
  const mins = last ? Math.round((Date.now() - last) / 60_000) : null;
  return (
    <div className={clsx('flex items-center gap-3 rounded-3xl border p-4', problem ? 'border-spend/40 bg-spend/5' : 'border-line')}>
      {problem ? <CircleAlert size={18} className="shrink-0 text-spend" /> : <Landmark size={18} className="shrink-0 text-ink-2" />}
      <button className="min-w-0 flex-1 text-left" onClick={() => go('bank')}>
        <span className="block truncate text-[15px] font-semibold">{items.map((i) => i.institution).join(', ')}</span>
        <span className="block truncate text-[13px] text-ink-2">
          {problem ? problem.error : mins == null ? 'Waiting for the first update' : mins < 1 ? 'Updated just now' : mins < 60 ? `Updated ${mins} min ago` : `Updated ${Math.round(mins / 60)} hr ago`}
        </span>
      </button>
      <button
        className="btn btn-sm btn-secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            set(await bankApi.refresh());
            toast({ title: 'Asked the bank for new transactions', detail: 'They usually show up within a minute or two.' });
          } catch (e) {
            toast({ title: 'Couldn’t refresh', detail: e instanceof Error ? e.message : String(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={15} className={clsx(busy && 'animate-spin')} /> Refresh
      </button>
    </div>
  );
}

export function Spending() {
  const now = useNow(30_000);
  const today = toLocalDate(now);
  const { weekStartsOn, trackFrom } = useSettings();
  const txs = useTransactions();
  const doubled = useMemo(() => findDuplicates(txs, trackFrom).length, [txs, trackFrom]);
  const cats = useCategories();
  const catOf = useCategoryOf();
  const data = useEngineData();
  const counts = useSpendCheck();
  const [range, setRange] = useState<Range>('week');
  const [mode, setMode] = useState<ChartMode>('left');
  const [anchor, setAnchor] = useState<LocalDate>(today);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ key: string; i: number | null } | null>(null);

  const { from, to } = periodBounds(range, anchor, weekStartsOn);
  const plan = useSetAsidePlan(from, to);
  const buckets = useMemo(() => bucketsFor(range, anchor, weekStartsOn), [range, anchor, weekStartsOn]);
  const nowIndex = bucketIndexAt(buckets, now);
  const isCurrent = nowIndex >= 0;
  const windowKey = `${range}|${anchor}|${weekStartsOn}`;
  const sel = picked?.key === windowKey ? picked.i : isCurrent ? nowIndex : null;
  const select = (i: number) => setPicked({ key: windowKey, i: sel === i ? null : i });
  const unit = UNIT[range];

  const segs = useMemo(() => buildSegments(data, from, to, now), [data, from, to, now]);
  const earnedIn = useMemo(() => buckets.map((b) => tally(segs, b.start, b.end, now)), [buckets, segs, now]);
  // "Left" is about all your money, so the category filter only narrows the Spent view.
  const spendCounts = useCallback(
    (tx: Transaction) => counts(tx) && (mode === 'left' || !catFilter || catOf(tx.categoryId) === catFilter),
    [counts, mode, catFilter, catOf],
  );
  const spentIn = useMemo(() => spentInSpans(txs, buckets, range === 'day', spendCounts), [txs, buckets, range, spendCounts]);
  const asideIn = useMemo(
    () => setAsideInSpans(plan, buckets, today, range === 'day' ? earnedIn.map((e) => e.value + e.projected) : undefined),
    [plan, buckets, today, range, earnedIn],
  );

  const spent = spentIn.values.reduce((t, v) => t + v, 0) + spentIn.untimed;
  const earned = earnedIn.reduce((t, e) => t + e.value, 0);
  const stillScheduled = earnedIn.reduce((t, e) => t + e.projected, 0);
  let asideSoFar = 0;
  let asideTotal = 0;
  for (const [d, v] of plan.byDay) {
    if (d < from || d > to) continue;
    asideTotal += v;
    if (d <= today) asideSoFar += v;
  }
  const left = earned - spent - asideSoFar;
  const onTrack = earned + stillScheduled - spent - asideTotal;
  const unfinished = stillScheduled > 0.005 || asideTotal - asideSoFar > 0.005;

  const spentChart: BarDatum[] = buckets.map((b, i) => {
    const future = b.start > now;
    const aside = asideIn[i].total;
    return {
      key: b.key,
      label: b.label,
      title: b.title,
      current: i === nowIndex,
      parts: [
        { id: 'spent', name: 'Spent', color: BUDGET_COLORS.spent, value: Math.max(0, spentIn.values[i]) },
        { id: 'aside', name: 'Set aside', color: BUDGET_COLORS.setAside, value: future ? 0 : aside, projected: future ? aside : 0 },
      ],
    };
  });
  const leftChart: BudgetDay[] = buckets.map((b, i) => {
    const future = b.start > now;
    const aside = asideIn[i];
    return {
      key: b.key,
      label: b.label,
      title: b.title,
      current: i === nowIndex,
      projected: future,
      earned: earnedIn[i].value + (future ? earnedIn[i].projected : 0),
      setAside: aside.total,
      setAsideParts: KINDS.map(([k, name]) => ({ name, value: aside.kinds[k] })).filter((p) => p.value > 0.005),
      spent: spentIn.values[i],
    };
  });

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const tx of txs) if (tx.date >= from && tx.date <= to && counts(tx)) m.set(catOf(tx.categoryId), (m.get(catOf(tx.categoryId)) ?? 0) + tx.amount);
    return [...m.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  }, [txs, from, to, counts, catOf]);
  const catTotal = byCat.reduce((t, [, v]) => t + v, 0);

  // The Day view always lists the whole day. The others narrow to the picked bar.
  const listBucket = range === 'day' || sel == null ? undefined : buckets[sel];
  const listFrom = listBucket ? toLocalDate(listBucket.start) : from;
  const listTo = listBucket ? toLocalDate(listBucket.end - 1) : to;
  const oneDay = listFrom === listTo ? listFrom : undefined;
  const counted = (tx: Transaction) => counts(tx) && (!catFilter || catOf(tx.categoryId) === catFilter);
  const listed = txs
    .filter((tx) => isShown(tx, trackFrom) && tx.date >= listFrom && tx.date <= listTo && (!catFilter || catOf(tx.categoryId) === catFilter))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
  const groups = new Map<LocalDate, Transaction[]>();
  for (const tx of listed) groups.set(tx.date, [...(groups.get(tx.date) ?? []), tx]);
  const dayHeading = (d: LocalDate) => (relativeDay(d, today) === dayLabel(d) ? dayLabel(d) : `${relativeDay(d, today)} · ${dayLabel(d)}`);
  const listTitle = oneDay ? dayHeading(oneDay) : listBucket ? listBucket.title : 'Transactions';
  const newExpenseDate = oneDay ?? today;

  const selBar = sel != null ? leftChart[sel] : undefined;
  const selLeft = selBar ? selBar.earned - selBar.setAside - selBar.spent : 0;
  let heading = 'Left';
  if (mode === 'spent') heading = catFilter ? (cats.find((c) => c.id === catFilter)?.name ?? 'Spent') : 'Spent';
  else if (range === 'day' && anchor === today) heading = 'Left today';
  else if (range !== 'day' && isCurrent) heading = 'Left so far';
  const legend: Array<[string, string]> =
    mode === 'left'
      ? [
          ['Set aside', BUDGET_COLORS.setAside],
          ['Spent', BUDGET_COLORS.spent],
          ['Left', BUDGET_COLORS.left],
        ]
      : [
          ['Spent', BUDGET_COLORS.spent],
          ['Set aside', BUDGET_COLORS.setAside],
        ];
  const labelEvery = range === 'day' ? 3 : range === 'month' ? 5 : 1;

  return (
    <div>
      <header className="flex items-center justify-between gap-2 py-2">
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Spending</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm btn-secondary lg:hidden" onClick={() => go('plan')}>
            <PiggyBank size={16} /> Plan
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => openSheet({ kind: 'expense', date: newExpenseDate })}>
            <Plus size={16} /> Expense
          </button>
        </div>
      </header>

      <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented<Range> label="Time range" value={range} options={RANGES} onChange={setRange} className="lg:w-96" />
        <div className="flex items-center justify-between gap-2">
          <button aria-label="Previous" onClick={() => setAnchor(shiftAnchor(range, anchor, -1))} className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
            <ChevronLeft size={20} />
          </button>
          <span className="min-w-40 text-center text-[15px] font-semibold">{periodTitle(range, anchor, weekStartsOn)}</span>
          <button aria-label="Next" onClick={() => setAnchor(shiftAnchor(range, anchor, 1))} className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
            <ChevronRight size={20} />
          </button>
          {!isCurrent && (
            <button className="btn btn-sm btn-secondary" onClick={() => setAnchor(today)}>
              Now
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-[15px] font-medium text-ink-2">{heading}</p>
              <Segmented<ChartMode>
                label="Chart"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'left', label: 'Left' },
                  { value: 'spent', label: 'Spent' },
                ]}
                className="w-36 shrink-0"
              />
            </div>
            <p className={clsx('num mt-1 text-[44px] leading-none font-bold tracking-tight', mode === 'left' && (left >= 0 ? 'text-money' : 'text-spend'))}>
              {mode === 'left' ? signed(left) : money(spent)}
            </p>
            <p className="num mt-2.5 text-[14px] text-ink-2">
              Earned {money(earned)} · spent {money(spent)} · set aside {money(mode === 'left' ? asideSoFar : asideTotal)}
            </p>
            {mode === 'left' && unfinished && (
              <p className="num mt-1 text-[14px] text-ink-2">
                On track for <span className="font-semibold text-ink">{signed(onTrack)}</span> by the end of the {range}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
              {legend.map(([name, color]) => (
                <span key={name} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[3px]" style={{ background: color }} /> {name}
                </span>
              ))}
              {mode === 'left' && <span className="text-ink-3">Full bar = {unit}'s pay</span>}
            </div>
            <div className="mt-6">
              {mode === 'left' ? (
                <NetChart ariaLabel={`Each ${unit}'s pay, split into set aside, spent, and left`} data={leftChart} selected={sel} onSelect={select} labelEvery={labelEvery} />
              ) : (
                <BarChart ariaLabel={`Spending and set-asides by ${unit}`} data={spentChart} selected={sel} onSelect={select} format={money} labelEvery={labelEvery} />
              )}
            </div>
            {range === 'day' && Math.abs(spentIn.untimed) > 0.005 && (
              <p className="num mt-3 text-[12px] text-ink-3">{money(spentIn.untimed)} spent without a time of day isn't in the hourly bars.</p>
            )}
            {selBar && (
              <div className="mt-5 border-t border-line pt-4">
                <p className="mb-3 text-center text-[13px] font-semibold">
                  {selBar.title}
                  {sel === nowIndex && range !== 'day' && <span className="font-normal text-ink-2"> · so far</span>}
                </p>
                <div className="num grid grid-cols-4 gap-2 text-center text-[13px]">
                  <div>
                    <p className="text-ink-2">{selBar.projected ? 'Scheduled' : 'Earned'}</p>
                    <p className="font-semibold">{money(selBar.earned)}</p>
                  </div>
                  <div>
                    <p className="text-ink-2">Set aside</p>
                    <p className="font-semibold">{money(selBar.setAside)}</p>
                  </div>
                  <div>
                    <p className="text-ink-2">Spent</p>
                    <p className="font-semibold">{money(selBar.spent)}</p>
                  </div>
                  <div>
                    <p className="text-ink-2">Left</p>
                    <p className={clsx('font-semibold', selLeft >= 0 ? 'text-money' : 'text-spend')}>{signed(selLeft)}</p>
                  </div>
                </div>
                {!!selBar.setAsideParts?.length && (
                  <p className="num mt-3 text-center text-[12px] text-ink-3">{selBar.setAsideParts.map((p) => `${p.name} ${money(p.value)}`).join(' · ')}</p>
                )}
              </div>
            )}
          </Card>

          <SectionTitle
            action={
              listBucket ? (
                <button className="text-[14px] font-medium text-ink-2 hover:text-ink" onClick={() => setPicked({ key: windowKey, i: null })}>
                  Show the whole {range}
                </button>
              ) : undefined
            }
          >
            {listTitle}
          </SectionTitle>
          {doubled > 0 && (
            <button onClick={() => go('review')} className="mb-3 flex w-full items-center gap-3 rounded-3xl border border-line p-4 text-left transition-colors hover:bg-hover">
              <CopyCheck size={18} className="shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1 text-[14px]">
                {doubled === 1 ? 'One purchase looks like it’s in here twice' : `${doubled} purchases look like they’re in here twice`}: once from the bank, once added by hand.
              </span>
              <span className="shrink-0 text-[14px] font-semibold">Review</span>
            </button>
          )}
          <Card className="overflow-hidden">
            {listed.length === 0 ? (
              <EmptyState
                icon={<Receipt size={24} />}
                title={oneDay ? 'Nothing spent' : 'No spending yet'}
                body="Add what you spend, or connect your bank, so each day shows what's left."
                action={
                  <button className="btn btn-primary" onClick={() => openSheet({ kind: 'expense', date: newExpenseDate })}>
                    <Plus size={18} /> Add expense
                  </button>
                }
              />
            ) : (
              [...groups.entries()].map(([date, list]) => (
                <div key={date}>
                  {!oneDay && (
                    <p className="flex justify-between bg-raised/60 px-4 py-2 text-[13px] font-semibold text-ink-2">
                      <span>{dayHeading(date)}</span>
                      <span className="num">{minus(list.filter(counted).reduce((t, tx) => t + tx.amount, 0))}</span>
                    </p>
                  )}
                  <div className="divide-y divide-line">
                    {list.map((tx) => (
                      <TxRow key={tx.id} tx={tx} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>

        <div>
          <div className="mt-8 lg:mt-0">
            <BankStrip />
          </div>
          <button onClick={() => go('review')} className="mt-3 flex w-full items-center gap-3 rounded-3xl border border-line p-4 text-left transition-colors hover:bg-hover">
            <Store size={18} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Bank transactions</span>
              <span className="block text-[13px] text-ink-2">Rename, hide, or tie them to bills</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-ink-3" />
          </button>
          <SectionTitle>By category</SectionTitle>
          <Card className="p-2">
            {byCat.length === 0 ? (
              <p className="px-3 py-4 text-[14px] text-ink-2">Categories fill in as you spend.</p>
            ) : (
              byCat.map(([id, v]) => {
                const cat = cats.find((c) => c.id === id);
                const Icon = categoryIcon(cat?.icon);
                const on = catFilter === id;
                return (
                  <button
                    key={id}
                    onClick={() => setCatFilter(on ? null : id)}
                    aria-pressed={on}
                    className={clsx('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors', on ? 'bg-raised' : 'hover:bg-hover')}
                  >
                    <Icon size={18} className="shrink-0 text-ink-2" />
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2 text-[14px]">
                        <span className="truncate font-medium">{cat?.name ?? 'Other'}</span>
                        <span className="num font-semibold">{money(v)}</span>
                      </span>
                      <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-raised">
                        <span className="block h-full rounded-full bg-[var(--s8)]" style={{ width: `${(v / catTotal) * 100}%` }} />
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </Card>
          {catFilter && (
            <div className="mt-3">
              <Chip on onClick={() => setCatFilter(null)}>
                Clear category filter
              </Chip>
            </div>
          )}
          <button onClick={() => go('plan')} className="mt-3 hidden w-full items-center gap-3 rounded-3xl border border-line p-4 text-left transition-colors hover:bg-hover lg:flex">
            <PiggyBank size={18} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Bills, savings, and wish list</span>
              <span className="block text-[13px] text-ink-2">
                {money(asideTotal)} set aside for {periodTitle(range, anchor, weekStartsOn)}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-ink-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
