import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { join } from 'node:path';
import { isValidChange, openStore } from './db.ts';
import { bankRoutes, createBank } from './bank.ts';
import type { SyncRequest, SyncResponse } from '../shared/types.ts';

// Not PORT: dev tooling sets PORT for the web server, and the API must stay on its own port.
const PORT = Number(process.env.CLOCKED_PORT ?? 8787);
const HOST = process.env.CLOCKED_HOST ?? '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');
const STATIC_DIR = process.env.STATIC_DIR ?? './dist';
// Tailscale Serve adds Tailscale-User-Login to proxied requests. When set, only these logins get the API.
const ALLOWED = (process.env.ALLOWED_TS_USERS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const store = openStore(DATA_DIR);
// Overrides are only for local testing against scripts/fake-plaid.mjs.
const bank = createBank(store, { baseUrls: { sandbox: process.env.PLAID_SANDBOX_URL || undefined, production: process.env.PLAID_PRODUCTION_URL || undefined } });
const app = new Hono();

// Health checks come from Docker and the deploy script, not through Tailscale, so they skip the login check.
app.get('/api/health', (c) => c.json({ ok: true }));

app.use('/api/*', async (c, next) => {
  if (ALLOWED.length) {
    const login = (c.req.header('tailscale-user-login') ?? '').toLowerCase();
    if (!ALLOWED.includes(login)) return c.json({ error: 'Not allowed' }, 403);
  }
  c.header('Cache-Control', 'no-store');
  await next();
});

app.post('/api/sync', bodyLimit({ maxSize: 20 * 1024 * 1024 }), async (c) => {
  let body: SyncRequest;
  try {
    body = await c.req.json<SyncRequest>();
  } catch {
    return c.json({ error: 'Body must be JSON' }, 400);
  }
  const since = Number(body?.since ?? 0);
  const changes = Array.isArray(body?.changes) ? body.changes : [];
  if (!Number.isFinite(since) || since < 0) return c.json({ error: 'Bad cursor' }, 400);
  if (!changes.every(isValidChange)) return c.json({ error: 'Bad change in batch' }, 400);

  if (changes.length) store.apply(changes);
  const page = store.since(since);
  return c.json<SyncResponse>(page);
});

app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    const notify = (seq: number) => {
      void stream.writeSSE({ event: 'change', data: JSON.stringify({ seq }) }).catch(() => {});
    };
    const unsubscribe = store.subscribe(notify);
    // A named event rather than a comment, so the app can tell the stream is still alive.
    const ping = setInterval(() => void stream.writeSSE({ event: 'ping', data: JSON.stringify({ seq: store.seq() }) }).catch(() => {}), 25_000);
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ seq: store.seq() }) });
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    clearInterval(ping);
    unsubscribe();
  }),
);

app.route('/api/bank', bankRoutes(bank));

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Hashed build assets never change; everything else (index.html, sw.js, manifest) must revalidate.
app.use('*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' || c.res.headers.has('Cache-Control')) return;
  c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
});
app.use('*', serveStatic({ root: STATIC_DIR }));
app.get('*', serveStatic({ root: STATIC_DIR, path: 'index.html' }));

const backup = () => {
  try {
    const file = store.backup();
    if (file) console.log(`backup written: ${file}`);
  } catch (e) {
    console.error('backup failed', e);
  }
};
backup();
setInterval(backup, 6 * 3_600_000).unref();
bank.schedule();

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`clocked server on http://${info.address}:${info.port} (data: ${DATA_DIR}${ALLOWED.length ? `, allowed: ${ALLOWED.join(', ')}` : ''})`);
});

const shutdown = () => {
  server.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
