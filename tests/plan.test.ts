import { describe, expect, it } from 'vitest';
import type { Goal, Saving, ScheduledJob, Shift } from '../shared/types.ts';
import { earningDays } from '../shared/bills.ts';
import { goalShares, goalStatus, planSetAsides, savingDueDates, savingShares, savingStatus } from '../shared/plan.ts';

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
const data = { jobs: [dayJob], overrides: [], gigs: [] };
const workdays = (d: string) => earningDays(data, '2026-09-01', '2027-03-31').has(d);
const sum = (m: Map<string, number>) => [...m.values()].reduce((t, v) => t + v, 0);

const saving = (over: Partial<Saving> = {}): Saving => ({
  id: 's1',
  updatedAt: 1,
  name: 'Savings',
  amount: 200,
  frequency: 'monthly',
  dueDate: '2026-10-31',
  startDate: '2026-10-05',
  ...over,
});

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  updatedAt: 1,
  kind: 'item',
  name: 'Headphones',
  targetDate: '2026-10-30',
  items: [{ id: 'i1', name: 'Headphones', price: 190, addedOn: '2026-10-05' }],
  ...over,
});

describe('savings', () => {
  it('splits a monthly amount across the workdays before it moves', () => {
    // Mon Oct 5 through Fri Oct 30: 20 workdays (Oct 31 is a Saturday).
    const shares = savingShares(saving(), '2026-10-01', '2026-10-31', workdays, data.jobs);
    expect(shares.size).toBe(20);
    expect(shares.get('2026-10-05')).toBeCloseTo(10, 6);
    expect(sum(shares)).toBeCloseTo(200, 6);
  });

  it('follows paydays for per-paycheck savings', () => {
    const s = saving({ frequency: 'paycheck', jobId: 'dayJob', amount: 100 });
    expect(savingDueDates(s, '2026-10-01', '2026-11-30', data.jobs)).toEqual(['2026-10-09', '2026-10-23', '2026-11-06', '2026-11-20']);
    // Oct 5 - Oct 9 is the first stretch: 5 workdays.
    expect(savingShares(s, '2026-10-05', '2026-10-09', workdays, data.jobs).get('2026-10-05')).toBeCloseTo(20, 6);
    // Oct 10 - Oct 23: 10 workdays.
    expect(savingShares(s, '2026-10-12', '2026-10-12', workdays, data.jobs).get('2026-10-12')).toBeCloseTo(10, 6);
  });

  it('stops at the target', () => {
    const s = saving({ amount: 100, frequency: 'weekly', dueDate: '2026-10-09', target: 250 });
    const shares = savingShares(s, '2026-10-01', '2026-12-31', workdays, data.jobs);
    expect(sum(shares)).toBeCloseTo(250, 6);
    expect([...shares.keys()].sort().at(-1)).toBe('2026-10-21');
    const st = savingStatus(s, '2026-12-01', workdays, data.jobs)!;
    expect(st.reachedTarget).toBe(true);
  });

  it('reports this period and the running total', () => {
    const st = savingStatus(saving(), '2026-10-07', workdays, data.jobs)!;
    expect(st.due).toBe('2026-10-31');
    expect(st.perDay).toBeCloseTo(10, 6);
    expect(st.savedThisPeriod).toBeCloseTo(30, 6);
    expect(st.savedTotal).toBeCloseTo(30, 6);
  });
});

describe('wish list and projects', () => {
  it('splits an item across the workdays until you want it', () => {
    // Oct 5 - Oct 30: 20 workdays.
    const shares = goalShares(goal(), '2026-10-01', '2026-11-30', workdays);
    expect(shares.size).toBe(20);
    expect(shares.get('2026-10-05')).toBeCloseTo(9.5, 6);
  });

  it('adds a project item from the day it was added without changing earlier days', () => {
    const g = goal({
      kind: 'project',
      name: 'Desk setup',
      items: [
        { id: 'a', name: 'Desk', price: 200, addedOn: '2026-10-05' },
        { id: 'b', name: 'Lamp', price: 30, addedOn: '2026-10-19' },
      ],
    });
    const shares = goalShares(g, '2026-10-01', '2026-11-30', workdays);
    expect(shares.get('2026-10-05')).toBeCloseTo(10, 6);
    // Oct 19 - Oct 30: 10 workdays for the lamp.
    expect(shares.get('2026-10-19')).toBeCloseTo(13, 6);
    expect(sum(shares)).toBeCloseTo(230, 6);
    const st = goalStatus(g, '2026-10-09', workdays);
    expect(st.total).toBe(230);
    expect(st.saved).toBeCloseTo(50, 6);
  });

  it('puts an item due today or earlier all on the day it was added', () => {
    const shares = goalShares(goal({ targetDate: '2026-10-01' }), '2026-10-01', '2026-10-31', workdays);
    expect([...shares.entries()]).toEqual([['2026-10-05', 190]]);
  });
});

describe('everything together', () => {
  it('adds bills, savings, and goals per day', () => {
    const plan = planSetAsides(
      {
        bills: [{ id: 'b1', updatedAt: 1, name: 'Phone', amount: 100, frequency: 'monthly', dueDate: '2026-10-15', categoryId: 'cat_bills', startDate: '2026-10-05' }],
        savings: [saving()],
        goals: [goal()],
      },
      data,
      '2026-10-05',
      '2026-10-05',
    );
    expect(plan.byKind.bills.get('2026-10-05')).toBeCloseTo(100 / 9, 6);
    expect(plan.byKind.savings.get('2026-10-05')).toBeCloseTo(10, 6);
    expect(plan.byKind.goals.get('2026-10-05')).toBeCloseTo(9.5, 6);
    expect(plan.byDay.get('2026-10-05')).toBeCloseTo(100 / 9 + 19.5, 6);
  });
});

describe('leftover money toward a goal', () => {
  const everyDay = () => true;
  // $100 over Oct 1-10, every day: $10 a day.
  const g = goal({ targetDate: '2026-10-10', items: [{ id: 'i1', name: 'Shoes', price: 100, addedOn: '2026-10-01' }] });
  const moves = [{ date: '2026-10-06', amount: 30 }];

  it('shrinks the days after the money moved, and leaves the days before alone', () => {
    const shares = goalShares(g, '2026-10-01', '2026-10-10', everyDay, moves);
    expect(shares.get('2026-10-05')).toBeCloseTo(10, 6);
    expect(shares.get('2026-10-06')).toBeCloseTo(4, 6);
    expect(sum(shares) + 30).toBeCloseTo(100, 6);
  });

  it('counts the money moved as saved', () => {
    const st = goalStatus(g, '2026-10-06', everyDay, moves);
    expect(st).toMatchObject({ total: 100, moved: 30 });
    expect(st.saved).toBeCloseTo(84, 6);
    expect(st.left).toBeCloseTo(16, 6);
    expect(st.perDay).toBeCloseTo(4, 6);
    // Moving everything that's left finishes it.
    expect(goalStatus(g, '2026-10-06', everyDay, [{ date: '2026-10-06', amount: 50 }]).left).toBeCloseTo(0, 6);
  });
});
