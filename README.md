# Clocked

**Your paycheck, paid by the hour.**

Clocked is a personal finance app that makes a regular job feel like gig pay. Your take-home pay is spread across the hours you're scheduled, so money lands every hour you work instead of once every two weeks. Gig work, bank transactions, and bills sit alongside it, so every day shows what you earned, what you spent, and what's actually left.

## What it does

- **Live earnings.** Enter your take-home pay per check, how often you're paid, and your weekly schedule. Clocked works out your hourly rate and builds your pay up by the minute while you're on the clock, with a deposit for every finished hour.
- **Gig work.** Start a timer when you go online and add each order's pay as you go, or log a session afterward with hours, pay, tips, and miles.
- **Earnings charts.** Day, week, month, and year views, stacked by job, with a breakdown for any day you tap.
- **Spending.** Add expenses by hand or connect your bank through Plaid. Purchases count on the day you made them. Paycheck deposits (already counted hour by hour) and transfers between your own accounts don't count as spending.
- **Bills.** Each bill is split evenly across the workdays before it's due, so a little comes out of each day instead of one big hit. The payment itself is matched to the bill and doesn't count again.
- **What's left.** Every day: earned − spent − bills set aside, with a chart that shows which days came out ahead and which didn't.
- **Phone and desktop.** An installable web app that works offline and syncs between devices through your own server.

## How it's built

- **App:** React 19, TypeScript, Vite, and Tailwind CSS, packaged as an installable PWA.
- **Server:** Node 22 with Hono and the built-in `node:sqlite`. The server runs its TypeScript directly, with no build step.
- **Sync:** local-first. Each device keeps a full copy in IndexedDB and syncs through the server (last write wins per record), with live updates over server-sent events.
- **Bank data:** Plaid `/transactions/sync`. API keys and access tokens live only on the server.
- **Hosting:** Docker on a home server behind [Tailscale Serve](https://tailscale.com/kb/1312/serve), so only your own devices can reach it.

## Run it locally

```bash
npm install
npm run dev          # app on :5173, API on :8787
npm test             # earnings, bills, and bank-import tests
npm run fake-plaid   # a stand-in for Plaid's sandbox, for trying the bank screens without keys
```

To use the fake Plaid, put `PLAID_SANDBOX_URL=http://127.0.0.1:8799` in `.env.local` and use `fake` as both the client ID and sandbox secret.

## Self-host it

1. On a server with Docker and Tailscale, copy the project and run `docker compose up -d --build`. The API listens on `127.0.0.1:8787` only.
2. Serve it over HTTPS on your tailnet: `tailscale serve --bg --https=8443 http://127.0.0.1:8787`.
3. Optional: set `ALLOWED_TS_USERS` in a `.env` next to `docker-compose.yml` to the Tailscale logins allowed to use the API.
4. Open the HTTPS address on your phone and add it to your home screen.

`scripts/deploy.sh` does steps 1-2 over SSH. The server keeps 14 days of nightly database backups in `data/backups`.

## Connecting a bank

1. Make a free [Plaid](https://dashboard.plaid.com/signup) account. The Trial plan covers up to 10 bank connections.
2. In the app, open **Settings → Bank connection** and paste your client ID and secrets.
3. Try Plaid's test bank first, then connect your real bank from a computer (your bank's sign-in opens in a pop-up).

Clocked only reads transactions and balances. It can't move money.

## Layout

- `shared/`: types and the money engine (dates, pay rate, paydays, accrual, bills), used by both app and server
- `src/`: the React app (screens, sheets, local store, sync client)
- `server/`: API, sync, SQLite storage, and the Plaid integration
- `tests/`: unit tests, including a bank-import run against a fake Plaid
- `PLAN.md`: design notes and roadmap
