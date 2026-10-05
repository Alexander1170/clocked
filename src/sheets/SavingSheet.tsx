import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Trash } from 'lucide-react';
import type { Saving, SavingFrequency } from '../../shared/types.ts';
import { earningDays } from '../../shared/bills.ts';
import { savingStatus } from '../../shared/plan.ts';
import { addDays, addMonths, endOfMonth, toLocalDate, weekday } from '../../shared/dates.ts';
import { useData } from '../lib/store.ts';
import { isScheduled, useEngineData, useJobs, useSettings } from '../lib/hooks.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, money } from '../lib/format.ts';
import { closeSheet, toast } from '../lib/ui.ts';
import { Field, MoneyInput, parseMoney, Sheet } from '../components/ui.tsx';

const FREQUENCIES: Array<{ value: SavingFrequency; label: string }> = [
  { value: 'paycheck', label: 'Every paycheck' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'yearly', label: 'Every year' },
];

/** A sensible first "money moves" day: the end of the period that starts today. */
function defaultDue(f: SavingFrequency, today: string): string {
  const friday = addDays(today, (5 - weekday(today) + 7) % 7);
  if (f === 'weekly') return friday;
  if (f === 'biweekly') return addDays(friday, 7);
  if (f === 'quarterly') return endOfMonth(addMonths(today, 2));
  if (f === 'yearly') return `${today.slice(0, 4)}-12-31`;
  return endOfMonth(today);
}

export function SavingSheet({ id, amount: suggested }: { id?: string; amount?: number }) {
  const existing = useData((s) => (id ? s.t.savings[id] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const jobs = useJobs().filter(isScheduled);
  const data = useEngineData();
  const { billSpread } = useSettings();
  const today = toLocalDate(Date.now());
  const unit = billSpread === 'everyday' ? 'day' : 'workday';

  const [name, setName] = useState(existing?.name ?? 'Savings');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : suggested ? String(suggested) : '');
  const [frequency, setFrequency] = useState<SavingFrequency>(existing?.frequency ?? (jobs.length ? 'paycheck' : 'monthly'));
  const [jobId, setJobId] = useState(existing?.jobId ?? jobs[0]?.id ?? '');
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? defaultDue(existing?.frequency ?? (jobs.length ? 'paycheck' : 'monthly'), today));
  const [dueTouched, setDueTouched] = useState(!!existing);
  const [account, setAccount] = useState(existing?.account ?? '');
  const [target, setTarget] = useState(existing?.target != null ? String(existing.target) : '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const working = useMemo(() => earningDays(data, addDays(today, -31), addDays(today, 400)), [data, today]);
  const isEarningDay = (d: string) => billSpread === 'everyday' || working.has(d);

  const value = parseMoney(amount);
  const goal = target.trim() ? parseMoney(target) : undefined;
  const draft: Saving | null =
    value > 0
      ? { id: id ?? 'draft', updatedAt: 0, name, amount: value, frequency, jobId: frequency === 'paycheck' ? jobId : undefined, dueDate, startDate, target: goal && goal > 0 ? goal : undefined }
      : null;
  const preview = draft ? savingStatus(draft, today, isEarningDay, data.jobs) : null;

  const pickFrequency = (f: SavingFrequency) => {
    setFrequency(f);
    if (!dueTouched) setDueDate(defaultDue(f, today));
  };

  const save = () => {
    if (!name.trim()) return setError('Give it a name.');
    if (!(value > 0)) return setError('Enter how much to save each time.');
    if (frequency === 'paycheck' && !jobId) return setError('Pick whose paychecks.');
    if (goal !== undefined && !(goal > 0)) return setError('The goal should be more than $0.');
    const rec: Saving = {
      ...(existing ?? {}),
      id: existing?.id ?? newId(),
      updatedAt: 0,
      name: name.trim(),
      amount: value,
      frequency,
      jobId: frequency === 'paycheck' ? jobId : undefined,
      dueDate,
      startDate,
      target: goal,
      account: account.trim() || undefined,
    };
    put('savings', rec);
    toast({ title: `${rec.name} ${existing ? 'saved' : 'added'}`, detail: preview ? `${money(preview.perDay)} a ${unit}` : undefined });
    closeSheet();
  };

  return (
    <Sheet
      title={existing ? `Edit ${existing.name}` : 'Add savings'}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          {existing && (
            <button
              className="btn btn-danger"
              onClick={() => {
                if (!confirmDelete) return setConfirmDelete(true);
                remove('savings', existing.id);
                toast({ title: `${existing.name} deleted` });
                closeSheet();
              }}
            >
              {confirmDelete ? 'Tap again to delete' : <Trash size={17} aria-label="Delete" />}
            </button>
          )}
          <button className="btn btn-primary flex-1" onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => (setName(e.target.value), setError(''))} placeholder="Emergency fund" />
        </Field>
        <Field label="How much each time">
          <MoneyInput value={amount} onChange={(v) => (setAmount(v), setError(''))} placeholder="100.00" ariaLabel="How much each time" />
        </Field>
        <div>
          <span className="label">How often</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {FREQUENCIES.filter((f) => f.value !== 'paycheck' || jobs.length).map((f) => (
              <button
                key={f.value}
                onClick={() => pickFrequency(f.value)}
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
        {frequency === 'paycheck' ? (
          jobs.length > 1 && (
            <div>
              <span className="label">Whose paychecks</span>
              <div className="flex flex-wrap gap-2">
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => setJobId(j.id)}
                    aria-pressed={jobId === j.id}
                    className={clsx('h-9 rounded-full border px-3.5 text-[14px] font-medium', jobId === j.id ? 'border-ink bg-ink text-inverse' : 'border-line text-ink-2')}
                  >
                    {j.name}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <Field label="Money moves on" hint="Any day you move it. It repeats from there.">
            <input className="input" type="date" value={dueDate} onChange={(e) => e.target.value && (setDueDate(e.target.value), setDueTouched(true))} />
          </Field>
        )}

        {preview && (
          <div className="rounded-3xl border border-line p-4">
            <p className="num text-[24px] font-bold tracking-tight">
              {money(preview.perDay)}
              <span className="text-[15px] font-semibold text-ink-2"> a {unit}</span>
            </p>
            <p className="mt-1 text-[14px] text-ink-2">Set aside until it moves on {dayLabel(preview.due)}, then it starts again.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Where it goes (optional)">
            <input className="input" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Savings account" />
          </Field>
          <Field label="Stop once I've saved (optional)">
            <MoneyInput value={target} onChange={setTarget} placeholder="1,000.00" ariaLabel="Stop once I've saved" />
          </Field>
        </div>
        <Field label="Start on">
          <input className="input" type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
        </Field>
        {error && <p className="text-[14px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}
