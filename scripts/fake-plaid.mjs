// A stand-in for Plaid's Sandbox API, for trying the bank screens locally without keys.
// Run: node scripts/fake-plaid.mjs   then set PLAID_SANDBOX_URL=http://127.0.0.1:8799 in .env.local
// and use client ID "fake" with sandbox secret "fake".
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_PLAID_PORT ?? 8799);
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const accounts = [
  { account_id: 'acc_chk', name: 'Everyday Checking', mask: '1111', type: 'depository', subtype: 'checking', balances: { current: 1284.55 } },
  { account_id: 'acc_sav', name: 'Savings', mask: '2222', type: 'depository', subtype: 'savings', balances: { current: 3200 } },
];

const pfc = (primary, detailed) => ({ primary, detailed, confidence_level: 'HIGH' });
let n = 0;
const tx = (offset, amount, merchant, primary, detailed, extra = {}) => ({
  transaction_id: `fake_${++n}`,
  account_id: 'acc_chk',
  amount,
  iso_currency_code: 'USD',
  date: day(offset + 1),
  authorized_date: day(offset),
  name: `DEBIT CARD PURCHASE ${merchant.toUpperCase()} 1234 SPRINGFIELD OH`,
  merchant_name: merchant,
  pending: false,
  personal_finance_category: pfc(primary, detailed),
  ...extra,
});

const history = [
  tx(0, 6.45, 'Starbucks', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE', { pending: true, date: day(0) }),
  tx(0, 41.2, 'Speedway', 'TRANSPORTATION', 'TRANSPORTATION_GAS', { pending: true, date: day(0) }),
  tx(-1, 12.87, 'Chipotle', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_FAST_FOOD'),
  tx(-1, 86.34, 'Kroger', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'),
  tx(-2, 15.49, 'Netflix', 'ENTERTAINMENT', 'ENTERTAINMENT_TV_AND_MOVIES'),
  tx(-3, 1476.12, 'Acme Logistics', 'INCOME', 'INCOME_SALARY', { amount: -1476.12, name: 'ACME PAYROLL DIRECT DEP', merchant_name: null }),
  tx(-3, 200, 'Transfer to Savings', 'TRANSFER_OUT', 'TRANSFER_OUT_SAVINGS', { merchant_name: null, name: 'ONLINE TRANSFER TO SAVINGS 2222' }),
  tx(-4, 85, 'Verizon Wireless', 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE'),
  tx(-5, 23.1, 'Amazon', 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES'),
  tx(-6, 9.99, 'Spotify', 'ENTERTAINMENT', 'ENTERTAINMENT_MUSIC_AND_AUDIO'),
  tx(-6, 54.6, 'DoorDash', 'INCOME', 'INCOME_GIG_ECONOMY', { amount: -54.6, name: 'DOORDASH DASHER PAYOUT' }),
  tx(-8, 31.75, 'Target', 'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES'),
  tx(-9, 7.25, 'Panera Bread', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'),
  tx(-10, 120, 'City Electric', 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'),
];

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const reply = (status, json) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (body.client_id !== 'fake' || body.secret !== 'fake') return reply(400, { error_code: 'INVALID_API_KEYS', error_type: 'INVALID_INPUT', error_message: 'invalid client_id or secret provided' });
    switch (req.url) {
      case '/sandbox/public_token/create':
        return reply(200, { public_token: 'public-sandbox-fake' });
      case '/item/public_token/exchange':
        return reply(200, { access_token: 'access-sandbox-fake', item_id: 'item_fake' });
      case '/accounts/get':
        return reply(200, { accounts });
      case '/transactions/sync':
        return reply(200, body.cursor ? { added: [], modified: [], removed: [], next_cursor: body.cursor, has_more: false, accounts } : { added: history, modified: [], removed: [], next_cursor: 'c1', has_more: false, accounts });
      case '/transactions/refresh':
      case '/item/remove':
        return reply(200, {});
      case '/link/token/create':
        return reply(200, { link_token: 'link-sandbox-fake' });
      default:
        return reply(404, { error_code: 'NOT_FOUND', error_message: req.url });
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`fake Plaid on http://127.0.0.1:${PORT}`));
