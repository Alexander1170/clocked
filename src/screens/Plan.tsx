import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarClock, ChevronRight, Gift, Package, PiggyBank, Plus } from 'lucide-react';
import type { Bill, BillFrequency, Goal, Saving, SavingFrequency } from '../../shared/types.ts';
import { billStatus, earningDays } from '../../shared/bills.ts';
import { goalStatus, savingStatus } from '../../shared/plan.ts';
import { addDays, toLocalDate } from '../../shared/dates.ts';
import {
  useBills,
  useCategoryMap,
  useEngineData,
  useGoals,
  useJobMap,
  useNow,
  useSavings,
  useSetAsidePlan,
  useSettings,
  useTransactions,
} from '../lib/hooks.ts';
import { categoryIcon } from '../lib/categories.ts';
import { dayLabel, daysUntil, money } from '../lib/format.ts';
import { openSheet } from '../lib/ui.ts';
import { Card, EmptyState, Segmented } from '../components/ui.tsx';

type Tab = 'bills' | 'savings' | 'wish';
const TAB_KEY = 'clocked.planTab';

const PER_MONTH: Record<BillFrequency, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
export const OFTEN: Record<SavingFrequency, string> = {
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
  paycheck: 'Every paycheck',
};

function readTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'savings' || t === 'wish' ? t : 'bills';
  } catch {
    return 'bills';
  }
}

function Progress({ value, of, color = 'var(--s7)' }: { value: number; of: number; color?: string }) {
  return (
    <span className="mt-3 block h-2 overflow-hidden rounded-full bg-raised">
      <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${of > 0 ? Math.min(100, (value / of) * 100) : 0}%`, background: color }} />
    </span>
  );
}

function Row({ icon, title, amount, sub, children, onClick }: { icon: React.ReactNode; title: string; amount: string; sub: React.ReactNode; children?: React.ReactNode; onClick(): void }) {
  return (
    <button onClick={onClick} className="card block w-full p-4 text-left transition-colors hover:bg-hover">
      <span className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-ink-2">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[16px] font-semibold">{title}</span>
            <span className="num shrink-0 text-[16px] font-semibold">{amount}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-2">{sub}</span>
          {children}
        </span>
        <ChevronRight size={18} className="mt-2.5 shrink-0 text-ink-3" />
      </span>
    </button>
  );
}

export function Plan() {
  const now = useNow(60_000);
  const today = toLocalDate(now);
  const bills = useBills();
  const savings = useSavings();
  const goals = useGoals();
  const txs = useTransactions();
  const cats = useCategoryMap();
  const jobs = useJobMap();
  const data = useEngineData();
  const { billSpread } = useSettings();
  const spread = billSpread ?? 'workdays';
  const unit = spread === 'everyday' ? 'day' : 'workday';
  const [tab, setTabState] = useState<Tab>(readTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode */
    }
  };

  const working = useMemo(() => earningDays(data, addDays(today, -400), addDays(today, 400)), [data, today]);
  const isEarningDay = (d: string) => spread === 'everyday' || working.has(d);
  const plan = useSetAsidePlan(today, today);
  const todayTotal = plan.byDay.get(today) ?? 0;
  const part = (k: 'bills' | 'savings' | 'goals') => plan.byKind[k].get(today) ?? 0;

  const lastPayment = (b: Bill) => {
    let best: (typeof txs)[number] | undefined;
    for (const t of txs) if (t.billId === b.id && (!best || t.date > best.date)) best = t;
    return best;
  };

  const billRows = bills
    .map((b) => ({ bill: b, status: billStatus(b, today, isEarningDay), last: lastPayment(b) }))
    .sort((a, b) => (a.status?.due ?? '9999').localeCompare(b.status?.due ?? '9999'));
  const perMonth = bills.reduce((t, b) => t + b.amount * PER_MONTH[b.frequency], 0);

  const goalRows = goals.map((g) => ({ goal: g, status: goalStatus(g, today, isEarningDay) }));
  const activeGoals = goalRows.filter((r) => !r.status.done);
  const doneGoals = goalRows.filter((r) => r.status.done);

  const add = () => {
    if (tab === 'bills') openSheet({ kind: 'bill' });
    else if (tab === 'savings') openSheet({ kind: 'saving' });
    else openSheet({ kind: 'goal', type: 'item' });
  };

  return (
    <div className="max-w-3xl">
      <header className="flex items-center justify-between gap-3 py-2">
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Plan</h1>
        <div className="flex gap-2">
          {tab === 'wish' && (
            <button className="btn btn-sm btn-secondary" onClick={() => openSheet({ kind: 'goal', type: 'project' })}>
              <Package size={16} /> Project
            </button>
          )}
          <button className="btn btn-sm btn-primary" onClick={add}>
            <Plus size={16} /> {tab === 'bills' ? 'Bill' : tab === 'savings' ? 'Savings' : 'Item'}
          </button>
        </div>
      </header>
      <p className="mt-1 text-[15px] text-ink-2">Bills, savings, and things you want are split across the {unit}s before they're due, so a little comes out of each day's pay.</p>

      <div className="card mt-5 p-4">
        <p className="text-[13px] font-medium text-ink-2">Set aside today</p>
        <p className="num mt-1 text-[26px] font-bold tracking-tight">{money(todayTotal)}</p>
        <p className="num mt-1 text-[13px] text-ink-2">
          {todayTotal === 0 && (bills.length || savings.length || goals.length)
            ? `Not a ${unit}, so nothing today.`
            : `Bills ${money(part('bills'))} · Savings ${money(part('savings'))} · Wish list ${money(part('goals'))}`}
        </p>
      </div>

      <Segmented<Tab>
        label="Plan"
        value={tab}
        onChange={setTab}
        className="mt-5"
        options={[
          { value: 'bills', label: `Bills${bills.length ? ` (${bills.length})` : ''}` },
          { value: 'savings', label: `Savings${savings.length ? ` (${savings.length})` : ''}` },
          { value: 'wish', label: `Wish list${goals.length ? ` (${goals.length})` : ''}` },
        ]}
      />

      <div className="mt-4 space-y-3">
        {tab === 'bills' &&
          (bills.length === 0 ? (
            <Card>
              <EmptyState
                icon={<CalendarClock size={24} />}
                title="Add your first bill"
                body="Rent, phone, car insurance, subscriptions. You can also turn any expense into a bill from its details."
                action={
                  <button className="btn btn-primary" onClick={() => openSheet({ kind: 'bill' })}>
                    <Plus size={18} /> Add a bill
                  </button>
                }
              />
            </Card>
          ) : (
            <>
              <p className="px-1 text-[13px] text-ink-2">
                <span className="num font-semibold text-ink">{money(perMonth)}</span> a month in bills
              </p>
              {billRows.map(({ bill, status, last }) => {
                const Icon = categoryIcon(cats[bill.categoryId]?.icon);
                return (
                  <Row
                    key={bill.id}
                    icon={<Icon size={18} />}
                    title={bill.name}
                    amount={money(bill.amount)}
                    onClick={() => openSheet({ kind: 'bill', id: bill.id })}
                    sub={
                      <>
                        <CalendarClock size={14} className="shrink-0" />
                        {OFTEN[bill.frequency]}
                        {status && ` · due ${dayLabel(status.due)}, ${daysUntil(status.due, today)}`}
                      </>
                    }
                  >
                    {status && (
                      <>
                        <Progress value={status.savedSoFar} of={bill.amount} />
                        <span className="num mt-2 flex justify-between gap-2 text-[13px] text-ink-2">
                          <span>{money(status.savedSoFar)} saved</span>
                          <span className="font-semibold text-ink">
                            {money(status.perDay)}/{unit}
                          </span>
                        </span>
                      </>
                    )}
                    {last && (
                      <span className="num mt-1 block text-[12px] text-ink-3">
                        Last paid {money(last.amount)} on {dayLabel(last.date)}
                      </span>
                    )}
                  </Row>
                );
              })}
            </>
          ))}

        {tab === 'savings' &&
          (savings.length === 0 ? (
            <Card>
              <EmptyState
                icon={<PiggyBank size={24} />}
                title="Pay yourself first"
                body="Pick how much goes to savings each week, month, or paycheck. It comes out of each day's pay a little at a time."
                action={
                  <button className="btn btn-primary" onClick={() => openSheet({ kind: 'saving' })}>
                    <Plus size={18} /> Add savings
                  </button>
                }
              />
            </Card>
          ) : (
            savings.map((s: Saving) => {
              const st = savingStatus(s, today, isEarningDay, data.jobs);
              const job = s.jobId ? jobs[s.jobId] : undefined;
              return (
                <Row
                  key={s.id}
                  icon={<PiggyBank size={18} />}
                  title={s.name}
                  amount={money(s.amount)}
                  onClick={() => openSheet({ kind: 'saving', id: s.id })}
                  sub={
                    <span className="truncate">
                      {OFTEN[s.frequency]}
                      {s.frequency === 'paycheck' && job ? ` from ${job.name}` : ''}
                      {st && !st.reachedTarget && ` · moves ${dayLabel(st.due)}`}
                      {s.account && ` · to ${s.account}`}
                    </span>
                  }
                >
                  {st && !st.reachedTarget && (
                    <>
                      <Progress value={st.savedThisPeriod} of={s.amount} color="var(--s3)" />
                      <span className="num mt-2 flex justify-between gap-2 text-[13px] text-ink-2">
                        <span>{money(st.savedThisPeriod)} this period</span>
                        <span className="font-semibold text-ink">
                          {money(st.perDay)}/{unit}
                        </span>
                      </span>
                    </>
                  )}
                  {st && (
                    <span className="num mt-1 block text-[12px] text-ink-3">
                      {st.reachedTarget
                        ? `Done: ${money(st.savedTotal)} saved`
                        : `${money(st.savedTotal)} saved so far${s.target ? ` of ${money(s.target)}` : ''}`}
                    </span>
                  )}
                </Row>
              );
            })
          ))}

        {tab === 'wish' &&
          (goals.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Gift size={24} />}
                title="Save up for something"
                body="Add something you want and when you want it by, or make a project with several items. It's split across your days until then."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <button className="btn btn-primary" onClick={() => openSheet({ kind: 'goal', type: 'item' })}>
                      <Gift size={18} /> Add an item
                    </button>
                    <button className="btn btn-secondary" onClick={() => openSheet({ kind: 'goal', type: 'project' })}>
                      <Package size={18} /> Start a project
                    </button>
                  </div>
                }
              />
            </Card>
          ) : (
            <>
              {[...activeGoals, ...doneGoals].map(({ goal: g, status: st }: { goal: Goal; status: ReturnType<typeof goalStatus> }) => (
                <Row
                  key={g.id}
                  icon={g.kind === 'project' ? <Package size={18} /> : <Gift size={18} />}
                  title={g.name}
                  amount={money(st.total)}
                  onClick={() => openSheet({ kind: 'goal', id: g.id })}
                  sub={
                    <span className="truncate">
                      {g.kind === 'project' ? `${g.items.length} ${g.items.length === 1 ? 'item' : 'items'} · ` : ''}
                      {st.done ? 'Saved up' : `by ${dayLabel(g.targetDate)}, ${daysUntil(g.targetDate, today)}`}
                      {st.bought > 0 && ` · ${st.bought} bought`}
                    </span>
                  }
                >
                  <Progress value={st.saved} of={st.total} color="var(--s5)" />
                  <span className={clsx('num mt-2 flex justify-between gap-2 text-[13px] text-ink-2', st.done && 'opacity-80')}>
                    <span>
                      {money(st.saved)} of {money(st.total)}
                    </span>
                    {!st.done && st.perDay > 0 && (
                      <span className="font-semibold text-ink">
                        {money(st.perDay)}/{unit}
                      </span>
                    )}
                  </span>
                </Row>
              ))}
            </>
          ))}
      </div>
    </div>
  );
}
