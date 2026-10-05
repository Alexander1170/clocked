import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Archive, ArchiveRestore, Bike, Briefcase, Trash } from 'lucide-react';
import type { GigJob, LocalDate, PayFrequency, ScheduledJob, Shift } from '../../shared/types.ts';
import { addDays, diffDays, toLocalDate } from '../../shared/dates.ts';
import { dayPaidHours, nextPaydayOnOrAfter, periodForPayday } from '../../shared/pay.ts';
import { useData } from '../lib/store.ts';
import { useJobs } from '../lib/hooks.ts';
import { nextSlot } from '../lib/colors.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, dowLong, dowShort, hrs, money, rangeLabel } from '../lib/format.ts';
import { rateSummary } from '../lib/money.ts';
import { closeSheet, toast } from '../lib/ui.ts';
import { ColorPicker, Field, MoneyInput, parseMoney, Sheet, Toggle } from '../components/ui.tsx';
import { DEFAULT_SHIFT, ShiftEditor } from '../components/ShiftEditor.tsx';

const FREQUENCIES: Array<{ value: PayFrequency; label: string }> = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Once a month' },
];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

const sameShift = (a: Shift, b: Shift) =>
  a.start === b.start && a.end === b.end && (a.breakMinutes ?? 0) === (b.breakMinutes ?? 0) && (a.breakStart ?? '') === (b.breakStart ?? '');

function DayOfMonth({ value, onChange, label }: { value: number; onChange(v: number): void; label: string }) {
  return (
    <select aria-label={label} className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {DAY_OPTIONS.map((d) => (
        <option key={d} value={d}>
          {d === 31 ? 'Last day' : `${d}${d === 1 || d === 21 ? 'st' : d === 2 || d === 22 ? 'nd' : d === 3 || d === 23 ? 'rd' : 'th'}`}
        </option>
      ))}
    </select>
  );
}

export function JobSheet({ id, type }: { id?: string; type?: 'scheduled' | 'gig' }) {
  const existing = useData((s) => (id ? s.t.jobs[id] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const allJobs = useJobs(true);
  const kind = existing?.kind ?? type ?? 'scheduled';
  const sched = existing?.kind === 'scheduled' ? existing : undefined;
  const usedColors = allJobs.filter((j) => j.id !== id).map((j) => j.color);

  const [name, setName] = useState(existing?.name ?? (kind === 'gig' ? 'DoorDash' : ''));
  const [color, setColor] = useState(existing?.color ?? nextSlot(usedColors));
  const [takeHome, setTakeHome] = useState(sched ? String(sched.takeHome) : '');
  const [gross, setGross] = useState(sched?.gross != null ? String(sched.gross) : '');
  const [frequency, setFrequency] = useState<PayFrequency>(sched?.frequency ?? 'biweekly');
  const [payday, setPayday] = useState<LocalDate>(sched?.payday ?? '');
  const [periodEnd, setPeriodEnd] = useState<LocalDate>(sched && sched.payLagDays > 0 ? addDays(sched.payday, -sched.payLagDays) : '');
  const [lagDays, setLagDays] = useState(String(sched?.payLagDays ?? 0));
  const [semi, setSemi] = useState<[number, number]>(sched?.semimonthlyDays ?? [15, 31]);
  const [monthlyDay, setMonthlyDay] = useState(sched?.monthlyDay ?? 1);
  const [salaried, setSalaried] = useState(sched?.salaried ?? true);
  const [days, setDays] = useState<Array<Shift | null>>(() =>
    sched ? sched.schedule.map((d) => d[0] ?? null) : [null, DEFAULT_SHIFT, DEFAULT_SHIFT, DEFAULT_SHIFT, DEFAULT_SHIFT, DEFAULT_SHIFT, null],
  );
  const [sameHours, setSameHours] = useState(() => {
    const on = days.filter((d): d is Shift => !!d);
    return on.every((s) => sameShift(s, on[0]));
  });
  const [startDate, setStartDate] = useState<LocalDate>(sched?.startDate ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const shared = days.find((d): d is Shift => !!d) ?? DEFAULT_SHIFT;
  const weekly = frequency === 'weekly' || frequency === 'biweekly';
  const lag = weekly ? (periodEnd && payday ? diffDays(periodEnd, payday) : 0) : Math.max(0, Math.round(Number(lagDays) || 0));

  const draft: ScheduledJob = useMemo(
    () => ({
      ...(sched ?? {}),
      id: id ?? 'draft',
      updatedAt: 0,
      kind: 'scheduled',
      name: name.trim(),
      color,
      salaried,
      takeHome: parseMoney(takeHome) || 0,
      gross: gross.trim() ? parseMoney(gross) : undefined,
      frequency,
      payday: weekly ? payday || toLocalDate(Date.now()) : toLocalDate(Date.now()),
      payLagDays: lag,
      semimonthlyDays: frequency === 'semimonthly' ? semi : undefined,
      monthlyDay: frequency === 'monthly' ? monthlyDay : undefined,
      schedule: days.map((d) => (d ? [d] : [])),
      startDate: startDate || undefined,
    }),
    [sched, id, name, color, salaried, takeHome, gross, frequency, weekly, payday, lag, semi, monthlyDay, days, startDate],
  );
  const summary = rateSummary(draft);
  const workday = days.find((d): d is Shift => !!d);
  const today = toLocalDate(Date.now());
  const next = summary.rate > 0 && (!weekly || payday) ? nextPaydayOnOrAfter(draft, addDays(today, 1)) : null;
  const nextPeriod = next ? periodForPayday(draft, next) : null;

  const setDay = (wd: number, on: boolean) => setDays(days.map((d, i) => (i === wd ? (on ? (sameHours ? shared : (d ?? shared)) : null) : d)));
  const setShift = (wd: number | 'all', s: Shift) => setDays(days.map((d, i) => (d && (wd === 'all' || i === wd) ? s : d)));

  const save = () => {
    if (!name.trim()) return setError('Give the job a name.');
    if (kind === 'gig') {
      const rec: GigJob = { ...(existing?.kind === 'gig' ? existing : {}), id: existing?.id ?? newId(), updatedAt: 0, kind: 'gig', name: name.trim(), color };
      put('jobs', rec);
    } else {
      if (!(draft.takeHome > 0)) return setError('Enter your take-home pay per paycheck.');
      if (weekly && !payday) return setError('Enter a payday from a paystub.');
      if (lag < 0 || lag > 31) return setError('The pay period should end on or before payday.');
      if (summary.weeklyHours <= 0) return setError('Add at least one work day.');
      put('jobs', { ...draft, id: existing?.id ?? newId(), name: name.trim() });
    }
    toast({ title: existing ? `${name.trim()} saved` : `${name.trim()} added` });
    closeSheet();
  };

  const destroy = () => {
    if (!existing) return;
    if (!confirmDelete) return setConfirmDelete(true);
    const { t } = useData.getState();
    for (const g of Object.values(t.gigs)) if (g.jobId === existing.id && !g.deleted) remove('gigs', g.id);
    for (const o of Object.values(t.overrides)) if (o.jobId === existing.id && !o.deleted) remove('overrides', o.id);
    remove('jobs', existing.id);
    toast({ title: `${existing.name} deleted` });
    closeSheet();
  };

  return (
    <Sheet
      wide={kind === 'scheduled'}
      title={existing ? `Edit ${existing.name}` : kind === 'gig' ? 'Add gig work' : 'Add a scheduled job'}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          {existing && (
            <>
              <button className="btn btn-danger" onClick={destroy}>
                {confirmDelete ? 'Tap again to delete with history' : <Trash size={17} aria-label="Delete" />}
              </button>
              {!confirmDelete && (
                <button
                  className="btn btn-secondary"
                  aria-label={existing.archived ? 'Unarchive' : 'Archive'}
                  title={existing.archived ? 'Unarchive' : 'Archive (keeps history)'}
                  onClick={() => {
                    put('jobs', { ...existing, archived: !existing.archived });
                    toast({ title: existing.archived ? `${existing.name} is back` : `${existing.name} archived`, detail: existing.archived ? undefined : 'Its history still counts.' });
                    closeSheet();
                  }}
                >
                  {existing.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />}
                </button>
              )}
            </>
          )}
          <button className="btn btn-primary flex-1" onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3 rounded-2xl bg-raised p-3.5 text-[14px] text-ink-2">
          {kind === 'gig' ? <Bike size={20} className="shrink-0" /> : <Briefcase size={20} className="shrink-0" />}
          {kind === 'gig'
            ? 'Gig work has no schedule. Start a dash from Today, or log what you made afterward.'
            : 'Your paycheck gets spread across your scheduled hours, so pay builds up while you work.'}
        </div>

        <Field label="Name">
          <input className="input" value={name} onChange={(e) => (setName(e.target.value), setError(''))} placeholder={kind === 'gig' ? 'DoorDash' : 'Day job'} autoFocus={!existing} />
        </Field>
        <div>
          <span className="label">Color</span>
          <ColorPicker value={color} onChange={setColor} used={usedColors} />
        </div>

        {kind === 'scheduled' && (
          <>
            <section className="space-y-4">
              <h3 className="text-[16px] font-semibold">Pay</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Take-home per paycheck" hint="The net amount on your paystub.">
                  <MoneyInput value={takeHome} onChange={(v) => (setTakeHome(v), setError(''))} placeholder="1,480.00" ariaLabel="Take-home per paycheck" />
                </Field>
                <Field label="Gross per paycheck (optional)" hint="Before taxes. Just for reference.">
                  <MoneyInput value={gross} onChange={setGross} ariaLabel="Gross per paycheck" />
                </Field>
              </div>
              <div>
                <span className="label">How often you're paid</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {FREQUENCIES.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setFrequency(f.value)}
                      aria-pressed={frequency === f.value}
                      className={clsx(
                        'h-11 rounded-2xl border text-[14px] font-medium transition-colors',
                        frequency === f.value ? 'border-ink bg-ink text-inverse' : 'border-line text-ink-2 hover:text-ink',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {weekly ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="A pay date" hint="From any paystub, past or upcoming.">
                    <input className="input" type="date" value={payday} onChange={(e) => (setPayday(e.target.value), setError(''))} />
                  </Field>
                  <Field label="Its pay period ended (optional)" hint="Most checks pay for work through a few days earlier.">
                    <input className="input" type="date" value={periodEnd} max={payday || undefined} onChange={(e) => setPeriodEnd(e.target.value)} />
                  </Field>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <span className="label">Paydays</span>
                    {frequency === 'semimonthly' ? (
                      <div className="flex items-center gap-2">
                        <DayOfMonth label="First payday" value={semi[0]} onChange={(v) => setSemi([v, semi[1]])} />
                        <span className="text-ink-3">and</span>
                        <DayOfMonth label="Second payday" value={semi[1]} onChange={(v) => setSemi([semi[0], v])} />
                      </div>
                    ) : (
                      <DayOfMonth label="Payday" value={monthlyDay} onChange={setMonthlyDay} />
                    )}
                    <span className="mt-1.5 block text-[13px] text-ink-3">Weekend paydays move to Friday.</span>
                  </div>
                  <Field label="Days from period end to payday" hint="0 if the check pays through payday.">
                    <input className="input num" inputMode="numeric" value={lagDays} onChange={(e) => setLagDays(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                </div>
              )}
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
                <span>
                  <span className="block text-[15px] font-medium">Salary</span>
                  <span className="block text-[13px] text-ink-2">
                    {salaried ? 'Same check every time. Different hours on a day don’t change pay.' : 'Hourly. Pay follows the hours you actually work.'}
                  </span>
                </span>
                <Toggle checked={salaried} onChange={setSalaried} label="Salary" />
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold">Schedule</h3>
                <label className="flex items-center gap-2 text-[14px] text-ink-2">
                  Same hours every day
                  <Toggle
                    checked={sameHours}
                    onChange={(v) => {
                      setSameHours(v);
                      if (v) setShift('all', shared);
                    }}
                    label="Same hours every day"
                  />
                </label>
              </div>
              <div className="flex gap-1.5">
                {WEEK.map((wd) => (
                  <button
                    key={wd}
                    onClick={() => setDay(wd, !days[wd])}
                    aria-pressed={!!days[wd]}
                    aria-label={dowLong(wd)}
                    className={clsx(
                      'h-11 flex-1 rounded-2xl text-[14px] font-semibold transition-colors',
                      days[wd] ? 'text-white' : 'bg-raised text-ink-3 hover:text-ink',
                    )}
                    style={days[wd] ? { background: `var(--s${color})` } : undefined}
                  >
                    {dowShort(wd).slice(0, 2)}
                  </button>
                ))}
              </div>
              {days.some(Boolean) &&
                (sameHours ? (
                  <ShiftEditor shift={shared} onChange={(s) => setShift('all', s)} />
                ) : (
                  <div className="space-y-4">
                    {WEEK.filter((wd) => days[wd]).map((wd) => (
                      <div key={wd}>
                        <p className="mb-1.5 text-[14px] font-semibold">{dowLong(wd)}</p>
                        <ShiftEditor shift={days[wd]!} onChange={(s) => setShift(wd, s)} compact />
                      </div>
                    ))}
                  </div>
                ))}
              <Field label="Started this job (optional)" hint="Leave blank to count every scheduled day.">
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
            </section>

            <section className="rounded-3xl border border-line p-5">
              <p className="text-[13px] font-medium text-ink-2">Your take-home rate</p>
              <p className="num mt-1 text-[36px] leading-none font-bold tracking-tight">
                {money(summary.rate)}
                <span className="text-[18px] font-semibold text-ink-2">/hr</span>
              </p>
              <p className="num mt-2 text-[14px] text-ink-2">{summary.rate > 0 ? summary.formula : 'Add your pay and schedule to see it.'}</p>
              {summary.rate > 0 && (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-[14px]">
                  <div className="rounded-2xl bg-raised p-3">
                    <dt className="text-ink-2">Each minute</dt>
                    <dd className="num font-semibold">{money(summary.rate / 60)}</dd>
                  </div>
                  <div className="rounded-2xl bg-raised p-3">
                    <dt className="text-ink-2">Per workday ({hrs(dayPaidHours(workday ? [workday] : []))})</dt>
                    <dd className="num font-semibold">{money(summary.rate * dayPaidHours(workday ? [workday] : []))}</dd>
                  </div>
                  <div className="rounded-2xl bg-raised p-3">
                    <dt className="text-ink-2">Hours a week</dt>
                    <dd className="num font-semibold">{hrs(summary.weeklyHours)}</dd>
                  </div>
                  <div className="rounded-2xl bg-raised p-3">
                    <dt className="text-ink-2">Next payday</dt>
                    <dd className="font-semibold">{next ? dayLabel(next) : '—'}</dd>
                  </div>
                </dl>
              )}
              {next && nextPeriod && (
                <p className="mt-3 text-[13px] text-ink-2">
                  That check covers {rangeLabel(nextPeriod.from, nextPeriod.to)}.
                </p>
              )}
            </section>
          </>
        )}
        {error && <p className="text-[14px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}
