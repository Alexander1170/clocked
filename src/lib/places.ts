import type { Bill, LocalDate, Rule, Transaction } from '../../shared/types.ts';
import { bankNameOf, normName, ruleFieldsDiffer, ruleFor, rulesApply, withRule } from '../../shared/rules.ts';
import { beforeTracking } from './money.ts';

/** Everything that came from one place, as the bank names it. */
export interface Place {
  /** The rule's name for it when you've taught one, else the bank's name, lowercased. */
  key: string;
  /** The bank's name, as it first showed up. */
  bankName: string;
  /** What it shows as. */
  name: string;
  rule?: Rule;
  /** Newest first. */
  txs: Transaction[];
  /** Money out, less refunds. */
  total: number;
  /** Hidden by its rule. */
  hidden: boolean;
  /** The category most of them have. */
  categoryId: string;
}

/** Bank transactions that rules can teach, from the day you started tracking. */
export const teachable = (tx: Transaction, trackFrom?: LocalDate) => !tx.deleted && !tx.accountOff && rulesApply(tx) && !beforeTracking(tx, trackFrom);

/** Bank transactions grouped by where they came from. A rule gathers every bank name it covers. */
export function groupPlaces(txs: readonly Transaction[], rules: readonly Rule[], trackFrom?: LocalDate): Place[] {
  const byKey = new Map<string, Place>();
  for (const tx of txs) {
    if (!teachable(tx, trackFrom)) continue;
    const bank = bankNameOf(tx);
    const rule = ruleFor(rules, bank, tx.rawName);
    const key = rule ? normName(rule.match) : normName(bank);
    if (!key) continue;
    let p = byKey.get(key);
    if (!p) {
      p = { key, bankName: rule ? rule.match : bank, name: rule?.rename?.trim() || bank, rule, txs: [], total: 0, hidden: !!rule?.hide, categoryId: tx.categoryId };
      byKey.set(key, p);
    }
    p.txs.push(tx);
  }
  for (const p of byKey.values()) {
    p.txs.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
    // Hidden ones don't add up, unless they all are.
    const counted = p.txs.some((t) => !t.hidden) ? p.txs.filter((t) => !t.hidden) : p.txs;
    p.total = counted.reduce((t, x) => t + x.amount, 0);
    // The bank's own spelling of the rule's name reads better than the lowercased rule.
    if (p.rule) {
      const exact = p.txs.map(bankNameOf).find((n) => normName(n) === p!.key);
      p.bankName = exact ?? p.key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
    }
    const count = new Map<string, number>();
    for (const t of p.txs) count.set(t.categoryId, (count.get(t.categoryId) ?? 0) + 1);
    p.categoryId = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return [...byKey.values()].sort((a, b) => b.txs.length - a.txs.length || b.total - a.total);
}

/** The id a place's rule is saved under, so teaching it again updates the same rule. */
export const placeRuleId = (key: string) => `rule_${normName(key).replace(/ /g, '-')}`;

/**
 * Puts the transactions a rule covers (or used to) the way it now says, and
 * saves the ones that change. `rules` is every rule as it is now: without
 * this one, if it was forgotten. Returns how many changed.
 */
export function reapplyRule(
  ruleId: string,
  txs: readonly Transaction[],
  rules: readonly Rule[],
  bills: readonly Bill[],
  save: (tx: Transaction) => void,
): number {
  let n = 0;
  for (const tx of txs) {
    if (tx.deleted || !rulesApply(tx)) continue;
    const rule = ruleFor(rules, bankNameOf(tx), tx.rawName);
    if (rule?.id !== ruleId && tx.ruleId !== ruleId) continue;
    const next = withRule(tx, rule, bills);
    if (!ruleFieldsDiffer(tx, next)) continue;
    save(next);
    n += 1;
  }
  return n;
}
