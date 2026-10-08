// Teaching Clocked about your bank transactions: rules for places, and merging duplicates.
import type { Rule, Transaction } from '../../shared/types.ts';
import { bankNameOf, normName, ruleFor } from '../../shared/rules.ts';
import { live, useData } from './store.ts';
import { mergeDuplicate, type Duplicate } from './money.ts';
import { placeRuleId, reapplyRule } from './places.ts';

/**
 * Saves what you taught about a place and applies it to every transaction it
 * covers, past ones included. New ones from the bank follow it too. Returns
 * how many changed, besides `except`.
 */
export function teachRule(rule: Omit<Rule, 'updatedAt'>, except?: string): number {
  const store = useData.getState();
  const clean = { ...rule } as Omit<Rule, 'updatedAt'>;
  for (const k of Object.keys(clean) as Array<keyof typeof clean>) if (clean[k] === undefined) delete clean[k];
  const saved = store.put('rules', clean);
  const t = useData.getState().t;
  let n = 0;
  reapplyRule(saved.id, live(t.transactions), live(t.rules), live(t.bills), (tx) => {
    useData.getState().put('transactions', tx);
    if (tx.id !== except) n += 1;
  });
  return n;
}

/** Forgets a rule. What it set goes back to what the bank sent. Returns how many changed. */
export function forgetRule(id: string): number {
  useData.getState().remove('rules', id);
  const t = useData.getState().t;
  let n = 0;
  reapplyRule(id, live(t.transactions), live(t.rules), live(t.bills), (tx) => {
    useData.getState().put('transactions', tx);
    n += 1;
  });
  return n;
}

/** The rule for a bank name, or a new one keyed on it. */
export function ruleForPlace(bankName: string, rawName?: string): Omit<Rule, 'updatedAt'> {
  const prior = ruleFor(live(useData.getState().t.rules), bankName, rawName);
  if (prior) return prior;
  const key = normName(bankName);
  return { id: placeRuleId(key), match: key };
}

/**
 * Keeps the bank's copy of a purchase you added by hand, with your name,
 * category, and note. With `renameAll`, every transaction from that place
 * takes your name and category, now and later.
 */
export function mergePair(d: Duplicate, renameAll: boolean): { merged: Transaction; more: number } {
  const { put, remove } = useData.getState();
  const merged = put('transactions', mergeDuplicate(d.bank, d.manual));
  remove('transactions', d.manual.id);
  const name = d.manual.merchant.trim();
  const more = renameAll && name ? teachRule({ ...ruleForPlace(bankNameOf(d.bank), d.bank.rawName), rename: name, categoryId: d.manual.categoryId }, merged.id) : 0;
  return { merged, more };
}

/** Says a purchase you added and a bank transaction aren't the same, so they aren't offered as a pair again. */
export function markDifferent(d: Duplicate) {
  useData.getState().put('transactions', { ...d.manual, distinct: [...(d.manual.distinct ?? []), d.bank.id] });
}
