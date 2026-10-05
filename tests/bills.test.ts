import { describe, expect, it } from 'vitest';
import type { Bill, DayOverride, ScheduledJob, Shift } from '../shared/types.ts';
import { billShares, billStatus, dueDatesBetween, earningDays, planBills, saveWindow } from '../shared/bills.ts';

const nineToFive: Shift = { start: '08:00', end: '17:00', breakMinutes: 60, breakStart: '12:00' };
const dayJob: ScheduledJob = {
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
};
const data = { jobs: [dayJob], overrides: [] as DayOverride[], gigs: [] };

const bill = (over: Partial<Bill> = {}): Bill => ({
  id: 'b1',
  updatedAt: 1,
  name: 'Phone',
  amount: 100,
  frequency: 'monthly',
  dueDate: '2026-10-15',
  categoryId: 'cat_bills',
  startDate: '2026-10-05',
  ...over,
});

const workdays = (d: string) => earningDays(data, '2026-09-01', '2027-01-31').has(d);
const sum = (m: Map<string, number>) => [...m.values()].reduce((t, v) => t + v, 0);

describe('due dates', () => {
  it('repeats monthly on the same day, and on the last day for 31', () => {
    expect(dueDatesBetween(bill(), '2026-10-01', '2026-12-31')).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
    expect(dueDatesBetween(bill({ dueDate: '2026-01-31' }), '2027-01-01', '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('handles weekly, quarterly, and yearly bills', () => {
    expect(dueDatesBetween(bill({ frequency: 'weekly', dueDate: '2026-10-09' }), '2026-10-01', '2026-10-20')).toEqual(['2026-10-02', '2026-10-09', '2026-10-16']);
    expect(dueDatesBetween(bill({ frequency: 'quarterly' }), '2026-01-01', '2027-01-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15', '2027-01-15']);
    expect(dueDatesBetween(bill({ frequency: 'yearly', dueDate: '2026-03-01' }), '2026-10-01', '2027-12-31')).toEqual(['2027-03-01']);
  });
});

describe('spreading a bill over workdays', () => {
  it('spreads the first payment from the start date to the due date', () => {
    // Mon Oct 5 through Thu Oct 15 has 9 workdays.
    const shares = billShares(bill(), '2026-10-01', '2026-10-15', workdays);
    expect(shares.size).toBe(9);
    expect(shares.get('2026-10-05')).toBeCloseTo(100 / 9, 6);
    expect(shares.has('2026-10-10')).toBe(false); // Saturday
    expect(sum(shares)).toBeCloseTo(100, 6);
  });

  it('spreads later payments over the whole cycle', () => {
    // Fri Oct 16 through Sun Nov 15 has 21 workdays.
    const shares = billShares(bill(), '2026-10-16', '2026-11-15', workdays);
    expect(shares.size).toBe(21);
    expect(sum(shares)).toBeCloseTo(100, 6);
  });

  it('can spread over every day instead', () => {
    const shares = billShares(bill(), '2026-10-01', '2026-10-15', () => true);
    expect(shares.size).toBe(11);
    expect(shares.get('2026-10-10')).toBeCloseTo(100 / 11, 6);
  });

  it('moves shares off unpaid days off', () => {
    const off: DayOverride = { id: 'o', updatedAt: 1, jobId: 'dayJob', date: '2026-10-07', type: 'off_unpaid' };
    const plan = planBills([bill()], { ...data, overrides: [off] }, '2026-10-05', '2026-10-15');
    expect(plan.byDay.has('2026-10-07')).toBe(false);
    expect(plan.byDay.get('2026-10-05')).toBeCloseTo(100 / 8, 6);
  });

  it('stops after the end date', () => {
    expect(saveWindow(bill({ endDate: '2026-10-20' }), '2026-11-15')).toBeNull();
    expect(billShares(bill({ endDate: '2026-10-20' }), '2026-10-16', '2026-11-15', workdays).size).toBe(0);
  });

  it('spreads a weekly bill over the five workdays before it', () => {
    const weekly = bill({ frequency: 'weekly', dueDate: '2026-10-16', amount: 35, startDate: '2026-10-01' });
    const shares = billShares(weekly, '2026-10-10', '2026-10-16', workdays);
    expect([...shares.keys()]).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(shares.get('2026-10-12')).toBeCloseTo(7, 6);
  });

  it('adds up several bills per day', () => {
    const plan = planBills([bill(), bill({ id: 'b2', amount: 45, name: 'Netflix' })], data, '2026-10-05', '2026-10-05');
    expect(plan.byDay.get('2026-10-05')).toBeCloseTo(145 / 9, 6);
  });
});

describe('bill status', () => {
  it('tracks what is set aside so far', () => {
    const s = billStatus(bill(), '2026-10-07', workdays)!;
    expect(s.due).toBe('2026-10-15');
    expect(s.perDay).toBeCloseTo(100 / 9, 6);
    expect(s.savedSoFar).toBeCloseTo((100 / 9) * 3, 6);
    expect(s.daysLeft).toBe(6);
  });

  it('saves toward the next payment when the bill starts after this one', () => {
    const s = billStatus(bill({ startDate: '2026-10-16' }), '2026-10-12', workdays)!;
    expect(s.due).toBe('2026-11-15');
    expect(s.savedSoFar).toBe(0);
  });
});
