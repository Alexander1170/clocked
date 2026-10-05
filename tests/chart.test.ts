import { describe, expect, it } from 'vitest';
import { splitDay } from '../src/lib/money.ts';

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
