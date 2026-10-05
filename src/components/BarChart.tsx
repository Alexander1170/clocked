import { useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { moneyAxis } from '../lib/format.ts';

export interface BarPart {
  id: string;
  name: string;
  color: string;
  value: number;
  /** Scheduled but not earned yet. Drawn as a faded cap. */
  projected?: number;
}

export interface BarDatum {
  key: string;
  label: string;
  title: string;
  parts: BarPart[];
  /** Marks "now" (today, this hour, this month). */
  current?: boolean;
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const total = (d: BarDatum, withProjected = true) =>
  d.parts.reduce((t, p) => t + p.value + (withProjected ? (p.projected ?? 0) : 0), 0);

/**
 * Stacked columns, one per bucket. Thin bars with a 2px surface gap between
 * segments, rounded only at the data end. Tap or arrow keys select a bucket;
 * the caller shows its detail (the table view). Hover shows a tooltip.
 */
export function BarChart({
  data,
  selected,
  onSelect,
  format,
  height = 168,
  labelEvery = 1,
  ariaLabel,
}: {
  data: BarDatum[];
  selected: number | null;
  onSelect(i: number): void;
  format(v: number): string;
  height?: number;
  labelEvery?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => total(d))));
  const px = (v: number) => (v / max) * height;
  const ticks = [max, max / 2];

  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next == null || next < 0 || next >= data.length) return;
    e.preventDefault();
    onSelect(next);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  const tip = hover ?? null;

  return (
    <div className="relative select-none" aria-label={ariaLabel} role="group">
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute right-0 left-0 border-t border-grid" style={{ bottom: px(t) }}>
            <span className="num absolute -top-2.5 right-0 bg-card pl-1.5 text-[11px] text-ink-3">{moneyAxis(t)}</span>
          </div>
        ))}
        <div className="absolute right-0 bottom-0 left-0 border-t border-ink-3/40" />
        <div className="absolute inset-0 right-9 flex items-end">
          {data.map((d, i) => {
            const rects = [
              ...d.parts.filter((p) => p.value > 0).map((p) => ({ key: p.id, color: p.color, h: px(p.value), faded: false })),
              ...d.parts.filter((p) => (p.projected ?? 0) > 0).map((p) => ({ key: `${p.id}-p`, color: p.color, h: px(p.projected ?? 0), faded: true })),
            ];
            const on = selected === i;
            const sum = total(d, false);
            return (
              <button
                key={d.key}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => onKey(e, i)}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${d.title}: ${format(sum)}`}
                aria-pressed={on}
                className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
              >
                {on && (
                  <span className="num absolute z-10 text-[12px] font-semibold whitespace-nowrap text-ink" style={{ bottom: Math.min(px(total(d)) + 6, height - 4) }}>
                    {format(sum)}
                  </span>
                )}
                <span
                  className={clsx(
                    'flex w-[64%] max-w-6 flex-col-reverse gap-[2px] transition-opacity',
                    selected != null && !on && 'opacity-55 group-hover:opacity-90',
                  )}
                >
                  {rects.map((r, k) => (
                    <span
                      key={r.key}
                      className={clsx('block w-full transition-[height] duration-300', k === rects.length - 1 && 'rounded-t-[4px]')}
                      style={{
                        height: Math.max(2, r.h),
                        background: r.color,
                        opacity: r.faded ? 0.32 : 1,
                      }}
                    />
                  ))}
                </span>
                {rects.length === 0 && <span className="block h-[2px] w-[64%] max-w-6 rounded-full bg-grid" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex pr-9">
        {data.map((d, i) => (
          <span
            key={d.key}
            className={clsx(
              'min-w-0 flex-1 text-center text-[11px] whitespace-nowrap',
              selected === i ? 'font-semibold text-ink' : d.current ? 'font-semibold text-ink-2' : 'text-ink-3',
            )}
          >
            {i % labelEvery === 0 || selected === i ? d.label : ''}
          </span>
        ))}
      </div>
      {tip != null && data[tip] && (
        <div
          className="pointer-events-none absolute z-20 w-max max-w-56 rounded-2xl border border-line bg-card px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
          style={{
            bottom: height + 8 - Math.min(height, px(total(data[tip]))),
            left: `${((tip + 0.5) / data.length) * 100}%`,
            transform: tip < 2 ? 'translateX(-20%)' : tip > data.length - 3 ? 'translateX(-85%)' : 'translateX(-50%)',
          }}
        >
          <p className="text-[12px] text-ink-2">{data[tip].title}</p>
          <p className="num text-[15px] font-semibold">{format(total(data[tip], false))}</p>
          {data[tip].parts.length > 1 &&
            data[tip].parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <p key={p.id} className="mt-1 flex items-center gap-2 text-[12px]">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
                  <span className="num font-semibold">{format(p.value)}</span>
                  <span className="text-ink-2">{p.name}</span>
                </p>
              ))}
          {data[tip].parts.some((p) => (p.projected ?? 0) > 0) && (
            <p className="mt-1 text-[12px] text-ink-3">+{format(data[tip].parts.reduce((t, p) => t + (p.projected ?? 0), 0))} still scheduled</p>
          )}
        </div>
      )}
    </div>
  );
}
