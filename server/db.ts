import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { COLLECTIONS } from '../shared/types.ts';
import type { BaseRecord, Change, CollectionMap, CollectionName } from '../shared/types.ts';

const PAGE = 2000;
const KEEP_BACKUPS = 14;

export interface Store {
  /** The raw database, for server-only tables. */
  db: DatabaseSync;
  /** Random id made when the database is created; clients resync from zero when it changes. */
  id: string;
  seq(): number;
  /** Applies changes with last-write-wins. Returns how many were newer than what we had. */
  apply(changes: Change[]): number;
  get<K extends CollectionName>(c: K, id: string): CollectionMap[K] | undefined;
  /** Every live (not deleted) record in a collection. */
  all<K extends CollectionName>(c: K): Array<CollectionMap[K]>;
  /** Called with the new sequence number whenever records change. */
  subscribe(fn: (seq: number) => void): () => void;
  since(seq: number): { dbId: string; changes: Change[]; seq: number; more: boolean };
  backup(): string | null;
  close(): void;
}

export function isValidChange(x: unknown): x is Change {
  if (!x || typeof x !== 'object') return false;
  const { c, rec } = x as { c?: unknown; rec?: Partial<BaseRecord> };
  return (
    typeof c === 'string' &&
    (COLLECTIONS as readonly string[]).includes(c) &&
    !!rec &&
    typeof rec === 'object' &&
    typeof rec.id === 'string' &&
    rec.id.length > 0 &&
    rec.id.length <= 120 &&
    typeof rec.updatedAt === 'number' &&
    Number.isFinite(rec.updatedAt)
  );
}

export function openStore(dataDir: string): Store {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'clocked.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS records (
      c TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (c, id)
    );
    CREATE INDEX IF NOT EXISTS records_seq ON records (seq);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('db_id', ?)").run(randomUUID());
  const dbId = (db.prepare("SELECT v FROM meta WHERE k = 'db_id'").get() as { v: string }).v;

  const getVersion = db.prepare('SELECT updated_at AS u FROM records WHERE c = ? AND id = ?');
  const upsert = db.prepare(`
    INSERT INTO records (c, id, data, updated_at, seq) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (c, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, seq = excluded.seq
  `);
  const page = db.prepare('SELECT c, data, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?');
  const getOne = db.prepare('SELECT data FROM records WHERE c = ? AND id = ?');
  const getAll = db.prepare('SELECT data FROM records WHERE c = ?');
  const listeners = new Set<(seq: number) => void>();
  let seq = Number((db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM records').get() as { s: number }).s);

  return {
    db,
    id: dbId,
    seq: () => seq,

    get(c, id) {
      const row = getOne.get(c, id) as { data: string } | undefined;
      return row ? (JSON.parse(row.data) as CollectionMap[typeof c]) : undefined;
    },

    all(c) {
      return (getAll.all(c) as Array<{ data: string }>).map((r) => JSON.parse(r.data) as CollectionMap[typeof c]).filter((r) => !r.deleted);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    apply(changes) {
      let accepted = 0;
      db.exec('BEGIN');
      try {
        for (const ch of changes) {
          const cur = getVersion.get(ch.c, ch.rec.id) as { u: number } | undefined;
          if (cur && cur.u >= ch.rec.updatedAt) continue;
          seq += 1;
          upsert.run(ch.c, ch.rec.id, JSON.stringify(ch.rec), Math.trunc(ch.rec.updatedAt), seq);
          accepted += 1;
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        seq = Number((db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM records').get() as { s: number }).s);
        throw e;
      }
      if (accepted) for (const fn of listeners) fn(seq);
      return accepted;
    },

    since(after) {
      const rows = page.all(after, PAGE + 1) as Array<{ c: CollectionName; data: string; seq: number }>;
      const more = rows.length > PAGE;
      const slice = more ? rows.slice(0, PAGE) : rows;
      return {
        dbId,
        changes: slice.map((r) => ({ c: r.c, rec: JSON.parse(r.data) as BaseRecord })),
        // The real latest seq, even if it's behind the client: that's how clients spot a restored database.
        seq: slice.length ? slice[slice.length - 1].seq : seq,
        more,
      };
    },

    backup() {
      const dir = join(dataDir, 'backups');
      mkdirSync(dir, { recursive: true });
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const file = join(dir, `clocked-${stamp}.db`);
      if (existsSync(file)) return null;
      db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
      const old = readdirSync(dir).filter((f) => /^clocked-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) rmSync(join(dir, f));
      return file;
    },

    close: () => db.close(),
  };
}
