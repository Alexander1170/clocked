// Savings and wish-list goals, plus one combined daily set-aside with bills.
import type { Bill, Goal, Job, LocalDate, Move, Saving, WishItem } from './types.ts';
import type { EngineData } from './accrual.ts';
import { addDays } from './dates.ts';
import { billShares, dueDatesBetween, earningDays, shareDays, windowsTouching, type PaidLog } from './bills.ts';
import { paydaysBetween } from './pay.ts';

type IsEarningDay = (d: LocalDate) => boolean;
interface Window {
  due: LocalDate;
  from: LocalDate;
  to: LocalDate;
}

// ---- Savings ------------------------------------------------------------------

function paydayJob(s: Saving, jobs: Job[]) {
  return jobs.find((j) => j.id === s.jobId && j.kind === 'scheduled' && !j.deleted);
}

/** The days money moves to savings: due dates, or a job's paydays. */
export function savingDueDates(s: Saving, from: LocalDate, to: LocalDate, jobs: Job[]): LocalDate[] {
  if (s.frequency === 'paycheck') {
    const job = paydayJob(s, jobs);
    return job && job.kind === 'scheduled' ? paydaysBetween(job, from, to) : [];
  }
  return dueDatesBetween({ frequency: s.frequency, dueDate: s.dueDate }, from, to);
}

/** Every period from the start date through the first one that ends on or after `to`. */
export function savingWindows(s: Saving, to: LocalDate, jobs: Job[]): Window[] {
  if (s.deleted || !(s.amount > 0)) return [];
  const lastDue = savingDueDates(s, to, addDays(to, 400), jobs)[0];
  if (!lastDue) return [];
  const before = savingDueDates(s, addDays(s.startDate, -400), addDays(s.startDate, -1), jobs);
  let prev: LocalDate | null = before.length ? before[before.length - 1] : null;
  const out: Window[] = [];
  for (const due of savingDueDates(s, s.startDate, lastDue, jobs)) {
    if (s.endDate && s.endDate < due) break;
    const cycleStart = prev ? addDays(prev, 1) : s.startDate;
    const from = cycleStart > s.startDate ? cycleStart : s.startDate;
    if (from <= due) out.push({ due, from, to: due });
    prev = due;
  }
  return out;
}

/** Windows that matter for [from, to]. With a target, every window counts (the cap depends on what came before). */
function savingWindowsFor(s: Saving, from: LocalDate, to: LocalDate, jobs: Job[]): Window[] {
  const all = savingWindows(s, to, jobs);
  return s.target ? all : all.filter((w) => w.to >= from);
}

/** How much to set aside for a saving plan on each day in [from, to]. Stops at the target, if there is one. */
export function savingShares(s: Saving, from: LocalDate, to: LocalDate, isEarningDay: IsEarningDay, jobs: Job[]): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  let total = 0;
  for (const w of savingWindowsFor(s, from, to, jobs)) {
    const days = shareDays(w.from, w.to, isEarningDay);
    for (const d of days) {
      if (d > to) return out;
      let v = s.amount / days.length;
      if (s.target) {
        if (total >= s.target - 1e-9) return out;
        v = Math.min(v, s.target - total);
      }
      total += v;
      if (d >= from) out.set(d, (out.get(d) ?? 0) + v);
    }
  }
  return out;
}

export interface SavingStatus {
  /** When this period's money moves. */
  due: LocalDate;
  perDay: number;
  savedThisPeriod: number;
  savedTotal: number;
  reachedTarget: boolean;
}

export function savingStatus(s: Saving, today: LocalDate, isEarningDay: IsEarningDay, jobs: Job[]): SavingStatus | null {
  const windows = savingWindows(s, today, jobs);
  const current = windows.find((w) => w.to >= today);
  if (!current) return null;
  const all = savingShares({ ...s, endDate: s.endDate }, s.startDate, today, isEarningDay, jobs);
  let savedTotal = 0;
  let savedThisPeriod = 0;
  for (const [d, v] of all) {
    savedTotal += v;
    if (d >= current.from) savedThisPeriod += v;
  }
  return {
    due: current.due,
    perDay: s.amount / shareDays(current.from, current.to, isEarningDay).length,
    savedThisPeriod,
    savedTotal,
    reachedTarget: !!s.target && savedTotal >= s.target - 0.005,
  };
}

// ---- Wish list and projects ---------------------------------------------------

/** An item is split across the days from when it was added until the goal's date. */
export function itemWindow(item: WishItem, g: Goal): { from: LocalDate; to: LocalDate } {
  return { from: item.addedOn, to: g.targetDate >= item.addedOn ? g.targetDate : item.addedOn };
}

/** Extra money put toward a goal on a day, like a paycheck's leftovers. */
export interface GoalMove {
  date: LocalDate;
  amount: number;
}

/**
 * Every day's share of a goal across its whole span. Each move covers part of
 * what was still to be set aside from its day on, so every later day shrinks
 * by the same fraction. Earlier days stay as they were.
 */
function allGoalShares(g: Goal, isEarningDay: IsEarningDay, moves: readonly GoalMove[]): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const item of g.items) {
    if (!(item.price > 0)) continue;
    const w = itemWindow(item, g);
    const days = shareDays(w.from, w.to, isEarningDay);
    const share = item.price / days.length;
    for (const d of days) out.set(d, (out.get(d) ?? 0) + share);
  }
  const days = [...out.keys()].sort();
  for (const m of [...moves].sort((a, b) => a.date.localeCompare(b.date))) {
    let rest = 0;
    for (const d of days) if (d >= m.date) rest += out.get(d)!;
    if (rest <= 0.005) continue;
    const k = Math.max(0, (rest - m.amount) / rest);
    for (const d of days) if (d >= m.date) out.set(d, out.get(d)! * k);
  }
  return out;
}

export function goalShares(g: Goal, from: LocalDate, to: LocalDate, isEarningDay: IsEarningDay, moves: readonly GoalMove[] = []): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  if (g.deleted) return out;
  for (const [d, v] of allGoalShares(g, isEarningDay, moves)) if (d >= from && d <= to && v > 0) out.set(d, v);
  return out;
}

export interface GoalStatus {
  total: number;
  /** Set aside through today, plus money moved toward it. */
  saved: number;
  /** Still to set aside after today. */
  left: number;
  /** Extra money moved toward it so far. */
  moved: number;
  /** What the goal takes on its next day with a share. */
  perDay: number;
  bought: number;
  /** Past the date and fully set aside. */
  done: boolean;
}

export function goalStatus(g: Goal, today: LocalDate, isEarningDay: IsEarningDay, moves: readonly GoalMove[] = []): GoalStatus {
  const total = g.items.reduce((t, i) => t + (i.price > 0 ? i.price : 0), 0);
  const shares = allGoalShares(g, isEarningDay, moves);
  const moved = moves.filter((m) => m.date <= today).reduce((t, m) => t + m.amount, 0);
  let saved = moved;
  let left = 0;
  let perDay = 0;
  for (const d of [...shares.keys()].sort()) {
    const v = shares.get(d)!;
    if (d <= today) saved += v;
    else left += v;
    if (d >= today && !perDay) perDay = v;
  }
  saved = Math.min(saved, total);
  return { total, saved, left, moved, perDay, bought: g.items.filter((i) => i.boughtOn).length, done: today > g.targetDate && saved >= total - 0.005 };
}

// ---- Everything together ------------------------------------------------------

export type SetAsideKind = 'bills' | 'savings' | 'goals';

export interface SetAsidePlan {
  /** Total to set aside per day. */
  byDay: Map<LocalDate, number>;
  byKind: Record<SetAsideKind, Map<LocalDate, number>>;
  /** Per bill, saving plan, or goal id. */
  byId: Map<string, Map<LocalDate, number>>;
  isEarningDay: IsEarningDay;
}

export interface SetAsides {
  bills: Bill[];
  savings: Saving[];
  goals: Goal[];
  /** Leftover money put toward goals. */
  moves?: readonly Move[];
  /** Bank payments linked to bills, so paid bills count what you actually paid. */
  paid?: PaidLog;
}

/** The leftover money that went toward one goal. */
export const movesFor = (goalId: string, moves: readonly Move[] = []): GoalMove[] => moves.filter((m) => !m.deleted && m.to === 'goal' && m.goalId === goalId);

/** Every daily set-aside over [from, to], with one earning-day lookup that covers all their windows. */
export function planSetAsides(input: SetAsides, data: EngineData, from: LocalDate, to: LocalDate, spread: 'workdays' | 'everyday' = 'workdays'): SetAsidePlan {
  let lo = from;
  let hi = to;
  const widen = (w: { from: LocalDate; to: LocalDate }) => {
    if (w.from < lo) lo = w.from;
    if (w.to > hi) hi = w.to;
  };
  for (const b of input.bills) windowsTouching(b, from, to, data.jobs).forEach(widen);
  for (const s of input.savings) savingWindowsFor(s, from, to, data.jobs).forEach(widen);
  for (const g of input.goals) for (const item of g.items) widen(itemWindow(item, g));

  const earning = spread === 'everyday' ? null : earningDays(data, lo, hi);
  const isEarningDay = (d: LocalDate) => (earning ? earning.has(d) : true);
  const plan: SetAsidePlan = { byDay: new Map(), byKind: { bills: new Map(), savings: new Map(), goals: new Map() }, byId: new Map(), isEarningDay };
  const add = (kind: SetAsideKind, id: string, shares: Map<LocalDate, number>) => {
    if (!shares.size) return;
    plan.byId.set(id, shares);
    for (const [d, v] of shares) {
      plan.byDay.set(d, (plan.byDay.get(d) ?? 0) + v);
      plan.byKind[kind].set(d, (plan.byKind[kind].get(d) ?? 0) + v);
    }
  };
  for (const b of input.bills) add('bills', b.id, billShares(b, from, to, isEarningDay, data.jobs, input.paid));
  for (const s of input.savings) add('savings', s.id, savingShares(s, from, to, isEarningDay, data.jobs));
  for (const g of input.goals) add('goals', g.id, goalShares(g, from, to, isEarningDay, movesFor(g.id, input.moves)));
  return plan;
}
