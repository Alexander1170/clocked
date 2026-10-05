import { useMemo } from 'react';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { useCategories, useCategoryOf, useTransactions } from '../lib/hooks.ts';
import { categoryIcon } from '../lib/categories.ts';
import { go, openSheet } from '../lib/ui.ts';
import { Card } from '../components/ui.tsx';

export function Categories() {
  const cats = useCategories();
  const txs = useTransactions();
  const catOf = useCategoryOf();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of txs) m.set(catOf(t.categoryId), (m.get(catOf(t.categoryId)) ?? 0) + 1);
    return m;
  }, [txs, catOf]);

  return (
    <div className="max-w-2xl">
      <header className="flex items-center gap-3 py-2">
        <button onClick={() => go('settings')} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
          <ArrowLeft size={19} />
        </button>
        <h1 className="min-w-0 flex-1 text-[28px] font-bold tracking-tight lg:text-[32px]">Categories</h1>
        <button className="btn btn-sm btn-primary" onClick={() => openSheet({ kind: 'category' })}>
          <Plus size={16} /> New
        </button>
      </header>
      <p className="mt-1 text-[15px] text-ink-2">Tap one to rename it, change its icon, or delete it. The number is how many transactions use it. You can also add one while tagging an expense or bill.</p>

      <Card className="mt-5 divide-y divide-line overflow-hidden">
        {cats.map((c) => {
          const Icon = categoryIcon(c.icon);
          const n = counts.get(c.id) ?? 0;
          return (
            <button
              key={c.id}
              onClick={() => openSheet({ kind: 'category', id: c.id })}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-ink-2">
                <Icon size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.name}</span>
              {n > 0 && <span className="num shrink-0 text-[13px] text-ink-3">{n}</span>}
              <ChevronRight size={18} className="shrink-0 text-ink-3" />
            </button>
          );
        })}
      </Card>
    </div>
  );
}
