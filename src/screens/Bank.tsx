import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeft, CircleAlert, ExternalLink, FlaskConical, KeyRound, Landmark, RefreshCw, Trash } from 'lucide-react';
import { bankApi, openPlaidLink, useBank, type ItemStatus } from '../lib/bank.ts';
import { syncNow } from '../lib/sync.ts';
import { clock, dayLabel, money } from '../lib/format.ts';
import { toLocalDate } from '../../shared/dates.ts';
import { go, toast } from '../lib/ui.ts';
import { Card, Field, SectionTitle, Toggle } from '../components/ui.tsx';

function ago(t: number | null): string {
  if (!t) return 'not yet';
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${dayLabel(toLocalDate(t))}, ${clock(t)}`;
}

function KeysForm({ onDone, existing }: { onDone(): void; existing: boolean }) {
  const set = useBank((s) => s.set);
  const [clientId, setClientId] = useState('');
  const [sandbox, setSandbox] = useState('');
  const [production, setProduction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!existing && !clientId.trim()) return setError('Enter your client ID.');
    if (!existing && !sandbox.trim() && !production.trim()) return setError('Enter at least one secret.');
    setBusy(true);
    try {
      set(await bankApi.saveConfig({ clientId, sandboxSecret: sandbox, productionSecret: production }));
      toast({ title: 'Plaid keys saved' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-5 p-5">
      {!existing && (
        <ol className="space-y-3 text-[14px] text-ink-2">
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-bold text-ink">1</span>
            <span>
              Make a free Plaid account and pick the <b className="font-semibold text-ink">Trial</b> plan.{' '}
              <a className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-2 hover:underline" href="https://dashboard.plaid.com/signup" target="_blank" rel="noreferrer">
                Open Plaid <ExternalLink size={13} />
              </a>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-bold text-ink">2</span>
            <span>
              Copy your client ID and secrets from the Keys page.{' '}
              <a className="inline-flex items-center gap-1 font-semibold text-ink underline-offset-2 hover:underline" href="https://dashboard.plaid.com/developers/keys" target="_blank" rel="noreferrer">
                Open Keys <ExternalLink size={13} />
              </a>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raised text-[12px] font-bold text-ink">3</span>
            <span>Paste them here. They're stored on your home server, never on this device.</span>
          </li>
        </ol>
      )}
      <Field label="Client ID">
        <input className="input num" autoComplete="off" spellCheck={false} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={existing ? 'Leave blank to keep the saved one' : ''} />
      </Field>
      <Field label="Sandbox secret" hint="For Plaid's test bank with fake transactions.">
        <input className="input num" type="password" autoComplete="off" spellCheck={false} value={sandbox} onChange={(e) => setSandbox(e.target.value)} placeholder={existing ? 'Leave blank to keep' : ''} />
      </Field>
      <Field label="Production secret" hint="For your real bank account.">
        <input className="input num" type="password" autoComplete="off" spellCheck={false} value={production} onChange={(e) => setProduction(e.target.value)} placeholder={existing ? 'Leave blank to keep' : ''} />
      </Field>
      {error && <p className="text-[13px] text-spend">{error}</p>}
      <div className="flex gap-2">
        {existing && (
          <button className="btn btn-secondary" onClick={onDone}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary flex-1" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save keys'}
        </button>
      </div>
    </Card>
  );
}

function ItemCard({ item }: { item: ItemStatus }) {
  const set = useBank((s) => s.set);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const live = item.env === 'production';

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast({ title: 'That didn’t work', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  // Update mode: sign in again or change which accounts the bank shares. Uses the same connection, not a new one.
  const reconnect = (label: string) =>
    run(label, async () => {
      const { linkToken } = await bankApi.linkToken(item.env, item.itemId);
      if (await openPlaidLink(linkToken)) {
        set(await bankApi.reconnected(item.itemId));
        toast({ title: `${item.institution} updated`, detail: 'Checking for transactions now.' });
      }
    });

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[16px] font-semibold">
            <span className="truncate">{item.institution}</span>
            <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold', live ? 'bg-money/15 text-money' : 'bg-raised text-ink-2')}>{live ? 'Live' : 'Test'}</span>
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2">Updated {ago(item.syncedAt)}</p>
        </div>
        <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={() => run('refresh', async () => set(await bankApi.refresh(item.itemId)))}>
          <RefreshCw size={15} className={clsx(busy === 'refresh' && 'animate-spin')} /> Refresh
        </button>
      </div>

      {item.status === 'ok' && item.updateStatus && item.updateStatus !== 'HISTORICAL_UPDATE_COMPLETE' && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-raised p-3.5 text-[14px]">
          <RefreshCw size={17} className="mt-0.5 shrink-0 animate-spin text-ink-2" />
          <p className="text-ink-2">
            {item.updateStatus !== 'NOT_READY'
              ? 'Your recent transactions are in. Plaid is still pulling older history.'
              : Date.now() - item.createdAt < 15 * 60_000
                ? `Plaid is pulling your transactions from ${item.institution}. They usually show up within a few minutes.`
                : `Plaid hasn't been able to get your transactions from ${item.institution} yet. It keeps retrying, and they'll show up here on their own. No need to reconnect.`}
          </p>
        </div>
      )}

      {item.status !== 'ok' && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl bg-spend/10 p-3.5 text-[14px]">
          <CircleAlert size={18} className="mt-0.5 shrink-0 text-spend" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{item.status === 'login_required' ? 'Sign in to the bank again' : 'Couldn’t update'}</p>
            <p className="text-[13px] text-ink-2">{item.error}</p>
          </div>
          {item.status === 'login_required' && (
            <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => reconnect('reconnect')}>
              Reconnect
            </button>
          )}
        </div>
      )}

      <div className="mt-4 divide-y divide-line">
        {item.accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">
                {a.name} {a.mask && <span className="text-ink-3">••{a.mask}</span>}
              </span>
              <span className="block text-[13px] text-ink-2">
                {a.subtype ?? a.type}
                {a.balance != null && ` · ${money(a.balance)}`}
                {!a.included && ' · hidden'}
              </span>
            </span>
            <Toggle
              checked={a.included}
              label={`Use ${a.name}${a.mask ? ` ••${a.mask}` : ''}`}
              onChange={(v) => void run('account', async () => set(await bankApi.setAccount(item.itemId, a.id, v)))}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[13px] text-ink-2">Change which accounts {item.institution} shares. Doesn’t use a new connection.</p>
        <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={() => reconnect('accounts')}>
          Choose accounts
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[13px] text-ink-2">{live ? 'Removing doesn’t give back a free connection.' : 'Removes the test transactions too.'}</p>
        <button
          className="btn btn-sm btn-danger"
          disabled={!!busy}
          onClick={() =>
            confirmRemove
              ? void run('remove', async () => {
                  set(await bankApi.remove(item.itemId));
                  toast({ title: `${item.institution} removed` });
                })
              : setConfirmRemove(true)
          }
        >
          <Trash size={15} /> {confirmRemove ? 'Tap again to remove' : 'Remove'}
        </button>
      </div>
    </Card>
  );
}

export function Bank() {
  const { status, error, load } = useBank();
  const [editingKeys, setEditingKeys] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // New connections keep importing for a minute or two; keep the status fresh.
    const id = setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [load]);

  const connect = async (env: 'sandbox' | 'production') => {
    setBusy(env);
    try {
      if (env === 'sandbox') {
        await bankApi.sandbox();
        toast({ title: 'Test bank connected', detail: 'Fake transactions are coming in now.' });
      } else {
        const { linkToken } = await bankApi.linkToken('production');
        const result = await openPlaidLink(linkToken);
        if (!result) return;
        await bankApi.exchange('production', result.publicToken, result.institution);
        toast({ title: `${result.institution ?? 'Bank'} connected`, detail: 'Pulling in the last 6 months.' });
      }
      await load();
      void syncNow();
    } catch (e) {
      toast({ title: 'Couldn’t connect', detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const items = status?.items ?? [];
  const hasTest = items.some((i) => i.env === 'sandbox');

  return (
    <div className="max-w-2xl">
      <header className="flex items-center gap-3 py-2">
        <button onClick={() => go('settings')} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
          <ArrowLeft size={19} />
        </button>
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Bank</h1>
      </header>
      <p className="mt-1 text-[15px] text-ink-2">Clocked reads your transactions through Plaid. It can't move money.</p>

      {error && !status && <p className="mt-4 text-[14px] text-spend">{error}</p>}

      {status && (!status.configured || editingKeys) && (
        <>
          <SectionTitle>Plaid keys</SectionTitle>
          <KeysForm existing={status.configured} onDone={() => setEditingKeys(false)} />
        </>
      )}

      {status?.configured && !editingKeys && (
        <>
          <div className="mt-5 flex items-center gap-3 rounded-3xl border border-line p-4">
            <KeyRound size={18} className="shrink-0 text-ink-2" />
            <p className="min-w-0 flex-1 text-[14px] text-ink-2">
              Keys saved (client ID …{status.clientIdHint}) · Sandbox {status.secrets.sandbox ? '✓' : '—'} · Production {status.secrets.production ? '✓' : '—'}
            </p>
            <button className="text-[14px] font-semibold" onClick={() => setEditingKeys(true)}>
              Change
            </button>
          </div>

          {items.length > 0 && <SectionTitle>Connected</SectionTitle>}
          <div className="space-y-3">
            {items.map((i) => (
              <ItemCard key={i.itemId} item={i} />
            ))}
          </div>

          <SectionTitle>Add a bank</SectionTitle>
          <div className="space-y-3">
            {status.secrets.production && (
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised">
                    <Landmark size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">Connect your bank</p>
                    <p className="mt-0.5 text-[13px] text-ink-2">
                      Do this on a computer: your bank's sign-in opens in a pop-up. Uses 1 of your {status.liveItemCap} free connections ({status.liveItemsUsed} used).
                    </p>
                  </div>
                </div>
                <button className="btn btn-primary mt-4 w-full" disabled={!!busy} onClick={() => void connect('production')}>
                  {busy === 'production' ? 'Opening Plaid…' : 'Connect a bank'}
                </button>
              </Card>
            )}
            {status.secrets.sandbox && !hasTest && (
              <Card className="p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised">
                    <FlaskConical size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold">Try Plaid's test bank first</p>
                    <p className="mt-0.5 text-[13px] text-ink-2">Loads fake transactions so you can see how it works. Remove it when you're done.</p>
                  </div>
                </div>
                <button className="btn btn-secondary mt-4 w-full" disabled={!!busy} onClick={() => void connect('sandbox')}>
                  {busy === 'sandbox' ? 'Connecting…' : 'Connect test bank'}
                </button>
              </Card>
            )}
          </div>

          <p className="mt-6 text-[13px] text-ink-2">
            Switch off accounts you don't want: their transactions stay hidden. New transactions show up a few times a day; Refresh asks the bank right away. Purchases count on the day you made them, deposits and transfers between your
            accounts aren't counted as spending, and bill payments are covered by their daily set-aside.
          </p>
        </>
      )}

      {!status && !error && <p className="mt-6 text-[14px] text-ink-2">Loading…</p>}
    </div>
  );
}
