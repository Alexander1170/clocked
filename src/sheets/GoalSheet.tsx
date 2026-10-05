import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, Gift, Package, Plus, Trash, X } from 'lucide-react';
import type { Goal, WishItem } from '../../shared/types.ts';
import { earningDays } from '../../shared/bills.ts';
import { goalStatus } from '../../shared/plan.ts';
import { addDays, toLocalDate } from '../../shared/dates.ts';
import { useData } from '../lib/store.ts';
import { useEngineData, useSettings, useTransactions } from '../lib/hooks.ts';
import { newId } from '../lib/ids.ts';
import { dayLabel, money } from '../lib/format.ts';
import { closeSheet, toast } from '../lib/ui.ts';
import { Field, MoneyInput, parseMoney, Sheet, Toggle } from '../components/ui.tsx';

interface Draft {
  id: string;
  name: string;
  price: string;
  url: string;
  note: string;
  addedOn: string;
  boughtOn?: string;
}

const toDraft = (i: WishItem): Draft => ({ id: i.id, name: i.name, price: String(i.price || ''), url: i.url ?? '', note: i.note ?? '', addedOn: i.addedOn, boughtOn: i.boughtOn });
const blank = (today: string): Draft => ({ id: newId(), name: '', price: '', url: '', note: '', addedOn: today });
const safeUrl = (u: string) => {
  const t = u.trim();
  if (!t) return undefined;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
};

function LinkButton({ url }: { url: string }) {
  const href = safeUrl(url);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label="Open link" className="grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-ink-2 hover:text-ink">
      <ExternalLink size={17} />
    </a>
  );
}

/** A wish-list item, or a project with several items, saved up for by a date. */
export function GoalSheet({ id, type }: { id?: string; type?: 'item' | 'project' }) {
  const existing = useData((s) => (id ? s.t.goals[id] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const txs = useTransactions();
  const data = useEngineData();
  const { billSpread } = useSettings();
  const today = toLocalDate(Date.now());
  const kind = existing?.kind ?? type ?? 'item';
  const unit = billSpread === 'everyday' ? 'day' : 'workday';

  const [name, setName] = useState(existing?.name ?? '');
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? addDays(today, 30));
  const [note, setNote] = useState(existing?.note ?? '');
  const [items, setItems] = useState<Draft[]>(() => (existing?.items.length ? existing.items.map(toDraft) : kind === 'item' ? [blank(today)] : [blank(today)]));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const working = useMemo(() => earningDays(data, addDays(today, -400), addDays(today, 400)), [data, today]);
  const isEarningDay = (d: string) => billSpread === 'everyday' || working.has(d);

  const setItem = (itemId: string, patch: Partial<Draft>) => setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...patch } : i)));
  const toItems = (): WishItem[] =>
    items
      .filter((i) => i.name.trim() || parseMoney(i.price) > 0)
      .map((i) => ({
        id: i.id,
        name: (kind === 'item' ? name : i.name).trim() || name.trim(),
        price: parseMoney(i.price) || 0,
        url: safeUrl(i.url),
        note: i.note.trim() || undefined,
        addedOn: i.addedOn,
        boughtOn: i.boughtOn,
      }));
  const draft: Goal = { id: id ?? 'draft', updatedAt: 0, kind, name, targetDate, items: toItems() };
  const st = goalStatus(draft, today, isEarningDay);

  const save = () => {
    if (!name.trim()) return setError(kind === 'item' ? 'What do you want?' : 'Name the project.');
    const list = toItems();
    if (!list.length || list.some((i) => !(i.price > 0))) return setError('Every item needs a price.');
    put('goals', { ...(existing ?? {}), ...draft, id: existing?.id ?? newId(), name: name.trim(), items: list, note: note.trim() || undefined });
    toast({ title: `${name.trim()} ${existing ? 'saved' : 'added'}`, detail: st.perDay > 0 ? `${money(st.perDay)} a ${unit} until ${dayLabel(targetDate)}` : undefined });
    closeSheet();
  };

  const destroy = () => {
    if (!existing) return;
    if (!confirmDelete) return setConfirmDelete(true);
    for (const t of txs) if (t.goalId === existing.id) put('transactions', { ...t, goalId: undefined });
    remove('goals', existing.id);
    toast({ title: `${existing.name} deleted` });
    closeSheet();
  };

  const single = items[0];

  return (
    <Sheet
      wide={kind === 'project'}
      title={existing ? `Edit ${existing.name}` : kind === 'item' ? 'Add to wish list' : 'Start a project'}
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
        <div className="flex items-center gap-3 rounded-2xl bg-raised p-3.5 text-[14px] text-ink-2">
          {kind === 'item' ? <Gift size={20} className="shrink-0" /> : <Package size={20} className="shrink-0" />}
          {kind === 'item'
            ? 'The price is split across your days until you want it.'
            : 'Each item is split across the days from when you add it until the project date.'}
        </div>

        <Field label={kind === 'item' ? 'What you want' : 'Project name'}>
          <input className="input" value={name} onChange={(e) => (setName(e.target.value), setError(''))} placeholder={kind === 'item' ? 'Noise-canceling headphones' : 'Desk setup'} autoFocus={!existing} />
        </Field>

        {kind === 'item' && single && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Price">
                <MoneyInput value={single.price} onChange={(v) => (setItem(single.id, { price: v }), setError(''))} placeholder="199.99" ariaLabel="Price" />
              </Field>
              <Field label="Want it by">
                <input className="input" type="date" value={targetDate} onChange={(e) => e.target.value && setTargetDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Link (optional)">
              <div className="flex gap-2">
                <input className="input" type="url" inputMode="url" value={single.url} onChange={(e) => setItem(single.id, { url: e.target.value })} placeholder="https://store.com/item" />
                <LinkButton url={single.url} />
              </div>
            </Field>
            <Field label="Notes (optional)">
              <input className="input" value={single.note} onChange={(e) => setItem(single.id, { note: e.target.value })} placeholder="Color, size, model" />
            </Field>
            {existing && (
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-3">
                <span>
                  <span className="block text-[15px] font-medium">Bought it</span>
                  <span className="block text-[13px] text-ink-2">{single.boughtOn ? `On ${dayLabel(single.boughtOn)}.` : 'Then link the purchase from your transactions.'}</span>
                </span>
                <Toggle checked={!!single.boughtOn} onChange={(v) => setItem(single.id, { boughtOn: v ? today : undefined })} label="Bought it" />
              </div>
            )}
          </>
        )}

        {kind === 'project' && (
          <>
            <Field label="Want it all by">
              <input className="input" type="date" value={targetDate} onChange={(e) => e.target.value && setTargetDate(e.target.value)} />
            </Field>
            <div>
              <span className="label">Items</span>
              <div className="space-y-3">
                {items.map((i, n) => (
                  <div key={i.id} className={clsx('rounded-2xl border border-line p-3', i.boughtOn && 'opacity-70')}>
                    <div className="flex gap-2">
                      <input aria-label={`Item ${n + 1}`} className="input h-11 min-w-0 flex-1" value={i.name} onChange={(e) => setItem(i.id, { name: e.target.value })} placeholder="Monitor arm" />
                      <div className="w-32 shrink-0">
                        <MoneyInput value={i.price} onChange={(v) => (setItem(i.id, { price: v }), setError(''))} placeholder="0.00" ariaLabel={`Price of item ${n + 1}`} />
                      </div>
                      <button
                        aria-label="Remove item"
                        onClick={() => setItems((list) => list.filter((x) => x.id !== i.id))}
                        className="grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-ink-2 hover:text-ink"
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input className="input h-10 min-w-0 flex-1 text-[14px]" type="url" inputMode="url" value={i.url} onChange={(e) => setItem(i.id, { url: e.target.value })} placeholder="Link (optional)" />
                      <LinkButton url={i.url} />
                      <label className="flex shrink-0 items-center gap-2 text-[13px] text-ink-2">
                        Bought
                        <Toggle checked={!!i.boughtOn} onChange={(v) => setItem(i.id, { boughtOn: v ? today : undefined })} label={`Bought ${i.name || 'item'}`} />
                      </label>
                    </div>
                    {i.addedOn !== today && <p className="mt-1.5 text-[12px] text-ink-3">Added {dayLabel(i.addedOn)}</p>}
                  </div>
                ))}
              </div>
              <button className="btn btn-secondary mt-3 w-full" onClick={() => setItems((list) => [...list, blank(today)])}>
                <Plus size={17} /> Add item
              </button>
            </div>
            <Field label="Notes (optional)">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it's for" />
            </Field>
          </>
        )}

        {st.total > 0 && (
          <div className="rounded-3xl border border-line p-4">
            <p className="num text-[24px] font-bold tracking-tight">
              {money(st.perDay)}
              <span className="text-[15px] font-semibold text-ink-2"> a {unit}</span>
            </p>
            <p className="num mt-1 text-[14px] text-ink-2">
              {money(st.total)} by {dayLabel(targetDate)}
              {st.saved > 0 && ` · ${money(st.saved)} set aside so far`}. Link the purchase when you buy it so it doesn't count as spending that day.
            </p>
          </div>
        )}
        {error && <p className="text-[14px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}
