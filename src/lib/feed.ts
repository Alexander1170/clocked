import type { Bill, Category, GigSession, Job, LocalDate, Transaction } from '../../shared/types.ts';
import { notCountedReason } from './money.ts';
import { hourlyChunks, valueIn, type Segment } from '../../shared/accrual.ts';
import { dayEnd, dayStart, toLocalDate } from '../../shared/dates.ts';
import { clock, hrs, timeRange } from './format.ts';
import type { SheetSpec } from './ui.ts';

export type FeedKind = 'deposit' | 'accruing' | 'order' | 'gig' | 'expense' | 'refund';

export interface FeedItem {
  key: string;
  at: number;
  kind: FeedKind;
  title: string;
  sub: string;
  /** Positive = money in, negative = money out. */
  amount: number;
  /** Job color slot. */
  color?: number;
  /** Category icon name. */
  icon?: string;
  /** Why this doesn't count against the day (deposit, transfer, covered bill). */
  muted?: string;
  open?: SheetSpec;
}

interface FeedInput {
  date: LocalDate;
  segs: Segment[];
  gigs: GigSession[];
  txs: Transaction[];
  jobs: Record<string, Job>;
  cats: Record<string, Category>;
  bills: Record<string, Bill>;
  now: number;
}

/** Everything that happened on one day, newest first: hourly deposits, gig pay, spending. */
export function buildDayFeed({ date, segs, gigs, txs, jobs, cats, bills, now }: FeedInput): FeedItem[] {
  const d0 = dayStart(date);
  const d1 = dayEnd(date);
  const items: FeedItem[] = [];

  for (const s of segs) {
    if (s.kind === 'gig') continue;
    const job = jobs[s.jobId];
    for (const [ca, cb] of hourlyChunks(s)) {
      const a = Math.max(ca, d0);
      const b = Math.min(cb, d1);
      if (b <= a || a >= now) continue;
      const done = b <= now;
      const pto = s.kind === 'pto' ? ' · PTO' : '';
      items.push({
        key: `${s.jobId}-${a}`,
        at: done ? b : now,
        kind: done ? 'deposit' : 'accruing',
        title: job?.name ?? 'Job',
        sub: done ? `${timeRange(a, b)}${pto}` : `${timeRange(a, b)} · building now${pto}`,
        amount: valueIn(s, a, done ? b : now),
        color: job?.color,
        open: { kind: 'day', jobId: s.jobId, date: s.date },
      });
    }
  }

  for (const g of gigs) {
    if (g.deleted || toLocalDate(g.start) !== date) continue;
    const job = jobs[g.jobId];
    const orders = g.orders ?? [];
    const open: SheetSpec = g.end == null ? { kind: 'endDash', id: g.id } : { kind: 'gig', id: g.id };
    orders.forEach((o, i) =>
      items.push({
        key: `${g.id}-o${i}`,
        at: o.at,
        kind: 'order',
        title: job?.name ?? 'Gig',
        sub: `Order · ${clock(o.at)}`,
        amount: o.amount,
        color: job?.color,
        open,
      }),
    );
    if (g.end == null) continue;
    const rest = g.earnings - orders.reduce((t, o) => t + o.amount, 0);
    if (!orders.length || Math.abs(rest) > 0.005) {
      items.push({
        key: `${g.id}-end`,
        at: g.end,
        kind: 'gig',
        title: job?.name ?? 'Gig',
        sub: orders.length ? 'Tips and adjustments' : `${timeRange(g.start, g.end)} · ${hrs((g.end - g.start) / 3_600_000)}`,
        amount: orders.length ? rest : g.earnings,
        color: job?.color,
        open,
      });
    }
  }

  for (const tx of txs) {
    if (tx.deleted || tx.date !== date) continue;
    const cat = cats[tx.categoryId];
    const when = tx.at ? clock(tx.at) : tx.pending ? 'Pending' : '';
    const muted = notCountedReason(tx, bills) ?? undefined;
    items.push({
      key: tx.id,
      at: tx.at ?? d0,
      kind: tx.amount >= 0 ? 'expense' : 'refund',
      title: tx.merchant || cat?.name || 'Expense',
      sub: muted ?? [cat?.name ?? 'Other', when].filter(Boolean).join(' · '),
      amount: -tx.amount,
      icon: cat?.icon,
      muted,
      open: { kind: 'expense', id: tx.id },
    });
  }

  return items.sort((x, y) => y.at - x.at);
}
