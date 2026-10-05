import { useState } from 'react';
import { Trash } from 'lucide-react';
import { useData } from '../lib/store.ts';
import { useBills, useCategories, useRules, useTransactions } from '../lib/hooks.ts';
import { categoryIcon, FALLBACK_CATEGORY, findCategory, guessIcon, nextCustomSort } from '../lib/categories.ts';
import { newId } from '../lib/ids.ts';
import { closeSheet, toast } from '../lib/ui.ts';
import { Field, Sheet } from '../components/ui.tsx';
import { IconGrid } from '../components/CategoryPicker.tsx';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CategorySheet({ id }: { id?: string }) {
  const existing = useData((s) => (id ? s.t.categories[id] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const cats = useCategories();
  const txs = useTransactions();
  const bills = useBills();
  const rules = useRules();

  const [name, setName] = useState(existing?.name ?? '');
  // A new category's icon follows its name until you pick one.
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const shownIcon = icon ?? guessIcon(name) ?? 'other';
  const Preview = categoryIcon(shownIcon);

  const usedBy = existing ? txs.filter((t) => t.categoryId === existing.id) : [];
  const billsUsing = existing ? bills.filter((b) => b.categoryId === existing.id) : [];
  const canDelete = !!existing && existing.id !== FALLBACK_CATEGORY;
  const moving = [usedBy.length && plural(usedBy.length, 'transaction', 'transactions'), billsUsing.length && plural(billsUsing.length, 'bill', 'bills')].filter(Boolean).join(' and ');

  const save = () => {
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return setError('Give it a name.');
    const dup = findCategory(
      cats.filter((c) => c.id !== existing?.id),
      clean,
    );
    if (dup) return setError(`You already have ${dup.name}.`);
    if (existing) put('categories', { ...existing, name: clean, icon: shownIcon });
    else put('categories', { id: newId(), updatedAt: 0, name: clean, icon: shownIcon, sort: nextCustomSort(cats) });
    toast({ title: existing ? `${clean} saved` : `Added ${clean}` });
    closeSheet();
  };

  const destroy = () => {
    if (!existing || !canDelete) return;
    if (!confirmDelete) return setConfirmDelete(true);
    for (const t of usedBy) put('transactions', { ...t, categoryId: FALLBACK_CATEGORY });
    for (const b of billsUsing) put('bills', { ...b, categoryId: FALLBACK_CATEGORY });
    // A merchant rule pointing here would keep filing new purchases under a category that's gone.
    for (const r of rules) if (r.categoryId === existing.id) remove('rules', r.id);
    remove('categories', existing.id);
    toast({ title: `${existing.name} deleted`, detail: moving ? `${moving} moved to Other.` : undefined });
    closeSheet();
  };

  return (
    <Sheet
      title={existing ? `Edit ${existing.name}` : 'New category'}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          {canDelete && (
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
          <div className="flex items-center gap-2">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-raised text-ink">
              <Preview size={20} />
            </span>
            <input
              className="input min-w-0 flex-1"
              value={name}
              onChange={(e) => (setName(e.target.value), setError(''))}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="Coffee"
              maxLength={40}
              autoFocus={!existing}
            />
          </div>
        </Field>
        <div>
          <span className="label">Icon</span>
          <IconGrid value={shownIcon} onChange={setIcon} />
        </div>
        {existing && (
          <p className="text-[14px] text-ink-2">
            {usedBy.length || billsUsing.length ? `Used by ${moving}.` : 'Nothing uses this category yet.'}
            {confirmDelete && moving && ' Deleting it moves them to Other.'}
          </p>
        )}
        {error && <p className="text-[14px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}
