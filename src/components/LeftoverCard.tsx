import { memo, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Gift, Package, PartyPopper, PiggyBank } from 'lucide-react';
import type { Move } from '../../shared/types.ts';
import { earningDays } from '../../shared/bills.ts';
import { goalStatus, movesFor } from '../../shared/plan.ts';
import { addDays, diffDays, toLocalDate } from '../../shared/dates.ts';
import { useEngineData, useGoals, useMoves, useSettings, type PaydayStretch } from '../lib/hooks.ts';
import { splitLeftover } from '../lib/insights.ts';
import { useData } from '../lib/store.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, money } from '../lib/format.ts';
import { toast } from '../lib/ui.ts';
import { MoneyInput, parseMoney } from './ui.tsx';

/**
 * After a paycheck that finished with money to spare: a suggested split
 * between savings and your plans, recorded with one tap. The money itself
 * moves in your bank app; this keeps your plans up to date.
 */
export const LeftoverCard = memo(function LeftoverCard({ stretch, now, className }: { stretch: PaydayStretch; now: number; className?: string }) {
  const today = toLocalDate(now);
  const goals = useGoals();
  const moves = useMoves();
  const put = useData((s) => s.put);
  const data = useEngineData();
  const { billSpread } = useSettings();
  const working = useMemo(() => (billSpread === 'everyday' ? null : earningDays(data, addDays(today, -400), addDays(today, 400))), [billSpread, data, today]);
  const isEarningDay = (d: string) => !working || working.has(d);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const payday = stretch.prevPayday;
  const amount = Math.floor(stretch.lastEnd ?? 0);
  const handled = !!payday && moves.some((m) => m.payday === payday);

  const plans = goals.map((g) => {
    const st = goalStatus(g, today, isEarningDay, movesFor(g.id, moves));
    return { goal: g, st, plan: { id: g.id, name: g.name, left: st.left, targetDate: g.targetDate, first: g.first } };
  });
  const split = splitLeftover(amount, plans.map((p) => p.plan), today);
  if (!payday || amount < 5 || handled) return null;

  const open = plans.filter((p) => p.st.left >= 1);
  const suggested: Record<string, number> = { savings: split.savings, ...Object.fromEntries(split.plans.map((p) => [p.id, p.amount])) };
  const chosen = editing ? Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, parseMoney(v) || 0])) : suggested;
  const placed = Object.values(chosen).reduce((t, v) => t + v, 0);
  const why = (id: string) => {
    const p = split.plans.find((x) => x.id === id);
    const g = goals.find((x) => x.id === id);
    if (!p || !g) return '';
    if (p.why === 'first') return 'you want it sooner';
    if (p.why === 'soon') return `due ${diffDays(today, g.targetDate) <= 0 ? 'now' : `in ${diffDays(today, g.targetDate)} days`}`;
    return '';
  };
  const perDayAfter = (id: string, extra: number) => {
    const p = plans.find((x) => x.goal.id === id);
    if (!p || extra <= 0) return null;
    const after = goalStatus(p.goal, today, isEarningDay, [...movesFor(id, moves), { date: today, amount: extra }]);
    return { before: p.st.perDay, after: after.perDay };
  };

  const record = (entries: Array<Omit<Move, 'id' | 'updatedAt' | 'payday' | 'date'>>) => {
    for (const e of entries) put('moves', { id: newId(), updatedAt: 0, payday, date: today, ...e });
  };
  const doIt = () => {
    const entries: Array<Omit<Move, 'id' | 'updatedAt' | 'payday' | 'date'>> = [];
    if ((chosen.savings ?? 0) > 0) entries.push({ to: 'savings', amount: chosen.savings });
    for (const p of open) if ((chosen[p.goal.id] ?? 0) > 0) entries.push({ to: 'goal', goalId: p.goal.id, amount: chosen[p.goal.id] });
    const kept = amount - placed;
    if (kept > 0.5 || !entries.length) entries.push({ to: 'kept', amount: Math.max(0, kept) });
    record(entries);
    const parts = [
      (chosen.savings ?? 0) > 0 && `${money(chosen.savings)} to savings`,
      ...open.filter((p) => (chosen[p.goal.id] ?? 0) > 0).map((p) => `${money(chosen[p.goal.id])} toward ${p.goal.name}`),
    ].filter(Boolean);
    toast({ title: parts.length ? `Moved ${parts.join(', ')}` : 'Kept it in checking', detail: parts.length ? 'Make the same transfer in your bank app.' : undefined, tone: 'money' });
  };
  const keep = () => {
    record([{ to: 'kept', amount }]);
    toast({ title: 'Kept it in checking' });
  };
  const edit = () => {
    setDraft(Object.fromEntries([['savings', String(suggested.savings ?? 0)], ...open.map((p) => [p.goal.id, String(suggested[p.goal.id] ?? 0)])]));
    setEditing(true);
  };

  const rows = [
    { id: 'savings', name: 'Savings', note: open.length ? '' : 'no plans yet, so all of it' },
    ...open.filter((p) => editing || (suggested[p.goal.id] ?? 0) > 0).map((p) => ({ id: p.goal.id, name: p.goal.name, note: why(p.goal.id) })),
  ];

  return (
    <div className={clsx('card p-5', className)}>
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <PartyPopper size={17} className="text-ink-2" /> Left over from your {dayLabel(payday)} paycheck
      </p>
      <p className="num mt-3 text-[32px] leading-none font-bold tracking-tight text-money">{money(amount)}</p>
      <p className="mt-2 text-[14px] text-ink-2">Nice work staying under. Here's a good way to use it:</p>
      <div className="mt-3 space-y-2.5">
        {rows.map((r) => {
          const effect = r.id === 'savings' ? null : perDayAfter(r.id, chosen[r.id] ?? 0);
          return (
            <div key={r.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[14px] font-medium">
                  {r.id === 'savings' ? (
                    <PiggyBank size={15} className="shrink-0 text-ink-2" />
                  ) : goals.find((g) => g.id === r.id)?.kind === 'project' ? (
                    <Package size={15} className="shrink-0 text-ink-2" />
                  ) : (
                    <Gift size={15} className="shrink-0 text-ink-2" />
                  )}
                  <span className="truncate">{r.name}</span>
                  {r.note && <span className="shrink-0 text-[12px] font-normal text-ink-3">{r.note}</span>}
                </span>
                {effect && effect.before - effect.after > 0.005 && (
                  <span className="num mt-0.5 block pl-[23px] text-[12px] text-ink-2">
                    {money(effect.before)} → {money(effect.after)} a day
                  </span>
                )}
              </span>
              {editing ? (
                <span className="w-32 shrink-0">
                  <MoneyInput value={draft[r.id] ?? ''} onChange={(v) => setDraft((d) => ({ ...d, [r.id]: v }))} placeholder="0" ariaLabel={`Amount for ${r.name}`} />
                </span>
              ) : (
                <span className="num shrink-0 text-[15px] font-semibold">{money(chosen[r.id] ?? 0)}</span>
              )}
            </div>
          );
        })}
      </div>
      {editing && (
        <p className={placed > amount + 0.005 ? 'num mt-2 text-[13px] text-spend' : 'num mt-2 text-[13px] text-ink-2'}>
          {placed > amount + 0.005 ? `That's ${money(placed - amount)} more than you have.` : `${money(amount - placed)} stays in checking.`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn btn-primary flex-1" disabled={placed > amount + 0.005} onClick={doIt}>
          {editing ? 'Save' : 'Do it'}
        </button>
        {!editing && (
          <button className="btn btn-secondary" onClick={edit}>
            Change
          </button>
        )}
        <button className="btn btn-secondary" onClick={editing ? () => setEditing(false) : keep}>
          {editing ? 'Cancel' : 'Keep it'}
        </button>
      </div>
      <p className="mt-3 text-[12px] text-ink-3">Make the transfer in your bank app. Doing it here keeps your plans and savings up to date.</p>
    </div>
  );
});
