import type { DayOverride, GigSession, Job, LocalDate, ScheduledJob, Shift } from './types.ts';
import { addDays, atMinutes, dayStart, eachDay, minutesOf, nextHour, toLocalDate, weekday } from './dates.ts';
import { dayPaidHours, hourlyRate, shiftSpanMinutes } from './pay.ts';

export type SegmentKind = 'work' | 'pto' | 'gig';

/** A stretch of time during which `value` dollars accrue evenly. */
export interface Segment {
  jobId: string;
  kind: SegmentKind;
  /** The day the work belongs to (the day the shift starts). */
  date: LocalDate;
  start: number;
  end: number;
  value: number;
  /** Gig session id. */
  refId?: string;
  /** A dash that's still running. It has no projected future. */
  active?: boolean;
}

/** Paid blocks for one shift on one day, with the unpaid break cut out. */
export function shiftBlocks(date: LocalDate, s: Shift): Array<[number, number]> {
  const startMin = minutesOf(s.start);
  const span = shiftSpanMinutes(s);
  const start = atMinutes(date, startMin);
  const end = atMinutes(date, startMin + span);
  const brk = Math.min(Math.max(0, s.breakMinutes ?? 0), span);
  if (brk === 0) return [[start, end]];
  let breakAt = s.breakStart ? minutesOf(s.breakStart) : startMin + Math.round((span - brk) / 2);
  if (breakAt < startMin) breakAt += 1440;
  breakAt = Math.min(breakAt, startMin + span - brk);
  const bs = atMinutes(date, breakAt);
  const be = atMinutes(date, breakAt + brk);
  const out: Array<[number, number]> = [];
  if (bs > start) out.push([start, bs]);
  if (end > be) out.push([be, end]);
  return out;
}

/** What a scheduled job earns on one day, as segments spread over the paid blocks. */
export function scheduledDaySegments(job: ScheduledJob, date: LocalDate, override?: DayOverride): Segment[] {
  if (job.startDate && date < job.startDate) return [];
  if (job.endDate && date > job.endDate) return [];
  const base = job.schedule[weekday(date)] ?? [];
  const rate = hourlyRate(job);
  let shifts = base;
  let kind: SegmentKind = 'work';
  let value = rate * dayPaidHours(base);
  if (override && !override.deleted) {
    if (override.type === 'off_unpaid') return [];
    if (override.type === 'off_paid') kind = 'pto';
    if (override.type === 'custom') {
      shifts = override.shifts ?? [];
      if (!job.salaried) value = rate * dayPaidHours(shifts);
    }
  }
  const blocks = shifts.flatMap((s) => shiftBlocks(date, s));
  const total = blocks.reduce((t, [a, b]) => t + (b - a), 0);
  if (total <= 0) return [];
  return blocks.map(([a, b]) => ({ jobId: job.id, kind, date, start: a, end: b, value: (value * (b - a)) / total }));
}

export function gigSegment(g: GigSession, now: number): Segment | null {
  let end = g.end ?? Math.max(now, g.start);
  if (end - g.start < 1000) end = g.start + 1000;
  return {
    jobId: g.jobId,
    kind: 'gig',
    date: toLocalDate(g.start),
    start: g.start,
    end,
    value: g.earnings,
    refId: g.id,
    active: g.end == null,
  };
}

export interface EngineData {
  jobs: Job[];
  overrides: DayOverride[];
  gigs: GigSession[];
}

const overrideKey = (jobId: string, date: LocalDate) => `${jobId}|${date}`;

/** All earning segments that touch the days `from`..`to` (inclusive). */
export function buildSegments(data: EngineData, from: LocalDate, to: LocalDate, now: number): Segment[] {
  const overrides = new Map<string, DayOverride>();
  for (const o of data.overrides) if (!o.deleted) overrides.set(overrideKey(o.jobId, o.date), o);
  const out: Segment[] = [];
  // Start a day early so overnight shifts that spill into the range are included.
  const days = eachDay(addDays(from, -1), to);
  for (const job of data.jobs) {
    if (job.deleted || job.kind !== 'scheduled') continue;
    for (const d of days) out.push(...scheduledDaySegments(job, d, overrides.get(overrideKey(job.id, d))));
  }
  const lo = dayStart(from);
  const hi = dayStart(addDays(to, 1));
  for (const g of data.gigs) {
    if (g.deleted) continue;
    const seg = gigSegment(g, now);
    if (seg && seg.end > lo && seg.start < hi) out.push(seg);
  }
  return out;
}

export function overlapMs(seg: Segment, a: number, b: number): number {
  return Math.max(0, Math.min(seg.end, b) - Math.max(seg.start, a));
}

export function valueIn(seg: Segment, a: number, b: number): number {
  const o = overlapMs(seg, a, b);
  return o > 0 ? (seg.value * o) / (seg.end - seg.start) : 0;
}

export interface Tally {
  /** Earned so far (up to now), PTO included. */
  value: number;
  /** The PTO part of value. */
  ptoValue: number;
  /** Hours worked so far (work + gig, not PTO). */
  hours: number;
  ptoHours: number;
  /** Still to come in the window, per the schedule. */
  projected: number;
  projectedHours: number;
}

export interface BucketTally extends Tally {
  byJob: Record<string, Tally>;
}

const emptyTally = (): Tally => ({ value: 0, ptoValue: 0, hours: 0, ptoHours: 0, projected: 0, projectedHours: 0 });

function addTo(t: Tally, kind: SegmentKind, v: number, h: number, pv: number, ph: number) {
  t.value += v;
  t.projected += pv;
  if (kind === 'pto') {
    t.ptoHours += h + ph;
    t.ptoValue += v;
  } else {
    t.hours += h;
    t.projectedHours += ph;
  }
}

/** Earnings and hours inside [a, b), split into what's happened by `now` and what's still scheduled. */
export function tally(segs: Segment[], a: number, b: number, now: number, jobId?: string): BucketTally {
  const out: BucketTally = { ...emptyTally(), byJob: {} };
  const cut = Math.min(Math.max(now, a), b);
  for (const s of segs) {
    if (jobId && s.jobId !== jobId) continue;
    const v = valueIn(s, a, cut);
    const h = overlapMs(s, a, cut) / 3_600_000;
    const pv = s.active ? 0 : valueIn(s, cut, b);
    const ph = s.active ? 0 : overlapMs(s, cut, b) / 3_600_000;
    if (v === 0 && h === 0 && pv === 0 && ph === 0) continue;
    addTo((out.byJob[s.jobId] ??= emptyTally()), s.kind, v, h, pv, ph);
    addTo(out, s.kind, v, h, pv, ph);
  }
  return out;
}

/** Dollars earned in [a, min(b, now)). */
export function earnedBetween(segs: Segment[], a: number, b: number, now: number): number {
  const end = Math.min(b, now);
  let t = 0;
  for (const s of segs) t += valueIn(s, a, end);
  return t;
}

/** Splits a segment at local clock-hour boundaries: the hourly "deposits". */
export function hourlyChunks(seg: Segment): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let a = seg.start; a < seg.end; ) {
    const b = Math.min(nextHour(a), seg.end);
    out.push([a, b]);
    a = b;
  }
  return out;
}
