import type { LocalDate } from './types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalDate(t: number | Date): LocalDate {
  const d = typeof t === 'number' ? new Date(t) : t;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ymd(d: LocalDate): [number, number, number] {
  return [Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))];
}

export function makeDate(y: number, m: number, day: number): LocalDate {
  return `${y}-${pad(m)}-${pad(day)}`;
}

export function toDate(d: LocalDate): Date {
  const [y, m, day] = ymd(d);
  return new Date(y, m - 1, day);
}

/** Local midnight at the start of the day, in ms. */
export function dayStart(d: LocalDate): number {
  return toDate(d).getTime();
}

/** Local midnight at the end of the day (start of the next day), in ms. */
export function dayEnd(d: LocalDate): number {
  return dayStart(addDays(d, 1));
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const [y, m, day] = ymd(d);
  return toLocalDate(new Date(y, m - 1, day + n));
}

/** First day of the month `n` months away. */
export function addMonths(d: LocalDate, n: number): LocalDate {
  const [y, m] = ymd(d);
  return toLocalDate(new Date(y, m - 1 + n, 1));
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(d: LocalDate): number {
  return toDate(d).getDay();
}

/** Whole days from `a` to `b` (b - a), unaffected by daylight saving. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = ymd(a);
  const [by, bm, bd] = ymd(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Every day from `from` to `to`, inclusive. */
export function eachDay(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfWeek(d: LocalDate, weekStartsOn: 0 | 1): LocalDate {
  return addDays(d, -((weekday(d) - weekStartsOn + 7) % 7));
}

export function startOfMonth(d: LocalDate): LocalDate {
  return d.slice(0, 8) + '01';
}

/** Days in month `m` (1-12) of year `y`. */
export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function endOfMonth(d: LocalDate): LocalDate {
  const [y, m] = ymd(d);
  return makeDate(y, m, daysInMonth(y, m));
}

/** Minutes since midnight for an 'HH:MM' string. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function hhmm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Local wall-clock time `minutes` after the start of day `d` (may run past midnight). */
export function atMinutes(d: LocalDate, minutes: number): number {
  const [y, m, day] = ymd(d);
  return new Date(y, m - 1, day, 0, minutes).getTime();
}

export function at(d: LocalDate, time: string): number {
  return atMinutes(d, minutesOf(time));
}

/** The next local clock-hour boundary strictly after `t`. */
export function nextHour(t: number): number {
  const d = new Date(t);
  d.setMinutes(60, 0, 0);
  return d.getTime();
}
