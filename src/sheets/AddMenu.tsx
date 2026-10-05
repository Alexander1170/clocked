import type { ReactNode } from 'react';
import { Bike, Briefcase, CalendarCog, PiggyBank, Plus, Receipt, Square } from 'lucide-react';
import { toLocalDate } from '../../shared/dates.ts';
import { useData } from '../lib/store.ts';
import { isGig, isScheduled, useActiveDash, useJobs } from '../lib/hooks.ts';
import { newId } from '../lib/ids.ts';
import { slotColor } from '../lib/colors.ts';
import { closeSheet, toast, useSheets } from '../lib/ui.ts';
import { Sheet } from '../components/ui.tsx';

function Item({ icon, title, sub, onClick, color }: { icon: ReactNode; title: string; sub: string; onClick(): void; color?: number }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3.5 rounded-2xl p-3 text-left transition-colors hover:bg-hover">
      <span
        className="grid size-11 shrink-0 place-items-center rounded-full bg-raised"
        style={color ? { background: `color-mix(in srgb, ${slotColor(color)} 16%, transparent)`, color: slotColor(color) } : undefined}
      >
        {icon}
      </span>
      <span>
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[13px] text-ink-2">{sub}</span>
      </span>
    </button>
  );
}

export function AddMenu() {
  const jobs = useJobs();
  const dash = useActiveDash();
  const put = useData((s) => s.put);
  const replace = useSheets((s) => s.replace);
  const today = toLocalDate(Date.now());
  const gigJobs = jobs.filter(isGig);
  const scheduled = jobs.filter(isScheduled);

  return (
    <Sheet title="Add" onClose={closeSheet}>
      <div className="space-y-1">
        <Item icon={<Receipt size={20} />} title="Expense" sub="Something you spent money on" onClick={() => replace({ kind: 'expense' })} />
        <Item icon={<PiggyBank size={20} />} title="Bill" sub="Split across your workdays until it's due" onClick={() => replace({ kind: 'bill' })} />
        {dash ? (
          <>
            <Item icon={<Plus size={20} />} title="Order pay" sub="Add an order to the running dash" onClick={() => replace({ kind: 'order', id: dash.id })} />
            <Item icon={<Square size={18} />} title="End dash" sub="Save this dash's total" onClick={() => replace({ kind: 'endDash', id: dash.id })} />
          </>
        ) : (
          gigJobs.map((j) => (
            <Item
              key={j.id}
              color={j.color}
              icon={<Bike size={20} />}
              title={`Start ${j.name} dash`}
              sub="A timer runs while you work"
              onClick={() => {
                put('gigs', { id: newId(), jobId: j.id, start: Date.now(), end: null, earnings: 0, orders: [] });
                toast({ title: `${j.name} dash started`, detail: 'Add order pay as you go.' });
                closeSheet();
              }}
            />
          ))
        )}
        {gigJobs.length > 0 && <Item icon={<Bike size={20} />} title="Log gig work" sub="Hours and pay from earlier" onClick={() => replace({ kind: 'gig' })} />}
        {scheduled.map((j) => (
          <Item
            key={j.id}
            color={j.color}
            icon={<CalendarCog size={19} />}
            title={`Change today at ${j.name}`}
            sub="Day off, PTO, or different hours"
            onClick={() => replace({ kind: 'day', jobId: j.id, date: today })}
          />
        ))}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button className="btn btn-secondary" onClick={() => replace({ kind: 'job', type: 'scheduled' })}>
            <Briefcase size={17} /> New job
          </button>
          <button className="btn btn-secondary" onClick={() => replace({ kind: 'job', type: 'gig' })}>
            <Bike size={17} /> New gig
          </button>
        </div>
      </div>
    </Sheet>
  );
}
