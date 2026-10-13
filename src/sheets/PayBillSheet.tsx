import { useState } from 'react';
import type { LocalDate, Transaction } from '../../shared/types.ts';
import { at, hhmm, toLocalDate } from '../../shared/dates.ts';
import { useData } from '../lib/store.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, money } from '../lib/format.ts';
import { closeSheet, toast, useSheets } from '../lib/ui.ts';
import { Field, MoneyInput, parseMoney, Sheet, Toggle } from '../components/ui.tsx';

/**
 * Mark a bill paid before the bank shows it: any amount, part of it, or part
 * now and the rest from the next paycheck. It comes off what's free until the
 * bank sends the payment, and then the two match up.
 */
export function PayBillSheet({ billId, due, amount, paid = 0 }: { billId: string; due: LocalDate; amount: number; paid?: number }) {
  const bill = useData((s) => s.t.bills[billId]);
  const put = useData((s) => s.put);
  const today = toLocalDate(Date.now());
  const rest = Math.max(0, amount - paid);
  const [value, setValue] = useState(rest.toFixed(2));
  const [day, setDay] = useState(today);
  const [restNext, setRestNext] = useState(true);
  const [error, setError] = useState('');

  if (!bill || bill.deleted) {
    return (
      <Sheet title="Bill" onClose={closeSheet}>
        <p className="text-[15px] text-ink-2">This bill isn’t there anymore.</p>
      </Sheet>
    );
  }

  const amt = parseMoney(value);
  const part = amt > 0 && amt < rest - 0.5;
  const save = () => {
    if (!(amt > 0)) return setError('Enter what you paid.');
    const now = new Date();
    const rec: Transaction = {
      id: newId(),
      updatedAt: 0,
      source: 'manual',
      date: day,
      at: day === today ? at(day, hhmm(now.getHours() * 60 + now.getMinutes())) : undefined,
      amount: amt,
      merchant: bill.name,
      categoryId: bill.categoryId,
      billId: bill.id,
      billDue: due,
    };
    if (part) {
      rec.billPart = true;
      if (restNext) rec.restNext = true;
    }
    for (const k of Object.keys(rec) as Array<keyof Transaction>) if (rec[k] === undefined) delete rec[k];
    put('transactions', rec);
    toast({
      title: `Marked ${bill.name} paid`,
      detail: part ? `${money(amt)} now, ${money(rest - amt)} ${restNext ? 'from your next paycheck' : 'still to pay'}` : `${money(amt)}. It’ll match up with the bank’s copy.`,
    });
    closeSheet();
  };

  return (
    <Sheet
      title={`Pay ${bill.name}`}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => useSheets.getState().replace({ kind: 'bill', id: bill.id })}>
            Edit bill
          </button>
          <button className="btn btn-primary flex-1" onClick={save}>
            Mark paid
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="num text-[14px] text-ink-2">
          Due {dayLabel(due)} · {money(amount)}
          {paid > 0.005 && ` · ${money(paid)} paid so far`}
        </p>
        <div>
          <MoneyInput big value={value} onChange={(v) => (setValue(v), setError(''))} ariaLabel="Amount paid" />
          {error && <p className="-mt-1 text-center text-[13px] text-spend">{error}</p>}
          <p className="text-center text-[13px] text-ink-3">The bank’s amount wins if it’s different: the bill counts what you actually paid.</p>
        </div>
        {part && (
          <label className="flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
            <span className="text-[14px]">
              Pay the rest from my next paycheck
              <span className="block text-[13px] text-ink-2">
                {money(rest - amt)} {restNext ? 'comes out of the next one instead of this one.' : 'is still due from this paycheck.'}
              </span>
            </span>
            <Toggle checked={restNext} onChange={setRestNext} label="Pay the rest from my next paycheck" />
          </label>
        )}
        <Field label="Paid on" hint="Until the bank shows it, it comes off what’s free until payday.">
          <input className="input" type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
