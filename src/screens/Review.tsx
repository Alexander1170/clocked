import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeft, ChevronRight, CopyCheck, Search, Store } from 'lucide-react';
import { toLocalDate } from '../../shared/dates.ts';
import { bankNameOf, normName } from '../../shared/rules.ts';
import { useBillMap, useCategoryMap, useJobMap, useRules, useSettings, useTransactions } from '../lib/hooks.ts';
import { useData } from '../lib/store.ts';
import { categoryIcon } from '../lib/categories.ts';
import { dayLabel, minus, money, signed } from '../lib/format.ts';
import { findDuplicates, type Duplicate } from '../lib/money.ts';
import { groupPlaces, teachable, type Place } from '../lib/places.ts';
import { markDifferent, mergePair } from '../lib/teach.ts';
import { go, openSheet, toast } from '../lib/ui.ts';
import { Card, EmptyState, Segmented, SectionTitle, Toggle } from '../components/ui.tsx';

type View = 'places' | 'hidden';
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A purchase you added by hand next to the bank's copy, to merge or keep apart. */
function DuplicateRow({ d }: { d: Duplicate }) {
  const bank = bankNameOf(d.bank);
  const yours = d.manual.merchant.trim();
  const canRename = !!yours && normName(yours) !== normName(bank);
  const [renameAll, setRenameAll] = useState(false);
  const side = (label: string, name: string, amount: number, date: string) => (
    <div className="min-w-0">
      <p className="text-[12px] font-medium text-ink-3">{label}</p>
      <p className="truncate text-[15px] font-medium">{name || 'Expense'}</p>
      <p className="num text-[13px] text-ink-2">
        {minus(amount)} · {dayLabel(date)}
      </p>
    </div>
  );
  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        {side('You added', yours, d.manual.amount, d.manual.date)}
        {side('The bank sent', d.bank.merchant, d.bank.amount, d.bank.date)}
      </div>
      {canRename && (
        <label className="mt-3 flex items-center justify-between gap-4 rounded-2xl bg-raised px-4 py-2.5">
          <span className="text-[14px]">
            Always call {bank} “{yours}”
          </span>
          <Toggle checked={renameAll} onChange={setRenameAll} label={`Always call ${bank} ${yours}`} />
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            const { merged, more } = mergePair(d, renameAll);
            toast({ title: 'Merged', detail: more ? `And ${plural(more, 'more')} from ${bank} renamed` : `Kept the bank’s copy as ${merged.merchant}` });
          }}
        >
          Same thing, merge
        </button>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => {
            markDifferent(d);
            toast({ title: 'Got it, they’re different' });
          }}
        >
          They’re different
        </button>
      </div>
    </div>
  );
}

function PlaceRow({ p }: { p: Place }) {
  const cats = useCategoryMap();
  const bills = useBillMap();
  const jobs = useJobMap();
  const cat = cats[p.categoryId];
  const Icon = categoryIcon(cat?.icon);
  const billIds = new Set(p.txs.map((t) => t.billId));
  const bill = billIds.size === 1 && p.txs[0].billId ? bills[p.txs[0].billId] : undefined;
  const jobIds = new Set(p.txs.map((t) => t.jobId));
  const job = jobIds.size === 1 && p.txs[0].jobId ? jobs[p.txs[0].jobId] : undefined;
  const sub = [p.name !== p.bankName ? p.bankName : null, job ? `pay from ${job.name}` : (cat?.name ?? 'Other'), bill && !bill.deleted ? `pays ${bill.name}` : null, plural(p.txs.length, 'time')]
    .filter(Boolean)
    .join(' · ');
  return (
    <button onClick={() => openSheet({ kind: 'place', key: p.key })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-ink-2">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{p.name}</span>
        <span className="block truncate text-[13px] text-ink-2">{sub}</span>
      </span>
      <span className={clsx('num shrink-0 text-[15px] font-semibold', p.total < 0 && 'text-money')}>{p.total < 0 ? signed(-p.total) : money(p.total)}</span>
      <ChevronRight size={18} className="shrink-0 text-ink-3" />
    </button>
  );
}

/** Every place your bank transactions come from, to rename, file, hide, or tie to a bill. */
export function Review() {
  const settings = useSettings();
  const put = useData((s) => s.put);
  const txs = useTransactions();
  const rules = useRules();
  const [view, setView] = useState<View>('places');
  const [query, setQuery] = useState('');
  const today = toLocalDate(Date.now());

  const places = useMemo(() => groupPlaces(txs, rules, settings.trackFrom), [txs, rules, settings.trackFrom]);
  const dups = useMemo(() => findDuplicates(txs, settings.trackFrom), [txs, settings.trackFrom]);
  const allHidden = (p: Place) => p.hidden || p.txs.every((t) => t.hidden);
  const hiddenPlaces = places.filter(allHidden);
  // Ones you hid one at a time, from places that still show.
  const hiddenOnes = useMemo(
    () => txs.filter((t) => t.hidden && teachable(t, settings.trackFrom) && !hiddenPlaces.some((p) => p.txs.includes(t))).sort((a, b) => b.date.localeCompare(a.date)),
    [txs, settings.trackFrom, hiddenPlaces],
  );
  const q = normName(query);
  const list = (view === 'hidden' ? hiddenPlaces : places.filter((p) => !allHidden(p))).filter(
    (p) => !q || normName(p.name).includes(q) || normName(p.bankName).includes(q),
  );
  const hiddenCount = hiddenPlaces.length + hiddenOnes.length;

  return (
    <div className="max-w-2xl">
      <header className="flex items-center gap-3 py-2">
        <button onClick={() => go('spending')} aria-label="Back" className="grid size-10 place-items-center rounded-full bg-card text-ink-2 hover:text-ink">
          <ArrowLeft size={19} />
        </button>
        <h1 className="min-w-0 flex-1 text-[28px] font-bold tracking-tight lg:text-[32px]">Bank transactions</h1>
      </header>
      <p className="mt-1 text-[15px] text-ink-2">
        Teach Clocked what your bank transactions are. Tap a place to rename it, file it, hide it, or say it pays a bill. It remembers, for these and every new one.
      </p>

      <Card className="mt-5 p-4">
        <label className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Count bank transactions from</span>
            <span className="block text-[13px] text-ink-2">
              {settings.trackFrom ? `Ones before ${dayLabel(settings.trackFrom)} are hidden and don’t count.` : 'Counting everything the bank sent. Pick the day you started.'}
            </span>
          </span>
          <input
            type="date"
            className="input w-44"
            value={settings.trackFrom ?? ''}
            max={today}
            onChange={(e) => {
              put('settings', { ...settings, trackFrom: e.target.value || undefined });
              toast({ title: e.target.value ? `Counting from ${dayLabel(e.target.value)}` : 'Counting everything' });
            }}
          />
        </label>
      </Card>

      {dups.length > 0 && (
        <>
          <SectionTitle>Same purchase twice?</SectionTitle>
          <p className="-mt-1 mb-3 text-[14px] text-ink-2">These came from the bank and you also added them by hand. Merging keeps one, with your name and category.</p>
          <Card className="divide-y divide-line overflow-hidden">
            {dups.map((d) => (
              <DuplicateRow key={`${d.manual.id}|${d.bank.id}`} d={d} />
            ))}
          </Card>
        </>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Segmented<View>
          label="Show"
          value={view}
          onChange={setView}
          className="sm:w-72"
          options={[
            { value: 'places', label: 'Places' },
            { value: 'hidden', label: `Hidden${hiddenCount ? ` (${hiddenCount})` : ''}` },
          ]}
        />
        <label className="relative min-w-0 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3" />
          <input className="input pl-10" placeholder="Find a place" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a place" />
        </label>
      </div>

      <Card className="mt-3 divide-y divide-line overflow-hidden">
        {list.length === 0 && (view === 'places' || hiddenOnes.length === 0) ? (
          <EmptyState
            icon={view === 'hidden' ? <CopyCheck size={24} /> : <Store size={24} />}
            title={q ? 'No place by that name' : view === 'hidden' ? 'Nothing hidden' : 'No bank transactions yet'}
            body={view === 'hidden' ? 'Hide a place or a single transaction and it shows up here, so you can bring it back.' : 'They show up here once your bank sends them.'}
          />
        ) : (
          list.map((p) => <PlaceRow key={p.key} p={p} />)
        )}
      </Card>

      {view === 'hidden' && hiddenOnes.length > 0 && (
        <>
          <SectionTitle>Hidden one at a time</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {hiddenOnes.map((t) => (
              <button key={t.id} onClick={() => openSheet({ kind: 'expense', id: t.id })} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{t.merchant}</span>
                  <span className="block truncate text-[13px] text-ink-2">{dayLabel(t.date)}</span>
                </span>
                <span className="num shrink-0 text-[15px] font-semibold text-ink-3">{minus(t.amount)}</span>
              </button>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
