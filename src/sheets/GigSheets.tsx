import { useState } from 'react';
import { Trash } from 'lucide-react';
import type { GigSession, LocalDate } from '../../shared/types.ts';
import { addDays, at, hhmm, toLocalDate } from '../../shared/dates.ts';
import { useData } from '../lib/store.ts';
import { isGig, useJobs, useNow } from '../lib/hooks.ts';
import { newId } from '../lib/ids.ts';
import { clock, hrs, money, signed, stopwatch } from '../lib/format.ts';
import { closeSheet, openSheet, toast, useSheets } from '../lib/ui.ts';
import { Dot, Field, MoneyInput, parseMoney, Sheet } from '../components/ui.tsx';

const timeOf = (t: number) => hhmm(new Date(t).getHours() * 60 + new Date(t).getMinutes());
const optionalMoney = (s: string) => (s.trim() ? parseMoney(s) : undefined);

/** Log or edit a finished stretch of gig work. */
export function GigSheet({ id, jobId, date }: { id?: string; jobId?: string; date?: LocalDate }) {
  const existing = useData((s) => (id ? s.t.gigs[id] : undefined));
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const gigJobs = useJobs().filter(isGig);
  const today = toLocalDate(Date.now());

  const [job, setJob] = useState(existing?.jobId ?? jobId ?? gigJobs[0]?.id ?? '');
  const [day, setDay] = useState(existing ? toLocalDate(existing.start) : (date ?? today));
  const [start, setStart] = useState(existing ? timeOf(existing.start) : '17:00');
  const [end, setEnd] = useState(existing?.end ? timeOf(existing.end) : '20:00');
  const [earnings, setEarnings] = useState(existing ? String(existing.earnings) : '');
  const [tips, setTips] = useState(existing?.tips != null ? String(existing.tips) : '');
  const [miles, setMiles] = useState(existing?.miles != null ? String(existing.miles) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');

  if (!gigJobs.length && !existing) {
    return (
      <Sheet title="Log gig work" onClose={closeSheet}>
        <p className="text-[15px] text-ink-2">Add a gig job first, like DoorDash, so your hours and pay have somewhere to go.</p>
        <button className="btn btn-primary mt-5 w-full" onClick={() => useSheets.getState().replace({ kind: 'job', type: 'gig' })}>
          Add gig work
        </button>
      </Sheet>
    );
  }

  const s = at(day, start);
  let e = at(day, end);
  if (e <= s) e = at(addDays(day, 1), end);
  const hours = (e - s) / 3_600_000;
  const pay = parseMoney(earnings);

  const save = () => {
    if (!job) return setError('Pick which gig this was.');
    if (!(pay >= 0)) return setError('Enter what you made.');
    if (hours <= 0 || hours > 24) return setError('Check the start and end times.');
    const rec: GigSession = {
      ...(existing ?? {}),
      id: existing?.id ?? newId(),
      updatedAt: 0,
      jobId: job,
      start: s,
      end: e,
      earnings: pay,
      tips: optionalMoney(tips),
      miles: miles.trim() ? Number(miles) || 0 : undefined,
      note: note.trim() || undefined,
    };
    put('gigs', rec);
    toast({ title: `${existing ? 'Updated' : 'Logged'} ${signed(pay)}`, detail: `${hrs(hours)} · ${money(pay / hours)}/hr`, tone: 'money' });
    closeSheet();
  };

  return (
    <Sheet
      title={existing ? 'Edit gig work' : 'Log gig work'}
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          {existing && (
            <button
              className="btn btn-danger"
              aria-label="Delete"
              onClick={() => {
                remove('gigs', existing.id);
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
        {gigJobs.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {gigJobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setJob(j.id)}
                aria-pressed={job === j.id}
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium ${job === j.id ? 'border-ink bg-ink text-inverse' : 'border-line text-ink-2'}`}
              >
                <Dot color={j.color} /> {j.name}
              </button>
            ))}
          </div>
        )}
        <div>
          <span className="label text-center">What you made</span>
          <MoneyInput big value={earnings} onChange={(v) => (setEarnings(v), setError(''))} autoFocus={!existing} ariaLabel="What you made" />
          <p className="num -mt-1 text-center text-[14px] text-ink-2">
            {hrs(hours)}
            {pay > 0 && hours > 0 && ` · ${money(pay / hours)}/hr`}
          </p>
        </div>
        <Field label="Day">
          <input className="input" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started">
            <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Finished">
            <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tips included (optional)">
            <MoneyInput value={tips} onChange={setTips} ariaLabel="Tips" />
          </Field>
          <Field label="Miles (optional)">
            <input className="input num" inputMode="decimal" placeholder="0" value={miles} onChange={(e) => setMiles(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
        </div>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Busy Friday dinner rush" />
        </Field>
        {error && <p className="text-[13px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}

/** Add one order's payout to the running dash. */
export function OrderSheet({ id }: { id: string }) {
  const dash = useData((s) => s.t.gigs[id]);
  const put = useData((s) => s.put);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  if (!dash) return null;

  const save = () => {
    const amt = parseMoney(amount);
    if (!(amt > 0)) return setError('Enter the order pay.');
    put('gigs', { ...dash, orders: [...(dash.orders ?? []), { at: Date.now(), amount: amt }], earnings: Math.round((dash.earnings + amt) * 100) / 100 });
    toast({ title: `${signed(amt)} order`, detail: `${money(dash.earnings + amt)} this dash`, tone: 'money' });
    closeSheet();
  };

  return (
    <Sheet
      title="Order pay"
      onClose={closeSheet}
      footer={
        <button className="btn btn-primary w-full" onClick={save}>
          Add to dash
        </button>
      }
    >
      <MoneyInput big value={amount} onChange={(v) => (setAmount(v), setError(''))} autoFocus ariaLabel="Order pay" />
      {error ? <p className="text-center text-[13px] text-spend">{error}</p> : <p className="text-center text-[14px] text-ink-2">Base pay plus tip, as the app showed it.</p>}
    </Sheet>
  );
}

/** Finish a running dash: confirm the total, tips, and miles. */
export function EndDashSheet({ id }: { id: string }) {
  const now = useNow(1000);
  const dash = useData((s) => s.t.gigs[id]);
  const put = useData((s) => s.put);
  const remove = useData((s) => s.remove);
  const [earnings, setEarnings] = useState(dash ? String(dash.earnings || '') : '');
  const [tips, setTips] = useState('');
  const [miles, setMiles] = useState('');
  const [endTime, setEndTime] = useState(timeOf(Date.now()));
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState('');
  if (!dash) return null;

  const orders = dash.orders ?? [];
  const startDay = toLocalDate(dash.start);
  let end = at(startDay, endTime);
  if (end <= dash.start) end = at(addDays(startDay, 1), endTime);
  if (end > now + 60_000) end = now;

  const save = () => {
    const pay = parseMoney(earnings || '0');
    if (!(pay >= 0)) return setError('Enter what you made.');
    put('gigs', { ...dash, end, earnings: pay, tips: optionalMoney(tips), miles: miles.trim() ? Number(miles) || 0 : undefined });
    const h = (end - dash.start) / 3_600_000;
    toast({ title: `Dash saved · ${signed(pay)}`, detail: `${hrs(h)}${h >= 0.25 ? ` · ${money(pay / h)}/hr` : ''}`, tone: 'money' });
    closeSheet();
  };

  return (
    <Sheet
      title="End dash"
      onClose={closeSheet}
      footer={
        <div className="flex gap-2">
          <button
            className="btn btn-danger"
            onClick={() => {
              if (!confirmDiscard) return setConfirmDiscard(true);
              remove('gigs', dash.id);
              toast({ title: 'Dash discarded' });
              closeSheet();
            }}
          >
            {confirmDiscard ? 'Tap again to discard' : 'Discard'}
          </button>
          <button className="btn btn-primary flex-1" onClick={save}>
            Save dash
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-2xl bg-raised p-4 text-center">
          <p className="num text-3xl font-bold tracking-tight">{stopwatch(now - dash.start)}</p>
          <p className="mt-1 text-[14px] text-ink-2">
            Started at {clock(dash.start)} · {orders.length} {orders.length === 1 ? 'order' : 'orders'} logged
          </p>
        </div>
        <div>
          <span className="label text-center">Total for this dash</span>
          <MoneyInput big value={earnings} onChange={(v) => (setEarnings(v), setError(''))} ariaLabel="Total for this dash" />
          {orders.length > 0 && <p className="num -mt-1 text-center text-[13px] text-ink-2">Orders add up to {money(orders.reduce((t, o) => t + o.amount, 0))}</p>}
        </div>
        <Field label="Ended at">
          <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tips included (optional)">
            <MoneyInput value={tips} onChange={setTips} ariaLabel="Tips" />
          </Field>
          <Field label="Miles (optional)">
            <input className="input num" inputMode="decimal" placeholder="0" value={miles} onChange={(e) => setMiles(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
        </div>
        <button className="text-[14px] font-medium text-ink-2 underline-offset-2 hover:underline" onClick={() => openSheet({ kind: 'order', id: dash.id })}>
          Add another order first
        </button>
        {error && <p className="text-[13px] text-spend">{error}</p>}
      </div>
    </Sheet>
  );
}
