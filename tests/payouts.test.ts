import { describe, expect, it } from 'vitest';
import type { GigJob, GigSession, Transaction } from '../shared/types.ts';
import { matchGigPayouts } from '../shared/payouts.ts';
import { rollingLeft, txTime } from '../src/lib/money.ts';

const gig: GigJob = { id: 'gig', updatedAt: 1, kind: 'gig', name: 'Deliveries', color: 2 };
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00`);
const session = (id: string, date: string, earnings: number, end = '21:00'): GigSession => ({
  id,
  updatedAt: 1,
  jobId: 'gig',
  start: at(date, '18:00'),
  end: at(date, end),
  earnings,
});
const deposit = (id: string, date: string, amount: number, over: Partial<Transaction> = {}): Transaction => ({
  id,
  updatedAt: 1,
  source: 'plaid',
  date,
  amount: -amount,
  merchant: 'Pos Credit',
  categoryId: 'cat_other',
  flow: 'spend',
  ...over,
});

describe('gig payouts', () => {
  it('match work you logged: the same amount, or a few dollars less for the cash-out fee', () => {
    const gigs = [session('a', '2026-10-07', 80), session('b', '2026-10-08', 64.5)];
    const txs = [deposit('p1', '2026-10-08', 78.01), deposit('p2', '2026-10-09', 64.5), deposit('r', '2026-10-09', 40)];
    expect(Object.fromEntries(matchGigPayouts(txs, gigs, [gig]))).toEqual({ p1: 'gig', p2: 'gig' });
  });

  it('pay out each piece of work once, and not too long after it', () => {
    const gigs = [session('a', '2026-10-07', 50)];
    const twice = [deposit('p1', '2026-10-07', 50), deposit('p2', '2026-10-08', 50)];
    expect([...matchGigPayouts(twice, gigs, [gig]).keys()]).toEqual(['p1']);
    expect(matchGigPayouts([deposit('late', '2026-10-15', 50)], gigs, [gig]).size).toBe(0);
  });

  it('add up a day of work cashed out together', () => {
    const gigs = [session('a', '2026-10-10', 30, '14:00'), session('b', '2026-10-10', 45.5)];
    expect(matchGigPayouts([deposit('p', '2026-10-10', 73.51)], gigs, [gig]).get('p')).toBe('gig');
  });

  it('let pay you taught it to recognize use up its work first', () => {
    const gigs = [session('a', '2026-10-07', 60)];
    const taught = deposit('pending', '2026-10-07', 60, { flow: 'income', jobId: 'gig' });
    expect(matchGigPayouts([taught, deposit('posted', '2026-10-08', 60)], gigs, [gig]).size).toBe(0);
  });
});

describe('money left, carried over', () => {
  it('builds up on good days and comes off on short ones', () => {
    const days = { d1: { earned: 200, setAside: 90, spent: 50, moved: 0 }, d2: { earned: 0, setAside: 90, spent: 20, moved: 0 }, d3: { earned: 200, setAside: 90, spent: 10, moved: 25 } };
    const out = rollingLeft(['d1', 'd2', 'd3'], (d) => days[d as keyof typeof days]);
    expect(out.map((r) => [r.carryIn, r.left])).toEqual([
      [0, 60],
      [60, -50],
      [-50, 25],
    ]);
  });
});

describe('transaction times', () => {
  it('treat a bank stamp at exactly midnight as no time of day', () => {
    expect(txTime({ source: 'plaid', at: at('2026-10-10', '00:00') })).toBeUndefined();
    expect(txTime({ source: 'plaid', at: at('2026-10-10', '13:05') })).toBe(at('2026-10-10', '13:05'));
    expect(txTime({ source: 'manual', at: at('2026-10-10', '00:00') })).toBe(at('2026-10-10', '00:00'));
  });
});

describe('gig payouts, carefully', () => {
  it('only consider money in that would otherwise count as a refund', () => {
    const gigs = [session('a', '2026-10-07', 60)];
    const transfer = deposit('t', '2026-10-07', 60, { flow: 'transfer' });
    const notMine = deposit('n', '2026-10-07', 60, { notPayout: true });
    expect(matchGigPayouts([transfer, notMine], gigs, [gig]).size).toBe(0);
  });

  it('give each piece of work to the deposit that fits it best, not the first one that fits', () => {
    // A $58 refund comes the same day as the $60 payout: the exact payout wins the dash.
    const gigs = [session('a', '2026-10-07', 60)];
    const txs = [deposit('refund', '2026-10-07', 58), deposit('payout', '2026-10-08', 60)];
    expect([...matchGigPayouts(txs, gigs, [gig]).keys()]).toEqual(['payout']);
  });

  it('cover a cash-out for work on more than one day', () => {
    const gigs = [session('a', '2026-10-07', 40), session('b', '2026-10-08', 25)];
    expect(matchGigPayouts([deposit('p', '2026-10-09', 63.01)], gigs, [gig]).get('p')).toBe('gig');
  });
});

describe('gig payouts, not refunds', () => {
  it('need the same amount or the cash-out fee less, unless the place has paid out before', () => {
    const gigs = [session('a', '2026-10-08', 41.25)];
    // A $40 refund the same day is neither the full amount nor $1.99 less: the real payout keeps the dash.
    const txs = [deposit('refund', '2026-10-08', 40), deposit('payout', '2026-10-09', 39.26)];
    expect([...matchGigPayouts(txs, gigs, [gig]).keys()]).toEqual(['payout']);
    // From a place that paid out before, a few dollars less is fine.
    const before = deposit('old', '2026-10-01', 30, { flow: 'income', jobId: 'gig', rawName: 'GIG CASHOUT' });
    const odd = deposit('odd', '2026-10-09', 38.5, { rawName: 'GIG CASHOUT' });
    expect(matchGigPayouts([before, odd], gigs, [gig]).get('odd')).toBe('gig');
  });

  it('leave deposits you edited, and ones from before you started tracking', () => {
    const gigs = [session('a', '2026-10-08', 25)];
    expect(matchGigPayouts([deposit('e', '2026-10-08', 25, { edited: true })], gigs, [gig]).size).toBe(0);
    expect(matchGigPayouts([deposit('o', '2026-10-08', 25)], gigs, [gig], '2026-10-09').size).toBe(0);
  });

  it('sweep up a week of dashes cashed out at once', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
    const gigs = days.map((d, i) => session(`s${i}`, d, 30));
    expect(matchGigPayouts([deposit('p', '2026-10-09', 148.01)], gigs, [gig]).get('p')).toBe('gig');
  });
});

describe('gig payouts from places you taught', () => {
  it('get first pick, even against a refund that fits one dash better', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
    const amounts = [27.4, 31.15, 22.8, 35.6, 30.06];
    const gigs = days.map((d, i) => session(`s${i}`, d, amounts[i]));
    const taught = deposit('taught', '2026-10-01', 20, { flow: 'income', jobId: 'gig', rawName: 'GIG CASHOUT' });
    const cashout = deposit('cashout', '2026-10-09', 145.02, { rawName: 'GIG CASHOUT' });
    const refund = deposit('refund', '2026-10-07', 22.8, { rawName: 'STORE REFUND' });
    const out = matchGigPayouts([taught, cashout, refund], gigs, [gig]);
    expect(out.get('cashout')).toBe('gig');
    expect(out.has('refund')).toBe(false);
  });

  it('let a payout you edited match again when its work comes back', () => {
    const gigs = [session('a', '2026-10-08', 41.25)];
    const back = deposit('p', '2026-10-09', 39.26, { edited: true, wasPayout: true });
    expect(matchGigPayouts([back], gigs, [gig]).get('p')).toBe('gig');
  });
});

describe('midnight from the bank, either way', () => {
  it('treats midnight UTC as no time of day too', () => {
    expect(txTime({ source: 'plaid', at: Date.parse('2026-10-08T00:00:00Z') })).toBeUndefined();
  });
});
