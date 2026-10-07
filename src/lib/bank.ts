import { create } from 'zustand';
import type { BankStatus } from '../../server/bank.ts';
import type { PlaidEnv } from '../../server/plaid.ts';

export type { BankStatus, PlaidEnv };
export type { AccountInfo, ItemStatus } from '../../server/bank.ts';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/bank${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? (res.status === 403 ? 'This device isn’t allowed to use the bank connection.' : `Request failed (${res.status})`));
  return data as T;
}

export const bankApi = {
  status: () => api<BankStatus>('GET', ''),
  saveConfig: (b: { clientId?: string; sandboxSecret?: string; productionSecret?: string }) => api<BankStatus>('PUT', '/config', b),
  linkToken: (env: PlaidEnv, itemId?: string) => api<{ linkToken: string }>('POST', '/link-token', { env, itemId }),
  exchange: (env: PlaidEnv, publicToken: string, institution?: string) => api<{ itemId: string }>('POST', '/exchange', { env, publicToken, institution }),
  reconnected: (itemId: string) => api<BankStatus>('POST', '/reconnected', { itemId }),
  sandbox: () => api<{ itemId: string }>('POST', '/sandbox'),
  refresh: (itemId?: string) => api<BankStatus>('POST', '/refresh', { itemId }),
  setAccount: (itemId: string, accountId: string, included: boolean) =>
    api<BankStatus>('PATCH', `/items/${encodeURIComponent(itemId)}/accounts/${encodeURIComponent(accountId)}`, { included }),
  remove: (itemId: string) => api<BankStatus>('DELETE', `/items/${encodeURIComponent(itemId)}`),
};

/** The server's bank status, shared by every screen that shows it. */
export const useBank = create<{ status: BankStatus | null; error: string | null; loadedAt: number; load(): Promise<void>; set(s: BankStatus): void }>()((set) => ({
  status: null,
  error: null,
  loadedAt: 0,
  async load() {
    try {
      set({ status: await bankApi.status(), error: null, loadedAt: Date.now() });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  set: (status) => set({ status, error: null, loadedAt: Date.now() }),
}));

// ---- Plaid Link ----------------------------------------------------------------

interface PlaidLinkHandler {
  open(): void;
  destroy?(): void;
}

interface PlaidGlobal {
  create(opts: {
    token: string;
    onSuccess(publicToken: string, metadata: { institution?: { name?: string } | null }): void;
    onExit(error: { display_message?: string | null; error_message?: string } | null): void;
  }): PlaidLinkHandler;
}

let linkScript: Promise<void> | null = null;

function loadLink(): Promise<void> {
  linkScript ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => resolve();
    s.onerror = () => {
      linkScript = null;
      reject(new Error('Couldn’t load Plaid. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return linkScript;
}

/** Opens Plaid Link. Resolves with the public token, or null if you closed it. */
export async function openPlaidLink(token: string): Promise<{ publicToken: string; institution?: string } | null> {
  await loadLink();
  const Plaid = (window as unknown as { Plaid: PlaidGlobal }).Plaid;
  return new Promise((resolve, reject) => {
    const handler = Plaid.create({
      token,
      onSuccess: (publicToken, metadata) => {
        handler.destroy?.();
        resolve({ publicToken, institution: metadata.institution?.name ?? undefined });
      },
      onExit: (err) => {
        handler.destroy?.();
        if (err) reject(new Error(err.display_message || err.error_message || 'Plaid closed with an error.'));
        else resolve(null);
      },
    });
    handler.open();
  });
}
