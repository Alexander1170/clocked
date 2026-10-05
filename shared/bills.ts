import type { Bill, BillFrequency, LocalDate } from './types.ts';
import type { EngineData } from './accrual.ts';
import { scheduledDaySegments } from './accrual.ts';
import { addDays, daysInMonth, diffDays, eachDay, makeDate, ymd } from './dates.ts';

const MONTH_STEP: Partial<Record<BillFrequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 };

type DueBill = Pick<Bill, 'frequency' | 'dueDate'>;

/** Due dates within [from, to], ascending. */
export function dueDatesBetween(bill: DueBill, from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  if (from > to) return out;
  if (bill.frequency === 'weekly' || bill.frequency === 'biweekly') {
    const step = bill.frequency === 'weekly' ? 7 : 14;
    for (let k = Math.ceil(diffDays(bill.dueDate, from) / step); ; k++) {
      const d = addDays(bill.dueDate, k * step);
      if (d > to) break;
      out.push(d);
    }
    return out;
  }
  const step = MONTH_STEP[bill.frequency] ?? 1;
  const [ay, am, ad] = ymd(bill.dueDate);
  const anchor = ay * 12 + am - 1;
  const [fy, fm] = ymd(from);
  const [ty, tm] = ymd(to);
  for (let i = anchor + Math.ceil((fy * 12 + fm - 1 - anchor) / step) * step; i <= ty * 12 + tm - 1; i += step) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    // Day 31 (or 29-30 in short months) lands on the month's last day.
    const d = makeDate(y, m, Math.min(ad, daysInMonth(y, m)));
    if (d >= from && d <= to) out.push(d);
  }
  return out;
}

export function nextDueOnOrAfter(bill: DueBill, d: LocalDate): LocalDate {
  return dueDatesBetween(bill, d, addDays(d, 400))[0];
}

export function prevDueBefore(bill: DueBill, d: LocalDate): LocalDate | null {
  const list = dueDatesBetween(bill, addDays(d, -400), addDays(d, -1));
  return list.length ? list[list.length - 1] : null;
}

/**
 * The days that save toward one payment: from the day after the previous due
 * date through the due date, but never before the bill's start date.
 */
export function saveWindow(bill: Bill, due: LocalDate): { from: LocalDate; to: LocalDate } | null {
  if (bill.endDate && bill.endDate < due) return null;
  const prev = prevDueBefore(bill, due);
  const cycleStart = prev ? addDays(prev, 1) : due;
  const from = cycleStart > bill.startDate ? cycleStart : bill.startDate;
  return from > due ? null : { from, to: due };
}

/** Days in a window that carry a share: earning days, or every day if there are none. */
function shareDays(from: LocalDate, to: LocalDate, isEarningDay: (d: LocalDate) => boolean): LocalDate[] {
  const all = eachDay(from, to);
  const working = all.filter(isEarningDay);
  return working.length ? working : all;
}

/** The save windows of every payment whose window touches [from, to]. */
export function windowsTouching(bill: Bill, from: LocalDate, to: LocalDate): Array<{ due: LocalDate; from: LocalDate; to: LocalDate }> {
  if (bill.deleted || !(bill.amount > 0)) return [];
  const out: Array<{ due: LocalDate; from: LocalDate; to: LocalDate }> = [];
  for (const due of dueDatesBetween(bill, from, nextDueOnOrAfter(bill, to))) {
    const w = saveWindow(bill, due);
    if (w && w.to >= from && w.from <= to) out.push({ due, ...w });
  }
  return out;
}

/** How much of the bill to set aside on each day in [from, to]. */
export function billShares(bill: Bill, from: LocalDate, to: LocalDate, isEarningDay: (d: LocalDate) => boolean): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const w of windowsTouching(bill, from, to)) {
    const days = shareDays(w.from, w.to, isEarningDay);
    const share = bill.amount / days.length;
    for (const d of days) if (d >= from && d <= to) out.set(d, (out.get(d) ?? 0) + share);
  }
  return out;
}

export interface BillStatus {
  due: LocalDate;
  windowFrom: LocalDate;
  perDay: number;
  /** Days that carry a share in this window. */
  days: number;
  /** Set aside from the window start through today. */
  savedSoFar: number;
  /** Share days left after today. */
  daysLeft: number;
}

/** Where a bill stands for its next payment. */
export function billStatus(bill: Bill, today: LocalDate, isEarningDay: (d: LocalDate) => boolean): BillStatus | null {
  if (bill.deleted || !(bill.amount > 0)) return null;
  let due = nextDueOnOrAfter(bill, today);
  // A bill that starts after this payment saves toward the next one.
  for (let i = 0; i < 3; i++) {
    const w = saveWindow(bill, due);
    if (w) {
      const days = shareDays(w.from, w.to, isEarningDay);
      const perDay = bill.amount / days.length;
      const done = days.filter((d) => d <= today).length;
      return { due, windowFrom: w.from, perDay, days: days.length, savedSoFar: perDay * done, daysLeft: days.length - done };
    }
    if (bill.endDate && bill.endDate < due) return null;
    due = nextDueOnOrAfter(bill, addDays(due, 1));
  }
  return null;
}

/** Days with scheduled work or paid time off at any scheduled job. */
export function earningDays(data: EngineData, from: LocalDate, to: LocalDate): Set<LocalDate> {
  const overrides = new Map(data.overrides.filter((o) => !o.deleted).map((o) => [`${o.jobId}|${o.date}`, o]));
  const out = new Set<LocalDate>();
  const jobs = data.jobs.filter((j) => !j.deleted && j.kind === 'scheduled');
  for (const d of eachDay(from, to)) {
    for (const job of jobs) {
      if (job.kind === 'scheduled' && scheduledDaySegments(job, d, overrides.get(`${job.id}|${d}`)).length) {
        out.add(d);
        break;
      }
    }
  }
  return out;
}

export interface BillPlan {
  /** Total to set aside per day. */
  byDay: Map<LocalDate, number>;
  /** Per bill, per day. */
  byBill: Map<string, Map<LocalDate, number>>;
  isEarningDay(d: LocalDate): boolean;
}

/** Every bill's daily set-aside over [from, to], using one earning-day lookup for all of them. */
export function planBills(bills: Bill[], data: EngineData, from: LocalDate, to: LocalDate, spread: 'workdays' | 'everyday' = 'workdays'): BillPlan {
  let lo = from;
  let hi = to;
  for (const b of bills) {
    for (const w of windowsTouching(b, from, to)) {
      if (w.from < lo) lo = w.from;
      if (w.to > hi) hi = w.to;
    }
  }
  const earning = spread === 'everyday' ? null : earningDays(data, lo, hi);
  const isEarningDay = (d: LocalDate) => (earning ? earning.has(d) : true);
  const byDay = new Map<LocalDate, number>();
  const byBill = new Map<string, Map<LocalDate, number>>();
  for (const b of bills) {
    const shares = billShares(b, from, to, isEarningDay);
    if (!shares.size) continue;
    byBill.set(b.id, shares);
    for (const [d, v] of shares) byDay.set(d, (byDay.get(d) ?? 0) + v);
  }
  return { byDay, byBill, isEarningDay };
}
