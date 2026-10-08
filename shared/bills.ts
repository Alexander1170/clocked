import type { Bill, BillFrequency, BillPaycheck, Job, LocalDate, ScheduledJob, Transaction } from './types.ts';
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

type PayPlan = Pick<Bill, 'payFrom' | 'jobId' | 'lateDays'>;

/** The last paycheck of a kind on or before a due date (or within the days it's fine to be late). */
function slotPayDate(bill: PayPlan, slot: BillPaycheck, due: LocalDate, jobs: readonly Job[]): LocalDate {
  const job = billPayJob(bill, jobs);
  if (!job) return due;
  const latest = addDays(due, Math.max(0, Math.round(bill.lateDays ?? 0)));
  const days = paydaysBetween(job, addDays(latest, -62), latest);
  for (let i = days.length - 1; i >= 0; i--) if (paycheckSlot(job, days[i]) === slot) return days[i];
  return due;
}

/**
 * The days a payment goes out: its due date, or the last paycheck of the
 * bill's kind on or before it (or within the days it's fine to be late). A
 * bill split between both paychecks goes out in two halves.
 */
export function payDatesFor(bill: PayPlan, due: LocalDate, jobs: readonly Job[]): LocalDate[] {
  if (!bill.payFrom) return [due];
  if (bill.payFrom !== 'both') return [slotPayDate(bill, bill.payFrom, due, jobs)];
  const a = slotPayDate(bill, 'end', due, jobs);
  const b = slotPayDate(bill, 'mid', due, jobs);
  return a === b ? [a] : a < b ? [a, b] : [b, a];
}

/** The day a payment goes out, or the first half of it when it's split. */
export const payDateFor = (bill: PayPlan, due: LocalDate, jobs: readonly Job[]): LocalDate => payDatesFor(bill, due, jobs)[0];

export interface BillPayment {
  /** The day the money goes out. */
  pay: LocalDate;
  /** The due dates it pays. Usually one; a paycheck can pay two when paydays bunch up. */
  dues: LocalDate[];
  /** The bill's amount, or what you actually paid once the bank shows it. */
  amount: number;
  /** First day that saves toward it. */
  from: LocalDate;
  /** How much of a due date it pays: a half when the bill is split between paychecks. */
  share: number;
  /** Bank payments toward it so far, when they're known. */
  paid?: number;
  /** Paid: the bank shows it all, or the payment came in for a different amount. */
  done?: boolean;
}

/** One bank payment linked to a bill. */
export interface BillPaid {
  date: LocalDate;
  amount: number;
  /** Pays only part of it. */
  part?: boolean;
}

/** Bank payments linked to bills, so bills go by what you actually paid. */
export interface PaidLog {
  today: LocalDate;
  byBill: ReadonlyMap<string, readonly BillPaid[]>;
}

/** The payments linked to each bill. */
export function paidLog(txs: ReadonlyArray<Pick<Transaction, 'billId' | 'billPart' | 'date' | 'amount' | 'deleted'>>, today: LocalDate): PaidLog {
  const byBill = new Map<string, BillPaid[]>();
  for (const t of txs) {
    if (!t.billId || t.deleted || !(t.amount > 0)) continue;
    const list = byBill.get(t.billId) ?? [];
    list.push(t.billPart ? { date: t.date, amount: t.amount, part: true } : { date: t.date, amount: t.amount });
    byBill.set(t.billId, list);
  }
  return { today, byBill };
}

/** How far around a range to look for payments that save inside it. */
const SLACK_DAYS = 80;
/** A bank payment can post this many days after it was planned or due and still count for it. */
const PAID_GRACE_DAYS = 5;

/**
 * Payments whose save window touches [from, to], in order. A payment saves
 * from the day after the previous one went out through the day it goes out,
 * but never before the bill's start date.
 *
 * With the bank payments you've linked, a payment that's been paid counts
 * what you actually paid: the bank's amount wins over the bill's. Each bank
 * payment counts toward the payment whose stretch it lands in, which runs
 * until a few days after it was planned or due, whichever is later.
 */
export function paymentsTouching(bill: Bill, from: LocalDate, to: LocalDate, jobs: readonly Job[] = [], ignoreStart = false, paid?: PaidLog): BillPayment[] {
  if (bill.deleted || !(bill.amount > 0)) return [];
  type Part = { due: LocalDate; share: number; before: number };
  // A paycheck that comes too late for one due date pays it together with the next.
  const groups: Array<{ pay: LocalDate; parts: Part[] }> = [];
  for (const due of dueDatesBetween(bill, addDays(from, -SLACK_DAYS), addDays(to, SLACK_DAYS))) {
    if (bill.endDate && due > bill.endDate) break;
    const pays = payDatesFor(bill, due, jobs);
    for (const pay of pays) {
      const part = { due, share: 1 / pays.length, before: 0 };
      const last = groups[groups.length - 1];
      if (last && pay <= last.pay) last.parts.push(part);
      else groups.push({ pay, parts: [part] });
    }
  }

  // What one bank payment settles: a paycheck's due dates, or one due date paid in halves.
  const split = bill.payFrom === 'both';
  const occOf = (gi: number, due: LocalDate) => (split ? `d${due}` : `g${gi}`);
  type Occ = { planned: number; shares: number; last: LocalDate; paid: number; settled: boolean; actual: number };
  const occs = new Map<string, Occ>();
  groups.forEach((g, gi) => {
    for (const p of g.parts) {
      const k = occOf(gi, p.due);
      const o = occs.get(k) ?? { planned: 0, shares: 0, last: g.pay, paid: 0, settled: false, actual: 0 };
      p.before = o.shares;
      o.shares += p.share;
      o.planned += bill.amount * p.share;
      const latest = g.pay > p.due ? g.pay : p.due;
      if (latest > o.last) o.last = latest;
      occs.set(k, o);
    }
  });
  const list = paid?.byBill.get(bill.id) ?? [];
  let prevEnd: LocalDate | null = null;
  for (const o of occs.values()) {
    const end = addDays(o.last, PAID_GRACE_DAYS);
    const start: LocalDate = prevEnd ?? addDays(end, -31);
    const mine = list.filter((x) => x.date > start && x.date <= end);
    o.paid = mine.reduce((t, x) => t + x.amount, 0);
    // One payment settles a bill that isn't split, unless you said it's only part.
    const whole = !split && mine.some((x) => !x.part);
    o.settled = !!paid && o.paid > 0.005 && (whole || o.paid >= o.planned - 0.5 || paid.today > end);
    o.actual = o.settled ? o.paid : o.planned;
    prevEnd = end;
  }

  const out: BillPayment[] = [];
  // The first group only marks where the next one starts saving.
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    const start = addDays(groups[i - 1].pay, 1);
    const saveFrom = ignoreStart || start > bill.startDate ? start : bill.startDate;
    if (saveFrom > g.pay || g.pay < from || saveFrom > to) continue;
    let amount = 0;
    let toward = 0;
    let share = 0;
    let done = true;
    for (const p of g.parts) {
      const o = occs.get(occOf(i, p.due))!;
      const want = (o.actual * p.share) / o.shares;
      const got = Math.min(want, Math.max(0, o.paid - (o.actual * p.before) / o.shares));
      amount += want;
      toward += got;
      share += p.share;
      if (!o.settled && got < want - 0.5) done = false;
    }
    const dues = [...new Set(g.parts.map((p) => p.due))];
    out.push({ pay: g.pay, dues, amount, from: saveFrom, share: split ? share : 1, ...(paid ? { paid: toward, done } : {}) });
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
export function billShares(bill: Bill, from: LocalDate, to: LocalDate, isEarningDay: (d: LocalDate) => boolean, jobs: readonly Job[] = [], paid?: PaidLog): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const p of paymentsTouching(bill, from, to, jobs, false, paid)) {
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
  /** A half, when the bill is split between paychecks. */
  share: number;
  /** Paid already, by the bank's account. */
  done?: boolean;
}

/** Where a bill stands for its next payment. */
export function billStatus(bill: Bill, today: LocalDate, isEarningDay: (d: LocalDate) => boolean, jobs: readonly Job[] = [], paid?: PaidLog): BillStatus | null {
  const next = paymentsTouching(bill, today, addDays(today, 400), jobs, false, paid).find((p) => p.pay >= today);
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
    share: next.share,
    done: next.done,
  };
}

export interface PaycheckBill {
  bill: Bill;
  /** The day it goes out. For a bill paid on its due date, a day before the next paycheck. */
  pay: LocalDate;
  dues: LocalDate[];
  amount: number;
  /** A half, when the bill is split between paychecks. */
  share: number;
  /** Bank payments toward it so far. */
  paid?: number;
  /** Paid, by the bank's account. */
  done?: boolean;
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
 * count against the first scheduled job only). With `ignoreStart`, payments
 * from before a bill's start date count too: they were still paid.
 */
export function upcomingPaychecks(job: ScheduledJob, bills: readonly Bill[], jobs: readonly Job[], from: LocalDate, count: number, ignoreStart = false, paid?: PaidLog): Paycheck[] {
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
      for (const p of paymentsTouching(bill, payday, addDays(until, -1), jobs, ignoreStart, paid)) {
        if (payJob ? p.pay === payday : p.pay >= payday && p.pay < until)
          list.push({ bill, pay: p.pay, dues: p.dues, amount: p.amount, share: p.share, paid: p.paid, done: p.done });
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
export function planBills(bills: Bill[], data: EngineData, from: LocalDate, to: LocalDate, spread: 'workdays' | 'everyday' = 'workdays', paid?: PaidLog): BillPlan {
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
    const shares = billShares(b, from, to, isEarningDay, data.jobs, paid);
    if (!shares.size) continue;
    byBill.set(b.id, shares);
    for (const [d, v] of shares) byDay.set(d, (byDay.get(d) ?? 0) + v);
  }
  return { byDay, byBill, isEarningDay };
}

/** Lowercase words and digits, for comparing names. */
const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
/** Bank descriptions run words together ("SUBSDenverCO"). Split them where the case changes. */
const unglue = (s: string) => s.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2');

/**
 * Whether a payment looks like it pays a bill: the bank's description has the
 * bill's bank name in it as whole words (or the bill's own name, when it has
 * no bank name), and the amount is within half to one and a half times the
 * bill's. So a $59.99 game doesn't count as a $9.99 game subscription from
 * the same store, and "rent" doesn't match "Parent".
 */
export function paysBill(bill: Pick<Bill, 'name' | 'match' | 'amount' | 'deleted'>, merchant: string, amount: number, rawName = ''): boolean {
  if (bill.deleted || !(amount > 0) || !(bill.amount > 0)) return false;
  if (amount < bill.amount * 0.5 || amount > bill.amount * 1.5) return false;
  const key = words(bill.match?.trim() || bill.name).trim();
  return !!key && [merchant, rawName, unglue(merchant), unglue(rawName)].map(words).join('').includes(` ${key} `);
}

/** The bill a payment pays, if any: of the ones it could pay, the closest in amount. */
export function billForPayment(bills: readonly Bill[], merchant: string, amount: number, rawName?: string): Bill | undefined {
  let best: Bill | undefined;
  for (const b of bills) {
    if (!paysBill(b, merchant, amount, rawName)) continue;
    if (!best || Math.abs(amount - b.amount) / b.amount < Math.abs(amount - best.amount) / best.amount) best = b;
  }
  return best;
}
