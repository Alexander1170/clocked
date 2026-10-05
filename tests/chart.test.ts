import { describe, expect, it } from 'vitest';
import type { LocalDate, Transaction } from '../shared/types.ts';
import { setAsideInSpans, spentInSpans, splitDay } from '../src/lib/money.ts';
import { bucketsFor } from '../src/lib/periods.ts';
import { addDays } from '../shared/dates.ts';

describe('splitDay (the Left chart stack)', () => {
  it('stacks set aside and spending inside the day’s pay', () => {
    const s = splitDay({ earned: 200, setAside: 40, spent: 30 });
    expect(s).toMatchObject({ pay: 200, asideCovered: 40, spentCovered: 30, left: 130, asideOver: 0, spentOver: 0, net: 130 });
  });

  it('carries spending past $0 when it eats the rest of the pay', () => {
    const s = splitDay({ earned: 200, setAside: 40, spent: 260 });
    expect(s).toMatchObject({ asideCovered: 40, spentCovered: 160, left: 0, asideOver: 0, spentOver: 100, net: -100 });
  });

  it('puts the whole set-aside below $0 on a day with no pay', () => {
    const s = splitDay({ earned: 0, setAside: 25, spent: 10 });
    expect(s).toMatchObject({ pay: 0, asideCovered: 0, spentCovered: 0, left: 0, asideOver: 25, spentOver: 10, net: -35 });
  });

  it('splits a set-aside bigger than the pay across $0', () => {
    const s = splitDay({ earned: 20, setAside: 50, spent: 5 });
    expect(s).toMatchObject({ asideCovered: 20, spentCovered: 0, left: 0, asideOver: 30, spentOver: 5, net: -35 });
  });

  it('adds a refund back to the day', () => {
    const s = splitDay({ earned: 100, setAside: 20, spent: -15 });
    expect(s).toMatchObject({ pay: 115, asideCovered: 20, spentCovered: 0, left: 95, net: 95 });
  });

  it('always adds up: the bar above $0 is the pay, and what hangs below is the shortfall', () => {
    for (const d of [
      { earned: 148, setAside: 56.11, spent: 47.65 },
      { earned: 30, setAside: 56.11, spent: 400 },
      { earned: 0, setAside: 12.5, spent: 0 },
    ]) {
      const s = splitDay(d);
      expect(s.left + s.spentCovered + s.asideCovered).toBeCloseTo(s.pay);
      expect(s.left - s.asideOver - s.spentOver).toBeCloseTo(s.net);
    }
  });
});

const spend = (id: string, date: LocalDate, amount: number, at?: number): Transaction => ({ id, updatedAt: 1, date, at, amount, merchant: id, categoryId: 'cat_food', source: 'manual' });
const always = () => true;
const planOf = (days: Record<LocalDate, number>) => {
  const byDay = new Map(Object.entries(days));
  return { byDay, byKind: { bills: new Map(byDay), savings: new Map<LocalDate, number>(), goals: new Map<LocalDate, number>() } };
};

describe('spentInSpans', () => {
  it('adds up spending by day and by month', () => {
    const txs = [spend('a', '2026-10-05', 10), spend('b', '2026-10-05', 5), spend('c', '2026-10-07', 20), spend('d', '2026-11-02', 7)];
    const week = bucketsFor('week', '2026-10-05', 1);
    expect(spentInSpans(txs, week, false, always).values).toEqual([15, 0, 20, 0, 0, 0, 0]);
    const year = spentInSpans(txs, bucketsFor('year', '2026-10-05', 1), false, always).values;
    expect(year[9]).toBe(35);
    expect(year[10]).toBe(7);
  });

  it('puts timed spending in its hour and adds up the rest as untimed', () => {
    const hours = bucketsFor('day', '2026-10-05', 1);
    const txs = [spend('a', '2026-10-05', 6.45, hours[8].start + 30 * 60_000), spend('b', '2026-10-05', 41.2), spend('c', '2026-10-06', 9, hours[23].end + 60_000)];
    const out = spentInSpans(txs, hours, true, always);
    expect(out.values[8]).toBe(6.45);
    expect(out.values.reduce((t, v) => t + v, 0)).toBe(6.45);
    expect(out.untimed).toBe(41.2);
  });
});

describe('setAsideInSpans', () => {
  const october = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [addDays('2026-10-01', i), 10]));

  it('counts a bar that has started through today, and a future bar in full', () => {
    const year = bucketsFor('year', '2026-10-05', 1);
    const out = setAsideInSpans(planOf(october), year, '2026-10-05');
    expect(out[9].total).toBe(50);
    expect(out[10].total).toBe(300);
    expect(out[9].kinds.bills).toBe(50);
  });

  it('splits a day by each hour of scheduled pay, or evenly with no pay', () => {
    const hours = bucketsFor('day', '2026-10-05', 1);
    const pay = hours.map((_, h) => (h >= 8 && h < 16 ? 18.5 : 0));
    const out = setAsideInSpans(planOf({ '2026-10-05': 40 }), hours, '2026-10-05', pay);
    expect(out[8].total).toBeCloseTo(5);
    expect(out[3].total).toBe(0);
    expect(out.reduce((t, b) => t + b.total, 0)).toBeCloseTo(40);
    const idle = setAsideInSpans(planOf({ '2026-10-05': 24 }), hours, '2026-10-05', hours.map(() => 0));
    expect(idle.every((b) => Math.abs(b.total - 1) < 1e-9)).toBe(true);
  });
});
