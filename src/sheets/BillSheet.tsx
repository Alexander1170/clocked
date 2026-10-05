import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Trash } from 'lucide-react';
import type { Bill, BillFrequency, BillPaycheck } from '../../shared/types.ts';
import { billStatus, dueDatesBetween, earningDays, nextDueOnOrAfter, payDateFor } from '../../shared/bills.ts';
import { addDays, diffDays, toLocalDate } from '../../shared/dates.ts';
import { paycheckSlot, paydaysBetween } from '../../shared/pay.ts';
import { useData } from '../lib/store.ts';
import { isScheduled, useBills, useCategoryMap, useEngineData, useJobs, useSettings, useTransactions } from '../lib/hooks.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, money } from '../lib/format.ts';
import { closeSheet, toast } from '../lib/ui.ts';
import { Field, MoneyInput, parseMoney, Sheet } from '../components/ui.tsx';
import { CategoryPicker } from '../components/CategoryPicker.tsx';

export const BILL_FREQUENCIES: Array<{ value: BillFrequency; label: string }> = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'yearly', label: 'Every year' },
];

type PayChoice = BillPaycheck | 'due';

const PAY_CHOICES: Array<{ value: PayChoice; label: string; hint: string }> = [
  { value: 'due', label: 'On its due date', hint: 'Autopay, or whenever it’s due.' },
  { value: 'end', label: 'End-of-month paycheck', hint: 'The one on or right before the 1st.' },
  { value: 'mid', label: 'Mid-month paycheck', hint: 'The one after that.' },
];

const LATE_CHOICES = [0, 3, 5, 7, 10, 14];

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`;

export function BillSheet({ id, fromTx }: { id?: string; fromTx?: string }) {
  const existing = useData((s) => (id ? s.t.bills[id] : undefined));
  const tx = useData((s) => (fromTx ? s.t.transactions[fromTx] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const txs = useTransactions();
  const data = useEngineData();
  const { billSpread } = useSettings();
  const today = toLocalDate(Date.now());

  const [name, setName] = useState(existing?.name ?? tx?.merchant ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : tx ? String(Math.abs(tx.amount)) : '');
  const [frequency, setFrequency] = useState<BillFrequency>(existing?.frequency ?? 'monthly');
  const [dueDate, setDueDate] = useState(
    existing ? nextDueOnOrAfter(existing, today) : tx ? nextDueOnOrAfter({ frequency: 'monthly', dueDate: tx.date }, addDays(today, 1)) : '',
  );
  const liveCats = useCategoryMap();
  const [categoryId, setCategoryId] = useState(() => {
    const start = existing?.categoryId ?? (tx?.categoryId && tx.categoryId !== 'cat_other' ? tx.categoryId : 'cat_bills');
    return liveCats[start] ? start : 'cat_bills';
  });
  const [match, setMatch] = useState(existing?.match ?? tx?.merchant ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const scheduled = useJobs().filter(isScheduled);
  const allBills = useBills();
  // New bills start out paid the way most of your bills are.
  const usual = useMemo(() => {
    const n: Record<PayChoice, number> = { due: 0, end: 0, mid: 0 };
    for (const b of allBills) n[b.payFrom ?? 'due'] += 1;
    return (['mid', 'end'] as const).reduce<PayChoice>((best, k) => (n[k] > n[best] ? k : best), 'due');
  }, [allBills]);
  const [payFrom, setPayFrom] = useState<PayChoice>(existing ? (existing.payFrom ?? 'due') : scheduled.length ? usual : 'due');
  const [lateDays, setLateDays] = useState(existing?.lateDays ?? 0);
  const [jobId, setJobId] = useState(existing?.jobId ?? scheduled[0]?.id ?? '');
  const payJob = scheduled.find((j) => j.id === jobId) ?? scheduled[0];
  const nextCheck = (slot: BillPaycheck) => (payJob ? paydaysBetween(payJob, today, addDays(today, 62)).find((d) => paycheckSlot(payJob, d) === slot) : undefined);
  const choices = PAY_CHOICES.filter((c) => c.value === 'due' || (payJob && (c.value === 'end' || payJob.frequency !== 'monthly')));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  // Which days count as workdays, far enough ahead for a yearly bill.
  const working = useMemo(() => earningDays(data, addDays(today, -31), addDays(today, 400)), [data, today]);
  const isEarningDay = (d: string) => billSpread === 'everyday' || working.has(d);

  const value = parseMoney(amount);
  const draft: Bill | null =
    value > 0 && dueDate
      ? {
          id: existing?.id ?? 'draft',
          updatedAt: 0,
          name,
          amount: value,
          frequency,
          dueDate,
          categoryId,
          match: match.trim() || undefined,
          startDate,
          payFrom: payFrom === 'due' ? undefined : payFrom,
          lateDays: payFrom === 'due' || !lateDays ? undefined : lateDays,
          jobId: payFrom !== 'due' && scheduled.length > 1 ? jobId : undefined,
        }
      : null;
  const preview = draft ? billStatus(draft, today, isEarningDay, data.jobs) : null;
  const offset = preview ? diffDays(preview.due, preview.pay) : 0;
  const atOnce = preview && value > 0 ? Math.round(preview.amount / value) : 1;
  // A payment due after you start, but planned on a paycheck from before then, isn't saved for.
  const skipped =
    draft?.payFrom && preview ? dueDatesBetween(draft, startDate, addDays(preview.due, -1)).find((d) => payDateFor(draft, d, data.jobs) < startDate) : undefined;
  const unit = billSpread === 'everyday' ? 'day' : 'workday';

  const save = () => {
    if (!name.trim()) return setError('Give the bill a name.');
    if (!(value > 0)) return setError('Enter the amount.');
    if (!dueDate) return setError('Pick when it’s due next.');
    const rec: Bill = {
      ...(existing ?? {}),
      id: existing?.id ?? newId(),
      updatedAt: 0,
      name: name.trim(),
      amount: value,
      frequency,
      dueDate,
      categoryId,
      match: match.trim() || undefined,
      startDate,
      payFrom: draft?.payFrom,
      lateDays: draft?.lateDays,
      jobId: draft?.jobId,
    };
    put('bills', rec);
    if (tx) put('transactions', { ...tx, billId: rec.id, edited: tx.source === 'plaid' ? true : tx.edited });
    // Past and future payments with a matching name count as this bill.
    const m = rec.match?.toLowerCase();
    let linked = 0;
    if (m)
      for (const t of txs)
        if (!t.billId && t.amount > 0 && t.id !== tx?.id && t.merchant.toLowerCase().includes(m)) {
          put('transactions', { ...t, billId: rec.id });
          linked += 1;
        }
    toast({
      title: `${rec.name} ${existing ? 'saved' : 'added'}`,
      detail: preview ? `${money(preview.perDay)} a ${unit}${linked ? ` · ${linked} past payments linked` : ''}` : undefined,
    });
    closeSheet();
  };

  const destroy = () => {
    if (!existing) return;
    if (!confirmDelete) return setConfirmDelete(true);
    for (const t of txs) if (t.billId === existing.id) put('transactions', { ...t, billId: undefined });
    remove('bills', existing.id);
    toast({ title: `${existing.name} deleted` });
    closeSheet();
  };

  return (
    <Sheet
      title={existing ? `Edit ${existing.name}` : 'Add a bill'}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          {existing && (
            <button className="btn btn-danger" onClick={destroy}>
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
          <input className="input" value={name} onChange={(e) => (setName(e.target.value), setError(''))} placeholder="Rent" autoFocus={!existing && !tx} />
        </Field>
        <Field label="Amount">
          <MoneyInput value={amount} onChange={(v) => (setAmount(v), setError(''))} placeholder="100.00" ariaLabel="Amount" />
        </Field>
        <div>
          <span className="label">How often</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {BILL_FREQUENCIES.map((f) => (
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Next due">
            <input className="input" type="date" value={dueDate} onChange={(e) => (setDueDate(e.target.value), setError(''))} />
          </Field>
          <Field label="Start setting aside" hint="Pick a later day if this payment is already covered.">
            <input className="input" type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} />
          </Field>
        </div>

        {scheduled.length > 0 && (
          <div>
            <span className="label">Pay it</span>
            <div className="space-y-2">
              {choices.map((c) => {
                const on = payFrom === c.value;
                const next = c.value === 'due' ? undefined : nextCheck(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setPayFrom(c.value)}
                    aria-pressed={on}
                    className={clsx('flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors', on ? 'border-ink bg-raised' : 'border-line hover:bg-hover')}
                  >
                    <span className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2', on ? 'border-ink' : 'border-ink-3')}>
                      {on && <span className="size-2.5 rounded-full bg-ink" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium">{c.label}</span>
                      <span className="block text-[13px] text-ink-2">
                        {c.hint}
                        {next && ` Next one: ${dayLabel(next)}.`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {payFrom !== 'due' && scheduled.length > 1 && (
          <div>
            <span className="label">Whose paychecks</span>
            <div className="flex flex-wrap gap-2">
              {scheduled.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setJobId(j.id)}
                  aria-pressed={jobId === j.id}
                  className={clsx('h-9 rounded-full border px-3.5 text-[14px] font-medium', jobId === j.id ? 'border-ink bg-ink text-inverse' : 'border-line text-ink-2')}
                >
                  {j.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {payFrom !== 'due' && (
          <div>
            <span className="label">Fine to pay it late?</span>
            <div className="flex flex-wrap gap-2">
              {LATE_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setLateDays(n)}
                  aria-pressed={lateDays === n}
                  className={clsx('h-9 rounded-full border px-3.5 text-[14px] font-medium', lateDays === n ? 'border-ink bg-ink text-inverse' : 'border-line text-ink-2 hover:text-ink')}
                >
                  {n === 0 ? 'Never late' : `Up to ${n} days`}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[13px] text-ink-3">If they give you a grace period, a paycheck that many days after the due date can still pay it.</p>
          </div>
        )}

        {preview && (
          <div className="rounded-3xl border border-line p-4">
            <p className="num text-[24px] font-bold tracking-tight">
              {money(preview.perDay)}
              <span className="text-[15px] font-semibold text-ink-2"> a {unit}</span>
            </p>
            <p className="mt-1 text-[14px] text-ink-2">
              {offset === 0
                ? `Split over ${plural(preview.days, unit)} from ${dayLabel(preview.windowFrom)} until it's due ${dayLabel(preview.due)}.`
                : `Paid ${dayLabel(preview.pay)}, ${plural(Math.abs(offset), 'day')} ${offset > 0 ? 'after' : 'before'} it's due ${dayLabel(preview.due)}. Split over ${plural(preview.days, unit)} from ${dayLabel(preview.windowFrom)} until then.`}
              {atOnce > 1 && ` That paycheck pays ${atOnce} of these at once, because the next one comes too late.`} The payment itself won't count as spending.
            </p>
            {skipped && (
              <p className="mt-2 text-[14px] text-ink-2">
                The one due {dayLabel(skipped)} would come from a paycheck before you start setting aside, so it isn't saved for here. To cover it, allow paying it late or pick the
                other paycheck.
              </p>
            )}
          </div>
        )}

        <Field label="Bank name (optional)" hint="Transactions with this in the name count as this bill's payment.">
          <input className="input" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Verizon" />
        </Field>
        <div>
          <span className="label">Category</span>
          <CategoryPicker value={categoryId} onChange={setCategoryId} />
        </div>
        {error && <p className="text-[14px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}
