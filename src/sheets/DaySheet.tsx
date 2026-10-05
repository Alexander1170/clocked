import { useState } from 'react';
import clsx from 'clsx';
import type { DayOverride, LocalDate, OverrideType, Shift } from '../../shared/types.ts';
import { scheduledDaySegments } from '../../shared/accrual.ts';
import { weekday } from '../../shared/dates.ts';
import { dayPaidHours } from '../../shared/pay.ts';
import { useData } from '../lib/store.ts';
import { dayLabel, hhmmLabel, hrs, money } from '../lib/format.ts';
import { closeSheet, toast } from '../lib/ui.ts';
import { Sheet } from '../components/ui.tsx';
import { DEFAULT_SHIFT, ShiftEditor } from '../components/ShiftEditor.tsx';

type Choice = 'normal' | OverrideType;

const describe = (shifts: Shift[]) =>
  shifts.length
    ? shifts
        .map((s) => `${hhmmLabel(s.start)}–${hhmmLabel(s.end)}${s.breakMinutes ? ` · ${s.breakMinutes} min unpaid break` : ''}`)
        .join(', ')
    : 'Not scheduled';

/** Change one day of a scheduled job: a day off or different hours. */
export function DaySheet({ jobId, date }: { jobId: string; date: LocalDate }) {
  const job = useData((s) => s.t.jobs[jobId]);
  const overrideId = `ov_${jobId}_${date}`;
  const existing = useData((s) => s.t.overrides[overrideId]);
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const live = existing && !existing.deleted ? existing : undefined;
  const base = job?.kind === 'scheduled' ? (job.schedule[weekday(date)] ?? []) : [];

  const [choice, setChoice] = useState<Choice>(live?.type ?? 'normal');
  const [shift, setShift] = useState<Shift>(live?.shifts?.[0] ?? base[0] ?? DEFAULT_SHIFT);

  if (!job || job.kind !== 'scheduled') return null;

  const draft: DayOverride | undefined =
    choice === 'normal' ? undefined : { id: overrideId, updatedAt: 0, jobId, date, type: choice, shifts: choice === 'custom' ? [shift] : undefined };
  const value = scheduledDaySegments(job, date, draft).reduce((t, s) => t + s.value, 0);

  const options: Array<{ value: Choice; title: string; sub: string }> = [
    { value: 'normal', title: 'Normal schedule', sub: describe(base) },
    { value: 'off_paid', title: 'Paid day off', sub: 'PTO or a paid holiday. Pay still builds up.' },
    { value: 'off_unpaid', title: 'Unpaid day off', sub: 'Nothing earned this day.' },
    { value: 'custom', title: 'Different hours', sub: job.salaried ? 'Same pay, spread over the hours you worked.' : 'Pay follows the hours you worked.' },
  ];

  const save = () => {
    if (choice === 'normal') {
      if (live) remove('overrides', overrideId);
    } else {
      put('overrides', { id: overrideId, jobId, date, type: choice, shifts: choice === 'custom' ? [shift] : undefined });
    }
    toast({ title: `${dayLabel(date)} saved`, detail: `${job.name} · ${money(value)}` });
    closeSheet();
  };

  return (
    <Sheet
      title={`${job.name} · ${dayLabel(date)}`}
      onClose={closeSheet}
      footer={
        <button className="btn btn-primary w-full" onClick={save}>
          Save
        </button>
      }
    >
      <div role="radiogroup" aria-label="This day" className="space-y-2">
        {options.map((o) => {
          const on = choice === o.value;
          return (
            <div key={o.value} className={clsx('rounded-2xl border transition-colors', on ? 'border-ink' : 'border-line')}>
              <button role="radio" aria-checked={on} onClick={() => setChoice(o.value)} className="flex w-full items-start gap-3 p-4 text-left">
                <span className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-ink' : 'border-ink-3')}>
                  {on && <span className="size-2.5 rounded-full bg-ink" />}
                </span>
                <span>
                  <span className="block text-[15px] font-semibold">{o.title}</span>
                  <span className="block text-[13px] text-ink-2">{o.sub}</span>
                </span>
              </button>
              {on && o.value === 'custom' && (
                <div className="px-4 pb-4">
                  <ShiftEditor shift={shift} onChange={setShift} compact />
                  <p className="mt-2 text-[13px] text-ink-2">{hrs(dayPaidHours([shift]))} paid</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex items-center justify-between rounded-2xl bg-raised px-4 py-3">
        <span className="text-[14px] text-ink-2">This day pays</span>
        <span className="num text-[18px] font-bold">{money(value)}</span>
      </div>
    </Sheet>
  );
}
