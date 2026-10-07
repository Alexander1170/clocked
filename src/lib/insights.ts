// The numbers behind the Insights screen. Plain math, so it's easy to test.
import type { Bill, BillFrequency, Category, GigSession, Job, LocalDate, Saving, ScheduledJob } from '../../shared/types.ts';
import type { SetAsidePlan } from '../../shared/plan.ts';
import { CHECKS_PER_YEAR } from '../../shared/pay.ts';
import { addDays, dayStart, diffDays } from '../../shared/dates.ts';

export const PER_MONTH: Record<BillFrequency, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

const scheduledJobs = (jobs: readonly Job[]) => jobs.filter((j): j is ScheduledJob => !j.deleted && !j.archived && j.kind === 'scheduled');

/** Take-home from scheduled jobs in an average month. Paid every two weeks, two months a year have a third check. */
export function monthlyTakeHome(jobs: readonly Job[]): number {
  return scheduledJobs(jobs).reduce((t, j) => t + ((j.takeHome || 0) * CHECKS_PER_YEAR[j.frequency]) / 12, 0);
}

export function monthlyBills(bills: readonly Bill[]): number {
  return bills.filter((b) => !b.deleted).reduce((t, b) => t + b.amount * PER_MONTH[b.frequency], 0);
}

/** Savings set aside in an average month. "Every paycheck" follows that job's paydays. */
export function monthlySavings(savings: readonly Saving[], jobs: readonly Job[]): number {
  const byId = new Map(scheduledJobs(jobs).map((j) => [j.id, j]));
  return savings
    .filter((s) => !s.deleted)
    .reduce((t, s) => {
      if (s.frequency !== 'paycheck') return t + s.amount * PER_MONTH[s.frequency];
      const job = (s.jobId && byId.get(s.jobId)) || scheduledJobs(jobs)[0];
      return t + (job ? (s.amount * CHECKS_PER_YEAR[job.frequency]) / 12 : 0);
    }, 0);
}

const FOOD_ICONS = new Set(['utensils', 'coffee', 'pizza', 'cart']);

/** Groceries, eating out, and any category of your own with a food icon. */
export const isFoodCategory = (c: Pick<Category, 'id' | 'icon'> | undefined) => !!c && (c.id === 'cat_food' || c.id === 'cat_groceries' || FOOD_ICONS.has(c.icon));

/** Share of take-home a food budget starts from, and the most of your free money it may use. */
export const FOOD_SHARE = 0.12;
export const FOOD_MAX_OF_FREE = 0.4;

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const floorTo = (v: number, step: number) => Math.floor(v / step) * step;

export interface FoodPlan {
  weekly: number;
  /** You set it yourself, rather than the suggestion. */
  mine: boolean;
}

/**
 * A weekly food budget: yours if you set one. Otherwise about 12% of
 * take-home, but never more than 40% of what's free after bills and savings,
 * so gas, fun, and everything else still fit.
 */
export function foodPlan(takeHomeMonthly: number, billsMonthly: number, savingsMonthly: number, own?: number): FoodPlan {
  if (own && own > 0) return { weekly: own, mine: true };
  const free = takeHomeMonthly - billsMonthly - savingsMonthly;
  const monthly = Math.max(0, Math.min(takeHomeMonthly * FOOD_SHARE, free * FOOD_MAX_OF_FREE));
  return { weekly: roundTo((monthly * 12) / 52, 5), mine: false };
}

export interface SaveIdea {
  monthly: number;
  /** The same, per paycheck of your main job. */
  perCheck: number;
  /** From your own spending, or the 10% rule while there's too little of it. */
  basis: 'spending' | 'rule';
}

/** Days of tracked spending before suggestions use your own numbers. */
export const ENOUGH_HISTORY_DAYS = 21;

/**
 * What you could put away each month. With a few weeks of spending: half of
 * what's usually left over. Before that: 10% of take-home, if it fits after
 * bills and food. Rounded down to $25; null when nothing fits.
 */
export function saveIdea(o: {
  takeHomeMonthly: number;
  billsMonthly: number;
  savingsMonthly: number;
  foodMonthly: number;
  /** Your usual spending a month, once there's enough history. */
  spendingMonthly?: number;
  checksPerYear: number;
}): SaveIdea | null {
  const free = o.takeHomeMonthly - o.billsMonthly - o.savingsMonthly;
  const basis = o.spendingMonthly != null ? 'spending' : 'rule';
  const monthly =
    o.spendingMonthly != null ? floorTo((free - o.spendingMonthly) * 0.5, 25) : floorTo(Math.min(o.takeHomeMonthly * 0.1, (free - o.foodMonthly) * 0.5), 25);
  if (!(monthly > 0) || !(o.checksPerYear > 0)) return null;
  return { monthly, perCheck: roundTo((monthly * 12) / o.checksPerYear, 5), basis };
}

export interface UntilPayday {
  /** What's left of the last check after its bills and savings, plus gig pay, minus spending and any shortfall. */
  free: number;
  /** Days from today through the day before payday. */
  daysLeft: number;
  perDay: number;
  /** What the stretch started with: the check, less its bills and savings. */
  start: number;
  /** How far short the last paycheck ran, made up from this one (zero or less). */
  carry: number;
}

/** Money free from your last paycheck until the next one. */
export function untilPayday(o: {
  check: number;
  bills: number;
  saving: number;
  gig: number;
  spent: number;
  today: LocalDate;
  nextPayday: LocalDate;
  carry?: number;
}): UntilPayday {
  const start = o.check - o.bills - o.saving;
  const carry = Math.min(0, o.carry ?? 0);
  const free = start + carry + o.gig - o.spent;
  const daysLeft = Math.max(1, diffDays(o.today, o.nextPayday));
  return { free, daysLeft, perDay: free / daysLeft, start, carry };
}

/**
 * Money free until payday, starting from what's in checking: less the bills
 * from this paycheck that haven't come out yet, and the savings planned for it.
 */
export function untilPaydayFromBalance(o: { balance: number; unpaid: number; saving: number; today: LocalDate; nextPayday: LocalDate }): UntilPayday {
  const free = o.balance - o.unpaid - o.saving;
  const daysLeft = Math.max(1, diffDays(o.today, o.nextPayday));
  return { free, daysLeft, perDay: free / daysLeft, start: o.balance, carry: 0 };
}

export interface StretchTotals {
  /** The check, less its bills and savings. */
  start: number;
  gig: number;
  spent: number;
}

/**
 * How each paycheck stretch ended, oldest first, and what it carried in.
 * Running short carries into the next stretch so it gets made up. Money to
 * spare doesn't: it's better off saved than spent.
 */
export function stretchEndings(stretches: readonly StretchTotals[]): Array<{ carry: number; end: number }> {
  let carry = 0;
  return stretches.map((s) => {
    const end = s.start + carry + s.gig - s.spent;
    const out = { carry, end };
    carry = Math.min(0, end);
    return out;
  });
}

/** Where a month's pay goes. `free` is what's not spent or spoken for; `over` is how far past the pay it went. */
export function monthSplit(o: { pay: number; bills: number; saving: number; spent: number }): { free: number; over: number } {
  const rest = o.pay - o.bills - o.saving - o.spent;
  return { free: Math.max(0, rest), over: Math.max(0, -rest) };
}

/** Running totals, day by day. */
export function cumulative(values: readonly number[]): number[] {
  let t = 0;
  return values.map((v) => (t += v));
}

/** Savings and wish-list set-asides in [from, to]. */
export function setAsideBetween(plan: Pick<SetAsidePlan, 'byKind'>, from: LocalDate, to: LocalDate): number {
  let t = 0;
  for (const k of ['savings', 'goals'] as const) for (const [d, v] of plan.byKind[k]) if (d >= from && d <= to) t += v;
  return t;
}

/** Gig pay from sessions that started in [from, to], up to now. */
export function gigPayBetween(gigs: readonly GigSession[], from: LocalDate, to: LocalDate, now: number): number {
  const a = dayStart(from);
  const b = dayStart(addDays(to, 1));
  return gigs.filter((g) => !g.deleted && g.start >= a && g.start < b && g.start <= now).reduce((t, g) => t + (g.earnings || 0), 0);
}

/** Of money left over after a paycheck, the part that goes to savings. The rest goes to your plans. */
export const SAVINGS_SHARE = 0.6;
/** A plan due within this many days is close: it gets what it still needs first. */
export const SOON_DAYS = 21;

export interface LeftoverPlan {
  id: string;
  name: string;
  /** Still to set aside for it. */
  left: number;
  targetDate: LocalDate;
  /** You want it sooner. */
  first?: boolean;
}

export interface LeftoverSplit {
  savings: number;
  plans: Array<{ id: string; name: string; amount: number; why: 'first' | 'soon' | 'share' }>;
}

/**
 * How to split money left over from a paycheck, in whole dollars. Plans you
 * want sooner, then plans due within three weeks, get what they still need
 * first. The rest goes 60% to savings and 40% to your other plans, shared by
 * how much each still needs. With no plans, it all goes to savings.
 */
export function splitLeftover(amount: number, plans: readonly LeftoverPlan[], today: LocalDate): LeftoverSplit {
  let rest = Math.floor(amount);
  const out: LeftoverSplit['plans'] = [];
  const open = plans.filter((p) => p.left >= 1);
  const urgent = open
    .filter((p) => p.first || diffDays(today, p.targetDate) <= SOON_DAYS)
    .sort((a, b) => Number(!!b.first) - Number(!!a.first) || a.targetDate.localeCompare(b.targetDate));
  for (const p of urgent) {
    const give = Math.min(rest, Math.ceil(p.left));
    if (give <= 0) continue;
    out.push({ id: p.id, name: p.name, amount: give, why: p.first ? 'first' : 'soon' });
    rest -= give;
  }
  const others = open.filter((p) => !urgent.includes(p));
  const need = others.reduce((t, p) => t + p.left, 0);
  const forPlans = others.length ? Math.min(Math.round(rest * (1 - SAVINGS_SHARE)), Math.ceil(need)) : 0;
  let given = 0;
  for (const p of others) {
    const give = Math.min(Math.ceil(p.left), Math.floor((forPlans * p.left) / need));
    if (give <= 0) continue;
    out.push({ id: p.id, name: p.name, amount: give, why: 'share' });
    given += give;
  }
  return { savings: rest - given, plans: out };
}
