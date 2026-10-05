import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Trash } from 'lucide-react';
import type { Bill, BillFrequency } from '../../shared/types.ts';
import { billStatus, earningDays, nextDueOnOrAfter } from '../../shared/bills.ts';
import { addDays, toLocalDate } from '../../shared/dates.ts';
import { useData } from '../lib/store.ts';
import { useCategories, useEngineData, useSettings, useTransactions } from '../lib/hooks.ts';
import { categoryIcon } from '../lib/categories.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, money } from '../lib/format.ts';
import { closeSheet, toast } from '../lib/ui.ts';
import { Field, MoneyInput, parseMoney, Sheet } from '../components/ui.tsx';

export const BILL_FREQUENCIES: Array<{ value: BillFrequency; label: string }> = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'yearly', label: 'Every year' },
];

export function BillSheet({ id, fromTx }: { id?: string; fromTx?: string }) {
  const existing = useData((s) => (id ? s.t.bills[id] : undefined));
  const tx = useData((s) => (fromTx ? s.t.transactions[fromTx] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const cats = useCategories();
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
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? (tx?.categoryId && tx.categoryId !== 'cat_other' ? tx.categoryId : 'cat_bills'));
  const [match, setMatch] = useState(existing?.match ?? tx?.merchant ?? '');
  const [startDate, setStartDate] = useState(existing?.startDate ?? today);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  // Which days count as workdays, far enough ahead for a yearly bill.
  const working = useMemo(() => earningDays(data, addDays(today, -31), addDays(today, 400)), [data, today]);
  const isEarningDay = (d: string) => billSpread === 'everyday' || working.has(d);

  const value = parseMoney(amount);
  const draft: Bill | null =
    value > 0 && dueDate
      ? { id: existing?.id ?? 'draft', updatedAt: 0, name, amount: value, frequency, dueDate, categoryId, match: match.trim() || undefined, startDate }
      : null;
  const preview = draft ? billStatus(draft, today, isEarningDay) : null;
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

        {preview && (
          <div className="rounded-3xl border border-line p-4">
            <p className="num text-[24px] font-bold tracking-tight">
              {money(preview.perDay)}
              <span className="text-[15px] font-semibold text-ink-2"> a {unit}</span>
            </p>
            <p className="mt-1 text-[14px] text-ink-2">
              Split over {preview.days} {preview.days === 1 ? unit : unit + 's'} from {dayLabel(preview.windowFrom)} until it's due {dayLabel(preview.due)}. The
              payment itself won't count as spending.
            </p>
          </div>
        )}

        <Field label="Bank name (optional)" hint="Transactions with this in the name count as this bill's payment.">
          <input className="input" value={match} onChange={(e) => setMatch(e.target.value)} placeholder="Verizon" />
        </Field>
        <div>
          <span className="label">Category</span>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => {
              const Icon = categoryIcon(c.icon);
              return (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={categoryId === c.id}
                  className={clsx(
                    'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[14px] font-medium transition-colors',
                    categoryId === c.id ? 'border-ink bg-ink text-inverse' : 'border-line text-ink-2 hover:text-ink',
                  )}
                >
                  <Icon size={15} /> {c.name}
                </button>
              );
            })}
          </div>
        </div>
        {error && <p className="text-[14px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}
