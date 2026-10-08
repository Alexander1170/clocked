// Turns Plaid transactions into Clocked transactions: category, money flow, bill links.
import type { Bill, LocalDate, Rule, Transaction, TxFlow } from '../shared/types.ts';
import { diffDays } from '../shared/dates.ts';
import { billForPayment } from '../shared/bills.ts';
import { categoryFor } from '../shared/plaidCategories.ts';
import { ruleFor, withRule } from '../shared/rules.ts';
import type { PlaidTransaction } from './plaid.ts';

export { categoryFor, MAPPED_CATEGORY_IDS } from '../shared/plaidCategories.ts';

// Money moving between your own accounts, or paying down a card whose purchases are already counted.
const TRANSFER_OUT = new Set([
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
  'TRANSFER_OUT_SAVINGS',
  'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
  'TRANSFER_OUT_CRYPTO',
  'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
]);

export function flowFor(amount: number, primary?: string, detailed?: string): TxFlow {
  if (amount < 0) {
    if (primary === 'INCOME') return 'income';
    if (primary === 'TRANSFER_IN' || primary === 'LOAN_DISBURSEMENTS') return 'transfer';
    return 'spend'; // a refund
  }
  if (detailed && TRANSFER_OUT.has(detailed)) return 'transfer';
  return 'spend';
}

const NOISE = /^(debit card purchase|pos (debit|purchase)|purchase authorized on \d\d\/\d\d|recurring (debit|payment)|checkcard \d+|sq \*|tst\*|paypal \*)\s*/i;

/** Readable merchant from a raw bank description, for when Plaid has no merchant name. */
export function cleanName(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 3; i++) s = s.replace(NOISE, '').replace(/^\d\d\/\d\d\s+/, '');
  s = s.split(/\s{2,}|\s#?\d{3,}/)[0] ?? s;
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
    .trim();
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "Chipotle" and "Chipotle Mexican Grill", or "Speedway" and "SPEEDWAY 04512". */
function sameName(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  return !!x && !!y && (x.includes(y) || y.includes(x) || x.split(' ')[0] === y.split(' ')[0]);
}

/**
 * A purchase you added by hand that this bank transaction is the same as, so
 * it isn't counted twice: the same amount within three days, under a similar
 * name. A different name still matches on the same or next day when the
 * amount has cents, since a round amount like $40 is too likely to be a
 * different purchase. The closest day wins.
 */
export function findManualMatch(t: { amount: number; date: LocalDate; merchant: string; alias?: string }, candidates: readonly Transaction[]): Transaction | undefined {
  const cents = Math.round(t.amount * 100);
  let best: Transaction | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c.deleted || c.source === 'plaid' || Math.round(c.amount * 100) !== cents) continue;
    const gap = Math.abs(diffDays(c.date, t.date));
    if (gap > 3) continue;
    // The name you taught Clocked for this place counts as a match too.
    const named = sameName(c.merchant, t.merchant) || (!!t.alias && sameName(c.merchant, t.alias));
    if (!named && !(gap <= 1 && cents % 100 !== 0)) continue;
    const score = gap * 10 + (named ? 0 : 5);
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export interface MapContext {
  /** The record already stored for this transaction. */
  existing?: Transaction;
  /** The pending transaction this posted one replaces; your edits carry over. */
  carryFrom?: Transaction;
  rules: Rule[];
  bills: Bill[];
  account?: { name: string; included: boolean };
  /** The bank connection it came from. */
  itemId?: string;
  /** True for a category you deleted. Anything that would land in one goes to Other. */
  categoryGone?: (id: string) => boolean;
  now: number;
}

export function mapPlaidTransaction(t: PlaidTransaction, ctx: MapContext): Transaction {
  const pfc = t.personal_finance_category ?? undefined;
  const merchant = (t.merchant_name || cleanName(t.name) || t.name).trim();
  const amount = Math.round(t.amount * 100) / 100;
  const stamp = t.authorized_datetime || t.datetime;
  const at = stamp ? Date.parse(stamp) : NaN;
  const prev = ctx.existing ?? ctx.carryFrom;

  const rec: Transaction = {
    id: `plaid_${t.transaction_id}`,
    updatedAt: Math.max(ctx.now, (ctx.existing?.updatedAt ?? 0) + 1),
    createdAt: ctx.existing?.createdAt ?? ctx.now,
    source: 'plaid',
    plaidId: t.transaction_id,
    itemId: ctx.itemId,
    accountId: t.account_id,
    accountName: ctx.account?.name,
    // The day you swiped, not the day it posted.
    date: t.authorized_date || t.date,
    at: Number.isFinite(at) ? at : undefined,
    amount,
    merchant,
    rawName: t.name,
    pending: t.pending || undefined,
    pfc: pfc?.detailed,
    categoryId: 'cat_other',
  };

  if (prev?.edited) {
    rec.edited = true;
    rec.categoryId = prev.categoryId;
    rec.note = prev.note;
    rec.excluded = prev.excluded;
    rec.flow = prev.flow;
    rec.billId = prev.billId;
    rec.billPart = prev.billPart;
    rec.goalId = prev.goalId;
    rec.hidden = prev.hidden;
    rec.ruleId = prev.ruleId;
    rec.ruleSet = prev.ruleSet;
    // Keep the name you gave it: yours for something you added by hand, or a rename.
    const yours = prev.source === 'plaid' ? (prev.bankName ? prev.merchant : undefined) : prev.merchant.trim();
    if (yours && yours !== merchant) {
      rec.merchant = yours;
      rec.bankName = merchant;
    }
    // The bank often has no time of day; keep the one you entered.
    rec.at = rec.at ?? prev.at;
  } else {
    rec.flow = flowFor(amount, pfc?.primary, pfc?.detailed);
    rec.categoryId = categoryFor(pfc?.primary, pfc?.detailed);
    // Bills paid by transfer, like a loan payment to a credit union, count too.
    rec.billId = rec.flow !== 'income' && amount > 0 ? billForPayment(ctx.bills, merchant, amount, t.name)?.id : undefined;
    rec.note = prev?.note;
    // What you taught Clocked about this place: its name, category, bill, or hiding it.
    Object.assign(rec, withRule(rec, ruleFor(ctx.rules, merchant), ctx.bills));
    if (ctx.categoryGone?.(rec.categoryId)) rec.categoryId = 'cat_other';
  }
  rec.distinct = prev?.distinct;

  // Switching an account off hides its transactions, edited or not.
  rec.accountOff = ctx.account && !ctx.account.included ? true : undefined;
  for (const k of Object.keys(rec) as Array<keyof Transaction>) if (rec[k] === undefined) delete rec[k];
  return rec;
}
