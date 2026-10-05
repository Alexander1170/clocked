import type { Shift } from '../../shared/types.ts';
import { hhmm, minutesOf } from '../../shared/dates.ts';
import { shiftSpanMinutes } from '../../shared/pay.ts';

export const DEFAULT_SHIFT: Shift = { start: '08:00', end: '17:00', breakMinutes: 60, breakStart: '12:00' };

/** Start, end, and an optional unpaid break for one shift. */
export function ShiftEditor({ shift, onChange, compact }: { shift: Shift; onChange(s: Shift): void; compact?: boolean }) {
  const brk = shift.breakMinutes ?? 0;
  const setBreak = (minutes: number) => {
    const m = Math.max(0, Math.min(minutes, shiftSpanMinutes(shift) - 15));
    const mid = minutesOf(shift.start) + Math.round((shiftSpanMinutes(shift) - m) / 2 / 15) * 15;
    onChange({ ...shift, breakMinutes: m || undefined, breakStart: m ? (shift.breakStart ?? hhmm(mid)) : undefined });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input aria-label="Start" className="input h-11 min-w-0 flex-1" type="time" value={shift.start} onChange={(e) => e.target.value && onChange({ ...shift, start: e.target.value })} />
        <span className="text-ink-3">–</span>
        <input aria-label="End" className="input h-11 min-w-0 flex-1" type="time" value={shift.end} onChange={(e) => e.target.value && onChange({ ...shift, end: e.target.value })} />
      </div>
      <div className={`flex items-center gap-2 text-[14px] text-ink-2 ${compact ? '' : 'pt-0.5'}`}>
        <span className="shrink-0">Unpaid break</span>
        <select aria-label="Unpaid break length" className="input h-10 w-auto min-w-0 flex-1 pr-2" value={brk} onChange={(e) => setBreak(Number(e.target.value))}>
          {[0, 15, 30, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'None' : m < 60 ? `${m} min` : m === 60 ? '1 hr' : '1.5 hrs'}
            </option>
          ))}
        </select>
        {brk > 0 && (
          <>
            <span className="shrink-0">at</span>
            <input
              aria-label="Break starts"
              className="input h-10 min-w-0 flex-1"
              type="time"
              value={shift.breakStart ?? ''}
              onChange={(e) => onChange({ ...shift, breakStart: e.target.value || undefined })}
            />
          </>
        )}
      </div>
    </div>
  );
}
