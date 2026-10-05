import type { Bill, BillFrequency, Job, LocalDate, ScheduledJob } from './types.ts';
import type { EngineData } from './accrual.ts';
import { scheduledDaySegments } from './accrual.ts';
import { addDays, daysInMonth, diffDays, eachDay, makeDate, ymd } from './dates.ts';
import { paycheckSlot, paydaysBetween, type PaycheckSlot } from './pay.ts';

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

/** The scheduled job whose paychecks pay a bill, if it's paid from one. */
export function billPayJob(bill: Pick<Bill, 'payFrom' | 'jobId'>, jobs: readonly Job[]): ScheduledJob | undefined {
  if (!bill.payFrom) return undefined;
  const scheduled = jobs.filter((j): j is ScheduledJob => !j.deleted && j.kind === 'scheduled');
  return scheduled.find((j) => j.id === bill.jobId) ?? scheduled[0];
}

/**
 * The day a payment goes out: its due date, or the last paycheck of the
 * bill's kind on or before it (or within the days it's fine to be late).
 */
export function payDateFor(bill: Pick<Bill, 'payFrom' | 'jobId' | 'lateDays'>, due: LocalDate, jobs: readonly Job[]): LocalDate {
  const job = billPayJob(bill, jobs);
  if (!job) return due;
  const latest = addDays(due, Math.max(0, Math.round(bill.lateDays ?? 0)));
  const days = paydaysBetween(job, addDays(latest, -62), latest);
  for (let i = days.length - 1; i >= 0; i--) if (paycheckSlot(job, days[i]) === bill.payFrom) return days[i];
  return due;
}

export interface BillPayment {
  /** The day the money goes out. */
  pay: LocalDate;
  /** The due dates it pays. Usually one; a paycheck can pay two when paydays bunch up. */
  dues: LocalDate[];
  amount: number;
  /** First day that saves toward it. */
  from: LocalDate;
}

/** How far around a range to look for payments that save inside it. */
const SLACK_DAYS = 80;

/**
 * Payments whose save window touches [from, to], in order. A payment saves
 * from the day after the previous one went out through the day it goes out,
 * but never before the bill's start date.
 */
export function paymentsTouching(bill: Bill, from: LocalDate, to: LocalDate, jobs: readonly Job[] = []): BillPayment[] {
  if (bill.deleted || !(bill.amount > 0)) return [];
  const groups: Array<{ pay: LocalDate; dues: LocalDate[] }> = [];
  for (const due of dueDatesBetween(bill, addDays(from, -SLACK_DAYS), addDays(to, SLACK_DAYS))) {
    if (bill.endDate && due > bill.endDate) break;
    const pay = payDateFor(bill, due, jobs);
    const last = groups[groups.length - 1];
    if (last && pay <= last.pay) last.dues.push(due);
    else groups.push({ pay, dues: [due] });
  }
  const out: BillPayment[] = [];
  // The first group only marks where the next one starts saving.
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    const start = addDays(groups[i - 1].pay, 1);
    const saveFrom = start > bill.startDate ? start : bill.startDate;
    if (saveFrom > g.pay || g.pay < from || saveFrom > to) continue;
    out.push({ pay: g.pay, dues: g.dues, amount: bill.amount * g.dues.length, from: saveFrom });
  }
  return out;
}

/** The days that save toward the payment covering a due date. */
export function saveWindow(bill: Bill, due: LocalDate, jobs: readonly Job[] = []): { from: LocalDate; to: LocalDate } | null {
  if (bill.endDate && bill.endDate < due) return null;
  const p = paymentsTouching(bill, addDays(due, -70), addDays(due, 40), jobs).find((x) => x.dues.includes(due));
  return p ? { from: p.from, to: p.pay } : null;
}

/** Days in a window that carry a share: earning days, or every day if there are none. */
export function shareDays(from: LocalDate, to: LocalDate, isEarningDay: (d: LocalDate) => boolean): LocalDate[] {
  const all = eachDay(from, to);
  const working = all.filter(isEarningDay);
  return working.length ? working : all;
}

/** The save windows of every payment whose window touches [from, to]. */
export function windowsTouching(bill: Bill, from: LocalDate, to: LocalDate, jobs: readonly Job[] = []): Array<{ due: LocalDate; from: LocalDate; to: LocalDate }> {
  return paymentsTouching(bill, from, to, jobs).map((p) => ({ due: p.dues[p.dues.length - 1], from: p.from, to: p.pay }));
}

/** How much of the bill to set aside on each day in [from, to]. */
export function billShares(bill: Bill, from: LocalDate, to: LocalDate, isEarningDay: (d: LocalDate) => boolean, jobs: readonly Job[] = []): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const p of paymentsTouching(bill, from, to, jobs)) {
    const days = shareDays(p.from, p.pay, isEarningDay);
    const share = p.amount / days.length;
    for (const d of days) if (d >= from && d <= to) out.set(d, (out.get(d) ?? 0) + share);
  }
  return out;
}

export interface BillStatus {
  /** The next payment's due date (the first one, if it pays two). */
  due: LocalDate;
  /** The day it goes out: the due date, or the paycheck that pays it. */
  pay: LocalDate;
  /** What it pays: the bill's amount, or more when one paycheck covers two due dates. */
  amount: number;
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
export function billStatus(bill: Bill, today: LocalDate, isEarningDay: (d: LocalDate) => boolean, jobs: readonly Job[] = []): BillStatus | null {
  const next = paymentsTouching(bill, today, addDays(today, 400), jobs).find((p) => p.pay >= today);
  if (!next) return null;
  const days = shareDays(next.from, next.pay, isEarningDay);
  const perDay = next.amount / days.length;
  const done = days.filter((d) => d <= today).length;
  return {
    due: next.dues[0],
    pay: next.pay,
    amount: next.amount,
    windowFrom: next.from,
    perDay,
    days: days.length,
    savedSoFar: perDay * done,
    daysLeft: days.length - done,
  };
}

export interface PaycheckBill {
  bill: Bill;
  /** The day it goes out. For a bill paid on its due date, a day before the next paycheck. */
  pay: LocalDate;
  dues: LocalDate[];
  amount: number;
}

export interface Paycheck {
  payday: LocalDate;
  slot: PaycheckSlot;
  /** The next payday, where this check's stretch ends. */
  until: LocalDate;
  bills: PaycheckBill[];
  billTotal: number;
}

/**
 * A job's next paychecks and the bills each one pays: the ones set to that
 * paycheck, plus bills paid on their due date before the next payday (those
 * count against the first scheduled job only).
 */
export function upcomingPaychecks(job: ScheduledJob, bills: readonly Bill[], jobs: readonly Job[], from: LocalDate, count: number): Paycheck[] {
  const paydays = paydaysBetween(job, from, addDays(from, 31 * (count + 1))).slice(0, count + 1);
  const primary = jobs.find((j): j is ScheduledJob => !j.deleted && j.kind === 'scheduled')?.id === job.id;
  const out: Paycheck[] = [];
  for (let i = 0; i + 1 < paydays.length; i++) {
    const payday = paydays[i];
    const until = paydays[i + 1];
    const list: PaycheckBill[] = [];
    for (const bill of bills) {
      if (bill.deleted) continue;
      const payJob = billPayJob(bill, jobs);
      if (payJob ? payJob.id !== job.id : !primary) continue;
      for (const p of paymentsTouching(bill, payday, addDays(until, -1), jobs)) {
        if (payJob ? p.pay === payday : p.pay >= payday && p.pay < until) list.push({ bill, pay: p.pay, dues: p.dues, amount: p.amount });
      }
    }
    list.sort((a, b) => a.pay.localeCompare(b.pay) || a.dues[0].localeCompare(b.dues[0]) || a.bill.name.localeCompare(b.bill.name));
    out.push({ payday, slot: paycheckSlot(job, payday), until, bills: list, billTotal: list.reduce((t, b) => t + b.amount, 0) });
  }
  return out;
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
    for (const w of windowsTouching(b, from, to, data.jobs)) {
      if (w.from < lo) lo = w.from;
      if (w.to > hi) hi = w.to;
    }
  }
  const earning = spread === 'everyday' ? null : earningDays(data, lo, hi);
  const isEarningDay = (d: LocalDate) => (earning ? earning.has(d) : true);
  const byDay = new Map<LocalDate, number>();
  const byBill = new Map<string, Map<LocalDate, number>>();
  for (const b of bills) {
    const shares = billShares(b, from, to, isEarningDay, data.jobs);
    if (!shares.size) continue;
    byBill.set(b.id, shares);
    for (const [d, v] of shares) byDay.set(d, (byDay.get(d) ?? 0) + v);
  }
  return { byDay, byBill, isEarningDay };
}
