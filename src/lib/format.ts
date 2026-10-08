import type { LocalDate } from '../../shared/types.ts';
import { addDays, diffDays, minutesOf, toDate, ymd } from '../../shared/dates.ts';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const clean = (v: number) => (Math.abs(v) < 0.005 ? 0 : v);

export const money = (v: number) => usd.format(clean(v));
export const moneyWhole = (v: number) => usdWhole.format(clean(v));
/** "+$12.00" / "−$12.00" with a true minus sign. */
export const signed = (v: number) => (clean(v) < 0 ? '−' : '+') + usd.format(Math.abs(clean(v)));
export const minus = (v: number) => '−' + usd.format(Math.abs(clean(v)));

/** Short axis labels: $0, $80, $1.2k. */
export function moneyAxis(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10_000 || v % 1000 === 0 ? 0 : 1)}k`;
  return `$${Math.round(v)}`;
}

export function hrs(h: number): string {
  if (h <= 0) return '0 hrs';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const r = Math.round(h * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} ${r === 1 ? 'hr' : 'hrs'}`;
}

function parts(t: number) {
  const d = new Date(t);
  const h = d.getHours();
  return { h12: h % 12 || 12, m: d.getMinutes(), pm: h >= 12 };
}

const piece = (p: ReturnType<typeof parts>, withSuffix: boolean) =>
  `${p.h12}${p.m ? ':' + String(p.m).padStart(2, '0') : ''}${withSuffix ? (p.pm ? ' PM' : ' AM') : ''}`;

/** "1:47 PM". */
export function clock(t: number): string {
  const p = parts(t);
  return `${p.h12}:${String(p.m).padStart(2, '0')} ${p.pm ? 'PM' : 'AM'}`;
}

/** "8 AM", "8:30 AM". */
export function clockShort(t: number): string {
  return piece(parts(t), true);
}

/** "9–10 AM", "11 AM–12 PM", "5:30–8:45 PM". */
export function timeRange(a: number, b: number): string {
  const pa = parts(a);
  const pb = parts(b);
  return pa.pm === pb.pm ? `${piece(pa, false)}–${piece(pb, true)}` : `${piece(pa, true)}–${piece(pb, true)}`;
}

/** "08:00" -> "8 AM". */
export function hhmmLabel(s: string): string {
  const m = minutesOf(s) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}${m % 60 ? ':' + String(m % 60).padStart(2, '0') : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const dowShort = (wd: number) => DOW[wd];
export const dowLong = (wd: number) => DOW_LONG[wd];
export const monthShort = (m: number) => MON[m - 1];
export const monthLong = (m: number) => MON_LONG[m - 1];

/** "1st", "22nd", "13th". */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const end = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${end}`;
}

/** The day of the month something repeats on: "the 5th", or "the last day" for the 31st. */
export function monthDay(d: LocalDate): string {
  const n = Number(d.slice(8));
  return n === 31 ? 'the last day' : `the ${ordinal(n)}`;
}

/** "Fri, Oct 2". */
export function dayLabel(d: LocalDate): string {
  const [, m, day] = ymd(d);
  return `${DOW[toDate(d).getDay()]}, ${MON[m - 1]} ${day}`;
}

/** "Friday, October 2". */
export function dayLabelLong(d: LocalDate): string {
  const [, m, day] = ymd(d);
  return `${DOW_LONG[toDate(d).getDay()]}, ${MON_LONG[m - 1]} ${day}`;
}

export function relativeDay(d: LocalDate, today: LocalDate): string {
  const n = diffDays(today, d);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  return dayLabel(d);
}

/** "Sep 28 – Oct 4", "Oct 5 – 11". */
export function rangeLabel(from: LocalDate, to: LocalDate): string {
  const [fy, fm, fd] = ymd(from);
  const [ty, tm, td] = ymd(to);
  if (fy !== ty) return `${MON[fm - 1]} ${fd}, ${fy} – ${MON[tm - 1]} ${td}, ${ty}`;
  if (fm === tm) return `${MON[fm - 1]} ${fd} – ${td}`;
  return `${MON[fm - 1]} ${fd} – ${MON[tm - 1]} ${td}`;
}

/** "1:12:05" for a running timer. */
export function stopwatch(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function daysUntil(d: LocalDate, today: LocalDate): string {
  const n = diffDays(today, d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

export { addDays };
