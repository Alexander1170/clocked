// Turns Plaid transactions into Clocked transactions: category, money flow, bill links.
import type { Bill, LocalDate, Rule, Transaction, TxFlow } from '../shared/types.ts';
import { diffDays } from '../shared/dates.ts';
import { billForPayment } from '../shared/bills.ts';
import type { PlaidTransaction } from './plaid.ts';

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

const BY_DETAILED: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: 'cat_groceries',
  TRANSPORTATION_GAS: 'cat_gas',
  ENTERTAINMENT_TV_AND_MOVIES: 'cat_subs',
  ENTERTAINMENT_MUSIC_AND_AUDIO: 'cat_subs',
  GENERAL_SERVICES_AUTOMOTIVE: 'cat_transport',
  GENERAL_SERVICES_INSURANCE: 'cat_insurance',
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'cat_health',
  TRANSFER_OUT_WITHDRAWAL: 'cat_cash',
  RENT_AND_UTILITIES_RENT: 'cat_rent',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'cat_rent',
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: 'cat_utilities',
  RENT_AND_UTILITIES_WATER: 'cat_utilities',
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: 'cat_utilities',
  RENT_AND_UTILITIES_OTHER_UTILITIES: 'cat_utilities',
  RENT_AND_UTILITIES_TELEPHONE: 'cat_phone',
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'cat_phone',
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: 'cat_clothes',
  GENERAL_MERCHANDISE_PET_SUPPLIES: 'cat_pets',
  MEDICAL_VETERINARY_SERVICES: 'cat_pets',
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: 'cat_gifts',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'cat_gifts',
};

const BY_PRIMARY: Record<string, string> = {
  FOOD_AND_DRINK: 'cat_food',
  TRANSPORTATION: 'cat_transport',
  GENERAL_MERCHANDISE: 'cat_shopping',
  RENT_AND_UTILITIES: 'cat_bills',
  LOAN_PAYMENTS: 'cat_debt',
  ENTERTAINMENT: 'cat_fun',
  MEDICAL: 'cat_health',
  PERSONAL_CARE: 'cat_personal',
  HOME_IMPROVEMENT: 'cat_home',
  TRAVEL: 'cat_travel',
  BANK_FEES: 'cat_fees',
};

/** Every category the mapping can file a transaction under. */
export const MAPPED_CATEGORY_IDS: ReadonlySet<string> = new Set([...Object.values(BY_DETAILED), ...Object.values(BY_PRIMARY), 'cat_other']);

export function categoryFor(primary?: string, detailed?: string): string {
  return (detailed && BY_DETAILED[detailed]) || (primary && BY_PRIMARY[primary]) || 'cat_other';
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

export function ruleCategory(merchant: string, rules: Rule[]): string | undefined {
  const m = merchant.trim().toLowerCase();
  return rules.find((r) => !r.deleted && r.match === m)?.categoryId;
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
export function findManualMatch(t: { amount: number; date: LocalDate; merchant: string }, candidates: readonly Transaction[]): Transaction | undefined {
  const cents = Math.round(t.amount * 100);
  let best: Transaction | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c.deleted || c.source === 'plaid' || Math.round(c.amount * 100) !== cents) continue;
    const gap = Math.abs(diffDays(c.date, t.date));
    if (gap > 3) continue;
    const named = sameName(c.merchant, t.merchant);
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
    rec.goalId = prev.goalId;
    // The bank often has no time of day; keep the one you entered.
    rec.at = rec.at ?? prev.at;
  } else {
    rec.flow = flowFor(amount, pfc?.primary, pfc?.detailed);
    rec.categoryId = ruleCategory(merchant, ctx.rules) ?? categoryFor(pfc?.primary, pfc?.detailed);
    if (ctx.categoryGone?.(rec.categoryId)) rec.categoryId = 'cat_other';
    // Bills paid by transfer, like a loan payment to a credit union, count too.
    rec.billId = rec.flow !== 'income' && amount > 0 ? billForPayment(ctx.bills, merchant, amount, t.name)?.id : undefined;
    rec.note = prev?.note;
  }

  // Switching an account off hides its transactions, edited or not.
  rec.accountOff = ctx.account && !ctx.account.included ? true : undefined;
  for (const k of Object.keys(rec) as Array<keyof Transaction>) if (rec[k] === undefined) delete rec[k];
  return rec;
}
