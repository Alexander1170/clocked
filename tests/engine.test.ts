import { describe, expect, it } from 'vitest';
import type { DayOverride, GigSession, ScheduledJob, Shift } from '../shared/types.ts';
import { addDays, at, dayEnd, dayStart, diffDays, eachDay, startOfWeek } from '../shared/dates.ts';
import {
  hourlyRate,
  lastPaydayOnOrBefore,
  nextPaydayOnOrAfter,
  paydaysBetween,
  periodForPayday,
  unpaidFrom,
  weeklyPaidHours,
} from '../shared/pay.ts';
import { buildSegments, earnedBetween, hourlyChunks, scheduledDaySegments, shiftBlocks, tally } from '../shared/accrual.ts';

const nineToFive: Shift = { start: '08:00', end: '17:00', breakMinutes: 60, breakStart: '12:00' };

function dayJob(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'dayJob',
    updatedAt: 1,
    kind: 'scheduled',
    name: 'Day job',
    color: 1,
    salaried: true,
    takeHome: 1480,
    frequency: 'biweekly',
    payday: '2026-10-09',
    payLagDays: 6,
    schedule: [[], [nineToFive], [nineToFive], [nineToFive], [nineToFive], [nineToFive], []],
    ...over,
  };
}

const ov = (date: string, type: DayOverride['type'], shifts?: Shift[]): DayOverride => ({
  id: `o-${date}`,
  updatedAt: 1,
  jobId: 'dayJob',
  date,
  type,
  shifts,
});

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('pay rate', () => {
  it('turns a biweekly take-home check into an hourly rate', () => {
    expect(weeklyPaidHours(dayJob())).toBe(40);
    close(hourlyRate(dayJob()), 18.5);
  });

  it('annualizes twice-a-month and monthly pay', () => {
    close(hourlyRate(dayJob({ frequency: 'semimonthly', takeHome: 1600 })), (1600 * 24) / (40 * 52));
    close(hourlyRate(dayJob({ frequency: 'monthly', takeHome: 3200 })), (3200 * 12) / (40 * 52));
  });

  it('is zero with no schedule', () => {
    expect(hourlyRate(dayJob({ schedule: [[], [], [], [], [], [], []] }))).toBe(0);
  });
});

describe('shifts', () => {
  it('cuts the unpaid lunch out of the shift', () => {
    const blocks = shiftBlocks('2026-10-02', nineToFive);
    expect(blocks).toEqual([
      [at('2026-10-02', '08:00'), at('2026-10-02', '12:00')],
      [at('2026-10-02', '13:00'), at('2026-10-02', '17:00')],
    ]);
  });

  it('puts a break with no start time in the middle', () => {
    const blocks = shiftBlocks('2026-10-02', { start: '09:00', end: '17:00', breakMinutes: 30 });
    expect(blocks[0][1]).toBe(at('2026-10-02', '12:45'));
    expect(blocks[1][0]).toBe(at('2026-10-02', '13:15'));
  });

  it('handles overnight shifts', () => {
    const [[a, b]] = shiftBlocks('2026-10-02', { start: '22:00', end: '06:00' });
    expect(a).toBe(at('2026-10-02', '22:00'));
    expect(b).toBe(at('2026-10-03', '06:00'));
  });
});

describe('daily accrual', () => {
  it('earns a full day on a scheduled weekday and nothing on the weekend', () => {
    const fri = scheduledDaySegments(dayJob(), '2026-10-02');
    close(fri.reduce((t, s) => t + s.value, 0), 148);
    expect(scheduledDaySegments(dayJob(), '2026-10-03')).toEqual([]);
  });

  it('applies day edits', () => {
    const job = dayJob();
    expect(scheduledDaySegments(job, '2026-10-02', ov('2026-10-02', 'off_unpaid'))).toEqual([]);
    const pto = scheduledDaySegments(job, '2026-10-02', ov('2026-10-02', 'off_paid'));
    expect(pto.every((s) => s.kind === 'pto')).toBe(true);
    close(pto.reduce((t, s) => t + s.value, 0), 148);
    // Salary: different hours keep the day's pay.
    const short = scheduledDaySegments(job, '2026-10-02', ov('2026-10-02', 'custom', [{ start: '08:00', end: '12:00' }]));
    close(short.reduce((t, s) => t + s.value, 0), 148);
    // Hourly: pay follows the hours.
    const hourly = scheduledDaySegments(dayJob({ salaried: false }), '2026-10-02', ov('2026-10-02', 'custom', [{ start: '07:00', end: '17:00' }]));
    close(hourly.reduce((t, s) => t + s.value, 0), 185);
  });

  it('respects start and end dates', () => {
    expect(scheduledDaySegments(dayJob({ startDate: '2026-10-05' }), '2026-10-02')).toEqual([]);
    expect(scheduledDaySegments(dayJob({ endDate: '2026-10-01' }), '2026-10-02')).toEqual([]);
  });
});

describe('paydays', () => {
  it('steps every two weeks in both directions from the anchor', () => {
    expect(paydaysBetween(dayJob(), '2026-09-20', '2026-10-31')).toEqual(['2026-09-25', '2026-10-09', '2026-10-23']);
    expect(lastPaydayOnOrBefore(dayJob(), '2026-10-02')).toBe('2026-09-25');
    expect(lastPaydayOnOrBefore(dayJob(), '2026-10-09')).toBe('2026-10-09');
    expect(nextPaydayOnOrAfter(dayJob(), '2026-10-03')).toBe('2026-10-09');
  });

  it('works out the period a check covers', () => {
    expect(periodForPayday(dayJob(), '2026-10-09')).toEqual({ from: '2026-09-20', to: '2026-10-03' });
  });

  it('moves twice-a-month weekend paydays to Friday', () => {
    const job = dayJob({ frequency: 'semimonthly', semimonthlyDays: [15, 31] });
    // Oct 31 2026 is a Saturday, Nov 15 a Sunday.
    expect(paydaysBetween(job, '2026-10-01', '2026-11-30')).toEqual(['2026-10-15', '2026-10-30', '2026-11-13', '2026-11-30']);
  });

  it('finds the first unpaid day', () => {
    expect(unpaidFrom(dayJob(), '2026-10-02')).toBe('2026-09-20');
    expect(unpaidFrom(dayJob(), '2026-10-09')).toBe('2026-10-04');
  });
});

describe('earned, not paid yet', () => {
  it('adds up the unpaid days plus today so far', () => {
    const now = at('2026-10-02', '13:47');
    const from = unpaidFrom(dayJob(), '2026-10-02');
    const segs = buildSegments({ jobs: [dayJob()], overrides: [], gigs: [] }, from, '2026-10-02', now);
    close(earnedBetween(segs, dayStart(from), dayEnd('2026-10-02'), now), 1332 + 18.5 * (4 + 47 / 60));
  });
});

describe('tally', () => {
  it('splits a day into earned so far and still to come', () => {
    const now = at('2026-10-02', '13:47');
    const segs = buildSegments({ jobs: [dayJob()], overrides: [], gigs: [] }, '2026-10-02', '2026-10-02', now);
    const t = tally(segs, dayStart('2026-10-02'), dayEnd('2026-10-02'), now);
    close(t.value, 18.5 * (4 + 47 / 60));
    close(t.value + t.projected, 148);
    close(t.hours + t.projectedHours, 8);
  });

  it('counts gig sessions and running dashes', () => {
    const gig: GigSession = { id: 'g1', updatedAt: 1, jobId: 'dd', start: at('2026-09-29', '17:30'), end: at('2026-09-29', '20:45'), earnings: 62.4 };
    const live: GigSession = { id: 'g2', updatedAt: 1, jobId: 'dd', start: at('2026-10-02', '18:00'), end: null, earnings: 9.5 };
    const now = at('2026-10-02', '19:00');
    const segs = buildSegments({ jobs: [], overrides: [], gigs: [gig, live] }, '2026-09-28', '2026-10-04', now);
    const week = tally(segs, dayStart('2026-09-28'), dayEnd('2026-10-04'), now, 'dd');
    close(week.value, 71.9);
    close(week.hours, 4.25);
    expect(week.projected).toBe(0);
  });

  it('keeps PTO out of worked hours', () => {
    const now = at('2026-10-03', '12:00');
    const segs = buildSegments({ jobs: [dayJob()], overrides: [ov('2026-10-02', 'off_paid')], gigs: [] }, '2026-10-02', '2026-10-02', now);
    const t = tally(segs, dayStart('2026-10-02'), dayEnd('2026-10-02'), now);
    close(t.value, 148);
    expect(t.hours).toBe(0);
    close(t.ptoHours, 8);
  });
});

describe('hourly deposits', () => {
  it('splits a block at clock hours', () => {
    const [seg] = buildSegments({ jobs: [dayJob()], overrides: [], gigs: [] }, '2026-10-02', '2026-10-02', 0).filter(
      (s) => s.date === '2026-10-02',
    );
    expect(hourlyChunks(seg).length).toBe(4);
    expect(hourlyChunks({ ...seg, start: at('2026-10-02', '08:30') }).length).toBe(4);
  });
});

describe('dates', () => {
  it('survives the daylight saving change', () => {
    expect(eachDay('2026-10-31', '2026-11-02')).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(diffDays('2026-10-31', '2026-11-02')).toBe(2);
    const mon = scheduledDaySegments(dayJob(), '2026-11-02');
    close(mon.reduce((t, s) => t + (s.end - s.start), 0) / 3_600_000, 8);
  });

  it('finds the start of the week', () => {
    expect(startOfWeek('2026-10-02', 1)).toBe('2026-09-28');
    expect(startOfWeek('2026-10-02', 0)).toBe('2026-09-27');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
