import type { Bill, Goal, LocalDate, ScheduledJob, Transaction } from '../../shared/types.ts';
import { buildSegments, earnedBetween, valueIn, type EngineData } from '../../shared/accrual.ts';
import { addDays, dayEnd, dayStart } from '../../shared/dates.ts';
import { hourlyRate, nextPaydayOnOrAfter, periodForPayday, unpaidFrom, weeklyPaidHours } from '../../shared/pay.ts';
import { money } from './format.ts';

export type SpendCheck = (tx: Transaction) => boolean;

/** Bills and goals whose set-asides can cover a payment. */
export interface Coverage {
  bills: Record<string, Bill>;
  goals: Record<string, Goal>;
}

/** Why a transaction isn't counted as spending, or null if it is. */
export function notCountedReason(tx: Transaction, { bills, goals }: Coverage): string | null {
  if (tx.accountOff) return 'From an account you switched off';
  if (tx.excluded) return 'Left out of spending';
  if (tx.jobId) return 'Paycheck, already counted hourly';
  if (tx.flow === 'income') return 'Deposit, already counted as pay';
  if (tx.flow === 'transfer') return 'Transfer between accounts';
  if (tx.billId) {
    const b = bills[tx.billId];
    // Payments after the set-asides started are covered by them.
    if (b && !b.deleted && tx.date >= b.startDate) return `Covered by ${b.name} set-asides`;
  }
  if (tx.goalId) {
    const g = goals[tx.goalId];
    if (g && !g.deleted) return `Paid from ${g.name} savings`;
  }
  return null;
}

/**
 * Spending counts money out minus refunds. Income (already counted as pay), transfers,
 * and bill payments covered by daily set-asides are left out.
 */
export function makeSpendCheck(cover: Coverage): SpendCheck {
  return (tx) => !tx.deleted && notCountedReason(tx, cover) === null;
}

export function spentBetween(txs: Transaction[], from: LocalDate, to: LocalDate, counts: SpendCheck): number {
  let t = 0;
  for (const tx of txs) if (tx.date >= from && tx.date <= to && counts(tx)) t += tx.amount;
  return t;
}

export function spentByDay(txs: Transaction[], from: LocalDate, to: LocalDate, counts: SpendCheck): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const tx of txs) if (tx.date >= from && tx.date <= to && counts(tx)) out.set(tx.date, (out.get(tx.date) ?? 0) + tx.amount);
  return out;
}

export interface PayInfo {
  job: ScheduledJob;
  /** Earned since the last paid period ended. */
  pending: number;
  unpaidFrom: LocalDate;
  nextPayday: LocalDate | null;
  /** What the next check should come to, per the schedule. */
  nextAmount: number;
}

export function payInfo(job: ScheduledJob, data: EngineData, today: LocalDate, now: number): PayInfo {
  const only = { jobs: [job], overrides: data.overrides, gigs: [] };
  const from = unpaidFrom(job, today);
  const pending = earnedBetween(buildSegments(only, from, today, now), dayStart(from), dayEnd(today), now);
  const nextPayday = nextPaydayOnOrAfter(job, addDays(today, 1));
  let nextAmount = 0;
  if (nextPayday) {
    const p = periodForPayday(job, nextPayday);
    const a = dayStart(p.from);
    const b = dayEnd(p.to);
    for (const s of buildSegments(only, p.from, p.to, now)) nextAmount += valueIn(s, a, b);
  }
  return { job, pending, unpaidFrom: from, nextPayday, nextAmount };
}

export interface RateSummary {
  weeklyHours: number;
  rate: number;
  formula: string;
}

export function rateSummary(job: Pick<ScheduledJob, 'schedule' | 'takeHome' | 'frequency'>): RateSummary {
  const weeklyHours = weeklyPaidHours(job);
  const rate = hourlyRate(job);
  const pay = money(job.takeHome || 0);
  const round = (n: number) => Math.round(n * 10) / 10;
  const formula = {
    weekly: `${pay} a week ÷ ${round(weeklyHours)} hrs`,
    biweekly: `${pay} every 2 weeks ÷ ${round(weeklyHours * 2)} hrs`,
    semimonthly: `${pay} × 24 checks ÷ ${Math.round(weeklyHours * 52)} hrs a year`,
    monthly: `${pay} × 12 checks ÷ ${Math.round(weeklyHours * 52)} hrs a year`,
  }[job.frequency];
  return { weeklyHours, rate, formula };
}
