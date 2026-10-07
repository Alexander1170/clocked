import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bill, Category, GigJob, Goal, Job, LocalDate, Move, Rule, Saving, ScheduledJob, Settings } from '../../shared/types.ts';
import { planSetAsides, type SetAsidePlan } from '../../shared/plan.ts';
import { makeSpendCheck, type Coverage, type SpendCheck } from './money.ts';
import type { EngineData } from '../../shared/accrual.ts';
import { addDays, toLocalDate } from '../../shared/dates.ts';
import { upcomingPaychecks } from '../../shared/bills.ts';
import { lastPaydayOnOrBefore, nextPaydayOnOrAfter, paydaysBetween } from '../../shared/pay.ts';
import { checkAmount, isPaid, spentBetween } from './money.ts';
import { useBank, type AccountInfo } from './bank.ts';
import { gigPayBetween, setAsideBetween, stretchEndings, untilPayday, untilPaydayFromBalance, type UntilPayday } from './insights.ts';
import { live, useData } from './store.ts';
import { FALLBACK_CATEGORY } from './categories.ts';

/** Re-renders every `ms` and returns the current time. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    const wake = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [ms]);
  return now;
}

export const useToday = (now: number) => toLocalDate(now);

const byCreated = (a: Job, b: Job) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.name.localeCompare(b.name);

export function useJobs(includeArchived = false): Job[] {
  const jobs = useData((s) => s.t.jobs);
  return useMemo(() => live(jobs).filter((j) => includeArchived || !j.archived).sort(byCreated), [jobs, includeArchived]);
}

export function useJobMap(): Record<string, Job> {
  return useData((s) => s.t.jobs);
}

export const isScheduled = (j: Job): j is ScheduledJob => j.kind === 'scheduled';
export const isGig = (j: Job): j is GigJob => j.kind === 'gig';

/** Everything the earnings engine needs, including archived jobs (their history still counts). */
export function useEngineData(): EngineData {
  const jobs = useData((s) => s.t.jobs);
  const overrides = useData((s) => s.t.overrides);
  const gigs = useData((s) => s.t.gigs);
  return useMemo(() => ({ jobs: live(jobs), overrides: live(overrides), gigs: live(gigs) }), [jobs, overrides, gigs]);
}

export function useTransactions() {
  const txs = useData((s) => s.t.transactions);
  return useMemo(() => live(txs), [txs]);
}

export function useCategories(): Category[] {
  const cats = useData((s) => s.t.categories);
  return useMemo(() => live(cats).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)), [cats]);
}

/** Categories by id, without deleted ones, so a transaction still pointing at one shows as Other. */
export function useCategoryMap(): Record<string, Category> {
  const cats = useData((s) => s.t.categories);
  return useMemo(() => Object.fromEntries(Object.entries(cats).filter(([, c]) => !c.deleted)), [cats]);
}

/** The category a transaction counts under: its own, or Other if that one was deleted. */
export function useCategoryOf(): (id: string) => string {
  const cats = useCategoryMap();
  return useCallback((id: string) => (cats[id] ? id : FALLBACK_CATEGORY), [cats]);
}

export const DEFAULT_SETTINGS: Settings = { id: 'main', updatedAt: 1, weekStartsOn: 1 };

export function useSettings(): Settings {
  const s = useData((st) => st.t.settings.main);
  return s && !s.deleted ? s : DEFAULT_SETTINGS;
}

export function useActiveDash() {
  const gigs = useData((s) => s.t.gigs);
  return useMemo(() => live(gigs).find((g) => g.end == null) ?? null, [gigs]);
}

export function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return match;
}

export function useBillMap(): Record<string, Bill> {
  return useData((s) => s.t.bills);
}

export function useBills(): Bill[] {
  const bills = useBillMap();
  return useMemo(() => live(bills).sort((a, b) => a.name.localeCompare(b.name)), [bills]);
}

export function useRules(): Rule[] {
  const rules = useData((s) => s.t.rules);
  return useMemo(() => live(rules), [rules]);
}

export function useSavings(): Saving[] {
  const savings = useData((s) => s.t.savings);
  return useMemo(() => live(savings).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)), [savings]);
}

export function useGoalMap(): Record<string, Goal> {
  return useData((s) => s.t.goals);
}

/** Where leftover paycheck money went, newest first. */
export function useMoves(): Move[] {
  const moves = useData((s) => s.t.moves);
  return useMemo(() => live(moves).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0)), [moves]);
}

export function useGoals(): Goal[] {
  const goals = useGoalMap();
  return useMemo(() => live(goals).sort((a, b) => a.targetDate.localeCompare(b.targetDate)), [goals]);
}

/** Bills and goals that can cover a payment. */
export function useCoverage(): Coverage {
  const bills = useBillMap();
  const goals = useGoalMap();
  return useMemo(() => ({ bills, goals }), [bills, goals]);
}

/** Decides what counts as spending (see makeSpendCheck). */
export function useSpendCheck(): SpendCheck {
  const cover = useCoverage();
  return useMemo(() => makeSpendCheck(cover), [cover]);
}

/** Every bill, saving plan, and goal's daily set-aside over [from, to]. */
export function useSetAsidePlan(from: LocalDate, to: LocalDate): SetAsidePlan {
  const bills = useBills();
  const savings = useSavings();
  const goals = useGoals();
  const moves = useMoves();
  const data = useEngineData();
  const { billSpread } = useSettings();
  return useMemo(
    () => planSetAsides({ bills, savings, goals, moves }, data, from, to, billSpread ?? 'workdays'),
    [bills, savings, goals, moves, data, from, to, billSpread],
  );
}

export interface PaydayStretch extends UntilPayday {
  job: ScheduledJob;
  lastPayday: LocalDate;
  nextPayday: LocalDate;
  /** The last check, and what came out of it. */
  check: number;
  bills: number;
  saving: number;
  gig: number;
  spent: number;
  /** How the paycheck before ended, when you were tracking spending then. */
  lastEnd: number | null;
  /** That paycheck's payday. */
  prevPayday: LocalDate | null;
  /**
   * When the bank sent a balance lately, the money free starts from it: what's
   * in the counted accounts, less the bills still to come out before payday.
   * Otherwise it's worked out from the paycheck.
   */
  fromBank: { balance: number; asOf: number; unpaid: Array<{ name: string; amount: number }> } | null;
}

/** A bank balance older than this is too stale to start from. */
const FRESH_BALANCE_MS = 36 * 3_600_000;
/** Ask the server for balances again after new bank transactions arrive, at most this often. */
const BALANCE_RELOAD_MS = 30_000;

/** How far back a shortfall can carry from. Older ones are forgiven. */
const CARRY_DAYS = 92;

/**
 * Money free from your last paycheck until the next one, for your main job.
 * With a fresh bank balance: what's in checking, less the bills from this
 * paycheck that haven't come out yet and the savings planned until payday.
 * Otherwise: the check, less its bills and savings, plus gig pay, minus what
 * you've spent since. If an earlier paycheck ran short, that comes off too,
 * so it gets made up.
 */
export function useUntilPayday(now: number): PaydayStretch | null {
  const today = toLocalDate(now);
  const jobs = useJobs();
  const bills = useBills();
  const data = useEngineData();
  const txs = useTransactions();
  const counts = useSpendCheck();
  const job = jobs.find((j): j is ScheduledJob => isScheduled(j) && j.takeHome > 0);
  const lastPayday = job ? lastPaydayOnOrBefore(job, today) : null;
  const nextPayday = job ? nextPaydayOnOrAfter(job, addDays(today, 1)) : null;
  const paydays = useMemo(() => (job && lastPayday ? paydaysBetween(job, addDays(lastPayday, -CARRY_DAYS), lastPayday) : []), [job, lastPayday]);
  const plan = useSetAsidePlan(paydays[0] ?? today, nextPayday ? addDays(nextPayday, -1) : today);
  const bank = useBank((s) => s.status);
  // New bank transactions usually mean a new balance too. Hourly otherwise, like the server's sync.
  const hour = Math.floor(now / 3_600_000);
  useEffect(() => {
    const s = useBank.getState();
    if (!s.loadedAt || Date.now() - s.loadedAt > BALANCE_RELOAD_MS) void s.load();
  }, [txs, hour]);
  return useMemo(() => {
    if (!job || !lastPayday || !nextPayday) return null;
    // Bills come off from their start date. Before that, what you paid shows up as spending instead.
    const stretch = (payday: LocalDate, end: LocalDate, through: LocalDate) => {
      const check = checkAmount(job, data, payday, now);
      const paid = upcomingPaychecks(job, bills, data.jobs, payday, 1)[0]?.billTotal ?? 0;
      const saving = setAsideBetween(plan, payday, end);
      return { check, bills: paid, saving, start: check - paid - saving, gig: gigPayBetween(data.gigs, payday, through, now), spent: spentBetween(txs, payday, through, counts) };
    };
    // Earlier stretches, oldest first, to see whether one ran short.
    const past = paydays.slice(0, -1).map((p, i) => stretch(p, addDays(paydays[i + 1], -1), addDays(paydays[i + 1], -1)));
    const endings = stretchEndings(past);
    const before = past[past.length - 1];
    const carry = endings.length ? Math.min(0, endings[endings.length - 1].end) : 0;
    const cur = stretch(lastPayday, addDays(nextPayday, -1), today);
    const base = {
      job,
      lastPayday,
      nextPayday,
      check: cur.check,
      bills: cur.bills,
      saving: cur.saving,
      gig: cur.gig,
      spent: cur.spent,
      // Without spending tracked then, how it ended doesn't mean much.
      lastEnd: before && before.spent > 0.005 ? endings[endings.length - 1].end : null,
      prevPayday: paydays.length > 1 ? paydays[paydays.length - 2] : null,
    };
    // With a fresh bank balance, start from what's really there.
    const countable = (a: AccountInfo) => a.included && a.type === 'depository' && (a.available ?? a.balance) != null;
    const fresh = (bank?.items ?? []).filter((i) => i.syncedAt && now - i.syncedAt < FRESH_BALANCE_MS && i.accounts.some(countable));
    const counted = fresh.flatMap((i) => i.accounts.filter(countable));
    if (counted.length) {
      const balance = counted.reduce((t, a) => t + (a.available ?? a.balance ?? 0), 0);
      const check = upcomingPaychecks(job, bills, data.jobs, lastPayday, 1)[0];
      const unpaid = (check?.bills ?? []).filter((b) => !isPaid(b.bill.id, b.pay, txs)).map((b) => ({ name: b.bill.name, amount: b.amount }));
      // Savings stay in checking until you move them, so this stretch's still count.
      const u = untilPaydayFromBalance({ balance, unpaid: unpaid.reduce((t, b) => t + b.amount, 0), saving: cur.saving, today, nextPayday });
      return {
        ...base,
        // Money left over last time can only be moved if it's still there.
        lastEnd: base.lastEnd == null ? null : Math.min(base.lastEnd, Math.max(0, u.free)),
        ...u,
        fromBank: { balance, asOf: Math.max(...fresh.map((i) => i.syncedAt ?? 0)), unpaid },
      };
    }
    return { ...base, ...untilPayday({ ...cur, today, nextPayday, carry }), fromBank: null };
  }, [job, lastPayday, nextPayday, paydays, data, now, bills, plan, txs, counts, today, bank]);
}
