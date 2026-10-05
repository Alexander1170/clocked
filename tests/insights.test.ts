import { describe, expect, it } from 'vitest';
import type { Bill, GigSession, Saving, ScheduledJob } from '../shared/types.ts';
import { dayStart } from '../shared/dates.ts';
import {
  cumulative,
  foodPlan,
  gigPayBetween,
  isFoodCategory,
  monthlyBills,
  monthlySavings,
  monthlyTakeHome,
  monthSplit,
  saveIdea,
  setAsideBetween,
  untilPayday,
} from '../src/lib/insights.ts';

const job: ScheduledJob = {
  id: 'job',
  updatedAt: 1,
  kind: 'scheduled',
  name: 'Job',
  color: 1,
  salaried: true,
  takeHome: 2000,
  frequency: 'biweekly',
  payday: '2026-10-16',
  payLagDays: 0,
  schedule: [[], [], [], [], [], [], []],
};
const bill = (over: Partial<Bill>): Bill => ({ id: 'b', updatedAt: 1, name: 'Bill', amount: 100, frequency: 'monthly', dueDate: '2026-10-15', categoryId: 'cat_bills', startDate: '2026-10-01', ...over });
const saving = (over: Partial<Saving>): Saving => ({ id: 's', updatedAt: 1, name: 'Savings', amount: 100, frequency: 'monthly', dueDate: '2026-10-31', startDate: '2026-10-01', ...over });

describe('monthly averages', () => {
  it('turns pay, bills, and savings into an average month', () => {
    expect(monthlyTakeHome([job])).toBeCloseTo((2000 * 26) / 12, 6);
    expect(monthlyTakeHome([{ ...job, archived: true }])).toBe(0);
    expect(monthlyBills([bill({ amount: 1000 }), bill({ amount: 10, frequency: 'weekly' }), bill({ amount: 120, frequency: 'yearly' }), bill({ deleted: true })])).toBeCloseTo(
      1000 + (10 * 52) / 12 + 10,
      6,
    );
    expect(monthlySavings([saving({ amount: 100, frequency: 'paycheck', jobId: 'job' }), saving({ amount: 50 })], [job])).toBeCloseTo((100 * 26) / 12 + 50, 6);
  });
});

describe('food', () => {
  it('suggests about 12% of take-home, but leaves room for everything else', () => {
    expect(foodPlan(4000, 2000, 0)).toEqual({ weekly: 110, mine: false });
    // Heavy bills: no more than 40% of the $500 that's free.
    expect(foodPlan(4000, 3500, 0).weekly).toBe(45);
    expect(foodPlan(4000, 4500, 0).weekly).toBe(0);
    expect(foodPlan(4000, 2000, 0, 150)).toEqual({ weekly: 150, mine: true });
  });

  it('counts groceries, eating out, and your own food categories', () => {
    expect(isFoodCategory({ id: 'cat_groceries', icon: 'cart' })).toBe(true);
    expect(isFoodCategory({ id: 'mine', icon: 'coffee' })).toBe(true);
    expect(isFoodCategory({ id: 'cat_gas', icon: 'fuel' })).toBe(false);
    expect(isFoodCategory(undefined)).toBe(false);
  });
});

describe('saving more', () => {
  const base = { takeHomeMonthly: 4000, billsMonthly: 2000, savingsMonthly: 0, foodMonthly: 480, checksPerYear: 26 };

  it('starts from 10% of take-home, then follows real spending', () => {
    expect(saveIdea(base)).toEqual({ monthly: 400, perCheck: 185, basis: 'rule' });
    expect(saveIdea({ ...base, spendingMonthly: 1500 })).toEqual({ monthly: 250, perCheck: 115, basis: 'spending' });
  });

  it('suggests nothing when there is no room', () => {
    expect(saveIdea({ ...base, spendingMonthly: 2100 })).toBeNull();
    expect(saveIdea({ ...base, billsMonthly: 3900 })).toBeNull();
  });
});

describe('until payday', () => {
  it('takes the check, less bills, savings, and spending, plus gig pay, over the days left', () => {
    const u = untilPayday({ check: 2000, bills: 1200, saving: 100, gig: 50, spent: 250, today: '2026-10-05', nextPayday: '2026-10-13' });
    expect(u).toEqual({ start: 700, free: 500, daysLeft: 8, perDay: 62.5 });
  });

  it('adds up savings set-asides and gig pay in the stretch', () => {
    const plan = {
      byKind: {
        bills: new Map([['2026-10-05', 99]]),
        savings: new Map([
          ['2026-10-04', 5],
          ['2026-10-05', 5],
        ]),
        goals: new Map([['2026-10-06', 2]]),
      },
    };
    expect(setAsideBetween(plan, '2026-10-05', '2026-10-12')).toBe(7);
    const gig = (start: number, earnings: number): GigSession => ({ id: String(start), updatedAt: 1, jobId: 'dash', start, end: start + 3_600_000, earnings });
    const gigs = [gig(dayStart('2026-10-04'), 20), gig(dayStart('2026-10-05') + 3_600_000, 30), gig(dayStart('2026-10-07'), 40)];
    expect(gigPayBetween(gigs, '2026-10-05', '2026-10-06', dayStart('2026-10-06'))).toBe(30);
  });
});

describe('month split', () => {
  it('shows what is still free, or how far over', () => {
    expect(monthSplit({ pay: 4000, bills: 2500, saving: 200, spent: 300 })).toEqual({ free: 1000, over: 0 });
    expect(monthSplit({ pay: 4000, bills: 2500, saving: 200, spent: 1500 })).toEqual({ free: 0, over: 200 });
    expect(cumulative([1, 2, 3])).toEqual([1, 3, 6]);
  });
});
