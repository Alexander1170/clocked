import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, CircleAlert, Landmark, PiggyBank, Plus, Receipt, RefreshCw } from 'lucide-react';
import type { LocalDate, Transaction } from '../../shared/types.ts';
import { buildSegments, tally } from '../../shared/accrual.ts';
import { toLocalDate } from '../../shared/dates.ts';
import { useBillMap, useCategories, useCategoryMap, useCoverage, useEngineData, useNow, useSetAsidePlan, useSettings, useSpendCheck, useTransactions } from '../lib/hooks.ts';
import { bucketIndexAt, bucketsFor, periodBounds, periodTitle, shiftAnchor } from '../lib/periods.ts';
import { categoryIcon } from '../lib/categories.ts';
import { clock, dayLabel, minus, money, relativeDay, signed } from '../lib/format.ts';
import { notCountedReason, spentByDay } from '../lib/money.ts';
import { bankApi, useBank } from '../lib/bank.ts';
import { go, openSheet, toast } from '../lib/ui.ts';
import { BarChart, type BarDatum } from '../components/BarChart.tsx';
import { NetChart, type NetDatum } from '../components/NetChart.tsx';
import { Card, Chip, EmptyState, Segmented, SectionTitle } from '../components/ui.tsx';

type SpendRange = 'week' | 'month';
type ChartMode = 'left' | 'spent';

function TxRow({ tx }: { tx: Transaction }) {
  const cats = useCategoryMap();
  const bills = useBillMap();
  const cover = useCoverage();
  const cat = cats[tx.categoryId];
  const Icon = categoryIcon(cat?.icon);
  const reason = notCountedReason(tx, cover);
  const bill = tx.billId ? bills[tx.billId] : undefined;
  const sub = reason ?? [cat?.name ?? 'Other', bill && !bill.deleted ? `${bill.name} payment` : null, tx.at ? clock(tx.at) : null, tx.pending ? 'Pending' : null].filter(Boolean).join(' · ');
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
  const { weekStartsOn } = useSettings();
  const txs = useTransactions();
  const cats = useCategories();
  const data = useEngineData();
  const counts = useSpendCheck();
  const [range, setRange] = useState<SpendRange>('week');
  const [mode, setMode] = useState<ChartMode>('left');
  const [anchor, setAnchor] = useState<LocalDate>(today);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ key: string; i: number | null } | null>(null);

  const { from, to } = periodBounds(range, anchor, weekStartsOn);
  const plan = useSetAsidePlan(from, to);
  const buckets = useMemo(() => bucketsFor(range, anchor, weekStartsOn), [range, anchor, weekStartsOn]);
  const nowIndex = bucketIndexAt(buckets, now);
  const windowKey = `${range}|${anchor}|${weekStartsOn}`;
  const sel = picked?.key === windowKey ? picked.i : nowIndex >= 0 ? nowIndex : null;
  const select = (i: number) => setPicked({ key: windowKey, i: sel === i ? null : i });

  const counted = (tx: Transaction) => counts(tx) && (!catFilter || tx.categoryId === catFilter);
  const spentDays = useMemo(() => spentByDay(txs, from, to, (tx) => counts(tx) && (!catFilter || tx.categoryId === catFilter)), [txs, from, to, counts, catFilter]);
  const segs = useMemo(() => buildSegments(data, from, to, now), [data, from, to, now]);
  const earnedDays = useMemo(() => buckets.map((b) => tally(segs, b.start, b.end, now)), [buckets, segs, now]);

  const spent = [...spentDays.values()].reduce((t, v) => t + v, 0);
  let billsSoFar = 0;
  let billsTotal = 0;
  for (const [d, v] of plan.byDay) {
    billsTotal += v;
    if (d <= today) billsSoFar += v;
  }
  const earned = earnedDays.reduce((t, e) => t + e.value, 0);
  const left = earned - spent - billsSoFar;

  const spentChart: BarDatum[] = buckets.map((b, i) => {
    const bill = plan.byDay.get(b.date!) ?? 0;
    const future = b.date! > today;
    return {
      key: b.key,
      label: b.label,
      title: b.title,
      current: i === nowIndex,
      parts: [
        { id: 'spent', name: 'Spent', color: 'var(--s8)', value: Math.max(0, spentDays.get(b.date!) ?? 0) },
        { id: 'bills', name: 'Set aside', color: 'var(--s7)', value: future ? 0 : bill, projected: future ? bill : 0 },
      ],
    };
  });
  const netChart: NetDatum[] = buckets.map((b, i) => {
    const e = earnedDays[i];
    const future = b.date! > today;
    return {
      key: b.key,
      label: b.label,
      title: b.title,
      current: i === nowIndex,
      projected: future,
      value: e.value + (future ? e.projected : 0) - (spentDays.get(b.date!) ?? 0) - (plan.byDay.get(b.date!) ?? 0),
    };
  });

  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const tx of txs) if (tx.date >= from && tx.date <= to && counts(tx)) m.set(tx.categoryId, (m.get(tx.categoryId) ?? 0) + tx.amount);
    return [...m.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  }, [txs, from, to, counts]);
  const catTotal = byCat.reduce((t, [, v]) => t + v, 0);

  const selDate = sel != null ? buckets[sel]?.date : undefined;
  const listed = txs
    .filter((tx) => !tx.accountOff && tx.date >= from && tx.date <= to && (!selDate || tx.date === selDate) && (!catFilter || tx.categoryId === catFilter))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
  const groups = new Map<LocalDate, Transaction[]>();
  for (const tx of listed) groups.set(tx.date, [...(groups.get(tx.date) ?? []), tx]);
  const selBills = selDate ? (plan.byDay.get(selDate) ?? 0) : 0;
  const selEarned = sel != null ? earnedDays[sel].value : 0;
  const selSpent = selDate ? (spentDays.get(selDate) ?? 0) : 0;

  return (
    <div>
      <header className="flex items-center justify-between gap-2 py-2">
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Spending</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm btn-secondary lg:hidden" onClick={() => go('plan')}>
            <PiggyBank size={16} /> Plan
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => openSheet({ kind: 'expense', date: selDate ?? today })}>
            <Plus size={16} /> Expense
          </button>
        </div>
      </header>

      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<SpendRange>
          label="Time range"
          value={range}
          options={[
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
          onChange={setRange}
          className="sm:w-64"
        />
        <div className="flex items-center justify-between gap-2">
          <button aria-label="Previous" onClick={() => setAnchor(shiftAnchor(range, anchor, -1))} className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
            <ChevronLeft size={20} />
          </button>
          <span className="min-w-40 text-center text-[15px] font-semibold">{periodTitle(range, anchor, weekStartsOn)}</span>
          <button aria-label="Next" onClick={() => setAnchor(shiftAnchor(range, anchor, 1))} className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
            <ChevronRight size={20} />
          </button>
          {nowIndex < 0 && (
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
              <p className="min-w-0 truncate text-[15px] font-medium text-ink-2">
                {mode === 'left' ? (nowIndex >= 0 ? 'Left so far' : 'Left') : catFilter ? (cats.find((c) => c.id === catFilter)?.name ?? 'Spent') : 'Spent'}
              </p>
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
              Earned {money(earned)} · spent {money(spent)} · set aside {money(mode === 'left' ? billsSoFar : billsTotal)}
            </p>
            {mode === 'spent' && (
              <div className="mt-3 flex gap-4 text-[13px] text-ink-2">
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[3px] bg-[var(--s8)]" /> Spent
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2.5 rounded-[3px] bg-[var(--s7)]" /> Set aside
                </span>
              </div>
            )}
            <div className="mt-6">
              {mode === 'left' ? (
                <NetChart ariaLabel="Money left each day" data={netChart} selected={sel} onSelect={select} format={signed} labelEvery={range === 'month' ? 5 : 1} />
              ) : (
                <BarChart ariaLabel="Spending and bills by day" data={spentChart} selected={sel} onSelect={select} format={money} labelEvery={range === 'month' ? 5 : 1} />
              )}
            </div>
            {selDate && (
              <div className="num mt-5 grid grid-cols-4 gap-2 border-t border-line pt-4 text-center text-[13px]">
                <div>
                  <p className="text-ink-2">Earned</p>
                  <p className="font-semibold">{money(selEarned)}</p>
                </div>
                <div>
                  <p className="text-ink-2">Spent</p>
                  <p className="font-semibold">{money(selSpent)}</p>
                </div>
                <div>
                  <p className="text-ink-2">Set aside</p>
                  <p className="font-semibold">{money(selBills)}</p>
                </div>
                <div>
                  <p className="text-ink-2">Left</p>
                  <p className={clsx('font-semibold', selEarned - selSpent - selBills >= 0 ? 'text-money' : 'text-spend')}>{signed(selEarned - selSpent - selBills)}</p>
                </div>
              </div>
            )}
          </Card>

          <SectionTitle
            action={
              selDate ? (
                <button className="text-[14px] font-medium text-ink-2 hover:text-ink" onClick={() => setPicked({ key: windowKey, i: null })}>
                  Show the whole {range}
                </button>
              ) : undefined
            }
          >
            {selDate ? `${relativeDay(selDate, today)}${relativeDay(selDate, today) !== dayLabel(selDate) ? ` · ${dayLabel(selDate)}` : ''}` : 'Transactions'}
          </SectionTitle>
          <Card className="overflow-hidden">
            {listed.length === 0 ? (
              <EmptyState
                icon={<Receipt size={24} />}
                title={selDate ? 'Nothing spent' : 'No spending yet'}
                body="Add what you spend, or connect your bank, so each day shows what's left."
                action={
                  <button className="btn btn-primary" onClick={() => openSheet({ kind: 'expense', date: selDate ?? today })}>
                    <Plus size={18} /> Add expense
                  </button>
                }
              />
            ) : (
              [...groups.entries()].map(([date, list]) => (
                <div key={date}>
                  {!selDate && (
                    <p className="flex justify-between bg-raised/60 px-4 py-2 text-[13px] font-semibold text-ink-2">
                      <span>{relativeDay(date, today) === dayLabel(date) ? dayLabel(date) : `${relativeDay(date, today)} · ${dayLabel(date)}`}</span>
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
              <span className="block text-[13px] text-ink-2">{money(billsTotal)} set aside this {range}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-ink-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
