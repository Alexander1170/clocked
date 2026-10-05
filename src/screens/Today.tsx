import { useMemo } from 'react';
import clsx from 'clsx';
import { Bike, Briefcase, CalendarDays, ChevronRight, Plus, Settings as Gear, Square, Wallet } from 'lucide-react';
import type { GigJob, GigSession, LocalDate, ScheduledJob } from '../../shared/types.ts';
import { buildSegments, tally, type Segment } from '../../shared/accrual.ts';
import { addDays, dayEnd, dayStart, toLocalDate } from '../../shared/dates.ts';
import { useActiveDash, useBillMap, useBillPlan, useCategoryMap, useEngineData, useJobMap, useJobs, useNow, useSpendCheck, useTransactions, isGig, isScheduled } from '../lib/hooks.ts';
import { buildDayFeed } from '../lib/feed.ts';
import { payInfo, spentBetween } from '../lib/money.ts';
import { clockShort, dayLabel, dayLabelLong, daysUntil, hrs, minus, money, signed, stopwatch } from '../lib/format.ts';
import { slotColor } from '../lib/colors.ts';
import { go, openSheet } from '../lib/ui.ts';
import { useData } from '../lib/store.ts';
import { newId } from '../lib/ids.ts';
import { Card, Dot, EmptyState, SectionTitle } from '../components/ui.tsx';
import { FeedList } from '../components/Feed.tsx';
import { SyncBadge } from '../components/SyncBadge.tsx';

/** Dollars per minute accruing right now from scheduled work. */
function ratePerMinute(segs: Segment[], now: number) {
  let r = 0;
  for (const s of segs) if (s.kind !== 'gig' && s.start <= now && now < s.end) r += (s.value / (s.end - s.start)) * 60_000;
  return r;
}

function nextShiftStart(job: ScheduledJob, data: ReturnType<typeof useEngineData>, today: LocalDate, now: number): number | null {
  const segs = buildSegments({ jobs: [job], overrides: data.overrides, gigs: [] }, today, addDays(today, 14), now);
  const next = segs.filter((s) => s.start > now).sort((a, b) => a.start - b.start)[0];
  return next?.start ?? null;
}

function ShiftCard({ job, segs, now, today, data }: { job: ScheduledJob; segs: Segment[]; now: number; today: LocalDate; data: ReturnType<typeof useEngineData> }) {
  const mine = segs.filter((s) => s.jobId === job.id && s.date === today);
  const t = tally(mine, dayStart(today), dayEnd(addDays(today, 1)), now);
  const override = data.overrides.find((o) => o.jobId === job.id && o.date === today);
  const total = t.value + t.projected;
  const first = mine[0]?.start;
  const last = mine[mine.length - 1]?.end;
  const working = mine.some((s) => s.start <= now && now < s.end);
  const onBreak = !working && first != null && last != null && now > first && now < last;

  let status: string;
  if (override?.type === 'off_unpaid') status = 'Day off';
  else if (!mine.length) status = 'Off today';
  else if (mine[0].kind === 'pto') status = now < (last ?? 0) ? 'Paid day off' : 'Paid day off · done';
  else if (working) status = 'On the clock';
  else if (onBreak) status = 'On break';
  else if (first != null && now < first) status = `Starts at ${clockShort(first)}`;
  else status = 'Done for today';

  const next = !mine.length || now >= (last ?? 0) ? nextShiftStart(job, data, today, now) : null;

  return (
    <button onClick={() => openSheet({ kind: 'day', jobId: job.id, date: today })} className="card block w-full p-4 text-left transition-colors hover:bg-hover">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <Dot color={job.color} />
          <span className="truncate text-[15px] font-semibold">{job.name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[13px] font-medium text-ink-2">
          {working && <span className="live-dot" />}
          {status}
        </span>
      </div>
      {total > 0 ? (
        <>
          <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full transition-[width] duration-1000"
              style={{ width: `${Math.min(100, (t.value / total) * 100)}%`, background: slotColor(job.color) }}
            />
          </div>
          <div className="mt-2.5 flex justify-between text-[13px] text-ink-2">
            <span className="num">
              {hrs(t.hours + t.ptoHours)} of {hrs(t.hours + t.ptoHours + t.projectedHours)}
              {mine[0] && mine.length > 0 && ` · ${clockShort(first!)}–${clockShort(last!)}`}
            </span>
            <span className="num">
              {money(t.value)} of {money(total)}
            </span>
          </div>
        </>
      ) : (
        next && <p className="mt-2 text-[13px] text-ink-2">Next shift {dayLabel(toLocalDate(next))} at {clockShort(next)}</p>
      )}
    </button>
  );
}

function DashCard({ job, dash, now }: { job: GigJob; dash: GigSession | null; now: number }) {
  const put = useData((s) => s.put);
  const mine = dash && dash.jobId === job.id ? dash : null;
  if (!mine) {
    return (
      <div className="card flex items-center gap-3 p-4">
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
          <Dot color={job.color} />
          <span className="truncate text-[15px] font-semibold">{job.name}</span>
        </span>
        <button className="btn btn-sm btn-secondary" onClick={() => openSheet({ kind: 'gig', jobId: job.id })}>
          Log work
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!!dash}
          onClick={() => put('gigs', { id: newId(), jobId: job.id, start: Date.now(), end: null, earnings: 0, orders: [] })}
        >
          <Bike size={16} /> Start
        </button>
      </div>
    );
  }
  const hours = (now - mine.start) / 3_600_000;
  const orders = mine.orders?.length ?? 0;
  return (
    <div className="card p-4" style={{ borderColor: `color-mix(in srgb, ${slotColor(job.color)} 45%, transparent)` }}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <Dot color={job.color} />
          <span className="truncate text-[15px] font-semibold">{job.name}</span>
        </span>
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
          <span className="live-dot" style={{ background: slotColor(job.color) }} /> Dashing
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className="num text-3xl font-semibold tracking-tight">{stopwatch(now - mine.start)}</p>
          <p className="num mt-1 text-[13px] text-ink-2">
            {money(mine.earnings)} · {orders} {orders === 1 ? 'order' : 'orders'}
            {hours >= 0.25 && mine.earnings > 0 && ` · ${money(mine.earnings / hours)}/hr`}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn btn-secondary" onClick={() => openSheet({ kind: 'order', id: mine.id })}>
          <Plus size={18} /> Order pay
        </button>
        <button className="btn btn-primary" onClick={() => openSheet({ kind: 'endDash', id: mine.id })}>
          <Square size={16} /> End dash
        </button>
      </div>
    </div>
  );
}

export function Today() {
  const now = useNow(1000);
  const today = toLocalDate(now);
  const data = useEngineData();
  const jobs = useJobs();
  const jobMap = useJobMap();
  const txs = useTransactions();
  const cats = useCategoryMap();
  const billMap = useBillMap();
  const counts = useSpendCheck();
  const plan = useBillPlan(today, today);
  const dash = useActiveDash();

  const segs = useMemo(() => buildSegments(data, today, today, now), [data, today, now]);
  const t = tally(segs, dayStart(today), dayEnd(today), now);
  const spent = spentBetween(txs, today, today, counts);
  const bills = plan.byDay.get(today) ?? 0;
  const left = t.value - spent - bills;
  const perMin = ratePerMinute(segs, now);
  const feed = useMemo(
    () => buildDayFeed({ date: today, segs, gigs: data.gigs, txs, jobs: jobMap, cats, bills: billMap, now }),
    [today, segs, data.gigs, txs, jobMap, cats, billMap, now],
  );
  const scheduled = jobs.filter(isScheduled);
  const gigJobs = jobs.filter(isGig);
  const pay = scheduled.filter((j) => j.takeHome > 0).map((j) => payInfo(j, data, today, now));
  const dashJob = dash ? jobMap[dash.jobId] : null;

  let statusLine: React.ReactNode;
  if (perMin > 0) {
    statusLine = (
      <>
        <span className="live-dot" /> +{money(perMin)} a minute right now
      </>
    );
  } else if (dash) {
    statusLine = (
      <>
        <span className="live-dot" /> Dashing for {stopwatch(now - dash.start)}
      </>
    );
  } else if (t.projected > 0) {
    statusLine = `${money(t.projected)} more scheduled today`;
  } else if (t.value > 0) {
    statusLine = 'Done for today';
  } else {
    statusLine = 'Nothing scheduled today';
  }

  return (
    <div>
      <header className="flex items-center justify-between py-2">
        <div>
          <p className="text-[13px] font-medium text-ink-2">{dayLabelLong(today)}</p>
          <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Today</h1>
        </div>
        <div className="flex items-center gap-2">
          <SyncBadge />
          <button onClick={() => go('settings')} aria-label="Settings" className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink lg:hidden">
            <Gear size={19} />
          </button>
        </div>
      </header>

      {jobs.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Wallet size={26} />}
            title="Turn your paycheck into hourly pay"
            body="Add your job and schedule, and your pay builds up every hour you're on the clock. Add gig work too."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <button className="btn btn-primary" onClick={() => openSheet({ kind: 'job', type: 'scheduled' })}>
                  <Briefcase size={18} /> Add your job
                </button>
                <button className="btn btn-secondary" onClick={() => openSheet({ kind: 'job', type: 'gig' })}>
                  <Bike size={18} /> Add gig work
                </button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-x-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <section className="pt-3 pb-5">
              <p className="text-[15px] font-medium text-ink-2">Earned today</p>
              <p className="num mt-1 text-[56px] leading-none font-bold tracking-tight lg:text-[64px]">{money(t.value)}</p>
              <p className="mt-3 flex items-center gap-2 text-[14px] font-medium text-ink-2">{statusLine}</p>
            </section>

            <div className="space-y-3">
              {scheduled.map((j) => (
                <ShiftCard key={j.id} job={j} segs={segs} now={now} today={today} data={data} />
              ))}
              {gigJobs.map((j) => (
                <DashCard key={j.id} job={j} dash={dash} now={now} />
              ))}
              {dash && dashJob && !gigJobs.some((g) => g.id === dash.jobId) && <DashCard job={dashJob as GigJob} dash={dash} now={now} />}
            </div>

            <Card className="mt-3 overflow-hidden">
              <div className="divide-y divide-line">
                <div className="flex items-center justify-between px-4 py-3 text-[15px]">
                  <span className="text-ink-2">Earned so far</span>
                  <span className="num font-semibold">{signed(t.value)}</span>
                </div>
                <button onClick={() => go('spending')} className="flex w-full items-center justify-between px-4 py-3 text-left text-[15px] transition-colors hover:bg-hover">
                  <span className="flex items-center gap-1 text-ink-2">
                    Spent <ChevronRight size={15} className="text-ink-3" />
                  </span>
                  <span className="num font-semibold">{minus(spent)}</span>
                </button>
                <button onClick={() => go('bills')} className="flex w-full items-center justify-between px-4 py-3 text-left text-[15px] transition-colors hover:bg-hover">
                  <span className="flex items-center gap-1 text-ink-2">
                    Bills set aside <ChevronRight size={15} className="text-ink-3" />
                  </span>
                  <span className="num font-semibold">{bills > 0 ? minus(bills) : billMap && Object.keys(billMap).length ? '$0.00' : 'Add bills'}</span>
                </button>
              </div>
              <div className="flex items-center justify-between border-t border-line bg-raised/50 px-4 py-3.5">
                <span className="text-[15px] font-semibold">Left today</span>
                <span className={clsx('num text-[24px] font-bold tracking-tight', left >= 0 ? 'text-money' : 'text-spend')}>{signed(left)}</span>
              </div>
            </Card>

            {pay.map((p) => (
              <button key={p.job.id} onClick={() => go('earnings')} className="card mt-3 block w-full p-4 text-left transition-colors hover:bg-hover">
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink-2">{pay.length > 1 ? `${p.job.name} · earned, not paid yet` : 'Earned, not paid yet'}</span>
                  <ChevronRight size={18} className="shrink-0 text-ink-3" />
                </span>
                <span className="num mt-1 block text-[24px] font-bold tracking-tight">{money(p.pending)}</span>
                {p.nextPayday && (
                  <span className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                    <CalendarDays size={15} className="shrink-0" />
                    <span>
                      Payday {dayLabel(p.nextPayday)}, {daysUntil(p.nextPayday, today)} ·{' '}
                      <span className="num font-semibold text-ink">{money(p.nextAmount)}</span>
                    </span>
                  </span>
                )}
              </button>
            ))}
          </div>

          <div>
            <SectionTitle
              action={
                <button className="text-[14px] font-medium text-ink-2 hover:text-ink" onClick={() => openSheet({ kind: 'expense' })}>
                  Add expense
                </button>
              }
            >
              Activity
            </SectionTitle>
            <Card className="overflow-hidden">
              {feed.length ? (
                <FeedList items={feed} />
              ) : (
                <p className="px-5 py-8 text-center text-[14px] text-ink-2">Hourly deposits and today's spending show up here.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
