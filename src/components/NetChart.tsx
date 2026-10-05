import { useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { moneyAxis } from '../lib/format.ts';

export interface NetDatum {
  key: string;
  label: string;
  title: string;
  /** Earned minus spent minus bills. */
  value: number;
  /** A future day: earnings are only scheduled, so the bar is faded. */
  projected?: boolean;
  current?: boolean;
}

function niceMax(v: number): number {
  if (v <= 0) return 0;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * What's left each day, as bars above (came out ahead) or below (overspent) a
 * zero line. Direction carries the sign, so color isn't the only cue.
 */
export function NetChart({
  data,
  selected,
  onSelect,
  format,
  height = 168,
  labelEvery = 1,
  ariaLabel,
}: {
  data: NetDatum[];
  selected: number | null;
  onSelect(i: number): void;
  format(v: number): string;
  height?: number;
  labelEvery?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const bottom = niceMax(Math.max(0, ...data.map((d) => -d.value)));
  const span = top + bottom || 1;
  const zero = (top / span) * height; // distance from the top
  const px = (v: number) => (Math.abs(v) / span) * height;

  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next == null || next < 0 || next >= data.length) return;
    e.preventDefault();
    onSelect(next);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  const ticks = [
    ...(top ? [{ v: top, y: 0 }] : []),
    ...(bottom ? [{ v: -bottom, y: height }] : []),
  ];

  return (
    <div className="relative select-none" role="group" aria-label={ariaLabel}>
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          <div key={t.v} className="pointer-events-none absolute right-0 left-0 border-t border-grid" style={{ top: t.y }}>
            <span className="num absolute -top-2.5 right-0 bg-card pl-1.5 text-[11px] text-ink-3">
              {t.v < 0 ? '−' : ''}
              {moneyAxis(Math.abs(t.v))}
            </span>
          </div>
        ))}
        <div className="pointer-events-none absolute right-0 left-0 border-t border-ink-3/50" style={{ top: zero }}>
          <span className="num absolute -top-2.5 right-0 bg-card pl-1.5 text-[11px] text-ink-3">$0</span>
        </div>
        <div className="absolute inset-0 right-9 flex">
          {data.map((d, i) => {
            const on = selected === i;
            const h = Math.max(d.value === 0 ? 0 : 2, px(d.value));
            const up = d.value >= 0;
            return (
              <button
                key={d.key}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => onKey(e, i)}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${d.title}: ${format(d.value)} left${d.projected ? ', projected' : ''}`}
                aria-pressed={on}
                className="group relative h-full min-w-0 flex-1 outline-none"
              >
                <span
                  className={clsx(
                    'absolute left-1/2 block w-[64%] max-w-6 -translate-x-1/2 transition-[height,opacity] duration-300',
                    up ? 'rounded-t-[4px]' : 'rounded-b-[4px]',
                    selected != null && !on && 'opacity-55 group-hover:opacity-90',
                  )}
                  style={{
                    height: h,
                    top: up ? zero - h : zero,
                    background: up ? 'var(--c-money)' : 'var(--c-spend)',
                    opacity: d.projected ? 0.32 : undefined,
                  }}
                />
                {on && (
                  <span
                    className="num absolute left-1/2 z-10 -translate-x-1/2 text-[12px] font-semibold whitespace-nowrap"
                    style={up ? { top: Math.max(0, zero - h - 20) } : { top: Math.min(height - 16, zero + h + 4) }}
                  >
                    {format(d.value)}
                  </span>
                )}
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
      {hover != null && data[hover] && (
        <div
          className="pointer-events-none absolute z-20 w-max max-w-56 rounded-2xl border border-line bg-card px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
          style={{
            top: -8,
            left: `${((hover + 0.5) / data.length) * 100}%`,
            transform: `translate(${hover < 2 ? '-20%' : hover > data.length - 3 ? '-85%' : '-50%'}, -100%)`,
          }}
        >
          <p className="text-[12px] text-ink-2">{data[hover].title}</p>
          <p className="num text-[15px] font-semibold">{format(data[hover].value)} left</p>
          {data[hover].projected && <p className="mt-0.5 text-[12px] text-ink-3">If you work as scheduled</p>}
        </div>
      )}
    </div>
  );
}
