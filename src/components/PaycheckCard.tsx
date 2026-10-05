import { Circle, CircleCheck } from 'lucide-react';
import type { LocalDate, Transaction } from '../../shared/types.ts';
import type { Paycheck, PaycheckBill } from '../../shared/bills.ts';
import type { PaycheckSlot } from '../../shared/pay.ts';
import { diffDays } from '../../shared/dates.ts';
import { dayLabel, money, monthShort } from '../lib/format.ts';
import { openSheet } from '../lib/ui.ts';

export const PAYCHECK_NAME: Record<PaycheckSlot, string> = {
  end: 'End-of-month paycheck',
  mid: 'Mid-month paycheck',
  extra: 'Extra paycheck',
};

/** "Oct 22". */
export const shortDay = (d: LocalDate) => `${monthShort(Number(d.slice(5, 7)))} ${Number(d.slice(8))}`;

/** Paid when a payment linked to the bill landed within two weeks of the day it was planned. */
export const isPaid = (billId: string, pay: LocalDate, txs: readonly Transaction[]) =>
  txs.some((t) => t.billId === billId && !t.deleted && Math.abs(diffDays(t.date, pay)) <= 13);

/** "due Oct 22, 5 days late", or when a bill on its due date comes out. */
export function payNote(b: Pick<PaycheckBill, 'pay' | 'dues'>, fromCheck: boolean): string {
  if (!fromCheck) return `comes out ${shortDay(b.pay)}`;
  const due = b.dues[b.dues.length - 1];
  const late = diffDays(due, b.pay);
  const dues = b.dues.map(shortDay).join(' and ');
  return late > 0 ? `due ${dues}, ${late} ${late === 1 ? 'day' : 'days'} late` : `due ${dues}`;
}

/** One paycheck: what it pays and what's left of it. */
export function PaycheckCard({ check, amount, today, txs, title }: { check: Paycheck; amount: number; today: LocalDate; txs: readonly Transaction[]; title?: string }) {
  const left = amount - check.billTotal;
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-[15px] font-semibold">
          {title ?? (check.payday === today ? 'Today' : dayLabel(check.payday))}
          <span className="font-normal text-ink-2"> · {PAYCHECK_NAME[check.slot]}</span>
        </p>
        <p className="num shrink-0 text-[15px] font-semibold">{money(amount)}</p>
      </div>
      {check.bills.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-2">{check.slot === 'extra' ? 'No bills planned on this one. It’s yours.' : 'No bills on this one.'}</p>
      ) : (
        <ul className="mt-2.5 space-y-0.5">
          {check.bills.map((b) => {
            const fromCheck = b.pay === check.payday && !!b.bill.payFrom;
            const paid = isPaid(b.bill.id, b.pay, txs);
            return (
              <li key={`${b.bill.id}|${b.pay}`}>
                <button
                  onClick={() => openSheet({ kind: 'bill', id: b.bill.id })}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-[14px] transition-colors hover:bg-hover"
                >
                  {paid ? <CircleCheck size={16} aria-label="Paid" className="shrink-0 text-money" /> : <Circle size={16} aria-hidden className="shrink-0 text-ink-3" />}
                  <span className="min-w-0 flex-1 truncate">
                    <span className={paid ? 'text-ink-2' : 'font-medium'}>{b.bill.name}</span>
                    <span className="text-[13px] text-ink-3"> · {payNote(b, fromCheck)}</span>
                  </span>
                  <span className="num shrink-0 font-semibold">{money(b.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="num mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-2.5 text-[13px]">
        <span className="text-ink-2">Bills {money(check.billTotal)}</span>
        <span>
          <span className="text-ink-2">Left </span>
          <span className={left >= 0 ? 'font-semibold' : 'font-semibold text-spend'}>{money(left)}</span>
        </span>
      </div>
    </div>
  );
}
