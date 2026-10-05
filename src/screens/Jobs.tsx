import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Bike, Briefcase, ChevronRight, Settings as Gear } from 'lucide-react';
import type { GigJob, ScheduledJob } from '../../shared/types.ts';
import { buildSegments, tally } from '../../shared/accrual.ts';
import { addDays, dayEnd, dayStart, startOfWeek, toLocalDate } from '../../shared/dates.ts';
import { useEngineData, useJobs, useNow, useSettings } from '../lib/hooks.ts';
import { rateSummary } from '../lib/money.ts';
import { hrs, money } from '../lib/format.ts';
import { go, openSheet } from '../lib/ui.ts';
import { Card, Dot, EmptyState, SectionTitle } from '../components/ui.tsx';

const FREQ: Record<ScheduledJob['frequency'], string> = {
  weekly: 'paid weekly',
  biweekly: 'paid every 2 weeks',
  semimonthly: 'paid twice a month',
  monthly: 'paid monthly',
};

const LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function ScheduledCard({ job }: { job: ScheduledJob }) {
  const { weeklyHours, rate } = rateSummary(job);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <button onClick={() => openSheet({ kind: 'job', id: job.id })} className="card flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2.5">
          <Dot color={job.color} />
          <span className="truncate text-[16px] font-semibold">{job.name}</span>
        </span>
        <span className="mt-1 block text-[13px] text-ink-2">
          {job.salaried ? 'Salary' : 'Hourly'} · {FREQ[job.frequency]}
        </span>
        <span className="num mt-2 block text-[15px] font-semibold">
          {money(rate)}/hr <span className="font-normal text-ink-2">· {hrs(weeklyHours)} a week</span>
        </span>
        <span className="mt-2.5 flex gap-1">
          {order.map((d) => (
            <span
              key={d}
              className={clsx('grid size-6 place-items-center rounded-full text-[11px] font-semibold', job.schedule[d]?.length ? 'text-white' : 'bg-raised text-ink-3')}
              style={job.schedule[d]?.length ? { background: `var(--s${job.color})` } : undefined}
            >
              {LETTERS[d]}
            </span>
          ))}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-3" />
    </button>
  );
}

function GigCard({ job, week }: { job: GigJob; week: { value: number; hours: number } }) {
  return (
    <button onClick={() => openSheet({ kind: 'job', id: job.id })} className="card flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-hover">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2.5">
          <Dot color={job.color} />
          <span className="truncate text-[16px] font-semibold">{job.name}</span>
        </span>
        <span className="mt-1 block text-[13px] text-ink-2">Gig work · logged as you go</span>
        <span className="num mt-2 block text-[15px] font-semibold">
          {money(week.value)} <span className="font-normal text-ink-2">this week · {hrs(week.hours)}</span>
          {week.hours >= 0.25 && <span className="font-normal text-ink-2"> · {money(week.value / week.hours)}/hr</span>}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-3" />
    </button>
  );
}

export function Jobs() {
  const now = useNow(60_000);
  const today = toLocalDate(now);
  const { weekStartsOn } = useSettings();
  const all = useJobs(true);
  const data = useEngineData();
  const [showArchived, setShowArchived] = useState(false);
  const active = all.filter((j) => !j.archived);
  const archived = all.filter((j) => j.archived);

  const weekFrom = startOfWeek(today, weekStartsOn);
  const weekTo = addDays(weekFrom, 6);
  const week = useMemo(() => {
    const segs = buildSegments(data, weekFrom, weekTo, now);
    return tally(segs, dayStart(weekFrom), dayEnd(weekTo), now);
  }, [data, weekFrom, weekTo, now]);

  const card = (j: (typeof all)[number]) =>
    j.kind === 'scheduled' ? (
      <ScheduledCard key={j.id} job={j} />
    ) : (
      <GigCard key={j.id} job={j} week={week.byJob[j.id] ?? { value: 0, hours: 0 }} />
    );

  return (
    <div>
      <header className="flex items-center justify-between py-2">
        <h1 className="text-[28px] font-bold tracking-tight lg:text-[32px]">Jobs</h1>
        <button onClick={() => go('settings')} aria-label="Settings" className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink lg:hidden">
          <Gear size={19} />
        </button>
      </header>

      {active.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Briefcase size={24} />}
            title="Add your first job"
            body="A scheduled job pays as you work your schedule. Gig work is logged when you do it."
          />
        </Card>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">{active.map(card)}</div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button onClick={() => openSheet({ kind: 'job', type: 'scheduled' })} className="card flex items-center gap-3 border-dashed p-4 text-left transition-colors hover:bg-hover">
          <span className="grid size-10 place-items-center rounded-full bg-raised">
            <Briefcase size={19} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">Add a scheduled job</span>
            <span className="block text-[13px] text-ink-2">Paycheck, pay schedule, and hours</span>
          </span>
        </button>
        <button onClick={() => openSheet({ kind: 'job', type: 'gig' })} className="card flex items-center gap-3 border-dashed p-4 text-left transition-colors hover:bg-hover">
          <span className="grid size-10 place-items-center rounded-full bg-raised">
            <Bike size={19} />
          </span>
          <span>
            <span className="block text-[15px] font-semibold">Add gig work</span>
            <span className="block text-[13px] text-ink-2">DoorDash, Uber, side jobs</span>
          </span>
        </button>
      </div>

      {archived.length > 0 && (
        <>
          <SectionTitle
            action={
              <button className="text-[14px] font-medium text-ink-2 hover:text-ink" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? 'Hide' : 'Show'}
              </button>
            }
          >
            Archived
          </SectionTitle>
          {showArchived && <div className="grid gap-3 opacity-70 md:grid-cols-2">{archived.map(card)}</div>}
        </>
      )}
    </div>
  );
}
