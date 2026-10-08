import type { Bill, Goal, LocalDate, ScheduledJob, Transaction } from '../../shared/types.ts';
import { buildSegments, earnedBetween, valueIn, type EngineData } from '../../shared/accrual.ts';
import { addDays, dayEnd, dayStart, diffDays, toLocalDate } from '../../shared/dates.ts';
import type { SetAsideKind, SetAsidePlan } from '../../shared/plan.ts';
import { hourlyRate, nextPaydayOnOrAfter, periodForPayday, unpaidFrom, weeklyPaidHours } from '../../shared/pay.ts';
import { money } from './format.ts';

export type SpendCheck = (tx: Transaction) => boolean;

/** Bills and goals whose set-asides can cover a payment. */
export interface Coverage {
  bills: Record<string, Bill>;
  goals: Record<string, Goal>;
  /** Bank transactions before this day don't count. */
  trackFrom?: LocalDate;
}

/** A bank transaction from before you started tracking. */
export const beforeTracking = (tx: Pick<Transaction, 'source' | 'date'>, trackFrom?: LocalDate) => !!trackFrom && tx.source === 'plaid' && tx.date < trackFrom;

/** Whether a transaction shows in lists: not hidden, not from a switched-off account, not from before you started tracking. */
export const isShown = (tx: Transaction, trackFrom?: LocalDate) => !tx.deleted && !tx.accountOff && !tx.hidden && !beforeTracking(tx, trackFrom);

/** Why a transaction isn't counted as spending, or null if it is. */
export function notCountedReason(tx: Transaction, { bills, goals, trackFrom }: Coverage): string | null {
  if (tx.accountOff) return 'From an account you switched off';
  if (tx.hidden) return 'Hidden';
  if (beforeTracking(tx, trackFrom)) return 'From before you started tracking';
  if (tx.excluded) return 'Left out of spending';
  if (tx.jobId) return 'Paycheck, already counted hourly';
  if (tx.flow === 'income') return 'Deposit, already counted as pay';
  if (tx.flow === 'transfer') return 'Transfer between accounts';
  if (tx.billId) {
    const b = bills[tx.billId];
    // Payments after the set-asides started are covered by them.
    if (b && !b.deleted && tx.date >= b.startDate) return tx.billPart ? `Part of ${b.name}, covered by its set-asides` : `Covered by ${b.name} set-asides`;
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

/** A chart bar's time span: an hour, a day, or a month. */
export interface Span {
  start: number;
  end: number;
}

const spanDays = (b: Span): [LocalDate, LocalDate] => [toLocalDate(b.start), toLocalDate(b.end - 1)];

/**
 * Counted spending in each bar. Day and month bars go by date. Hour bars need
 * the time of day, so spending without one is added up separately as
 * `untimed`.
 */
export function spentInSpans(txs: Transaction[], spans: Span[], hourly: boolean, counts: SpendCheck): { values: number[]; untimed: number } {
  const values = spans.map(() => 0);
  let untimed = 0;
  if (!spans.length) return { values, untimed };
  const days = spans.map(spanDays);
  const first = days[0][0];
  const last = days[days.length - 1][1];
  for (const tx of txs) {
    if (tx.date < first || tx.date > last || !counts(tx)) continue;
    const at = tx.at;
    const i = hourly ? (at == null ? -1 : spans.findIndex((b) => at >= b.start && at < b.end)) : days.findIndex(([a, z]) => tx.date >= a && tx.date <= z);
    if (i >= 0) values[i] += tx.amount;
    else if (hourly) untimed += tx.amount;
  }
  return { values, untimed };
}

export interface SpanSetAside {
  total: number;
  kinds: Record<SetAsideKind, number>;
}

const noKinds = (): Record<SetAsideKind, number> => ({ bills: 0, savings: 0, goals: 0 });

/**
 * What to set aside in each bar. Day and month bars add up their days; a bar
 * that has started counts its days through today, the way pay counts what's
 * earned so far. Hour bars split their day's set-aside by each hour's
 * scheduled pay, or evenly when the day has none.
 */
export function setAsideInSpans(plan: Pick<SetAsidePlan, 'byDay' | 'byKind'>, spans: Span[], today: LocalDate, hourlyPay?: number[]): SpanSetAside[] {
  const kindsOn = (d: LocalDate) => {
    const k = noKinds();
    for (const kind of Object.keys(k) as SetAsideKind[]) k[kind] = plan.byKind[kind].get(d) ?? 0;
    return k;
  };
  if (hourlyPay) {
    const day = spans.length ? toLocalDate(spans[0].start) : today;
    const total = plan.byDay.get(day) ?? 0;
    const kinds = kindsOn(day);
    const pay = hourlyPay.reduce((t, v) => t + v, 0);
    return spans.map((_, i) => {
      const share = pay > 0.005 ? hourlyPay[i] / pay : 1 / spans.length;
      const k = noKinds();
      for (const kind of Object.keys(k) as SetAsideKind[]) k[kind] = kinds[kind] * share;
      return { total: total * share, kinds: k };
    });
  }
  return spans.map((b) => {
    const [first, last] = spanDays(b);
    const out: SpanSetAside = { total: 0, kinds: noKinds() };
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (first <= today && d > today) break;
      out.total += plan.byDay.get(d) ?? 0;
      const k = kindsOn(d);
      for (const kind of Object.keys(k) as SetAsideKind[]) out.kinds[kind] += k[kind];
    }
    return out;
  });
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
  return { job, pending, unpaidFrom: from, nextPayday, nextAmount: nextPayday ? checkAmount(job, data, nextPayday, now) : 0 };
}

/** What a payday's check comes to, per the schedule, days off included. */
export function checkAmount(job: ScheduledJob, data: EngineData, payday: LocalDate, now: number): number {
  const only = { jobs: [job], overrides: data.overrides, gigs: [] };
  const p = periodForPayday(job, payday);
  const a = dayStart(p.from);
  const b = dayEnd(p.to);
  let total = 0;
  for (const seg of buildSegments(only, p.from, p.to, now)) total += valueIn(seg, a, b);
  return total;
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

/**
 * A day's pay as one stacked bar: set-asides come off the top, then spending,
 * and what's left sits on the $0 line. Whatever the pay doesn't cover carries
 * on below $0.
 */
export function splitDay(d: { earned: number; setAside: number; spent: number }) {
  const spent = Math.max(0, d.spent);
  // A refund adds back to the day, like extra pay.
  const pay = Math.max(0, d.earned) + Math.max(0, -d.spent);
  const asideCovered = Math.min(d.setAside, pay);
  const spentCovered = Math.min(spent, pay - asideCovered);
  return {
    pay,
    asideCovered,
    spentCovered,
    left: pay - asideCovered - spentCovered,
    asideOver: d.setAside - asideCovered,
    spentOver: spent - spentCovered,
    net: d.earned - d.setAside - d.spent,
  };
}

/** A purchase you added by hand and the bank's copy of it. */
export interface Duplicate {
  manual: Transaction;
  bank: Transaction;
}

/**
 * Purchases you added by hand that look like a bank transaction: the same
 * amount within three days, whatever the name. Each pairs up once, closest day
 * first. Pairs you said aren't the same are left out.
 */
export function findDuplicates(txs: readonly Transaction[], trackFrom?: LocalDate): Duplicate[] {
  const manual = txs.filter((t) => t.source !== 'plaid' && !t.deleted && !t.hidden);
  const bank = txs.filter((t) => t.source === 'plaid' && isShown(t, trackFrom) && t.flow !== 'income');
  const pairs: Array<Duplicate & { gap: number }> = [];
  for (const m of manual) {
    const cents = Math.round(m.amount * 100);
    for (const b of bank) {
      if (Math.round(b.amount * 100) !== cents) continue;
      const gap = Math.abs(diffDays(m.date, b.date));
      if (gap > 3 || m.distinct?.includes(b.id) || b.distinct?.includes(m.id)) continue;
      pairs.push({ manual: m, bank: b, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap);
  const used = new Set<string>();
  const out: Duplicate[] = [];
  for (const p of pairs) {
    if (used.has(p.manual.id) || used.has(p.bank.id)) continue;
    used.add(p.manual.id);
    used.add(p.bank.id);
    out.push({ manual: p.manual, bank: p.bank });
  }
  return out;
}

/**
 * The bank's copy takes the place of the one you added by hand: it keeps the
 * bank's amount and date, and your name, category, note, and links.
 */
export function mergeDuplicate(bank: Transaction, manual: Transaction): Transaction {
  const out: Transaction = {
    ...bank,
    categoryId: manual.categoryId,
    note: manual.note ?? bank.note,
    at: bank.at ?? manual.at,
    billId: manual.billId ?? bank.billId,
    goalId: manual.goalId ?? bank.goalId,
    edited: true,
  };
  const name = manual.merchant.trim();
  if (name && name !== bank.merchant) {
    out.bankName = bank.bankName ?? bank.merchant;
    out.merchant = name;
  }
  if (manual.excluded) out.excluded = true;
  for (const k of Object.keys(out) as Array<keyof Transaction>) if (out[k] === undefined) delete out[k];
  return out;
}
