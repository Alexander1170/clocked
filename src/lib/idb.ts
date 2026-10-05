import { openDB, type IDBPDatabase } from 'idb';
import type { BaseRecord, Change, CollectionName } from '../../shared/types.ts';

let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  dbp ??= openDB('clocked', 1, {
    upgrade(d) {
      d.createObjectStore('records');
      d.createObjectStore('outbox');
      d.createObjectStore('meta');
    },
  });
  return dbp;
}

const key = (c: CollectionName, id: string) => `${c}/${id}`;

export async function loadAll(): Promise<Change[]> {
  return (await db()).getAll('records');
}

/** A local edit: store it and queue it for the server. */
export async function saveLocal(c: CollectionName, rec: BaseRecord, queue = true) {
  const d = await db();
  const tx = d.transaction(['records', 'outbox'], 'readwrite');
  const value: Change = { c, rec };
  void tx.objectStore('records').put(value, key(c, rec.id));
  if (queue) void tx.objectStore('outbox').put(value, key(c, rec.id));
  await tx.done;
}

/** Changes that came from the server. */
export async function saveRemote(changes: Change[]) {
  if (!changes.length) return;
  const d = await db();
  const tx = d.transaction('records', 'readwrite');
  for (const ch of changes) void tx.store.put(ch, key(ch.c, ch.rec.id));
  await tx.done;
}

export async function getOutbox(): Promise<Change[]> {
  return (await db()).getAll('outbox');
}

/** Drops sent changes from the outbox, unless they were edited again while in flight. */
export async function ackOutbox(sent: Change[]) {
  const d = await db();
  const tx = d.transaction('outbox', 'readwrite');
  for (const ch of sent) {
    const k = key(ch.c, ch.rec.id);
    const cur = (await tx.store.get(k)) as Change | undefined;
    if (cur && cur.rec.updatedAt === ch.rec.updatedAt) await tx.store.delete(k);
  }
  await tx.done;
}

/** Queues every local record for sending: used when the server database is new or was restored. */
export async function requeueAll() {
  const d = await db();
  const tx = d.transaction(['records', 'outbox'], 'readwrite');
  for (const ch of (await tx.objectStore('records').getAll()) as Change[]) void tx.objectStore('outbox').put(ch, key(ch.c, ch.rec.id));
  await tx.done;
}

export async function outboxCount(): Promise<number> {
  return (await db()).count('outbox');
}

export async function getMeta<T>(k: string): Promise<T | undefined> {
  return (await db()).get('meta', k) as Promise<T | undefined>;
}

export async function setMeta(k: string, v: unknown) {
  await (await db()).put('meta', v, k);
}
