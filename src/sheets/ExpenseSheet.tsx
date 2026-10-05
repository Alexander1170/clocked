import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Landmark, PiggyBank, Plus, Trash } from 'lucide-react';
import type { LocalDate, Rule, Transaction } from '../../shared/types.ts';
import { at, hhmm, toLocalDate } from '../../shared/dates.ts';
import { useData } from '../lib/store.ts';
import { useBillMap, useBills, useCategories, useTransactions } from '../lib/hooks.ts';
import { categoryIcon, FALLBACK_CATEGORY } from '../lib/categories.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, minus, money, signed } from '../lib/format.ts';
import { notCountedReason } from '../lib/money.ts';
import { closeSheet, toast, useSheets } from '../lib/ui.ts';
import { Field, MoneyInput, parseMoney, Segmented, Sheet, Toggle } from '../components/ui.tsx';

const timeOf = (t: number) => hhmm(new Date(t).getHours() * 60 + new Date(t).getMinutes());
const ruleId = (merchant: string) => `rule_${merchant.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function ExpenseSheet({ id, date }: { id?: string; date?: LocalDate }) {
  const existing = useData((s) => (id ? s.t.transactions[id] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const cats = useCategories();
  const txs = useTransactions();
  const bills = useBills();
  const billMap = useBillMap();
  const today = toLocalDate(Date.now());
  const fromBank = existing?.source === 'plaid';

  const [amount, setAmount] = useState(existing ? String(Math.abs(existing.amount)) : '');
  const [direction, setDirection] = useState<'out' | 'in'>(existing && existing.amount < 0 ? 'in' : 'out');
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [day, setDay] = useState(existing?.date ?? date ?? today);
  const [time, setTime] = useState(existing?.at ? timeOf(existing.at) : (date ?? today) === today ? timeOf(Date.now()) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [counted, setCounted] = useState(existing ? !existing.excluded && (existing.flow ?? 'spend') === 'spend' : true);
  const [billId, setBillId] = useState<string | undefined>(existing?.billId);
  const [always, setAlways] = useState(true);
  const [error, setError] = useState('');

  const categoryChanged = !!existing && !!categoryId && categoryId !== existing.categoryId;
  const others = useMemo(
    () => txs.filter((t) => t.id !== existing?.id && !t.edited && t.merchant.trim().toLowerCase() === merchant.trim().toLowerCase()).length,
    [txs, existing?.id, merchant],
  );

  // Remember what category each merchant usually gets.
  const merchantCats = useMemo(() => {
    const m = new Map<string, { name: string; cat: string; at: number }>();
    for (const tx of txs) {
      const key = tx.merchant.trim().toLowerCase();
      if (!key) continue;
      const seen = m.get(key);
      if (!seen || tx.updatedAt > seen.at) m.set(key, { name: tx.merchant.trim(), cat: tx.categoryId, at: tx.updatedAt });
    }
    return m;
  }, [txs]);
  const suggestions = [...merchantCats.values()].sort((a, b) => b.at - a.at).slice(0, 30);

  const onMerchant = (v: string) => {
    setMerchant(v);
    const hit = merchantCats.get(v.trim().toLowerCase());
    if (hit && !categoryId) setCategoryId(hit.cat);
  };

  const save = () => {
    const amt = fromBank && existing ? Math.abs(existing.amount) : parseMoney(amount);
    if (!(amt > 0)) return setError('Enter an amount.');
    const cat = categoryId || FALLBACK_CATEGORY;
    const rec: Transaction = {
      ...(existing ?? { source: 'manual' as const }),
      id: existing?.id ?? newId(),
      updatedAt: 0,
      date: day,
      at: time ? at(day, time) : fromBank ? existing?.at : undefined,
      amount: fromBank && existing ? existing.amount : direction === 'in' ? -amt : amt,
      merchant: merchant.trim(),
      categoryId: cat,
      note: note.trim() || undefined,
      billId,
    };
    if (counted) {
      delete rec.excluded;
      rec.flow = 'spend';
    } else if (!notCountedReason({ ...rec, excluded: undefined }, billMap)) {
      rec.excluded = true;
    }
    // Bank updates keep what you changed here.
    if (fromBank) rec.edited = true;
    put('transactions', rec);

    if (categoryChanged && always && rec.merchant) {
      const rule: Rule = { id: ruleId(rec.merchant), updatedAt: 0, match: rec.merchant.trim().toLowerCase(), categoryId: cat };
      put('rules', rule);
      for (const t of txs) if (t.id !== rec.id && !t.edited && t.merchant.trim().toLowerCase() === rule.match && t.categoryId !== cat) put('transactions', { ...t, categoryId: cat });
    }
    toast({ title: `${existing ? 'Updated' : 'Added'} ${rec.amount < 0 ? signed(amt) : minus(amt)}`, detail: rec.merchant || undefined });
    closeSheet();
  };

  const linked = billId ? billMap[billId] : undefined;
  const isMoneyOut = existing ? existing.amount > 0 : direction === 'out';

  return (
    <Sheet
      title={existing ? 'Transaction' : 'Add expense'}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          {existing && !fromBank && (
            <button
              className="btn btn-danger"
              aria-label="Delete"
              onClick={() => {
                remove('transactions', existing.id);
                toast({ title: 'Deleted' });
                closeSheet();
              }}
            >
              <Trash size={17} />
            </button>
          )}
          <button className="btn btn-primary flex-1" onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {fromBank && existing ? (
          <div className="text-center">
            <p className={clsx('num text-5xl font-semibold tracking-tight', existing.amount < 0 && 'text-money')}>
              {existing.amount < 0 ? signed(-existing.amount) : minus(existing.amount)}
            </p>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-ink-2">
              <Landmark size={14} /> {existing.accountName ?? 'Bank'} · {dayLabel(existing.date)}
              {existing.pending && ' · Pending'}
            </p>
            {existing.rawName && existing.rawName !== existing.merchant && <p className="mt-1 truncate text-[12px] text-ink-3">{existing.rawName}</p>}
          </div>
        ) : (
          <>
            <Segmented<'out' | 'in'>
              label="Money in or out"
              value={direction}
              onChange={setDirection}
              options={[
                { value: 'out', label: 'Spent' },
                { value: 'in', label: 'Refund' },
              ]}
            />
            <div>
              <MoneyInput big value={amount} onChange={(v) => (setAmount(v), setError(''))} autoFocus={!existing} ariaLabel="Amount" />
              {error && <p className="-mt-1 text-center text-[13px] text-spend">{error}</p>}
            </div>
          </>
        )}

        <Field label="Where">
          <input className="input" list="merchant-list" placeholder="Chipotle" value={merchant} onChange={(e) => onMerchant(e.target.value)} />
          <datalist id="merchant-list">
            {suggestions.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
        </Field>

        <div>
          <span className="label">Category</span>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => {
              const Icon = categoryIcon(c.icon);
              const on = (categoryId || '') === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={on}
                  className={clsx(
                    'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[14px] font-medium transition-colors',
                    on ? 'border-ink bg-ink text-inverse' : 'border-line text-ink-2 hover:text-ink',
                  )}
                >
                  <Icon size={15} /> {c.name}
                </button>
              );
            })}
          </div>
          {categoryChanged && merchant.trim() && (
            <label className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
              <span className="text-[14px]">
                Always use this for {merchant.trim()}
                {others > 0 && <span className="text-ink-2"> (and {others} more like it)</span>}
              </span>
              <Toggle checked={always} onChange={setAlways} label={`Always use this category for ${merchant.trim()}`} />
            </label>
          )}
        </div>

        {isMoneyOut && (
          <div>
            <span className="label">Bill payment</span>
            {linked ? (
              <div className="flex items-center gap-3 rounded-2xl bg-raised px-4 py-3">
                <PiggyBank size={18} className="shrink-0 text-ink-2" />
                <span className="min-w-0 flex-1 text-[14px]">
                  Payment for <b className="font-semibold">{linked.name}</b>. {day >= linked.startDate ? 'Covered by its daily set-aside, so it isn’t spending today.' : 'Made before the set-asides started, so it still counts as spending.'}
                </span>
                <button className="text-[14px] font-semibold text-ink-2 hover:text-ink" onClick={() => setBillId(undefined)}>
                  Unlink
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {bills.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBillId(b.id)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[14px] font-medium text-ink-2 transition-colors hover:text-ink"
                  >
                    <PiggyBank size={15} /> {b.name}
                  </button>
                ))}
                {existing && (
                  <button
                    onClick={() => useSheets.getState().replace({ kind: 'bill', fromTx: existing.id })}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-[14px] font-medium text-ink-2 transition-colors hover:text-ink"
                  >
                    <Plus size={15} /> Make this a bill
                  </button>
                )}
                {!existing && !bills.length && <p className="text-[13px] text-ink-3">Save it first, then you can turn it into a bill.</p>}
              </div>
            )}
          </div>
        )}

        <div className={clsx('grid gap-3', fromBank ? 'grid-cols-1' : 'grid-cols-2')}>
          {!fromBank && (
            <Field label="Day">
              <input className="input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
            </Field>
          )}
          <Field label="Time (optional)">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Lunch with Sam" />
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
          <span>
            <span className="block text-[15px] font-medium">Count as spending</span>
            <span className="block text-[13px] text-ink-2">
              {existing && !counted ? (notCountedReason({ ...existing, billId }, billMap) ?? 'Left out of spending') : 'Turn off for transfers between your own accounts.'}
            </span>
          </span>
          <Toggle checked={counted} onChange={setCounted} label="Count as spending" />
        </div>
        {existing && fromBank && existing.amount < 0 && existing.flow === 'income' && (
          <p className="text-[13px] text-ink-2">
            Deposits like paychecks aren't counted: that money already showed up hour by hour. This one was {money(-existing.amount)}.
          </p>
        )}
      </div>
    </Sheet>
  );
}
