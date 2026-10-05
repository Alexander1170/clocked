import { useEffect, useMemo, useState } from 'react';
import type { Bill, Category, GigJob, Job, LocalDate, Rule, ScheduledJob, Settings } from '../../shared/types.ts';
import { planBills, type BillPlan } from '../../shared/bills.ts';
import { makeSpendCheck, type SpendCheck } from './money.ts';
import type { EngineData } from '../../shared/accrual.ts';
import { toLocalDate } from '../../shared/dates.ts';
import { live, useData } from './store.ts';

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

export function useCategoryMap(): Record<string, Category> {
  return useData((s) => s.t.categories);
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

/** Decides what counts as spending (see makeSpendCheck). */
export function useSpendCheck(): SpendCheck {
  const bills = useBillMap();
  return useMemo(() => makeSpendCheck(bills), [bills]);
}

/** Each bill's daily set-aside over [from, to]. */
export function useBillPlan(from: LocalDate, to: LocalDate): BillPlan {
  const bills = useBills();
  const data = useEngineData();
  const { billSpread } = useSettings();
  return useMemo(() => planBills(bills, data, from, to, billSpread ?? 'workdays'), [bills, data, from, to, billSpread]);
}
