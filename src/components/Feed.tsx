import clsx from 'clsx';
import { Bike, Coins } from 'lucide-react';
import type { FeedItem } from '../lib/feed.ts';
import { categoryIcon } from '../lib/categories.ts';
import { slotColor } from '../lib/colors.ts';
import { minus, signed } from '../lib/format.ts';
import { openSheet } from '../lib/ui.ts';

function ItemIcon({ item }: { item: FeedItem }) {
  if (item.kind === 'expense' || item.kind === 'refund') {
    const Icon = categoryIcon(item.icon);
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-ink-2">
        <Icon size={18} />
      </span>
    );
  }
  const Icon = item.kind === 'order' || item.kind === 'gig' ? Bike : Coins;
  const color = item.color ? slotColor(item.color) : 'var(--c-money)';
  return (
    <span className="relative grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}>
      <Icon size={18} style={{ color }} />
      {item.kind === 'accruing' && <span className="live-dot absolute -top-0.5 -right-0.5 ring-2 ring-card" />}
    </span>
  );
}

export function FeedList({ items, limit }: { items: FeedItem[]; limit?: number }) {
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="divide-y divide-line">
      {shown.map((item) => {
        const out = item.amount < 0;
        return (
          <li key={item.key}>
            <button
              onClick={() => item.open && openSheet(item.open)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
            >
              <ItemIcon item={item} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{item.title}</span>
                <span className="block truncate text-[13px] text-ink-2">{item.sub}</span>
              </span>
              <span className={clsx('num shrink-0 text-[15px] font-semibold', item.muted ? 'text-ink-3' : out ? 'text-ink' : 'text-money')}>
                {out ? minus(item.amount) : signed(item.amount)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
