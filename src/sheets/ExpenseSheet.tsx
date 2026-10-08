import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CopyCheck, Eye, EyeOff, Gift, Landmark, PiggyBank, Plus, Trash } from 'lucide-react';
import type { LocalDate, Rule, RuleField, Transaction } from '../../shared/types.ts';
import { at, hhmm, toLocalDate } from '../../shared/dates.ts';
import { paysBill } from '../../shared/bills.ts';
import { bankNameOf, normName, releaseFromRule, ruleCovers, ruleFor, rulesApply } from '../../shared/rules.ts';
import { useData } from '../lib/store.ts';
import { useBills, useCategoryMap, useCoverage, useGoals, useRules, useTransactions } from '../lib/hooks.ts';
import { FALLBACK_CATEGORY } from '../lib/categories.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, minus, money, monthDay, signed } from '../lib/format.ts';
import { findDuplicates, notCountedReason } from '../lib/money.ts';
import { placeRuleId, teachable } from '../lib/places.ts';
import { markDifferent, mergePair, teachRule } from '../lib/teach.ts';
import { closeSheet, toast, useSheets } from '../lib/ui.ts';
import { Field, MoneyInput, parseMoney, Segmented, Sheet, Toggle } from '../components/ui.tsx';
import { CategoryPicker } from '../components/CategoryPicker.tsx';

const timeOf = (t: number) => hhmm(new Date(t).getHours() * 60 + new Date(t).getMinutes());
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function ExpenseSheet({ id, date }: { id?: string; date?: LocalDate }) {
  const existing = useData((s) => (id ? s.t.transactions[id] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const txs = useTransactions();
  const bills = useBills();
  const rules = useRules();
  const goals = useGoals().filter((g) => g.items.some((i) => !i.boughtOn) || g.id === existing?.goalId);
  const cover = useCoverage();
  const billMap = cover.bills;
  const today = toLocalDate(Date.now());
  const fromBank = existing?.source === 'plaid';
  // A bank transaction can teach its place: what you call it and how it's filed carries to the rest.
  const bankName = existing && fromBank ? bankNameOf(existing) : '';
  const canRule = !!existing && rulesApply(existing);
  const placeRule = canRule ? ruleFor(rules, bankName, existing?.rawName) : undefined;

  const [amount, setAmount] = useState(existing ? String(Math.abs(existing.amount)) : '');
  const [direction, setDirection] = useState<'out' | 'in'>(existing && existing.amount < 0 ? 'in' : 'out');
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const liveCats = useCategoryMap();
  // A category deleted since this was tagged reads as none picked, so saving files it under Other.
  const [categoryId, setCategoryId] = useState(existing && liveCats[existing.categoryId] ? existing.categoryId : '');
  const [day, setDay] = useState(existing?.date ?? date ?? today);
  const [time, setTime] = useState(existing?.at ? timeOf(existing.at) : (date ?? today) === today ? timeOf(Date.now()) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [counted, setCounted] = useState(existing ? !existing.excluded && (existing.flow ?? 'spend') === 'spend' : true);
  const [billId, setBillId] = useState<string | undefined>(existing?.billId);
  const [billPart, setBillPart] = useState(!!existing?.billPart);
  const [goalId, setGoalId] = useState<string | undefined>(existing?.goalId);
  const [teachPick, setTeach] = useState<boolean | null>(null);
  const [mergeName, setMergeName] = useState(false);
  const [error, setError] = useState('');

  const name = merchant.trim();
  const categoryChanged = !!existing && !!categoryId && categoryId !== existing.categoryId;
  const nameChanged = canRule && !!existing && (name || bankName) !== existing.merchant;
  const billChanged = canRule && billId !== existing?.billId;
  // The place this teaches: the bank name for a bank transaction, your name for one you added.
  const teachKey = canRule ? (placeRule ? placeRule.match : normName(bankName)) : normName(name);
  const offerTeach = canRule ? nameChanged || categoryChanged || (billChanged && !!billId) : categoryChanged && !!name;
  const placeOthers = useMemo(
    () => (offerTeach && teachKey ? txs.filter((t) => t.id !== existing?.id && teachable(t, cover.trackFrom) && ruleCovers({ match: teachKey }, bankNameOf(t))) : []),
    [offerTeach, teachKey, txs, existing?.id, cover.trackFrom],
  );
  const others = placeOthers.length;
  // Linking one payment to a bill teaches the place only when the rest look like payments of it too,
  // so tying one store order to a membership bill doesn't make every order from that store a bill payment.
  const teachBill = billId ? billMap[billId] : undefined;
  const billLike = !!teachBill && placeOthers.every((t) => t.amount >= teachBill.amount * 0.25 && t.amount <= teachBill.amount * 1.5);
  const teach = teachPick ?? (nameChanged || categoryChanged || billLike);

  // A purchase you added by hand that this is the bank's copy of, or the other way around.
  const dup = useMemo(
    () => (existing ? findDuplicates(txs, cover.trackFrom).find((d) => d.bank.id === existing.id || d.manual.id === existing.id) : undefined),
    [existing, txs, cover.trackFrom],
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

  /** Saves a rule for this place and puts its transactions the way it says. Returns how many others changed. */
  const teachPlace = (rec: Transaction, fields: { rename?: string | null; categoryId?: string; billId?: string | null }) => {
    const prior = canRule ? placeRule : rules.find((r) => normName(r.match) === teachKey);
    const rule: Omit<Rule, 'updatedAt'> = { ...(prior ?? {}), id: prior?.id ?? placeRuleId(teachKey), match: prior?.match ?? teachKey };
    if (fields.categoryId) rule.categoryId = fields.categoryId;
    if (fields.rename !== undefined) rule.rename = fields.rename ?? undefined;
    if (fields.billId !== undefined) rule.billId = fields.billId ?? undefined;
    return teachRule(rule, rec.id);
  };

  const save = () => {
    const amt = fromBank && existing ? Math.abs(existing.amount) : parseMoney(amount);
    if (!(amt > 0)) return setError('Enter an amount.');
    const cat = categoryId || FALLBACK_CATEGORY;
    let rec: Transaction = {
      ...(existing ?? { source: 'manual' as const }),
      id: existing?.id ?? newId(),
      updatedAt: 0,
      date: day,
      at: time ? at(day, time) : fromBank ? existing?.at : undefined,
      amount: fromBank && existing ? existing.amount : direction === 'in' ? -amt : amt,
      merchant: name,
      categoryId: cat,
      note: note.trim() || undefined,
      billId,
      goalId: billId ? undefined : goalId,
    };
    if (fromBank) {
      // A name of your own; the bank's stays underneath, for matching.
      if (name && name !== bankName) rec.bankName = bankName;
      else {
        rec.merchant = bankName;
        delete rec.bankName;
      }
    }
    if (billId && billPart) rec.billPart = true;
    else delete rec.billPart;
    if (counted) {
      delete rec.excluded;
      rec.flow = 'spend';
    } else if (!notCountedReason({ ...rec, excluded: undefined }, cover)) {
      rec.excluded = true;
    }
    // Bank updates keep what you changed here.
    if (fromBank) rec.edited = true;
    // What you changed yourself isn't the place's rule's to undo.
    const mine: RuleField[] = [];
    if (nameChanged) mine.push('name');
    if (categoryChanged) mine.push('category');
    if (billChanged) mine.push('bill');
    rec = releaseFromRule(rec, mine);
    rec = put('transactions', rec);

    let more = 0;
    const taught = offerTeach && teach && !!teachKey;
    if (taught) {
      more = teachPlace(rec, {
        categoryId: cat,
        rename: nameChanged ? (name && normName(name) !== normName(bankName) ? name : null) : undefined,
        billId: billChanged ? (billId ?? null) : undefined,
      });
    }
    const place = canRule ? bankName : rec.merchant;
    const bill = billId ? billMap[billId] : undefined;
    if (billChanged && bill) {
      toast({
        title: `Marked as ${bill.name}`,
        detail: taught ? `${more ? `And ${plural(more, 'more')} from ${place}. ` : ''}New ones from ${place} will be too.` : 'It isn’t spending anymore.',
      });
    } else if (billChanged) {
      toast({ title: 'Not a bill payment', detail: 'It counts as spending again.' });
    } else {
      toast({
        title: `${existing ? 'Updated' : 'Added'} ${rec.amount < 0 ? signed(amt) : minus(amt)}`,
        detail: more ? `And ${plural(more, 'more')} from ${place}` : rec.merchant || undefined,
      });
    }
    closeSheet();
  };

  const setHidden = (on: boolean) => {
    if (!existing) return;
    const rec: Transaction = releaseFromRule({ ...existing, edited: true }, ['hide']);
    if (on) rec.hidden = true;
    else delete rec.hidden;
    put('transactions', rec);
    toast({ title: on ? 'Hidden' : 'Showing it again', detail: on ? 'It won’t show or count. Find it in Bank transactions.' : undefined });
    closeSheet();
  };

  const merge = () => {
    if (!dup) return;
    const { merged, more } = mergePair(dup, mergeName);
    toast({ title: 'Merged', detail: more ? `And ${plural(more, 'more')} from ${bankNameOf(dup.bank)} renamed` : `Kept the bank’s copy as ${merged.merchant}` });
    closeSheet();
  };

  const notSame = () => {
    if (!dup) return;
    markDifferent(dup);
    toast({ title: 'Got it, they’re different' });
  };

  const linked = billId ? billMap[billId] : undefined;
  const linkedGoal = !linked && goalId ? cover.goals[goalId] : undefined;
  const isMoneyOut = existing ? existing.amount > 0 : direction === 'out';
  const paidAmount = existing ? Math.abs(existing.amount) : parseMoney(amount);
  const short = !!linked && paidAmount > 0 && paidAmount < linked.amount - 0.5;
  const other = dup && existing ? (dup.bank.id === existing.id ? dup.manual : dup.bank) : undefined;
  const placeLabel = canRule ? bankName : name;

  const pickBill = (id: string) => {
    setBillId(id);
    setBillPart(billMap[id]?.payFrom === 'both');
    setGoalId(undefined);
  };
  // Bills this looks like: the name fits one and the amount is close. A close amount alone isn't enough;
  // plenty of lunches cost about what a subscription does.
  const likely = isMoneyOut && !linked && !linkedGoal ? bills.filter((b) => paysBill(b, fromBank ? bankName : name, paidAmount, existing?.rawName)).slice(0, 2) : [];
  const chip = 'inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3 text-[14px] font-medium text-ink-2 transition-colors hover:text-ink';

  const billBlock = isMoneyOut && (
    <div>
      <span className="label">{linked ? 'Bill payment' : linkedGoal ? 'Paid for' : 'Is this a bill?'}</span>
      {linked ? (
        <>
          <div className="flex items-center gap-3 rounded-2xl bg-raised px-4 py-3">
            <PiggyBank size={18} className="shrink-0 text-money" />
            <span className="min-w-0 flex-1 text-[14px]">
              <b className="font-semibold">{linked.name}</b>.{' '}
              {day >= linked.startDate ? 'Its set-aside covers this, so it isn’t spending.' : 'Made before its set-asides started, so it still counts as spending.'}
              {day >= linked.startDate && !billPart && Math.abs(paidAmount - linked.amount) > 0.5 && ` The bill counts the ${money(paidAmount)} you paid, not ${money(linked.amount)}.`}
            </span>
            <button className="shrink-0 text-[14px] font-semibold text-ink-2 hover:text-ink" onClick={() => (setBillId(undefined), setBillPart(false))}>
              Not a bill
            </button>
          </div>
          {short && linked.payFrom !== 'both' && (
            <label className="mt-2 flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
              <span className="text-[14px]">
                Only part of {linked.name}
                <span className="block text-[13px] text-ink-2">The rest comes in another payment, like from your next paycheck.</span>
              </span>
              <Toggle checked={billPart} onChange={setBillPart} label={`Only part of ${linked.name}`} />
            </label>
          )}
        </>
      ) : linkedGoal ? (
        <div className="flex items-center gap-3 rounded-2xl bg-raised px-4 py-3">
          <Gift size={18} className="shrink-0 text-ink-2" />
          <span className="min-w-0 flex-1 text-[14px]">
            Bought from your <b className="font-semibold">{linkedGoal.name}</b> savings, so it isn’t spending today.
          </span>
          <button className="shrink-0 text-[14px] font-semibold text-ink-2 hover:text-ink" onClick={() => setGoalId(undefined)}>
            Unlink
          </button>
        </div>
      ) : (
        <>
          {likely.map((b) => (
            <button
              key={b.id}
              onClick={() => pickBill(b.id)}
              className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-line bg-raised px-4 py-3 text-left transition-colors hover:bg-hover"
            >
              <PiggyBank size={18} className="shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1 text-[14px]">
                Looks like your <b className="font-semibold">{b.name}</b> bill
              </span>
              <span className="shrink-0 text-[14px] font-semibold">Yes, it is</span>
            </button>
          ))}
          <div className="flex flex-wrap gap-2">
            {bills
              .filter((b) => !likely.includes(b))
              .map((b) => (
                <button key={b.id} onClick={() => pickBill(b.id)} className={chip}>
                  <PiggyBank size={15} /> {b.name}
                </button>
              ))}
            {goals.map((g) => (
              <button key={g.id} onClick={() => (setGoalId(g.id), setBillId(undefined))} className={chip}>
                <Gift size={15} /> {g.name}
              </button>
            ))}
            {!existing && !bills.length && <p className="text-[13px] text-ink-3">Save it first, then you can turn it into a bill.</p>}
          </div>
          {existing && (
            <button
              onClick={() => useSheets.getState().replace({ kind: 'bill', fromTx: existing.id })}
              className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left transition-colors hover:bg-hover"
            >
              <Plus size={18} className="shrink-0 text-ink-2" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">Make it a bill</span>
                <span className="block text-[13px] text-ink-2">Repeats on {monthDay(existing.date)} every month, starting with this one.</span>
              </span>
            </button>
          )}
          {bills.length > 0 && <p className="mt-1.5 text-[13px] text-ink-3">A bill payment is covered by the bill’s set-aside, so it doesn’t count as spending.</p>}
        </>
      )}
    </div>
  );

  const teachBox = offerTeach && teachKey && (
    <label className="flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
      <span className="text-[14px]">
        {billChanged && teachBill ? `Remember this for ${placeLabel}` : `Do the same for every ${placeLabel}`}
        <span className="block text-[13px] text-ink-2">
          {billChanged && teachBill
            ? `${others > 0 ? `${plural(others, 'more')} now, and new` : 'New'} ones from the bank count as ${teachBill.name}.`
            : others > 0
              ? `${plural(others, 'more')} now, and new ones from the bank.`
              : 'New ones from the bank too.'}
        </span>
      </span>
      <Toggle checked={teach} onChange={setTeach} label={billChanged && teachBill ? `Remember this for ${placeLabel}` : `Do the same for every ${placeLabel}`} />
    </label>
  );
  // A bill link is the first question for a bank transaction, so its "remember" switch sits right under it.
  const teachUp = fromBank && billChanged;

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
          {existing && fromBank && (
            <button className="btn btn-secondary" onClick={() => setHidden(!existing.hidden)}>
              {existing.hidden ? <Eye size={17} /> : <EyeOff size={17} />} {existing.hidden ? 'Unhide' : 'Hide'}
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
            {existing.hidden && <p className="mt-2 text-[13px] font-medium text-ink-2">Hidden: it doesn’t show or count.</p>}
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

        {dup && other && (
          <div className="rounded-3xl border border-line p-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <CopyCheck size={17} className="shrink-0 text-ink-2" /> Same purchase twice?
            </p>
            <p className="mt-1 text-[14px] text-ink-2">
              {other.source === 'plaid' ? 'The bank sent' : 'You added'} <b className="font-semibold text-ink">{other.merchant || 'an expense'}</b> for {money(Math.abs(other.amount))}{' '}
              {dayLabel(other.date)}. Merging keeps one: the bank’s amount, with your name, category, and note.
            </p>
            {dup.manual.merchant.trim() && normName(dup.manual.merchant) !== normName(bankNameOf(dup.bank)) && (
              <label className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
                <span className="text-[14px]">
                  Call every {bankNameOf(dup.bank)} “{dup.manual.merchant.trim()}”
                </span>
                <Toggle checked={mergeName} onChange={setMergeName} label={`Call every ${bankNameOf(dup.bank)} ${dup.manual.merchant.trim()}`} />
              </label>
            )}
            <div className="mt-3 flex gap-2">
              <button className="btn btn-sm btn-primary" onClick={merge}>
                Merge them
              </button>
              <button className="btn btn-sm btn-secondary" onClick={notSame}>
                They’re different
              </button>
            </div>
          </div>
        )}

        {fromBank && billBlock}
        {teachUp && teachBox}

        <Field label={fromBank ? 'Name' : 'Where'} hint={fromBank && name !== bankName ? `The bank calls it ${bankName}.` : undefined}>
          <input className="input" list="merchant-list" placeholder={fromBank ? bankName : 'Chipotle'} value={merchant} onChange={(e) => onMerchant(e.target.value)} />
          <datalist id="merchant-list">
            {suggestions.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
        </Field>

        <div>
          <span className="label">Category</span>
          <CategoryPicker value={categoryId} onChange={setCategoryId} />
        </div>

        {!fromBank && billBlock}
        {!teachUp && teachBox}

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
        {/* A bill payment or wish-list buy is already left out of spending. */}
        {!linked && !linkedGoal && (
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
            <span>
              <span className="block text-[15px] font-medium">Count as spending</span>
              <span className="block text-[13px] text-ink-2">
                {existing && !counted ? (notCountedReason({ ...existing, billId, goalId }, cover) ?? 'Left out of spending') : 'Turn off for transfers between your own accounts.'}
              </span>
            </span>
            <Toggle checked={counted} onChange={setCounted} label="Count as spending" />
          </div>
        )}
        {existing && fromBank && existing.amount < 0 && existing.flow === 'income' && (
          <p className="text-[13px] text-ink-2">
            Deposits like paychecks aren't counted: that money already showed up hour by hour. This one was {money(-existing.amount)}.
          </p>
        )}
      </div>
    </Sheet>
  );
}
