import { create } from 'zustand';
import type { SyncRequest, SyncResponse } from '../../shared/types.ts';
import * as idb from './idb.ts';
import { setLocalWriteHandler, useData } from './store.ts';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

export const useSync = create<{ status: SyncStatus; lastSync: number | null; pending: number; error: string | null }>()(() => ({
  status: 'idle',
  lastSync: null,
  pending: 0,
  error: null,
}));

let running = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2000;

export function requestSync(delay = 300) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

async function post(body: SyncRequest): Promise<SyncResponse> {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(res.status === 403 ? 'This device isn’t allowed to sync' : `Server error ${res.status}`);
  return res.json() as Promise<SyncResponse>;
}

export async function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  useSync.setState({ status: 'syncing' });
  try {
    do {
      again = false;
      const outbox = await idb.getOutbox();
      let since = (await idb.getMeta<number>('lastSeq')) ?? 0;
      const knownDb = await idb.getMeta<string>('dbId');
      let first = true;
      let more = true;
      while (more) {
        const res = await post({ since, changes: first ? outbox : [] });
        if (first && outbox.length) await idb.ackOutbox(outbox);
        // A different database, or one behind us (restored from backup): start over and resend everything we have.
        if (first && (res.dbId !== knownDb || res.seq < since)) {
          await idb.setMeta('dbId', res.dbId);
          await idb.setMeta('lastSeq', 0);
          if (knownDb !== undefined || since > 0) await idb.requeueAll();
          again = true;
          break;
        }
        first = false;
        await useData.getState().applyRemote(res.changes);
        since = res.seq;
        await idb.setMeta('lastSeq', since);
        more = res.more;
      }
    } while (again);
    retryDelay = 2000;
    useSync.setState({ status: 'idle', lastSync: Date.now(), error: null });
  } catch (e) {
    useSync.setState({ status: navigator.onLine ? 'error' : 'offline', error: e instanceof Error ? e.message : String(e) });
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60_000);
  } finally {
    running = false;
    useSync.setState({ pending: await idb.outboxCount() });
  }
}

let events: EventSource | null = null;
let lastHeard = 0;

/** The server pings every 25 seconds, so this much quiet means the stream died without saying so. */
const STALE_MS = 70_000;

function onServerSeq(e: Event) {
  lastHeard = Date.now();
  const { seq } = JSON.parse((e as MessageEvent<string>).data) as { seq: number };
  void idb.getMeta<number>('lastSeq').then((last) => {
    if (seq > (last ?? 0)) requestSync(50);
  });
}

function connectEvents() {
  events?.close();
  const es = new EventSource('/api/events');
  events = es;
  lastHeard = Date.now();
  // Every event carries the server's latest change number, so any of them can start a catch-up.
  for (const name of ['hello', 'change', 'ping']) es.addEventListener(name, onServerSeq);
  // The browser retries a dropped stream by itself, but gives up for good if a retry fails,
  // say while the server restarts for an update. Start a new one when that happens.
  es.addEventListener('error', () => {
    if (es.readyState !== EventSource.CLOSED) return;
    setTimeout(() => {
      if (events === es) connectEvents();
    }, 5000);
  });
}

const streamDead = () => !events || events.readyState === EventSource.CLOSED || Date.now() - lastHeard > STALE_MS;

let started = false;

export function startSync() {
  if (started) return;
  started = true;
  setLocalWriteHandler(() => {
    useSync.setState((s) => ({ pending: s.pending + 1 }));
    requestSync();
  });
  void syncNow();
  connectEvents();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    requestSync(0);
    if (streamDead()) connectEvents();
  });
  window.addEventListener('online', () => requestSync(0));
  setInterval(() => {
    requestSync(0);
    if (streamDead()) connectEvents();
  }, 60_000);
}
