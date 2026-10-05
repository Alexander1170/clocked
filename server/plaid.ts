// Minimal Plaid API client: plain fetch, only the endpoints Clocked uses.

export type PlaidEnv = 'sandbox' | 'production';

const HOSTS: Record<PlaidEnv, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances?: { current?: number | null; available?: number | null; iso_currency_code?: string | null };
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  iso_currency_code?: string | null;
  date: string;
  authorized_date?: string | null;
  authorized_datetime?: string | null;
  datetime?: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary: string; detailed: string; confidence_level?: string } | null;
}

export interface SyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: Array<{ transaction_id: string; account_id?: string }>;
  next_cursor: string;
  has_more: boolean;
  accounts?: PlaidAccount[];
  transactions_update_status?: string;
}

export class PlaidError extends Error {
  readonly code: string;
  readonly type: string;
  readonly display: string | null;
  readonly status: number;
  constructor(body: { error_code?: string; error_type?: string; error_message?: string; display_message?: string | null }, status: number) {
    super(body.error_message ?? `Plaid error ${status}`);
    this.code = body.error_code ?? 'UNKNOWN';
    this.type = body.error_type ?? 'API_ERROR';
    this.display = body.display_message ?? null;
    this.status = status;
  }
}

export interface PlaidClient {
  env: PlaidEnv;
  linkToken(opts: { accessToken?: string; daysRequested?: number }): Promise<string>;
  exchange(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  sandboxPublicToken(institutionId: string): Promise<string>;
  accounts(accessToken: string): Promise<PlaidAccount[]>;
  institutionName(accessToken: string): Promise<string | null>;
  syncPage(accessToken: string, cursor: string, daysRequested: number): Promise<SyncPage>;
  refresh(accessToken: string): Promise<void>;
  remove(accessToken: string): Promise<void>;
}

export function plaidClient(env: PlaidEnv, clientId: string, secret: string, baseUrl?: string): PlaidClient {
  const host = baseUrl ?? HOSTS[env];

  async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(host + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, secret, ...body }),
      signal: AbortSignal.timeout(45_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new PlaidError(data, res.status);
    return data as T;
  }

  return {
    env,

    async linkToken({ accessToken, daysRequested = 180 }) {
      const body: Record<string, unknown> = {
        client_name: 'Clocked',
        language: 'en',
        country_codes: ['US'],
        user: { client_user_id: 'clocked-owner' },
      };
      // Update mode (fixing a login) passes the access token instead of products.
      if (accessToken) body.access_token = accessToken;
      else {
        body.products = ['transactions'];
        body.transactions = { days_requested: daysRequested };
      }
      return (await call<{ link_token: string }>('/link/token/create', body)).link_token;
    },

    async exchange(publicToken) {
      const r = await call<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: publicToken });
      return { accessToken: r.access_token, itemId: r.item_id };
    },

    async sandboxPublicToken(institutionId) {
      const r = await call<{ public_token: string }>('/sandbox/public_token/create', {
        institution_id: institutionId,
        initial_products: ['transactions'],
        options: { transactions: { days_requested: 90 } },
      });
      return r.public_token;
    },

    async accounts(accessToken) {
      return (await call<{ accounts: PlaidAccount[] }>('/accounts/get', { access_token: accessToken })).accounts;
    },

    async institutionName(accessToken) {
      const item = await call<{ item: { institution_id?: string | null } }>('/item/get', { access_token: accessToken });
      const id = item.item.institution_id;
      if (!id) return null;
      const inst = await call<{ institution: { name: string } }>('/institutions/get_by_id', { institution_id: id, country_codes: ['US'] });
      return inst.institution.name;
    },

    syncPage(accessToken, cursor, daysRequested) {
      return call<SyncPage>('/transactions/sync', {
        access_token: accessToken,
        cursor: cursor || undefined,
        count: 500,
        options: { days_requested: daysRequested },
      });
    },

    async refresh(accessToken) {
      await call('/transactions/refresh', { access_token: accessToken });
    },

    async remove(accessToken) {
      await call('/item/remove', { access_token: accessToken });
    },
  };
}
