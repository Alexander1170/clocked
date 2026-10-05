import { useState } from 'react';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import type { Category } from '../../shared/types.ts';
import { useData } from '../lib/store.ts';
import { useCategories } from '../lib/hooks.ts';
import { CATEGORY_ICONS, categoryIcon, findCategory, guessIcon, nextCustomSort } from '../lib/categories.ts';
import { newId } from '../lib/ids.ts';
import { toast } from '../lib/ui.ts';

/** Every icon a category can use. */
export function IconGrid({ value, onChange }: { value: string; onChange(icon: string): void }) {
  return (
    <div role="group" aria-label="Icon" className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))] gap-1.5">
      {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
        <button
          key={key}
          type="button"
          aria-label={key}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={clsx(
            'grid aspect-square place-items-center rounded-xl transition-colors',
            value === key ? 'bg-ink text-inverse' : 'text-ink-2 hover:bg-hover hover:text-ink',
          )}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}

/**
 * Category chips with a "New" chip at the end that adds one in place, so a
 * missing category never means leaving the expense you're filling in.
 */
export function CategoryPicker({ value, onChange }: { value: string; onChange(id: string): void }) {
  const cats = useCategories();
  const put = useData((s) => s.put);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  // Until you pick an icon yourself, it follows the name.
  const [icon, setIcon] = useState<string | null>(null);
  const shownIcon = icon ?? guessIcon(name) ?? 'other';
  const Preview = categoryIcon(shownIcon);

  const reset = () => {
    setAdding(false);
    setName('');
    setIcon(null);
  };

  const add = () => {
    if (!name.trim()) return;
    const had = findCategory(cats, name);
    const cat: Category = had ?? put('categories', { id: newId(), updatedAt: 0, name: name.trim().replace(/\s+/g, ' '), icon: shownIcon, sort: nextCustomSort(cats) });
    onChange(cat.id);
    toast(had ? { title: `You already have ${had.name}`, detail: 'Picked it for you.' } : { title: `Added ${cat.name}` });
    reset();
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {cats.map((c) => {
          const Icon = categoryIcon(c.icon);
          const on = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
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
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-ink-3/60 px-3 text-[14px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            <Plus size={15} /> New
          </button>
        )}
      </div>
      {adding && (
        <div className="mt-3 rounded-2xl border border-line p-3">
          <div className="flex items-center gap-2">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-ink">
              <Preview size={19} />
            </span>
            <input
              className="input h-11 min-w-0 flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                } else if (e.key === 'Escape') {
                  // Close just this form, not the whole sheet.
                  e.stopPropagation();
                  reset();
                }
              }}
              placeholder="New category name"
              aria-label="New category name"
              maxLength={40}
              autoFocus
            />
          </div>
          <span className="label mt-3">Icon</span>
          <IconGrid value={shownIcon} onChange={setIcon} />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn btn-sm btn-secondary" onClick={reset}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={add} disabled={!name.trim()}>
              Add category
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
