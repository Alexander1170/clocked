# Clocked — design notes and roadmap

## The money math

**Scheduled jobs.** Hourly rate = take-home × checks per year ÷ (paid hours per week × 52). For every-2-weeks pay that is just `paycheck ÷ (2 × weekly hours)`: $1,480 ÷ 80 = $18.50/hr. Pay accrues during scheduled paid blocks (unpaid breaks excluded). Every completed clock hour shows as a deposit.

Per-day edits:
- **Paid day off** (PTO/holiday): accrues as normal, labeled PTO.
- **Unpaid day off**: nothing that day.
- **Different hours**: salary keeps the day's normal value, paced over the new hours; hourly pays rate × actual hours.

**Pay periods.** A job has a frequency, a known payday, and a lag (how many days before payday its period ends). "Earned, not paid yet" is everything since the end of the period the latest payday covered.

**Gig work.** A running dash timer with per-order pay, or sessions logged afterward. Earnings spread evenly across the session for hourly charts.

**Spending.** Positive amounts are money out (Plaid's convention). A transaction counts on the day it was authorized. Income (already counted as pay), transfers between your own accounts, and bill payments covered by set-asides don't count.

**Bills.** A bill's amount is split evenly across the workdays from the day after the previous due date (or the bill's start date, if later) through the due date. Days with no scheduled work get nothing; if a window has no workdays, every day in it shares. Payments linked to a bill don't count as spending once its set-asides have started.

**Left today** = earned so far − spent − today's bill set-asides.

## Architecture

```
Phone PWA ─┐                        ┌─ SQLite: synced records + server-only Plaid tables
           ├─ HTTPS (Tailscale) ──> Node (Hono) ─ nightly VACUUM INTO backups
PC PWA ────┘   /api/sync, /api/events (SSE), /api/bank
```

- One generic record store. Every record has `id`, `updatedAt`, and an optional `deleted` tombstone. Clients push their outbox and pull everything after their last sequence number; last write wins per record.
- The server database has a random id. A client that sees a new id, or a sequence behind its own, resets and re-sends everything it has (covers restores from backup).
- Plaid: hourly `/transactions/sync` with a stored cursor, a refresh every 6 hours, and on-demand refresh. Bank updates keep anything you edited (category, note, flags), including across the pending-to-posted switch. Merchant rules and bill name matching run on import.
- Charts are hand-built. Job colors use a validated 8-slot categorical palette in fixed order, stored on the job so filtering never repaints.

## Roadmap

### Phase 1: core (done)
- Jobs, schedules, live accrual and hourly deposits
- Gig dash timer and logging
- Today, Earnings, Spending, Jobs, Settings
- Installable PWA, offline, multi-device sync, self-hosted deploy

### Phase 2: bank and bills (done)
- Plaid connection (sandbox and production), import, refresh, per-account toggles
- Categories from Plaid, merchant rules, edits that survive bank updates
- Bills spread across workdays, payment matching, "left over" chart

### Phase 3: next
- Match paycheck deposits to jobs: expected vs. actual
- Apple Pay instant capture through an iOS Shortcuts automation
- Push notifications: end-of-day recap, payday, bill due
- Face ID unlock (passkey), gig tax set-aside and mileage, savings goals
