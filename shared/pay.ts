import type { LocalDate, PayFrequency, ScheduledJob, Shift } from './types.ts';
import { addDays, daysInMonth, diffDays, makeDate, minutesOf, weekday, ymd } from './dates.ts';

export const CHECKS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export function shiftSpanMinutes(s: Shift): number {
  const a = minutesOf(s.start);
  let b = minutesOf(s.end);
  if (b <= a) b += 1440;
  return b - a;
}

export function shiftPaidMinutes(s: Shift): number {
  return Math.max(0, shiftSpanMinutes(s) - (s.breakMinutes ?? 0));
}

export function dayPaidHours(shifts: Shift[] | undefined): number {
  return (shifts ?? []).reduce((t, s) => t + shiftPaidMinutes(s), 0) / 60;
}

export function weeklyPaidHours(job: Pick<ScheduledJob, 'schedule'>): number {
  return job.schedule.reduce((t, day) => t + dayPaidHours(day), 0);
}

/**
 * Take-home dollars per paid hour. Annualized so twice-a-month and monthly pay
 * work too; for weekly and every-2-weeks pay it reduces to paycheck ÷ hours in the period.
 */
export function hourlyRate(job: Pick<ScheduledJob, 'schedule' | 'takeHome' | 'frequency'>): number {
  const weekly = weeklyPaidHours(job);
  if (weekly <= 0 || !(job.takeHome > 0)) return 0;
  return (job.takeHome * CHECKS_PER_YEAR[job.frequency]) / (weekly * 52);
}

function clampToMonth(y: number, m: number, day: number): LocalDate {
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Paydays that land on a weekend move to the Friday before. */
function weekendToFriday(d: LocalDate): LocalDate {
  const wd = weekday(d);
  if (wd === 6) return addDays(d, -1);
  if (wd === 0) return addDays(d, -2);
  return d;
}

type PayJob = Pick<ScheduledJob, 'frequency' | 'payday' | 'payLagDays' | 'semimonthlyDays' | 'monthlyDay'>;

/** Paydays within [from, to], inclusive, ascending. */
export function paydaysBetween(job: PayJob, from: LocalDate, to: LocalDate): LocalDate[] {
  if (from > to) return [];
  if (job.frequency === 'weekly' || job.frequency === 'biweekly') {
    const step = job.frequency === 'weekly' ? 7 : 14;
    const out: LocalDate[] = [];
    for (let k = Math.ceil(diffDays(job.payday, from) / step); ; k++) {
      const d = addDays(job.payday, k * step);
      if (d > to) break;
      if (d >= from) out.push(d);
    }
    return out;
  }
  const days = job.frequency === 'semimonthly' ? (job.semimonthlyDays ?? [15, 31]) : [job.monthlyDay ?? 1];
  const [fy, fm] = ymd(from);
  const [ty, tm] = ymd(to);
  const found = new Set<LocalDate>();
  // One month of slack on each side: moving a weekend payday can cross a month boundary.
  for (let i = fy * 12 + fm - 2; i <= ty * 12 + tm; i++) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    for (const day of days) {
      const d = weekendToFriday(clampToMonth(y, m, day));
      if (d >= from && d <= to) found.add(d);
    }
  }
  return [...found].sort();
}

export function lastPaydayOnOrBefore(job: PayJob, d: LocalDate): LocalDate | null {
  const list = paydaysBetween(job, addDays(d, -70), d);
  return list.length ? list[list.length - 1] : null;
}

export function nextPaydayOnOrAfter(job: PayJob, d: LocalDate): LocalDate | null {
  return paydaysBetween(job, d, addDays(d, 70))[0] ?? null;
}

/** The days of work a payday's check covers, inclusive. */
export function periodForPayday(job: PayJob, payday: LocalDate): { from: LocalDate; to: LocalDate } {
  const to = addDays(payday, -job.payLagDays);
  const prev = lastPaydayOnOrBefore(job, addDays(payday, -1));
  const from = prev ? addDays(prev, 1 - job.payLagDays) : addDays(to, -13);
  return { from, to };
}

/** First day of work that hasn't been paid yet as of `today` (a payday counts as paid). */
export function unpaidFrom(job: PayJob & Pick<ScheduledJob, 'startDate'>, today: LocalDate): LocalDate {
  const last = lastPaydayOnOrBefore(job, today);
  const from = last ? addDays(last, 1 - job.payLagDays) : today;
  return job.startDate && job.startDate > from ? job.startDate : from;
}
