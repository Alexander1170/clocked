// Bank connections through Plaid. Keys and access tokens stay in server-only
// tables; imported transactions go into the synced store like any other record.
import { Hono } from 'hono';
import type { Store } from './db.ts';
import { plaidClient, PlaidError, type PlaidAccount, type PlaidClient, type PlaidEnv, type PlaidTransaction } from './plaid.ts';
import { cleanName, findManualMatch, mapPlaidTransaction } from './categorize.ts';
import { billForPayment, paysBill } from '../shared/bills.ts';
import type { Change, Transaction } from '../shared/types.ts';

const DAYS_REQUESTED = 180;
const SANDBOX_INSTITUTION = 'ins_109508'; // First Platypus Bank
const TRIAL_ITEM_CAP = 10;

export interface AccountInfo {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  balance: number | null;
  /** What's free to spend, after pending charges. */
  available?: number | null;
  /** Count this account's spending. */
  included: boolean;
}

export type ItemState = 'ok' | 'login_required' | 'error';

export interface ItemStatus {
  itemId: string;
  env: PlaidEnv;
  institution: string;
  accounts: AccountInfo[];
  status: ItemState;
  error: string | null;
  createdAt: number;
  syncedAt: number | null;
  refreshedAt: number | null;
  /** Plaid's progress pulling history: NOT_READY, INITIAL_UPDATE_COMPLETE, or HISTORICAL_UPDATE_COMPLETE. */
  updateStatus: string | null;
}

export interface BankStatus {
  configured: boolean;
  /** Last 4 characters of the client ID, so you can tell which keys are saved. */
  clientIdHint: string | null;
  secrets: Record<PlaidEnv, boolean>;
  /** Live (Production) bank logins created so far. The free Trial plan allows 10, ever. */
  liveItemsUsed: number;
  liveItemCap: number;
  items: ItemStatus[];
}

interface ItemRow {
  item_id: string;
  env: PlaidEnv;
  access_token: string;
  institution: string | null;
  cursor: string;
  accounts: string;
  status: ItemState;
  error: string | null;
  created_at: number;
  synced_at: number | null;
  refreshed_at: number | null;
  update_status: string | null;
}

interface Config {
  clientId: string;
  secrets: Partial<Record<PlaidEnv, string>>;
}

export class BankError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const accountLabel = (a: AccountInfo) => `${a.name}${a.mask ? ` ••${a.mask}` : ''}`;
const includedByDefault = (a: PlaidAccount) => a.type === 'depository' || a.type === 'credit';

/**
 * Plaid's account, keeping the on/off switch it already had. A new account
 * the bank starts sharing on its own stays off once you've switched any
 * account off, since you've already picked what counts. One you picked in
 * Plaid yourself starts on.
 */
const accountInfo = (a: PlaidAccount, prev: AccountInfo[], picked = false): AccountInfo => ({
  id: a.account_id,
  name: a.name,
  mask: a.mask ?? null,
  type: a.type,
  subtype: a.subtype ?? null,
  balance: a.balances?.current ?? null,
  available: a.balances?.available ?? null,
  included: prev.find((p) => p.id === a.account_id)?.included ?? (!picked && prev.some((p) => !p.included && (p.type === 'depository' || p.type === 'credit')) ? false : includedByDefault(a)),
});

function describe(e: unknown): { status: ItemState; message: string } {
  if (e instanceof PlaidError) {
    if (e.code === 'ITEM_LOGIN_REQUIRED' || e.code === 'PENDING_EXPIRATION' || e.code === 'PENDING_DISCONNECT')
      return { status: 'login_required', message: 'The bank needs you to sign in again.' };
    return { status: 'error', message: e.display ?? `${e.code}: ${e.message}` };
  }
  return { status: 'error', message: e instanceof Error ? e.message : String(e) };
}

export function createBank(store: Store, opts: { baseUrls?: Partial<Record<PlaidEnv, string>>; log?: (msg: string) => void } = {}) {
  const log = opts.log ?? ((msg: string) => console.log(`[bank] ${msg}`));
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS plaid_items (
      item_id TEXT PRIMARY KEY,
      env TEXT NOT NULL,
      access_token TEXT NOT NULL,
      institution TEXT,
      cursor TEXT NOT NULL DEFAULT '',
      accounts TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT,
      created_at INTEGER NOT NULL,
      synced_at INTEGER,
      refreshed_at INTEGER
    );
  `);
  // Columns added after the first release.
  const cols = new Set((db.prepare('PRAGMA table_info(plaid_items)').all() as Array<{ name: string }>).map((c) => c.name));
  if (!cols.has('update_status')) db.exec('ALTER TABLE plaid_items ADD COLUMN update_status TEXT');
  const kvGet = (k: string) => (db.prepare('SELECT v FROM kv WHERE k = ?').get(k) as { v: string } | undefined)?.v;
  const kvSet = (k: string, v: string) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').run(k, v);
  const rows = () => db.prepare('SELECT * FROM plaid_items ORDER BY created_at').all() as unknown as ItemRow[];
  const row = (id: string) => db.prepare('SELECT * FROM plaid_items WHERE item_id = ?').get(id) as unknown as ItemRow | undefined;
  const update = (id: string, fields: Partial<ItemRow>) => {
    const keys = Object.keys(fields) as Array<keyof ItemRow>;
    if (!keys.length) return;
    db.prepare(`UPDATE plaid_items SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE item_id = ?`).run(
      ...keys.map((k) => (fields[k] ?? null) as string | number | null),
      id,
    );
  };

  const config = (): Config | null => {
    const raw = kvGet('plaid');
    return raw ? (JSON.parse(raw) as Config) : null;
  };

  function client(env: PlaidEnv): PlaidClient {
    const cfg = config();
    const secret = cfg?.secrets[env];
    if (!cfg?.clientId || !secret) throw new BankError(`Add your Plaid ${env === 'sandbox' ? 'Sandbox' : 'Production'} secret first.`);
    return plaidClient(env, cfg.clientId, secret, opts.baseUrls?.[env]);
  }

  function status(): BankStatus {
    const cfg = config();
    return {
      configured: !!cfg?.clientId && !!(cfg.secrets.sandbox || cfg.secrets.production),
      clientIdHint: cfg?.clientId ? cfg.clientId.slice(-4) : null,
      secrets: { sandbox: !!cfg?.secrets.sandbox, production: !!cfg?.secrets.production },
      liveItemsUsed: Number(kvGet('live_items_created') ?? 0),
      liveItemCap: TRIAL_ITEM_CAP,
      items: rows().map((r) => ({
        itemId: r.item_id,
        env: r.env,
        institution: r.institution ?? 'Bank',
        accounts: JSON.parse(r.accounts) as AccountInfo[],
        status: r.status,
        error: r.error,
        createdAt: r.created_at,
        syncedAt: r.synced_at,
        refreshedAt: r.refreshed_at,
        updateStatus: r.update_status,
      })),
    };
  }

  function saveConfig(input: { clientId?: string; sandboxSecret?: string; productionSecret?: string }) {
    const cur = config() ?? { clientId: '', secrets: {} };
    const clean = (s: string | undefined) => (typeof s === 'string' ? s.trim() : '');
    const next: Config = {
      clientId: clean(input.clientId) || cur.clientId,
      secrets: {
        sandbox: clean(input.sandboxSecret) || cur.secrets.sandbox,
        production: clean(input.productionSecret) || cur.secrets.production,
      },
    };
    if (!next.clientId) throw new BankError('Enter your Plaid client ID.');
    kvSet('plaid', JSON.stringify(next));
  }

  const syncing = new Set<string>();
  const followUps = new Map<string, ReturnType<typeof setTimeout>[]>();

  async function syncItem(itemId: string): Promise<{ added: number; modified: number; removed: number } | null> {
    if (syncing.has(itemId)) return null;
    const item = row(itemId);
    if (!item) return null;
    syncing.add(itemId);
    try {
      const c = client(item.env);
      let added: PlaidTransaction[] = [];
      let modified: PlaidTransaction[] = [];
      let removed: Array<{ transaction_id: string }> = [];
      let cursor = item.cursor;
      let updateStatus = item.update_status;
      for (let attempt = 0; ; attempt++) {
        try {
          cursor = item.cursor;
          added = [];
          modified = [];
          removed = [];
          for (let more = true; more; ) {
            const page = await c.syncPage(item.access_token, cursor, DAYS_REQUESTED);
            added.push(...page.added);
            modified.push(...page.modified);
            removed.push(...page.removed);
            if (page.transactions_update_status) updateStatus = page.transactions_update_status;
            cursor = page.next_cursor;
            more = page.has_more;
          }
          break;
        } catch (e) {
          // The data changed mid-pagination: restart from the first page.
          if (e instanceof PlaidError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 3) continue;
          throw e;
        }
      }
      const prevAccounts = JSON.parse(item.accounts) as AccountInfo[];
      // A sync page only lists the accounts with new activity, so get the full list from
      // the bank. Balances only move when transactions do, so skip it on quiet checks.
      const stale = !prevAccounts.length || prevAccounts.some((a) => !('available' in a));
      const accounts = stale || added.length || modified.length || removed.length ? await c.accounts(item.access_token) : null;
      const accountInfos: AccountInfo[] = accounts ? accounts.map((a) => accountInfo(a, prevAccounts)) : prevAccounts;
      const byAccount = new Map(accountInfos.map((a) => [a.id, a]));

      const rules = store.all('rules');
      const bills = store.all('bills');
      const categoryGone = (id: string) => !!store.get('categories', id)?.deleted;
      const now = Date.now();
      const changes: Change[] = [];
      // Purchases you added by hand that the bank hasn't sent yet. Each can stand in for one bank transaction.
      const handEntered = store.all('transactions').filter((x) => x.source !== 'plaid');
      const matched = new Set<string>();
      for (const t of [...added, ...modified]) {
        const existing = store.get('transactions', `plaid_${t.transaction_id}`);
        let carryFrom = !existing && t.pending_transaction_id ? store.get('transactions', `plaid_${t.pending_transaction_id}`) : undefined;
        // The bank's copy of something you already added takes its place, keeping your category and note.
        const replaces =
          !existing && !carryFrom
            ? findManualMatch(
                { amount: t.amount, date: t.authorized_date || t.date, merchant: (t.merchant_name || cleanName(t.name) || t.name).trim() },
                handEntered.filter((x) => !matched.has(x.id)),
              )
            : undefined;
        if (replaces) {
          matched.add(replaces.id);
          carryFrom = { ...replaces, edited: true };
        }
        const acct = byAccount.get(t.account_id);
        // An account the bank no longer lists (closed, or no longer shared) doesn't count.
        const account = acct
          ? { name: accountLabel(acct), included: acct.included }
          : accountInfos.length
            ? { name: existing?.accountName ?? carryFrom?.accountName ?? 'Account no longer shared', included: false }
            : undefined;
        const rec = mapPlaidTransaction(t, { existing, carryFrom, rules, bills, categoryGone, account, itemId, now });
        changes.push({ c: 'transactions', rec });
        if (replaces) changes.push({ c: 'transactions', rec: { ...replaces, deleted: true, updatedAt: Math.max(now, replaces.updatedAt + 1) } });
      }
      for (const r of removed) {
        const existing = store.get('transactions', `plaid_${r.transaction_id}`);
        if (existing && !existing.deleted) changes.push({ c: 'transactions', rec: { ...existing, deleted: true, updatedAt: Math.max(now, existing.updatedAt + 1) } });
      }
      if (changes.length) store.apply(changes);
      update(itemId, { cursor, accounts: JSON.stringify(accountInfos), status: 'ok', error: null, synced_at: now, update_status: updateStatus });
      if (added.length || modified.length || removed.length)
        log(`${item.institution ?? itemId}: +${added.length} ~${modified.length} -${removed.length}`);
      if (updateStatus !== item.update_status) log(`${item.institution ?? itemId}: Plaid says ${updateStatus}`);
      // Until Plaid has the whole history, check back: every 2 minutes at first, then every 10, for a few hours.
      const age = now - item.created_at;
      if (updateStatus && updateStatus !== 'HISTORICAL_UPDATE_COMPLETE' && age < 6 * 3_600_000) followUp(itemId, [age < 30 * 60_000 ? 120_000 : 600_000]);
      return { added: added.length, modified: modified.length, removed: removed.length };
    } catch (e) {
      const d = describe(e);
      update(itemId, { status: d.status, error: d.message });
      log(`sync failed for ${item.institution ?? itemId}: ${d.message}`);
      return null;
    } finally {
      syncing.delete(itemId);
    }
  }

  /** New data takes Plaid a little while to gather; check back a few times. */
  function followUp(itemId: string, delays: number[]) {
    for (const t of followUps.get(itemId) ?? []) clearTimeout(t);
    followUps.set(
      itemId,
      delays.map((ms) => {
        const t = setTimeout(() => void syncItem(itemId), ms);
        t.unref?.();
        return t;
      }),
    );
  }

  async function addItem(env: PlaidEnv, publicToken: string, institution?: string): Promise<string> {
    const c = client(env);
    const { accessToken, itemId } = await c.exchange(publicToken);
    const name = institution || (await c.institutionName(accessToken).catch(() => null)) || 'Bank';
    db.prepare('INSERT OR REPLACE INTO plaid_items (item_id, env, access_token, institution, created_at) VALUES (?, ?, ?, ?, ?)').run(
      itemId,
      env,
      accessToken,
      name,
      Date.now(),
    );
    if (env === 'production') kvSet('live_items_created', String(Number(kvGet('live_items_created') ?? 0) + 1));
    log(`connected ${name} (${env})`);
    await syncItem(itemId);
    followUp(itemId, [5_000, 20_000, 60_000, 180_000]);
    return itemId;
  }

  async function refresh(itemId?: string) {
    for (const item of itemId ? [row(itemId)].filter(Boolean) : rows()) {
      const r = item as ItemRow;
      try {
        await client(r.env).refresh(r.access_token);
        update(r.item_id, { refreshed_at: Date.now() });
      } catch (e) {
        const d = describe(e);
        if (d.status === 'login_required') update(r.item_id, { status: d.status, error: d.message });
      }
      followUp(r.item_id, [10_000, 40_000, 120_000]);
    }
  }

  async function syncAll() {
    for (const r of rows()) await syncItem(r.item_id);
    reconcileAccounts();
    linkBillPayments();
  }

  /** Links bank payments to the bills they pay, for ones not linked yet that you haven't edited. */
  function linkBillPayments() {
    const bills = store.all('bills');
    if (!bills.length) return;
    const now = Date.now();
    const changes: Change[] = [];
    const byId = new Map(bills.map((b) => [b.id, b]));
    for (const tx of store.all('transactions')) {
      // Links you made yourself are edits, and stay put.
      if (tx.source !== 'plaid' || tx.edited || !(tx.amount > 0) || tx.flow === 'income') continue;
      const cur = tx.billId ? byId.get(tx.billId) : undefined;
      if (cur && paysBill(cur, tx.merchant, tx.amount, tx.rawName)) continue;
      // Unlinked, or linked to a bill it no longer fits (its bank name changed, or it was deleted).
      const billId = billForPayment(bills, tx.merchant, tx.amount, tx.rawName)?.id;
      if (billId === tx.billId) continue;
      const rec: Transaction = { ...tx, updatedAt: Math.max(now, tx.updatedAt + 1) };
      if (billId) rec.billId = billId;
      else delete rec.billId;
      changes.push({ c: 'transactions', rec });
    }
    if (changes.length) {
      store.apply(changes);
      log(`relinked ${changes.length} bank payments to bills`);
    }
  }

  /**
   * Makes every bank transaction's accountOff flag match its account's switch.
   * Also clears the old way switched-off accounts were marked (excluded on unedited transactions).
   */
  function reconcileAccounts() {
    const included = new Map<string, boolean>();
    for (const r of rows()) for (const a of JSON.parse(r.accounts) as AccountInfo[]) included.set(a.id, a.included);
    const now = Date.now();
    const changes: Change[] = [];
    const known = rows().some((r) => (JSON.parse(r.accounts) as AccountInfo[]).length);
    for (const tx of store.all('transactions')) {
      if (tx.source !== 'plaid' || !tx.accountId) continue;
      // An account the bank no longer lists doesn't count.
      if (!included.has(tx.accountId) && !known) continue;
      const off = !included.get(tx.accountId);
      const legacy = !tx.edited && tx.excluded;
      if (!!tx.accountOff === off && !legacy) continue;
      const rec = { ...tx, updatedAt: Math.max(now, tx.updatedAt + 1) };
      if (off) rec.accountOff = true;
      else delete rec.accountOff;
      if (legacy) delete rec.excluded;
      changes.push({ c: 'transactions', rec });
    }
    if (changes.length) store.apply(changes);
  }

  function setAccountIncluded(itemId: string, accountId: string, included: boolean) {
    const item = row(itemId);
    if (!item) throw new BankError('No such bank connection.', 404);
    const accounts = (JSON.parse(item.accounts) as AccountInfo[]).map((a) => (a.id === accountId ? { ...a, included } : a));
    update(itemId, { accounts: JSON.stringify(accounts) });
    reconcileAccounts();
  }

  async function removeItem(itemId: string) {
    const item = row(itemId);
    if (!item) return;
    try {
      await client(item.env).remove(item.access_token);
    } catch (e) {
      log(`remove at Plaid failed (continuing): ${describe(e).message}`);
    }
    const accountIds = new Set((JSON.parse(item.accounts) as AccountInfo[]).map((a) => a.id));
    // Older transactions don't say which connection they came from. Ones from an account no
    // other connection lists, like a closed one, go with this connection.
    const others = new Set(
      rows()
        .filter((r) => r.item_id !== itemId)
        .flatMap((r) => (JSON.parse(r.accounts) as AccountInfo[]).map((a) => a.id)),
    );
    const mine = (tx: Transaction) => (tx.itemId ? tx.itemId === itemId : !!tx.accountId && (accountIds.has(tx.accountId) || !others.has(tx.accountId)));
    const now = Date.now();
    const changes: Change[] = store
      .all('transactions')
      .filter((tx) => tx.source === 'plaid' && mine(tx))
      .map((tx) => ({ c: 'transactions' as const, rec: { ...tx, deleted: true, updatedAt: Math.max(now, tx.updatedAt + 1) } }));
    if (changes.length) store.apply(changes);
    db.prepare('DELETE FROM plaid_items WHERE item_id = ?').run(itemId);
    for (const t of followUps.get(itemId) ?? []) clearTimeout(t);
    log(`removed ${item.institution ?? itemId} and ${changes.length} transactions`);
  }

  return {
    status,
    saveConfig,
    syncItem,
    syncAll,
    refresh,
    setAccountIncluded,
    removeItem,
    addItem,
    linkToken: (env: PlaidEnv, itemId?: string) => {
      const item = itemId ? row(itemId) : undefined;
      if (itemId && !item) throw new BankError('No such bank connection.', 404);
      if (env === 'production' && !item && Number(kvGet('live_items_created') ?? 0) >= TRIAL_ITEM_CAP)
        throw new BankError('All 10 free Plaid Trial connections are used.');
      return client(item?.env ?? env).linkToken({ accessToken: item?.access_token, daysRequested: DAYS_REQUESTED });
    },
    connectSandbox: async () => addItem('sandbox', await client('sandbox').sandboxPublicToken(SANDBOX_INSTITUTION), 'First Platypus Bank (test)'),
    /** After fixing a login in Link, clear the error and pull new data. */
    reconnected: async (itemId: string) => {
      const item = row(itemId);
      if (!item) return;
      update(itemId, { status: 'ok', error: null });
      // The bank may share different accounts now.
      try {
        const prev = JSON.parse(item.accounts) as AccountInfo[];
        const accounts = await client(item.env).accounts(item.access_token);
        update(itemId, { accounts: JSON.stringify(accounts.map((a) => accountInfo(a, prev, true))) });
      } catch (e) {
        log(`account refresh after reconnect failed: ${describe(e).message}`);
      }
      await syncItem(itemId);
    },
    /** Sync every hour; ask banks for fresh data every 6 hours. */
    schedule() {
      reconcileAccounts();
      const first = setTimeout(() => void syncAll(), 20_000);
      const hourly = setInterval(() => void syncAll(), 3_600_000);
      const refreshes = setInterval(() => void refresh(), 6 * 3_600_000);
      first.unref?.();
      hourly.unref?.();
      refreshes.unref?.();
    },
  };
}

export type Bank = ReturnType<typeof createBank>;

export function bankRoutes(bank: Bank): Hono {
  const r = new Hono();
  const body = async <T,>(c: { req: { json<J>(): Promise<J> } }) => (await c.req.json<T>().catch(() => ({}) as T)) as T;
  const env = (v: unknown): PlaidEnv => (v === 'production' ? 'production' : 'sandbox');

  r.get('/', (c) => c.json(bank.status()));
  r.put('/config', async (c) => {
    bank.saveConfig(await body(c));
    return c.json(bank.status());
  });
  r.post('/link-token', async (c) => {
    const b = await body<{ env?: string; itemId?: string }>(c);
    return c.json({ linkToken: await bank.linkToken(env(b.env), b.itemId) });
  });
  r.post('/exchange', async (c) => {
    const b = await body<{ env?: string; publicToken?: string; institution?: string }>(c);
    if (!b.publicToken) throw new BankError('Missing public token.');
    return c.json({ itemId: await bank.addItem(env(b.env), b.publicToken, b.institution) });
  });
  r.post('/reconnected', async (c) => {
    const b = await body<{ itemId?: string }>(c);
    if (b.itemId) await bank.reconnected(b.itemId);
    return c.json(bank.status());
  });
  r.post('/sandbox', async (c) => c.json({ itemId: await bank.connectSandbox() }));
  r.post('/refresh', async (c) => {
    const b = await body<{ itemId?: string }>(c);
    await bank.refresh(b.itemId);
    return c.json(bank.status());
  });
  r.post('/sync', async (c) => {
    await bank.syncAll();
    return c.json(bank.status());
  });
  r.patch('/items/:id/accounts/:accountId', async (c) => {
    const b = await body<{ included?: boolean }>(c);
    bank.setAccountIncluded(c.req.param('id'), c.req.param('accountId'), !!b.included);
    return c.json(bank.status());
  });
  r.delete('/items/:id', async (c) => {
    await bank.removeItem(c.req.param('id'));
    return c.json(bank.status());
  });
  r.onError((e, c) => {
    if (e instanceof BankError) return c.json({ error: e.message }, e.status as 400);
    if (e instanceof PlaidError) {
      const message =
        e.code === 'INVALID_API_KEYS'
          ? 'Plaid didn’t accept those keys. Check the client ID and secret for this environment.'
          : (e.display ?? `${e.code}: ${e.message}`);
      return c.json({ error: message, code: e.code }, 400);
    }
    console.error('[bank]', e);
    return c.json({ error: 'Something went wrong talking to Plaid.' }, 500);
  });
  return r;
}
