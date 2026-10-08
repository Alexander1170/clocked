import { describe, expect, it } from 'vitest';
import type { Bill, Rule, Transaction } from '../shared/types.ts';
import { releaseFromRule, ruleFor, withRule } from '../shared/rules.ts';
import { findDuplicates, mergeDuplicate, notCountedReason } from '../src/lib/money.ts';
import { groupPlaces, reapplyRule } from '../src/lib/places.ts';

const bank = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id,
  updatedAt: 1,
  source: 'plaid',
  date: '2026-10-06',
  amount: 20,
  merchant: 'Atm Main St',
  categoryId: 'cat_cash',
  flow: 'spend',
  pfc: 'TRANSFER_OUT_WITHDRAWAL',
  ...over,
});
const hand = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id,
  updatedAt: 1,
  source: 'manual',
  date: '2026-10-05',
  amount: 50,
  merchant: 'Weekend fun',
  categoryId: 'cat_fun',
  ...over,
});
const rule = (over: Partial<Rule>): Rule => ({ id: 'r', updatedAt: 1, match: 'atm', ...over });
const gym: Bill = { id: 'gym', updatedAt: 1, name: 'Gym', amount: 40, frequency: 'monthly', dueDate: '2026-10-20', categoryId: 'cat_health', startDate: '2026-10-01' };

describe('rules for a place', () => {
  it('cover a bank name and longer ones that start with it, most specific first', () => {
    const rules = [rule({ id: 'a', match: 'atm' }), rule({ id: 'b', match: 'atm main st' }), rule({ id: 'c', match: 'at', deleted: true })];
    expect(ruleFor(rules, 'ATM Main St')?.id).toBe('b');
    expect(ruleFor(rules, 'Atm Elm Ave')?.id).toBe('a');
    expect(ruleFor(rules, 'Atmosphere Cafe')).toBeUndefined();
  });

  it('rename, file, hide, and tie to a bill, and remember what they set', () => {
    const out = withRule(bank('t'), rule({ rename: 'Cash', categoryId: 'cat_fun', hide: true }), [gym]);
    expect(out).toMatchObject({ merchant: 'Cash', bankName: 'Atm Main St', categoryId: 'cat_fun', hidden: true, ruleId: 'r', ruleSet: ['name', 'category', 'hide'] });
    // A bill a place pays counts whatever the amount.
    const paid = withRule(bank('p', { merchant: 'FitCo', amount: 12 }), rule({ id: 'g', match: 'fitco', billId: 'gym' }), [gym]);
    expect(paid).toMatchObject({ billId: 'gym', ruleSet: ['bill'] });
  });

  it('take back what they set when forgotten, but not what you changed yourself', () => {
    const ruled = withRule(bank('t'), rule({ rename: 'Cash', categoryId: 'cat_fun' }), [gym]);
    expect(withRule(ruled, undefined, [gym])).toMatchObject({ merchant: 'Atm Main St', categoryId: 'cat_cash' });
    // You filed this one yourself after the rule did.
    const yours = releaseFromRule({ ...ruled, categoryId: 'cat_gifts' }, ['category']);
    const forgot = withRule(yours, undefined, [gym]);
    expect(forgot).toMatchObject({ merchant: 'Atm Main St', categoryId: 'cat_gifts' });
    expect(forgot.bankName).toBeUndefined();
    expect(forgot.ruleId).toBeUndefined();
  });

  it('leave paychecks alone', () => {
    const pay = bank('i', { amount: -900, flow: 'income', merchant: 'Atm Payroll' });
    expect(withRule(pay, rule({ hide: true }), [])).toBe(pay);
  });
});

describe('places', () => {
  const txs = [
    bank('a'),
    bank('b', { merchant: 'Atm Elm Ave', date: '2026-10-07' }),
    bank('c', { merchant: 'Corner Store', categoryId: 'cat_food', pfc: 'FOOD_AND_DRINK_GROCERIES' }),
    bank('old', { date: '2026-09-01' }),
  ];
  const rules = [rule({ rename: 'Cash' })];

  it('gather every bank name a rule covers, from the day you started tracking', () => {
    expect(groupPlaces(txs, rules, '2026-10-01').map((p) => [p.key, p.name, p.txs.length])).toEqual([
      ['atm', 'Cash', 2],
      ['corner store', 'Corner Store', 1],
    ]);
  });

  it('take a changed rule only where it applies', () => {
    const saved: Transaction[] = [];
    expect(reapplyRule('r', txs, rules, [], (t) => saved.push(t))).toBe(3);
    expect(saved.map((t) => [t.id, t.merchant])).toEqual([
      ['a', 'Cash'],
      ['b', 'Cash'],
      ['old', 'Cash'],
    ]);
  });
});

describe('the same purchase twice', () => {
  it('pairs one you added with the bank copy: same amount, within three days, any name', () => {
    const txs = [hand('m1'), bank('b1', { amount: 50, date: '2026-10-07' }), bank('b2', { amount: 50, date: '2026-10-05' }), hand('m2', { amount: 19.99, date: '2026-10-01' }), bank('b3', { amount: 19.99 })];
    expect(findDuplicates(txs).map((d) => [d.manual.id, d.bank.id])).toEqual([['m1', 'b2']]);
    // Once you say they're different, that pair isn't offered again.
    expect(findDuplicates([{ ...txs[0], distinct: ['b2'] }, txs[1], txs[2]]).map((d) => d.bank.id)).toEqual(['b1']);
  });

  it('merges into the bank copy, with your name, category, and note', () => {
    expect(mergeDuplicate(bank('b', { amount: 50 }), hand('m', { note: 'concert' }))).toMatchObject({
      id: 'b',
      amount: 50,
      merchant: 'Weekend fun',
      bankName: 'Atm Main St',
      categoryId: 'cat_fun',
      note: 'concert',
      edited: true,
    });
  });
});

describe('what counts', () => {
  const cover = { bills: {}, goals: {}, trackFrom: '2026-10-04' };

  it('leaves out hidden ones, and bank ones from before you started tracking', () => {
    expect(notCountedReason(bank('h', { hidden: true }), cover)).toBe('Hidden');
    expect(notCountedReason(bank('o', { date: '2026-10-03' }), cover)).toBe('From before you started tracking');
    expect(notCountedReason(hand('m', { date: '2026-10-01' }), cover)).toBeNull();
    expect(notCountedReason(bank('n'), cover)).toBeNull();
  });
});
