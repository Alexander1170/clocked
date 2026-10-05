import clsx from 'clsx';
import type { LocalDate } from '../../shared/types.ts';
import { eachDay, endOfMonth, weekday } from '../../shared/dates.ts';
import { dowShort } from '../lib/format.ts';

/** Five steps of one hue, light to dark, for "more is darker". */
const STEPS = [22, 40, 58, 78, 100];
const shade = (step: number) => `color-mix(in oklab, var(--s8) ${STEPS[step]}%, var(--c-raised))`;

/**
 * A month as a calendar, each day shaded by how much was spent. Days to come
 * stay blank. Tap a day to pick it.
 */
export function MonthHeatmap({
  month,
  values,
  today,
  weekStartsOn,
  selected,
  onSelect,
  format,
}: {
  /** Any day in the month. */
  month: LocalDate;
  values: Map<LocalDate, number>;
  today: LocalDate;
  weekStartsOn: 0 | 1;
  selected: LocalDate | null;
  onSelect(d: LocalDate | null): void;
  format(v: number): string;
}) {
  const first = month.slice(0, 8) + '01';
  const days = eachDay(first, endOfMonth(first));
  const lead = (weekday(first) - weekStartsOn + 7) % 7;
  const max = Math.max(0, ...days.map((d) => values.get(d) ?? 0));
  const stepOf = (v: number) => (v <= 0.005 || max <= 0 ? -1 : Math.min(STEPS.length - 1, Math.floor((v / max) * STEPS.length - 1e-9)));
  const heads = Array.from({ length: 7 }, (_, i) => dowShort((i + weekStartsOn) % 7));

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-ink-3">
        {heads.map((h) => (
          <span key={h}>{h.slice(0, 1)}</span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5" role="grid" aria-label="Spending by day">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {days.map((d) => {
          const v = values.get(d) ?? 0;
          const step = stepOf(v);
          const future = d > today;
          const on = selected === d;
          return (
            <button
              key={d}
              type="button"
              disabled={future}
              onClick={() => onSelect(on ? null : d)}
              aria-pressed={on}
              aria-label={`${d}: ${future ? 'still to come' : format(v)}`}
              className={clsx(
                'num grid aspect-square place-items-center rounded-lg text-[12px] font-medium transition-shadow',
                future ? 'text-ink-3/60' : step >= 3 ? 'text-white' : 'text-ink-2',
                on ? 'ring-2 ring-ink' : d === today && 'ring-1 ring-ink-3',
              )}
              style={{ background: future ? 'transparent' : step < 0 ? 'var(--c-raised)' : shade(step) }}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-ink-3">
        Less
        <span className="size-3 rounded-[3px] bg-raised" />
        {STEPS.map((_, i) => (
          <span key={i} className="size-3 rounded-[3px]" style={{ background: shade(i) }} />
        ))}
        More
      </div>
    </div>
  );
}

