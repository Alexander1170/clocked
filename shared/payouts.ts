// Gig payouts: the bank deposit that pays out work you already logged.
import type { GigSession, Job, LocalDate, Transaction } from './types.ts';
import { addDays, diffDays, toLocalDate } from './dates.ts';
import { bankNameOf, normName } from './rules.ts';

/** A cash-out from a place that paid out before can come in this much under what you logged. */
export const PAYOUT_FEE_MAX = 3;
/** Anywhere else it has to be the same amount, or this instant cash-out fee less (give or take a few cents). */
const FEE = 1.99;
const FEE_SLACK = 0.12;
/** It comes in up to this many days after the work ended (or a day before, around midnight). */
const PAYOUT_DAYS_AFTER = 3;
/** One cash-out can sweep up several sessions in a row, all ending within this many days. */
const RUN_DAYS = 7;
const RUN_MAX = 12;

type Tx = Pick<
  Transaction,
  'id' | 'source' | 'amount' | 'date' | 'deleted' | 'flow' | 'jobId' | 'gigPayout' | 'wasPayout' | 'notPayout' | 'accountOff' | 'hidden' | 'edited' | 'merchant' | 'bankName' | 'rawName'
>;

/** Work one payout can cover: a session, or several in a row cashed out together. */
interface Unit {
  jobId: string;
  /** The day the last of it ended. */
  day: LocalDate;
  earnings: number;
  sessions: string[];
}

function units(gigs: readonly GigSession[], gigJobs: ReadonlySet<string>): Unit[] {
  const out: Unit[] = [];
  const byJob = new Map<string, GigSession[]>();
  for (const g of gigs) {
    if (g.deleted || g.end == null || !(g.earnings > 0) || !gigJobs.has(g.jobId)) continue;
    byJob.set(g.jobId, [...(byJob.get(g.jobId) ?? []), g]);
  }
  for (const [jobId, list] of byJob) {
    list.sort((a, b) => a.end! - b.end!);
    for (let i = 0; i < list.length; i++) {
      const first = toLocalDate(list[i].end!);
      let earnings = 0;
      for (let k = i; k < list.length && k < i + RUN_MAX; k++) {
        const day = toLocalDate(list[k].end!);
        if (diffDays(first, day) > RUN_DAYS) break;
        earnings += list[k].earnings;
        out.push({ jobId, day, earnings, sessions: list.slice(i, k + 1).map((g) => g.id) });
      }
    }
  }
  return out;
}

/** What a deposit is called, to recognize a place that paid out before. */
const placeOf = (t: Pick<Tx, 'merchant' | 'bankName' | 'rawName'>) => normName(t.rawName || bankNameOf(t));

/**
 * Which bank deposits pay out gig work you logged: money in that would
 * otherwise count as a refund, within a few days after the work, for the same
 * amount or the instant cash-out fee less. From a place that paid out before,
 * anything up to a few dollars less counts. One payout can sweep up several
 * sessions in a row. Pay you taught Clocked to recognize uses up its work
 * first, nothing pays out twice, and the closest matches win. Deposits you
 * edited or said aren't a payout, and ones from before you started tracking,
 * are left alone. Returns deposit id → job id.
 */
export function matchGigPayouts(txs: readonly Tx[], gigs: readonly GigSession[], jobs: readonly Job[], trackFrom?: LocalDate): Map<string, string> {
  const gigJobs = new Set(jobs.filter((j) => j.kind === 'gig' && !j.deleted).map((j) => j.id));
  const all = units(gigs, gigJobs);
  const used = new Set<string>();
  const money = txs.filter((t) => t.source === 'plaid' && !t.deleted && t.amount < 0);
  // A place is a known payout place once you taught it as pay (or kept one as pay yourself), not just because it matched once.
  const known = new Set(money.filter((t) => t.jobId && !t.gigPayout && gigJobs.has(t.jobId)).map(placeOf));
  // Work by the day it ended, so each deposit only looks at work from the few days before it.
  const byDay = new Map<LocalDate, Unit[]>();
  for (const u of all) byDay.set(u.day, [...(byDay.get(u.day) ?? []), u]);
  const near = (date: LocalDate) => {
    const out: Unit[] = [];
    for (let k = -1; k <= PAYOUT_DAYS_AFTER; k++) out.push(...(byDay.get(addDays(date, -k)) ?? []));
    return out;
  };

  /** How far off a deposit is from what a payout of this work would be, or null if it can't be one. */
  const miss = (tx: Tx, u: Unit, loose: boolean): number | null => {
    const short = u.earnings + tx.amount;
    const gap = diffDays(u.day, tx.date);
    if (short < -0.005 || gap < -1 || gap > PAYOUT_DAYS_AFTER) return null;
    const exact = Math.abs(short);
    const fee = Math.abs(short - FEE);
    const off = Math.min(exact, fee);
    if (loose ? short > PAYOUT_FEE_MAX + 0.005 : off > FEE_SLACK) return null;
    // The exact amount beats the fee less, and a known payout place beats a stranger.
    return off * 10 + (fee < exact ? 0.5 : 0) + Math.abs(gap) * 0.3 + (u.sessions.length - 1) * 2 + (loose ? 0 : 3);
  };

  /** Pairs each deposit with the work it fits best, closest matches first. */
  const assign = (list: readonly Tx[], always: boolean) => {
    const pairs: Array<{ tx: Tx; u: Unit; score: number }> = [];
    for (const tx of list) {
      const loose = always || known.has(placeOf(tx));
      for (const u of near(tx.date)) {
        const score = miss(tx, u, loose);
        if (score != null) pairs.push({ tx, u, score });
      }
    }
    pairs.sort((a, b) => a.score - b.score || a.tx.date.localeCompare(b.tx.date));
    const out = new Map<string, string>();
    for (const { tx, u } of pairs) {
      if (out.has(tx.id) || u.sessions.some((s) => used.has(s))) continue;
      out.set(tx.id, u.jobId);
      for (const s of u.sessions) used.add(s);
    }
    return out;
  };

  // Pay you taught Clocked to recognize, or kept yourself, goes first.
  assign(
    money.filter((t) => t.jobId && !t.gigPayout && gigJobs.has(t.jobId)),
    true,
  );
  const open = money.filter(
    (t) =>
      !t.notPayout &&
      !t.accountOff &&
      !t.hidden &&
      !(trackFrom && t.date < trackFrom) &&
      (t.gigPayout || t.wasPayout || (t.flow === 'spend' && !t.jobId && !t.edited)),
  );
  // Deposits from known payout places get their pick before strangers do.
  const first = assign(
    open.filter((t) => known.has(placeOf(t))),
    false,
  );
  const rest = assign(
    open.filter((t) => !known.has(placeOf(t))),
    false,
  );
  return new Map([...first, ...rest]);
}
