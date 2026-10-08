import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Rule } from '../../shared/types.ts';
import { bankNameOf, normName, ruleCovers } from '../../shared/rules.ts';
import { useBillMap, useBills, useRules, useSettings, useTransactions } from '../lib/hooks.ts';
import { groupPlaces, placeRuleId, teachable } from '../lib/places.ts';
import { forgetRule, teachRule } from '../lib/teach.ts';
import { dayLabel, minus, money, monthDay, signed } from '../lib/format.ts';
import { closeSheet, openSheet, toast, useSheets } from '../lib/ui.ts';
import { Chip, Field, Sheet, Toggle } from '../components/ui.tsx';
import { CategoryPicker } from '../components/CategoryPicker.tsx';

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Teach Clocked about one place: what to call it, how to file it, whether it pays a bill, or to hide it. */
export function PlaceSheet({ placeKey }: { placeKey: string }) {
  const txs = useTransactions();
  const rules = useRules();
  const bills = useBills();
  const billMap = useBillMap();
  const { trackFrom } = useSettings();
  const place = useMemo(() => groupPlaces(txs, rules, trackFrom).find((p) => p.key === placeKey), [txs, rules, trackFrom, placeKey]);
  const rule = place?.rule;

  const [name, setName] = useState(rule?.rename ?? place?.name ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? place?.categoryId ?? '');
  const [billId, setBillId] = useState<string | undefined>(rule?.billId);
  const [hide, setHide] = useState(!!rule?.hide);
  const [match, setMatch] = useState(rule?.match ?? place?.bankName ?? '');
  const covers = useMemo(() => (normName(match) ? txs.filter((t) => teachable(t, trackFrom) && ruleCovers({ match }, bankNameOf(t))).length : 0), [txs, trackFrom, match]);

  if (!place) {
    return (
      <Sheet title="Nothing here" onClose={closeSheet}>
        <p className="text-[15px] text-ink-2">There aren’t any bank transactions from this place anymore.</p>
      </Sheet>
    );
  }

  const moneyOut = place.txs.some((t) => t.amount > 0);
  // The newest payment, for making this place a bill that repeats on its date.
  const latest = place.txs.find((t) => t.amount > 0);
  const save = () => {
    const key = normName(match) || place.key;
    const rename = name.trim() && normName(name) !== normName(place.bankName) ? name.trim() : undefined;
    const next: Omit<Rule, 'updatedAt'> = {
      ...(rule ?? {}),
      id: rule?.id ?? placeRuleId(key),
      match: key,
      rename,
      categoryId: categoryId || undefined,
      hide: hide || undefined,
      billId: moneyOut ? billId : undefined,
    };
    const n = teachRule(next);
    toast({ title: `Saved ${rename ?? place.bankName}`, detail: n ? `${plural(n, 'transaction')} updated. New ones will follow it.` : 'New ones from the bank will follow it.' });
    closeSheet();
  };
  const forget = () => {
    if (!rule) return;
    const n = forgetRule(rule.id);
    toast({ title: `Forgot ${rule.rename ?? place.bankName}`, detail: n ? `${plural(n, 'transaction')} back to what the bank sent` : undefined });
    closeSheet();
  };

  return (
    <Sheet
      title={place.bankName}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          {rule && (
            <button className="btn btn-secondary" onClick={forget}>
              Forget
            </button>
          )}
          <button className="btn btn-primary flex-1" onClick={save}>
            Save for all of them
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="num text-[14px] text-ink-2">
          {plural(place.txs.length, 'transaction')} · {money(place.total)}
          {trackFrom ? ` since ${dayLabel(trackFrom)}` : ''}. What you set here goes for all of them, and new ones from the bank.
        </p>

        <Field label="Call it" hint="What these show as everywhere in the app.">
          <input className="input" value={name} placeholder={place.bankName} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div>
          <span className="label">Category</span>
          <CategoryPicker value={categoryId} onChange={setCategoryId} />
        </div>

        {moneyOut && (
          <div>
            <span className="label">They pay a bill</span>
            <div className={bills.length ? 'flex flex-wrap gap-2' : 'hidden'}>
              <Chip on={!billId} onClick={() => setBillId(undefined)}>
                No
              </Chip>
              {bills.map((b) => (
                <Chip key={b.id} on={billId === b.id} onClick={() => setBillId(b.id)}>
                  {b.name}
                </Chip>
              ))}
            </div>
            {bills.length > 0 && (
              <p className="mt-1.5 text-[13px] text-ink-3">
                Every payment from here counts toward the bill, whatever the amount, so it isn’t spending. Handy for a bill you split between paychecks.
              </p>
            )}
            {latest && !billId && (
              <button
                onClick={() => useSheets.getState().replace({ kind: 'bill', fromTx: latest.id })}
                className="mt-2 flex w-full items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-left transition-colors hover:bg-hover"
              >
                <Plus size={18} className="shrink-0 text-ink-2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">Make it a bill</span>
                  <span className="block text-[13px] text-ink-2">
                    {money(latest.amount)}, repeating on {monthDay(latest.date)} every month, starting with the one {dayLabel(latest.date)}.
                  </span>
                </span>
              </button>
            )}
          </div>
        )}

        <label className="flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
          <span>
            <span className="block text-[15px] font-medium">Hide them</span>
            <span className="block text-[13px] text-ink-2">They won’t show or count, now or later.</span>
          </span>
          <Toggle checked={hide} onChange={setHide} label="Hide them" />
        </label>

        <Field label="Bank name starts with" hint={`Covers ${plural(covers, 'transaction')}. Shorten it to catch the same place under longer names, like every ATM location.`}>
          <input className="input" value={match} onChange={(e) => setMatch(e.target.value)} />
        </Field>

        <div>
          <span className="label">Latest</span>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {place.txs.slice(0, 8).map((t) => {
              const bill = t.billId ? billMap[t.billId] : undefined;
              return (
                <button
                  key={t.id}
                  onClick={() => openSheet({ kind: 'expense', id: t.id })}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[14px] transition-colors hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {dayLabel(t.date)}
                    <span className="text-ink-2">
                      {bankNameOf(t) !== place.bankName && ` · ${bankNameOf(t)}`}
                      {bill && !bill.deleted && ` · ${bill.name}${t.billPart ? ' (part)' : ''}`}
                      {t.hidden && ' · Hidden'}
                    </span>
                  </span>
                  <span className="num shrink-0 font-semibold">{t.amount < 0 ? signed(-t.amount) : minus(t.amount)}</span>
                </button>
              );
            })}
          </div>
          {place.txs.length > 8 && <p className="mt-1.5 text-[13px] text-ink-3">And {plural(place.txs.length - 8, 'more')}.</p>}
        </div>
      </div>
    </Sheet>
  );
}
