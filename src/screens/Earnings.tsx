import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarCog, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Job, LocalDate } from '../../shared/types.ts';
import { buildSegments, tally, type Segment, type Tally } from '../../shared/accrual.ts';
import { addDays, dayEnd, dayStart, endOfMonth, toLocalDate } from '../../shared/dates.ts';
import { useBillPlan, useEngineData, useJobs, useNow, useSettings, useSpendCheck, useTransactions } from '../lib/hooks.ts';
import { bucketIndexAt, bucketsFor, periodBounds, periodTitle, shiftAnchor, type Bucket, type Range } from '../lib/periods.ts';
import { slotColor } from '../lib/colors.ts';
import { hrs, minus, money, moneyWhole, signed, timeRange } from '../lib/format.ts';
import { spentBetween } from '../lib/money.ts';
import { openSheet } from '../lib/ui.ts';
import { BarChart, type BarDatum } from '../components/BarChart.tsx';
import { Card, Chip, Dot, Segmented, SectionTitle } from '../components/ui.tsx';

const RANGES: Array<{ value: Range; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const perHour = (t: Tally) => (t.hours > 0 ? (t.value - t.ptoValue) / t.hours : 0);

function Row({ color, title, sub, amount, action }: { color?: number; title: string; sub?: string; amount: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      {color != null ? <Dot color={color} /> : <span className="w-2.5" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        {sub && <span className="block truncate text-[13px] text-ink-2">{sub}</span>}
      </span>
      <span className="num shrink-0 text-[15px] font-semibold">{amount}</span>
      {action}
    </div>
  );
}

/** What happened on one day, job by job, plus spending: the chart's table view. */
function DayDetail({ date, segs, jobs, now, spent, bills }: { date: LocalDate; segs: Segment[]; jobs: Job[]; now: number; spent: number; bills: number }) {
  const d0 = dayStart(date);
  const d1 = dayEnd(date);
  const t = tally(segs, d0, d1, now);
  const rows: React.ReactNode[] = [];
  for (const job of jobs) {
    if (job.kind === 'scheduled') {
      const mine = segs.filter((s) => s.jobId === job.id && s.date === date);
      const jt = tally(mine, d0, dayEnd(addDays(date, 1)), now);
      if (!mine.length && !jt.value) continue;
      const pto = mine[0]?.kind === 'pto';
      const range = mine.length ? timeRange(mine[0].start, mine[mine.length - 1].end) : '';
      const hours = jt.hours + jt.ptoHours;
      const ofTotal = jt.projectedHours > 0 ? `${Math.round(hours * 10) / 10} of ${hrs(hours + jt.projectedHours)}` : hrs(hours);
      rows.push(
        <Row
          key={job.id}
          color={job.color}
          title={job.name}
          sub={`${pto ? 'PTO · ' : ''}${range} · ${ofTotal}`}
          amount={signed(jt.value)}
          action={
            <button
              aria-label={`Edit ${job.name} on this day`}
              onClick={() => openSheet({ kind: 'day', jobId: job.id, date })}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-ink-2 hover:text-ink"
            >
              <CalendarCog size={15} />
            </button>
          }
        />,
      );
    } else {
      for (const s of segs.filter((x) => x.jobId === job.id && x.kind === 'gig' && x.date === date)) {
        const h = (s.end - s.start) / 3_600_000;
        rows.push(
          <button key={s.refId} className="block w-full text-left" onClick={() => openSheet(s.active ? { kind: 'endDash', id: s.refId! } : { kind: 'gig', id: s.refId! })}>
            <Row
              color={job.color}
              title={job.name}
              sub={`${s.active ? 'Dashing now · ' : ''}${timeRange(s.start, s.end)} · ${hrs(h)}${h >= 0.25 && s.value > 0 ? ` · ${money(s.value / h)}/hr` : ''}`}
              amount={signed(s.value)}
            />
          </button>,
        );
      }
    }
  }
  return (
    <div className="divide-y divide-line">
      {rows.length ? rows : <p className="py-4 text-[14px] text-ink-2">No work on this day.</p>}
      <Row title="Spent" sub="Manual and bank" amount={minus(spent)} />
      <Row title="Bills set aside" amount={minus(bills)} />
      <div className="flex items-center justify-between py-3 font-semibold">
        <span className="pl-[22px] text-[15px]">Left for the day</span>
        <span className={clsx('num text-[15px]', t.value - spent - bills >= 0 ? 'text-money' : 'text-spend')}>{signed(t.value - spent - bills)}</span>
      </div>
    </div>
  );
}

function PeriodDetail({ bucket, segs, jobs, now, spent, bills }: { bucket: Bucket; segs: Segment[]; jobs: Job[]; now: number; spent: number; bills: number }) {
  const t = tally(segs, bucket.start, bucket.end, now);
  return (
    <div className="divide-y divide-line">
      {jobs
        .filter((j) => t.byJob[j.id])
        .map((j) => {
          const jt = t.byJob[j.id];
          return (
            <Row
              key={j.id}
              color={j.color}
              title={j.name}
              sub={`${hrs(jt.hours)}${jt.hours >= 0.25 ? ` · ${money(perHour(jt))}/hr` : ''}${jt.ptoHours ? ` · ${hrs(jt.ptoHours)} PTO` : ''}`}
              amount={signed(jt.value)}
            />
          );
        })}
      <Row title="Spent" amount={minus(spent)} />
      <Row title="Bills set aside" amount={minus(bills)} />
      <div className="flex items-center justify-between py-3 font-semibold">
        <span className="pl-[22px] text-[15px]">Left</span>
        <span className={clsx('num text-[15px]', t.value - spent - bills >= 0 ? 'text-money' : 'text-spend')}>{signed(t.value - spent - bills)}</span>
      </div>
    </div>
  );
}

export function Earnings() {
  const now = useNow(10_000);
  const today = toLocalDate(now);
  const { weekStartsOn } = useSettings();
  const data = useEngineData();
  const jobs = useJobs(true);
  const txs = useTransactions();
  const counts = useSpendCheck();
  const [range, setRange] = useState<Range>('week');
  const [anchor, setAnchor] = useState<LocalDate>(today);
  const [jobFilter, setJobFilter] = useState<string>('all');
  const [picked, setPicked] = useState<{ key: string; i: number } | null>(null);

  const { from, to } = periodBounds(range, anchor, weekStartsOn);
  const plan = useBillPlan(from, to);
  const buckets = useMemo(() => bucketsFor(range, anchor, weekStartsOn), [range, anchor, weekStartsOn]);
  const segs = useMemo(() => buildSegments(data, from, to, now), [data, from, to, now]);
  const jf = jobFilter === 'all' ? undefined : jobFilter;
  const tallies = useMemo(() => buckets.map((b) => tally(segs, b.start, b.end, now, jf)), [buckets, segs, now, jf]);
  const period = tally(segs, dayStart(from), dayEnd(to), now, jf);
  const nowIndex = bucketIndexAt(buckets, now);
  const isCurrent = nowIndex >= 0;
  // A pick only applies to the window it was made in; otherwise "now" is selected.
  const windowKey = `${range}|${anchor}|${weekStartsOn}`;
  const sel = picked?.key === windowKey ? picked.i : isCurrent ? nowIndex : null;
  const setSel = (i: number) => setPicked({ key: windowKey, i });

  const activeJobs = jobs.filter((j) => !j.archived || period.byJob[j.id]);
  const series = activeJobs.filter((j) => (jf ? j.id === jf : true));
  const chart: BarDatum[] = buckets.map((b, i) => ({
    key: b.key,
    label: b.label,
    title: b.title,
    current: i === nowIndex,
    parts: series.map((j) => ({
      id: j.id,
      name: j.name,
      color: slotColor(j.color),
      value: tallies[i].byJob[j.id]?.value ?? 0,
      projected: tallies[i].byJob[j.id]?.projected ?? 0,
    })),
  }));
  const legend = series.filter((j) => period.byJob[j.id]);
  const selBucket = sel != null ? buckets[sel] : null;
  const selDate: LocalDate | null = range === 'day' ? anchor : (selBucket?.date ?? null);
  const selFrom = selDate ?? (selBucket ? toLocalDate(selBucket.start) : null);
  const selTo = selDate ?? (selBucket ? endOfMonth(toLocalDate(selBucket.start)) : null);
  const selSpent = selFrom && selTo ? spentBetween(txs, selFrom, selTo, counts) : 0;
  let selBills = 0;
  if (selFrom && selTo) for (const [d, v] of plan.byDay) if (d >= selFrom && d <= selTo) selBills += v;

  const heading = range === 'day' ? (anchor === today ? 'Earned today' : 'Earned') : isCurrent ? 'Earned so far' : 'Earned';

  return (
    <div>
      <header className="py-2">
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Earnings</h1>
      </header>

      <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented<Range> label="Time range" value={range} options={RANGES} onChange={setRange} className="lg:w-96" />
        <div className="flex items-center justify-between gap-2">
          <button aria-label="Previous" onClick={() => setAnchor(shiftAnchor(range, anchor, -1))} className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
            <ChevronLeft size={20} />
          </button>
          <span className="min-w-40 text-center text-[15px] font-semibold">{periodTitle(range, anchor, weekStartsOn)}</span>
          <button aria-label="Next" onClick={() => setAnchor(shiftAnchor(range, anchor, 1))} className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
            <ChevronRight size={20} />
          </button>
          {!isCurrent && (
            <button className="btn btn-sm btn-secondary" onClick={() => setAnchor(today)}>
              Now
            </button>
          )}
        </div>
      </div>

      {jobs.length > 1 && (
        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
          <Chip on={jobFilter === 'all'} onClick={() => setJobFilter('all')}>
            All jobs
          </Chip>
          {activeJobs.map((j) => (
            <Chip key={j.id} on={jobFilter === j.id} onClick={() => setJobFilter(j.id)}>
              <Dot color={j.color} /> {j.name}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <p className="text-[15px] font-medium text-ink-2">{heading}</p>
          <p className="num mt-1 text-[44px] leading-none font-bold tracking-tight">{money(period.value)}</p>
          <p className="num mt-2.5 text-[14px] text-ink-2">
            {hrs(period.hours)} worked
            {period.hours >= 0.25 && ` · ${money(perHour(period))}/hr`}
            {period.ptoHours > 0 && ` · ${hrs(period.ptoHours)} PTO`}
          </p>
          {period.projected > 0.005 && (
            <p className="num mt-1 text-[14px] text-ink-2">
              On track for <span className="font-semibold text-ink">{money(period.value + period.projected)}</span>
            </p>
          )}
          {legend.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
              {legend.map((j) => (
                <span key={j.id} className="flex items-center gap-2 text-[13px] text-ink-2">
                  <span className="size-2.5 rounded-[3px]" style={{ background: slotColor(j.color) }} />
                  {j.name} <span className="num font-semibold text-ink">{moneyWhole(period.byJob[j.id].value)}</span>
                </span>
              ))}
            </div>
          )}
          <div className="mt-6">
            <BarChart
              ariaLabel={`Earnings by ${range === 'day' ? 'hour' : range === 'year' ? 'month' : 'day'}`}
              data={chart}
              selected={sel}
              onSelect={setSel}
              format={money}
              labelEvery={range === 'day' ? 3 : range === 'month' ? 5 : 1}
            />
          </div>
        </Card>

        <div>
          <Card className="px-5 pt-4 pb-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold">
                {range === 'day' ? periodTitle('day', anchor, weekStartsOn) : selBucket ? selBucket.title : 'Pick a bar'}
                {selBucket && range !== 'day' && nowIndex === sel && <span className="font-normal text-ink-2"> · so far</span>}
              </h2>
              {selDate && jobs.some((j) => j.kind === 'gig') && (
                <button className="btn btn-sm btn-secondary" onClick={() => openSheet({ kind: 'gig', date: selDate })}>
                  <Plus size={16} /> Gig work
                </button>
              )}
            </div>
            {selDate ? (
              <DayDetail date={selDate} segs={segs} jobs={activeJobs} now={now} spent={selSpent} bills={selBills} />
            ) : selBucket ? (
              <PeriodDetail bucket={selBucket} segs={segs} jobs={activeJobs} now={now} spent={selSpent} bills={selBills} />
            ) : (
              <p className="py-4 text-[14px] text-ink-2">Tap a bar to see that {range === 'year' ? 'month' : 'day'}.</p>
            )}
          </Card>

          <SectionTitle>By job</SectionTitle>
          <Card className="px-5 py-1">
            <div className="divide-y divide-line">
              {activeJobs.filter((j) => tally(segs, dayStart(from), dayEnd(to), now, j.id).value > 0).length === 0 && (
                <p className="py-4 text-[14px] text-ink-2">No earnings in this window yet.</p>
              )}
              {activeJobs.map((j) => {
                const jt = tally(segs, dayStart(from), dayEnd(to), now, j.id);
                if (jt.value <= 0 && jt.projected <= 0) return null;
                return (
                  <Row
                    key={j.id}
                    color={j.color}
                    title={j.name}
                    sub={`${hrs(jt.hours)}${jt.hours >= 0.25 ? ` · ${money(perHour(jt))}/hr` : ''}${jt.projected > 0.005 ? ` · ${money(jt.projected)} to go` : ''}`}
                    amount={money(jt.value)}
                  />
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
