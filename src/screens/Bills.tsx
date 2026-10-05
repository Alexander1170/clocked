import { useMemo } from 'react';
import { ArrowLeft, CalendarClock, ChevronRight, PiggyBank, Plus } from 'lucide-react';
import type { Bill, BillFrequency } from '../../shared/types.ts';
import { billStatus, earningDays, planBills } from '../../shared/bills.ts';
import { addDays, toLocalDate } from '../../shared/dates.ts';
import { useBills, useCategoryMap, useEngineData, useNow, useSettings, useTransactions } from '../lib/hooks.ts';
import { categoryIcon } from '../lib/categories.ts';
import { dayLabel, daysUntil, money } from '../lib/format.ts';
import { go, openSheet } from '../lib/ui.ts';
import { Card, EmptyState, SectionTitle } from '../components/ui.tsx';

const PER_MONTH: Record<BillFrequency, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };
const OFTEN: Record<BillFrequency, string> = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', quarterly: 'Every 3 months', yearly: 'Every year' };

export function Bills() {
  const now = useNow(60_000);
  const today = toLocalDate(now);
  const bills = useBills();
  const txs = useTransactions();
  const cats = useCategoryMap();
  const data = useEngineData();
  const { billSpread } = useSettings();
  const spread = billSpread ?? 'workdays';
  const unit = spread === 'everyday' ? 'day' : 'workday';

  const working = useMemo(() => earningDays(data, addDays(today, -400), addDays(today, 400)), [data, today]);
  const isEarningDay = (d: string) => spread === 'everyday' || working.has(d);
  const plan = useMemo(() => planBills(bills, data, today, today, spread), [bills, data, today, spread]);
  const todayTotal = plan.byDay.get(today) ?? 0;
  const perMonth = bills.reduce((t, b) => t + b.amount * PER_MONTH[b.frequency], 0);

  const rows = bills
    .map((b) => ({ bill: b, status: billStatus(b, today, isEarningDay), last: lastPayment(b) }))
    .sort((a, b) => (a.status?.due ?? '9999').localeCompare(b.status?.due ?? '9999'));

  function lastPayment(b: Bill) {
    let best: (typeof txs)[number] | undefined;
    for (const t of txs) if (t.billId === b.id && (!best || t.date > best.date)) best = t;
    return best;
  }

  return (
    <div className="max-w-3xl">
      <header className="flex items-center justify-between gap-3 py-2">
        <div className="flex items-center gap-3">
          <button onClick={() => go('spending')} aria-label="Back to spending" className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink lg:hidden">
            <ArrowLeft size={19} />
          </button>
          <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Bills</h1>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => openSheet({ kind: 'bill' })}>
          <Plus size={16} /> Bill
        </button>
      </header>
      <p className="mt-1 text-[15px] text-ink-2">
        Each bill is split across the {unit}s before it's due, so a little comes out of each day's pay instead of one big hit.
      </p>

      {bills.length === 0 ? (
        <Card className="mt-5">
          <EmptyState
            icon={<PiggyBank size={24} />}
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
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="text-[13px] font-medium text-ink-2">Set aside today</p>
              <p className="num mt-1 text-[22px] font-bold tracking-tight">{money(todayTotal)}</p>
              {todayTotal === 0 && <p className="text-[12px] text-ink-3">Not a {unit}</p>}
            </div>
            <div className="card p-4">
              <p className="text-[13px] font-medium text-ink-2">Bills a month</p>
              <p className="num mt-1 text-[22px] font-bold tracking-tight">{money(perMonth)}</p>
            </div>
          </div>

          <SectionTitle>Coming up</SectionTitle>
          <div className="space-y-3">
            {rows.map(({ bill, status, last }) => {
              const Icon = categoryIcon(cats[bill.categoryId]?.icon);
              const pct = status ? Math.min(100, (status.savedSoFar / bill.amount) * 100) : 0;
              return (
                <button key={bill.id} onClick={() => openSheet({ kind: 'bill', id: bill.id })} className="card block w-full p-4 text-left transition-colors hover:bg-hover">
                  <span className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-ink-2">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[16px] font-semibold">{bill.name}</span>
                        <span className="num shrink-0 text-[16px] font-semibold">{money(bill.amount)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-2">
                        <CalendarClock size={14} className="shrink-0" />
                        {OFTEN[bill.frequency]}
                        {status && ` · due ${dayLabel(status.due)}, ${daysUntil(status.due, today)}`}
                      </span>
                      {status && (
                        <>
                          <span className="mt-3 block h-2 overflow-hidden rounded-full bg-raised">
                            <span className="block h-full rounded-full bg-[var(--s7)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
                          </span>
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
                    </span>
                    <ChevronRight size={18} className="mt-2.5 shrink-0 text-ink-3" />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
