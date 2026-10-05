import type { LocalDate } from '../../shared/types.ts';
import { addDays, addMonths, dayStart, eachDay, endOfMonth, makeDate, startOfMonth, startOfWeek, ymd } from '../../shared/dates.ts';
import { dayLabel, dowShort, monthLong, monthShort, rangeLabel } from './format.ts';

export type Range = 'day' | 'week' | 'month' | 'year';

export interface Bucket {
  key: string;
  /** Axis label. */
  label: string;
  /** Full label for the detail panel and tooltips. */
  title: string;
  start: number;
  end: number;
  /** For day buckets. */
  date?: LocalDate;
}

export function periodBounds(range: Range, anchor: LocalDate, weekStartsOn: 0 | 1): { from: LocalDate; to: LocalDate } {
  switch (range) {
    case 'day':
      return { from: anchor, to: anchor };
    case 'week': {
      const from = startOfWeek(anchor, weekStartsOn);
      return { from, to: addDays(from, 6) };
    }
    case 'month':
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    case 'year':
      return { from: anchor.slice(0, 4) + '-01-01', to: anchor.slice(0, 4) + '-12-31' };
  }
}

export function shiftAnchor(range: Range, anchor: LocalDate, dir: number): LocalDate {
  switch (range) {
    case 'day':
      return addDays(anchor, dir);
    case 'week':
      return addDays(anchor, 7 * dir);
    case 'month':
      return addMonths(anchor, dir);
    case 'year':
      return addMonths(anchor, 12 * dir);
  }
}

export function periodTitle(range: Range, anchor: LocalDate, weekStartsOn: 0 | 1): string {
  const { from, to } = periodBounds(range, anchor, weekStartsOn);
  const [y, m] = ymd(anchor);
  switch (range) {
    case 'day':
      return dayLabel(anchor);
    case 'week':
      return rangeLabel(from, to);
    case 'month':
      return `${monthLong(m)} ${y}`;
    case 'year':
      return String(y);
  }
}

export function bucketsFor(range: Range, anchor: LocalDate, weekStartsOn: 0 | 1): Bucket[] {
  const { from, to } = periodBounds(range, anchor, weekStartsOn);
  if (range === 'day') {
    const base = dayStart(anchor);
    return Array.from({ length: 24 }, (_, h) => {
      const start = new Date(base);
      start.setHours(h);
      const end = new Date(base);
      end.setHours(h + 1);
      const h12 = h % 12 || 12;
      return {
        key: `h${h}`,
        label: `${h12}${h < 12 ? 'a' : 'p'}`,
        title: `${dayLabel(anchor)}, ${h12} ${h < 12 ? 'AM' : 'PM'}`,
        start: start.getTime(),
        end: end.getTime(),
      };
    });
  }
  if (range === 'year') {
    const y = Number(anchor.slice(0, 4));
    return Array.from({ length: 12 }, (_, i) => {
      const first = makeDate(y, i + 1, 1);
      return {
        key: first,
        label: monthShort(i + 1).slice(0, range === 'year' ? 3 : 1),
        title: `${monthLong(i + 1)} ${y}`,
        start: dayStart(first),
        end: dayStart(addMonths(first, 1)),
      };
    });
  }
  return eachDay(from, to).map((d) => ({
    key: d,
    label: range === 'week' ? dowShort(new Date(dayStart(d)).getDay()) : String(Number(d.slice(8))),
    title: dayLabel(d),
    start: dayStart(d),
    end: dayStart(addDays(d, 1)),
    date: d,
  }));
}

/** Which bucket holds `t`, or -1. */
export const bucketIndexAt = (buckets: Bucket[], t: number) => buckets.findIndex((b) => t >= b.start && t < b.end);
