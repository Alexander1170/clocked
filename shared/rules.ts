// What you've taught Clocked about the places your bank transactions come from.
import type { Bill, Rule, RuleField, Transaction } from './types.ts';
import { billForPayment } from './bills.ts';
import { categoryForDetailed } from './plaidCategories.ts';

/** Lowercase words and digits, for comparing names. */
export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The name the bank uses for a transaction, even after you renamed it. */
export const bankNameOf = (tx: Pick<Transaction, 'merchant' | 'bankName'>) => tx.bankName ?? tx.merchant;

/** Whether a rule covers a bank name: the same name, or a longer one that starts with it. */
export function ruleCovers(rule: Pick<Rule, 'match'>, bankName: string): boolean {
  const m = normName(rule.match);
  const n = normName(bankName);
  return !!m && (n === m || n.startsWith(`${m} `));
}

/** The rule for a bank name: the most specific one that covers it. */
export function ruleFor(rules: readonly Rule[], bankName: string): Rule | undefined {
  let best: Rule | undefined;
  for (const r of rules) {
    if (r.deleted || !ruleCovers(r, bankName)) continue;
    if (!best || normName(r.match).length > normName(best.match).length) best = r;
  }
  return best;
}

/** Rules only touch bank transactions, and never deposits like paychecks. */
export const rulesApply = (tx: Pick<Transaction, 'source' | 'flow'>) => tx.source === 'plaid' && tx.flow !== 'income';

/**
 * A bank transaction the way a rule says: its name, category, whether it's
 * hidden, and the bill it pays. What an earlier rule set goes back to what the
 * bank sent first, so changing or forgetting a rule takes it back. Anything
 * you changed yourself afterwards stays, unless the new rule sets it too.
 */
export function withRule(tx: Transaction, rule: Rule | undefined, bills: readonly Bill[]): Transaction {
  if (!rulesApply(tx)) return tx;
  const bank = bankNameOf(tx);
  const out: Transaction = { ...tx };
  const moneyOut = tx.amount > 0;
  const before = tx.ruleSet ?? [];
  if (before.includes('name')) {
    out.merchant = bank;
    delete out.bankName;
  }
  if (before.includes('category')) out.categoryId = categoryForDetailed(tx.pfc);
  if (before.includes('hide')) delete out.hidden;
  if (before.includes('bill')) {
    const guess = moneyOut ? billForPayment(bills, bank, tx.amount, tx.rawName)?.id : undefined;
    if (guess) out.billId = guess;
    else delete out.billId;
  }
  delete out.ruleId;
  delete out.ruleSet;
  if (rule) {
    const set: RuleField[] = [];
    const name = rule.rename?.trim();
    if (name && name !== bank) {
      out.merchant = name;
      out.bankName = bank;
      set.push('name');
    }
    if (rule.categoryId) {
      out.categoryId = rule.categoryId;
      set.push('category');
    }
    if (rule.hide) {
      out.hidden = true;
      set.push('hide');
    }
    if (rule.billId && moneyOut && bills.some((b) => b.id === rule.billId && !b.deleted)) {
      out.billId = rule.billId;
      set.push('bill');
    }
    out.ruleId = rule.id;
    if (set.length) out.ruleSet = set;
  }
  if (out.billId !== tx.billId) delete out.billPart;
  return out;
}

/** True when two versions of a transaction differ in anything a rule sets. */
export function ruleFieldsDiffer(a: Transaction, b: Transaction): boolean {
  return (
    a.merchant !== b.merchant ||
    a.bankName !== b.bankName ||
    a.categoryId !== b.categoryId ||
    !!a.hidden !== !!b.hidden ||
    a.billId !== b.billId ||
    !!a.billPart !== !!b.billPart ||
    a.ruleId !== b.ruleId ||
    (a.ruleSet ?? []).join() !== (b.ruleSet ?? []).join()
  );
}

/** After you change something yourself, the rule no longer owns it. */
export function releaseFromRule(tx: Transaction, fields: readonly RuleField[]): Transaction {
  if (!tx.ruleSet?.length || !fields.length) return tx;
  const left = tx.ruleSet.filter((f) => !fields.includes(f));
  const out = { ...tx };
  if (left.length) out.ruleSet = left;
  else delete out.ruleSet;
  return out;
}
