import { create } from 'zustand';
import type { BaseRecord, Change, CollectionMap, CollectionName } from '../../shared/types.ts';
import * as idb from './idb.ts';

export type Tables = { [K in CollectionName]: Record<string, CollectionMap[K]> };

const emptyTables = (): Tables => ({ jobs: {}, overrides: {}, gigs: {}, transactions: {}, categories: {}, settings: {}, bills: {}, rules: {}, savings: {}, goals: {} });

type Draft<K extends CollectionName> = Omit<CollectionMap[K], 'updatedAt'> & { updatedAt?: number };

interface DataStore {
  ready: boolean;
  t: Tables;
  load(): Promise<void>;
  /** Saves a record locally and queues it for sync. */
  put<K extends CollectionName>(c: K, rec: Draft<K>): CollectionMap[K];
  remove(c: CollectionName, id: string): void;
  /** Writes a record only if it's missing, without syncing it (built-in defaults). */
  seed<K extends CollectionName>(c: K, rec: CollectionMap[K]): void;
  applyRemote(changes: Change[]): Promise<void>;
}

let onLocalWrite: () => void = () => {};
export function setLocalWriteHandler(fn: () => void) {
  onLocalWrite = fn;
}

export const useData = create<DataStore>()((set, get) => ({
  ready: false,
  t: emptyTables(),

  async load() {
    const t = emptyTables();
    for (const { c, rec } of await idb.loadAll()) {
      if (c in t) (t[c] as Record<string, BaseRecord>)[rec.id] = rec;
    }
    set({ t, ready: true });
  },

  put(c, rec) {
    const prev = get().t[c][rec.id];
    const now = Date.now();
    const full = {
      ...rec,
      createdAt: rec.createdAt ?? prev?.createdAt ?? now,
      updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1),
    } as CollectionMap[typeof c];
    set((s) => ({ t: { ...s.t, [c]: { ...s.t[c], [rec.id]: full } } }));
    void idb.saveLocal(c, full).then(() => onLocalWrite());
    return full;
  },

  remove(c, id) {
    const prev = get().t[c][id];
    if (prev && !prev.deleted) get().put(c, { ...prev, deleted: true });
  },

  seed(c, rec) {
    if (get().t[c][rec.id]) return;
    set((s) => ({ t: { ...s.t, [c]: { ...s.t[c], [rec.id]: rec } } }));
    void idb.saveLocal(c, rec, false);
  },

  async applyRemote(changes) {
    const cur = get().t;
    const next: Tables = { ...cur };
    const accepted: Change[] = [];
    for (const ch of changes) {
      if (!(ch.c in next)) continue;
      const have = next[ch.c][ch.rec.id];
      if (have && have.updatedAt >= ch.rec.updatedAt) continue;
      if (next[ch.c] === cur[ch.c]) (next as Record<string, unknown>)[ch.c] = { ...cur[ch.c] };
      (next[ch.c] as Record<string, BaseRecord>)[ch.rec.id] = ch.rec;
      accepted.push(ch);
    }
    if (!accepted.length) return;
    set({ t: next });
    await idb.saveRemote(accepted);
  },
}));

export const live = <T extends BaseRecord>(rows: Record<string, T>): T[] => Object.values(rows).filter((r) => !r.deleted);
