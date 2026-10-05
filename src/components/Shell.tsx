import { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { Briefcase, ChartColumn, House, Lightbulb, PiggyBank, Plus, Receipt, Settings as Gear } from 'lucide-react';
import { buildSegments, hourlyChunks, valueIn } from '../../shared/accrual.ts';
import { toLocalDate } from '../../shared/dates.ts';
import { useEngineData, useJobMap, useNow } from '../lib/hooks.ts';
import { signed, timeRange } from '../lib/format.ts';
import { go, openSheet, toast, useSheets, useToasts, type Route } from '../lib/ui.ts';
import { AddMenu } from '../sheets/AddMenu.tsx';
import { ExpenseSheet } from '../sheets/ExpenseSheet.tsx';
import { EndDashSheet, GigSheet, OrderSheet } from '../sheets/GigSheets.tsx';
import { DaySheet } from '../sheets/DaySheet.tsx';
import { JobSheet } from '../sheets/JobSheet.tsx';
import { BillSheet } from '../sheets/BillSheet.tsx';
import { SavingSheet } from '../sheets/SavingSheet.tsx';
import { GoalSheet } from '../sheets/GoalSheet.tsx';
import { CategorySheet } from '../sheets/CategorySheet.tsx';
import { SyncBadge } from './SyncBadge.tsx';

/** The phone's bottom tabs. Jobs live in Settings on phones; they change rarely. */
const NAV: Array<{ route: Route; label: string; icon: typeof House }> = [
  { route: 'today', label: 'Today', icon: House },
  { route: 'earnings', label: 'Earnings', icon: ChartColumn },
  { route: 'insights', label: 'Insights', icon: Lightbulb },
  { route: 'spending', label: 'Spending', icon: Receipt },
  { route: 'plan', label: 'Plan', icon: PiggyBank },
];
const SIDEBAR: typeof NAV = [...NAV, { route: 'jobs', label: 'Jobs', icon: Briefcase }, { route: 'settings', label: 'Settings', icon: Gear }];

export function TabBar({ route }: { route: Route }) {
  const tab = ({ route: r, label, icon: Icon }: (typeof NAV)[number]) => (
    <button
      key={r}
      onClick={() => go(r)}
      aria-current={route === r ? 'page' : undefined}
      className={clsx('flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold', route === r ? 'text-ink' : 'text-ink-3')}
    >
      <Icon size={22} strokeWidth={route === r ? 2.4 : 2} />
      {label}
    </button>
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-lg items-center">{NAV.map(tab)}</div>
      {/* Add floats above the tabs so Insights can sit in the middle. */}
      <button
        onClick={() => openSheet({ kind: 'add' })}
        aria-label="Add"
        className="absolute right-4 bottom-[calc(100%+16px)] grid size-14 place-items-center rounded-full bg-ink text-inverse shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition-transform active:scale-95"
      >
        <Plus size={26} />
      </button>
    </nav>
  );
}

export function Sidebar({ route }: { route: Route }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-card px-4 py-6 lg:flex">
      <div className="flex items-center gap-2.5 px-2">
        <img src="/favicon.svg" alt="" className="size-8" />
        <span className="text-[19px] font-bold tracking-tight">Clocked</span>
      </div>
      <button className="btn btn-primary mt-6" onClick={() => openSheet({ kind: 'add' })}>
        <Plus size={18} /> Add
      </button>
      <nav className="mt-6 space-y-1">
        {SIDEBAR.map(({ route: r, label, icon: Icon }) => (
          <button
            key={r}
            onClick={() => go(r)}
            aria-current={route === r ? 'page' : undefined}
            className={clsx(
              'flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-[15px] font-semibold transition-colors',
              route === r ? 'bg-raised text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            <Icon size={19} /> {label}
          </button>
        ))}
      </nav>
      <div className="mt-auto">
        <SyncBadge withLabel />
      </div>
    </aside>
  );
}

export function SheetHost() {
  const top = useSheets((s) => s.stack[s.stack.length - 1]);
  const depth = useSheets((s) => s.stack.length);
  let content: React.ReactNode = null;
  if (top) {
    switch (top.kind) {
      case 'add':
        content = <AddMenu />;
        break;
      case 'expense':
        content = <ExpenseSheet id={top.id} date={top.date} />;
        break;
      case 'gig':
        content = <GigSheet id={top.id} jobId={top.jobId} date={top.date} />;
        break;
      case 'order':
        content = <OrderSheet id={top.id} />;
        break;
      case 'endDash':
        content = <EndDashSheet id={top.id} />;
        break;
      case 'day':
        content = <DaySheet jobId={top.jobId} date={top.date} />;
        break;
      case 'job':
        content = <JobSheet id={top.id} type={top.type} />;
        break;
      case 'bill':
        content = <BillSheet id={top.id} fromTx={top.fromTx} />;
        break;
      case 'saving':
        content = <SavingSheet id={top.id} amount={top.amount} />;
        break;
      case 'goal':
        content = <GoalSheet id={top.id} type={top.type} />;
        break;
      case 'category':
        content = <CategorySheet id={top.id} />;
        break;
    }
  }
  // A new key remounts the sheet, so switching sheets resets their form state.
  const key = top ? `${depth}-${top.kind}-${'id' in top ? top.id : ''}` : 'none';
  return top ? <div key={key}>{content}</div> : null;
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-[60] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="anim-toast pointer-events-auto flex max-w-sm items-center gap-3 rounded-full border border-line bg-card py-2.5 pr-5 pl-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)]"
        >
          <span className={clsx('size-2.5 shrink-0 rounded-full', t.tone === 'money' ? 'bg-money' : 'bg-ink-3')} />
          <span>
            <span className={clsx('num block text-[15px] font-semibold', t.tone === 'money' && 'text-money')}>{t.title}</span>
            {t.detail && <span className="block text-[13px] text-ink-2">{t.detail}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Pops a toast each time an hour of scheduled pay lands while the app is open. */
export function DepositWatcher() {
  const now = useNow(1000);
  const data = useEngineData();
  const jobs = useJobMap();
  const today = toLocalDate(now);
  const segs = useMemo(() => buildSegments({ ...data, gigs: [] }, today, today, 0), [data, today]);
  const chunks = useMemo(() => segs.flatMap((s) => hourlyChunks(s).map(([a, b]) => ({ s, a, b }))), [segs]);
  const done = chunks.filter((c) => c.b <= now).length;
  const prev = useRef<{ day: string; done: number } | null>(null);

  // Only fire on a real increase while open, never for hours that passed while the app was closed.
  useEffect(() => {
    const last = prev.current;
    prev.current = { day: today, done };
    if (!last || last.day !== today || done !== last.done + 1) return;
    const c = chunks.filter((x) => x.b <= now).sort((x, y) => y.b - x.b)[0];
    if (!c) return;
    toast({ title: `${signed(valueIn(c.s, c.a, c.b))} deposited`, detail: `${jobs[c.s.jobId]?.name ?? 'Job'} · ${timeRange(c.a, c.b)}`, tone: 'money' });
  }, [done, today, chunks, jobs, now]);

  return null;
}
