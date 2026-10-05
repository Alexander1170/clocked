// Runs the bank pipeline against a fake Plaid API: import, edits surviving
// bank updates, pending -> posted, removals, rules, bills, and account toggles.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../server/db.ts';
import { createBank, type Bank } from '../server/bank.ts';
import { flowFor, categoryFor, cleanName } from '../server/categorize.ts';
import type { PlaidTransaction } from '../server/plaid.ts';
import type { BaseRecord, Change, CollectionName, Transaction } from '../shared/types.ts';

// ---- fake Plaid -------------------------------------------------------------

const tx = (id: string, over: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
  transaction_id: id,
  account_id: 'acc_checking',
  amount: 12.4,
  date: '2026-10-05',
  authorized_date: '2026-10-03',
  name: 'DEBIT CARD PURCHASE CHIPOTLE 1234',
  merchant_name: 'Chipotle',
  pending: false,
  personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_FAST_FOOD' },
  ...over,
});

const fake = {
  pages: [] as Array<{ added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: Array<{ transaction_id: string }> }>,
  cursorSeen: [] as string[],
  removedItems: 0,
  refreshes: 0,
};

const accounts = [
  { account_id: 'acc_checking', name: 'Checking', mask: '1234', type: 'depository', subtype: 'checking', balances: { current: 812.5 } },
  { account_id: 'acc_loan', name: 'Auto loan', mask: '9999', type: 'loan', subtype: 'auto', balances: { current: 9000 } },
];

let server: Server;
let base = '';

function handle(path: string, body: Record<string, unknown>) {
  if (body.client_id !== 'cid' || body.secret !== 'sandbox-secret') return [400, { error_code: 'INVALID_API_KEYS', error_type: 'INVALID_INPUT', error_message: 'bad keys' }] as const;
  switch (path) {
    case '/sandbox/public_token/create':
      return [200, { public_token: 'public-sandbox-1' }] as const;
    case '/item/public_token/exchange':
      return [200, { access_token: 'access-sandbox-1', item_id: 'item_1' }] as const;
    case '/accounts/get':
      return [200, { accounts }] as const;
    case '/transactions/refresh':
      fake.refreshes += 1;
      return [200, {}] as const;
    case '/item/remove':
      fake.removedItems += 1;
      return [200, {}] as const;
    case '/link/token/create':
      return [200, { link_token: 'link-sandbox-abc', expiration: '2026-10-05T12:00:00Z' }] as const;
    case '/transactions/sync': {
      const cursor = String(body.cursor ?? '');
      fake.cursorSeen.push(cursor);
      const n = cursor ? Number(cursor.slice(1)) : 0;
      const page = fake.pages[n];
      if (!page) return [200, { added: [], modified: [], removed: [], next_cursor: cursor || 'c0', has_more: false, accounts }] as const;
      return [200, { ...page, next_cursor: `c${n + 1}`, has_more: n + 1 < fake.pages.length && fake.pages[n + 1] !== undefined && false, accounts }] as const;
    }
  }
  return [404, { error_code: 'NOT_FOUND', error_message: path }] as const;
}

let store: Store;
let bank: Bank;
let dir: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const [status, json] = handle(req.url ?? '', JSON.parse(raw || '{}'));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  dir = mkdtempSync(join(tmpdir(), 'clocked-bank-'));
  store = openStore(dir);
  bank = createBank(store, { baseUrls: { sandbox: base }, log: () => {} });
});

afterAll(() => {
  store.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = (id: string) => store.get('transactions', `plaid_${id}`) as Transaction | undefined;
const change = (c: CollectionName, rec: object): Change => ({ c, rec: rec as BaseRecord });

// ---- tests -------------------------------------------------------------------

describe('categorizing', () => {
  it('separates spending, income, and transfers', () => {
    expect(flowFor(25, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE')).toBe('spend');
    expect(flowFor(-1476, 'INCOME', 'INCOME_SALARY')).toBe('income');
    expect(flowFor(-200, 'TRANSFER_IN', 'TRANSFER_IN_ACCOUNT_TRANSFER')).toBe('transfer');
    expect(flowFor(300, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')).toBe('transfer');
    expect(flowFor(-15, 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES')).toBe('spend');
  });

  it('maps Plaid categories onto ours', () => {
    expect(categoryFor('FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES')).toBe('cat_groceries');
    expect(categoryFor('TRANSPORTATION', 'TRANSPORTATION_GAS')).toBe('cat_gas');
    expect(categoryFor('ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES')).toBe('cat_subs');
    expect(categoryFor('SOMETHING_NEW', 'SOMETHING_NEW_THING')).toBe('cat_other');
    expect(categoryFor('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT')).toBe('cat_rent');
    expect(categoryFor('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY')).toBe('cat_utilities');
    expect(categoryFor('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE')).toBe('cat_phone');
    expect(categoryFor('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_SOMETHING_NEW')).toBe('cat_bills');
    expect(categoryFor('GENERAL_SERVICES', 'GENERAL_SERVICES_INSURANCE')).toBe('cat_insurance');
    expect(categoryFor('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CAR_PAYMENT')).toBe('cat_debt');
    expect(categoryFor('MEDICAL', 'MEDICAL_VETERINARY_SERVICES')).toBe('cat_pets');
    expect(categoryFor('GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES')).toBe('cat_clothes');
  });

  it('cleans raw bank descriptions', () => {
    expect(cleanName('DEBIT CARD PURCHASE SPEEDWAY 04512 SPRINGFIELD OH')).toBe('Speedway');
    expect(cleanName('SQ *BLUE DOOR CAFE')).toBe('Blue Door Cafe');
  });
});

describe('bank sync against a fake Plaid', () => {
  it('rejects bad keys with a clear message', async () => {
    bank.saveConfig({ clientId: 'cid', sandboxSecret: 'wrong' });
    await expect(bank.connectSandbox()).rejects.toMatchObject({ code: 'INVALID_API_KEYS' });
    bank.saveConfig({ sandboxSecret: 'sandbox-secret' });
    const st = bank.status();
    expect(st.configured).toBe(true);
    expect(st.clientIdHint).toBe('cid');
    expect(JSON.stringify(st)).not.toContain('sandbox-secret');
  });

  it('imports transactions on the day they happened', async () => {
    fake.pages = [
      {
        added: [
          tx('t1'),
          tx('t2', { amount: -1476, name: 'ACME PAYROLL', merchant_name: null, personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_SALARY' } }),
          tx('t3', { amount: 45.1, merchant_name: 'Speedway', personal_finance_category: { primary: 'TRANSPORTATION', detailed: 'TRANSPORTATION_GAS' }, pending: true }),
          tx('t4', { account_id: 'acc_loan', amount: 310, merchant_name: 'Auto loan payment', personal_finance_category: { primary: 'LOAN_PAYMENTS', detailed: 'LOAN_PAYMENTS_CAR_PAYMENT' } }),
        ],
        modified: [],
        removed: [],
      },
    ];
    const itemId = await bank.connectSandbox();
    expect(itemId).toBe('item_1');
    const t1 = get('t1')!;
    expect(t1.date).toBe('2026-10-03');
    expect(t1.categoryId).toBe('cat_food');
    expect(t1.flow).toBe('spend');
    expect(t1.accountName).toBe('Checking ••1234');
    expect(get('t2')!.flow).toBe('income');
    expect(get('t3')!.pending).toBe(true);
    expect(get('t3')!.categoryId).toBe('cat_gas');
    // Loan accounts are switched off by default, so their transactions are hidden.
    expect(get('t4')!.accountOff).toBe(true);
    expect(bank.status().items[0].accounts.map((a) => a.included)).toEqual([true, false]);
  });

  it('keeps your edits when the bank updates a transaction', async () => {
    const t1 = get('t1')!;
    store.apply([change('transactions', { ...t1, categoryId: 'cat_fun', note: 'team lunch', edited: true, updatedAt: t1.updatedAt + 5 })]);
    fake.pages[1] = { added: [], modified: [tx('t1', { amount: 13.4 })], removed: [] };
    await bank.syncItem('item_1');
    const after = get('t1')!;
    expect(after.amount).toBe(13.4);
    expect(after.categoryId).toBe('cat_fun');
    expect(after.note).toBe('team lunch');
  });

  it('moves edits from a pending charge to the posted one', async () => {
    const t3 = get('t3')!;
    store.apply([change('transactions', { ...t3, note: 'fill up', edited: true, updatedAt: t3.updatedAt + 5 })]);
    fake.pages[2] = {
      added: [tx('t3-posted', { amount: 45.1, merchant_name: 'Speedway', pending: false, pending_transaction_id: 't3' })],
      modified: [],
      removed: [{ transaction_id: 't3' }],
    };
    await bank.syncItem('item_1');
    expect(store.get('transactions', 'plaid_t3')?.deleted).toBe(true);
    const posted = get('t3-posted')!;
    expect(posted.note).toBe('fill up');
    expect(posted.pending).toBeUndefined();
  });

  it('applies merchant rules and links bill payments', async () => {
    store.apply([
      change('rules', { id: 'r1', updatedAt: 1, match: 'kroger', categoryId: 'cat_groceries' }),
      change('bills', { id: 'bill_phone', updatedAt: 1, name: 'Phone', amount: 85, frequency: 'monthly', dueDate: '2026-10-20', categoryId: 'cat_bills', match: 'verizon', startDate: '2026-10-01' }),
    ]);
    fake.pages[3] = {
      added: [
        tx('t5', { merchant_name: 'Kroger', personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_SUPERSTORES' } }),
        tx('t6', { amount: 85, merchant_name: 'Verizon Wireless', personal_finance_category: { primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_TELEPHONE' } }),
      ],
      modified: [],
      removed: [],
    };
    await bank.syncItem('item_1');
    expect(get('t5')!.categoryId).toBe('cat_groceries');
    expect(get('t6')!.billId).toBe('bill_phone');
    expect(get('t6')!.categoryId).toBe('cat_phone');
  });

  it('files purchases for a deleted category under Other', async () => {
    store.apply([change('categories', { id: 'cat_pets', updatedAt: 5, name: 'Pets', icon: 'paw', sort: 11.5, deleted: true })]);
    fake.pages[4] = {
      added: [tx('t7', { merchant_name: 'Petco', personal_finance_category: { primary: 'GENERAL_MERCHANDISE', detailed: 'GENERAL_MERCHANDISE_PET_SUPPLIES' } })],
      modified: [],
      removed: [],
    };
    await bank.syncItem('item_1');
    expect(get('t7')!.categoryId).toBe('cat_other');
  });

  it('lets the bank copy of something you added by hand take its place', async () => {
    const at = Date.parse('2026-10-03T12:15:00');
    store.apply([
      change('transactions', { id: 'hand1', updatedAt: 1, source: 'manual', date: '2026-10-03', at, amount: 23.17, merchant: 'Chipotle', categoryId: 'cat_fun', note: 'team lunch' }),
      change('transactions', { id: 'hand2', updatedAt: 1, source: 'manual', date: '2026-10-04', amount: 40, merchant: 'Cash for a friend', categoryId: 'cat_other' }),
    ]);
    fake.pages[5] = {
      added: [
        tx('t9', { amount: 23.17, merchant_name: 'Chipotle Mexican Grill', authorized_date: '2026-10-04' }),
        // Same round amount, different place: too likely to be a different purchase.
        tx('t10', { amount: 40, merchant_name: 'Kroger', authorized_date: '2026-10-04', personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES' } }),
      ],
      modified: [],
      removed: [],
    };
    await bank.syncItem('item_1');
    expect(get('t9')).toMatchObject({ categoryId: 'cat_fun', note: 'team lunch', edited: true, at });
    expect(store.get('transactions', 'hand1')?.deleted).toBe(true);
    expect(get('t10')!.categoryId).toBe('cat_groceries');
    expect(store.get('transactions', 'hand2')?.deleted).toBeFalsy();
  });

  it('turns an account on and off', () => {
    bank.setAccountIncluded('item_1', 'acc_loan', true);
    expect(get('t4')!.accountOff).toBeUndefined();
    bank.setAccountIncluded('item_1', 'acc_loan', false);
    expect(get('t4')!.accountOff).toBe(true);
    // Edited transactions follow the switch too.
    expect(get('t1')!.edited).toBe(true);
    bank.setAccountIncluded('item_1', 'acc_checking', false);
    expect(get('t1')!.accountOff).toBe(true);
    bank.setAccountIncluded('item_1', 'acc_checking', true);
    expect(get('t1')!.accountOff).toBeUndefined();
  });

  it('removes a connection and its transactions', async () => {
    await bank.removeItem('item_1');
    expect(fake.removedItems).toBe(1);
    expect(bank.status().items).toEqual([]);
    expect(store.all('transactions').filter((t) => t.source === 'plaid')).toEqual([]);
  });
});
