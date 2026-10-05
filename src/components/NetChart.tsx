import { useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { minus, money, moneyAxis, signed } from '../lib/format.ts';
import { splitDay } from '../lib/money.ts';

export interface BudgetDay {
  key: string;
  label: string;
  title: string;
  /** Pay for the day: earned so far, or what's scheduled on a future day. */
  earned: number;
  setAside: number;
  /** What the set-aside is for (bills, savings, wish list). */
  setAsideParts?: Array<{ name: string; value: number }>;
  /** Net spending: refunds make it negative. */
  spent: number;
  /** A future day: pay is only scheduled, so the bar is faded. */
  projected?: boolean;
  current?: boolean;
}

/** Validated together, light and dark, so any two stay apart with color blindness. */
export const BUDGET_COLORS = { left: 'var(--c-left)', spent: 'var(--s8)', setAside: 'var(--s7)' } as const;

function niceMax(v: number): number {
  if (v <= 0) return 0;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

const GAP = 2;

interface Seg {
  key: string;
  color: string;
  h: number;
}

const segments = (list: Array<[string, string, number]>, px: (v: number) => number): Seg[] =>
  list.filter(([, , v]) => v > 0.005).map(([key, color, v]) => ({ key, color, h: Math.max(2, px(v)) }));
const stackHeight = (s: Seg[]) => s.reduce((t, x) => t + x.h, 0) + Math.max(0, s.length - 1) * GAP;

function Swatch({ color }: { color?: string }) {
  return <span className="size-2 rounded-[2px]" style={{ background: color ?? 'transparent' }} />;
}

/**
 * Each day's pay, stacked into what's set aside, what's spent, and what's
 * left, around a $0 line. Tap or arrow keys select a day; hover shows the
 * numbers.
 */
export function NetChart({
  data,
  selected,
  onSelect,
  height = 180,
  labelEvery = 1,
  ariaLabel,
}: {
  data: BudgetDay[];
  selected: number | null;
  onSelect(i: number): void;
  height?: number;
  labelEvery?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const parts = data.map(splitDay);
  const top = niceMax(Math.max(0, ...parts.map((p) => p.pay)));
  const bottom = niceMax(Math.max(0, ...parts.map((p) => p.asideOver + p.spentOver)));
  const span = top + bottom;
  const zero = span ? (top / span) * height : height; // distance of $0 from the top
  const px = (v: number) => (span ? (v / span) * height : 0);

  const bars = parts.map((p) => {
    // Above $0, bottom to top. Below $0 the same stack carries on downward.
    const up = segments(
      [
        ['left', BUDGET_COLORS.left, p.left],
        ['spent', BUDGET_COLORS.spent, p.spentCovered],
        ['aside', BUDGET_COLORS.setAside, p.asideCovered],
      ],
      px,
    );
    const down = segments(
      [
        ['aside', BUDGET_COLORS.setAside, p.asideOver],
        ['spent', BUDGET_COLORS.spent, p.spentOver],
      ],
      px,
    );
    return { ...p, up, down, peak: zero - stackHeight(up) };
  });

  const ticks = [
    ...(top ? [{ v: top, y: 0 }] : []),
    ...(top && zero >= 96 ? [{ v: top / 2, y: zero / 2 }] : []),
    ...(bottom ? [{ v: -bottom, y: height }] : []),
  ];

  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next == null || next < 0 || next >= data.length) return;
    e.preventDefault();
    onSelect(next);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };

  const tip = hover != null && data[hover] ? { d: data[hover], b: bars[hover], i: hover } : null;

  return (
    <div className="relative select-none" role="group" aria-label={ariaLabel}>
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          <div key={t.v} className="pointer-events-none absolute right-0 left-0 border-t border-grid" style={{ top: t.y }}>
            {Math.abs(t.y - zero) >= 16 && (
              <span className="num absolute -top-2.5 right-0 bg-card pl-1.5 text-[11px] text-ink-3">
                {t.v < 0 ? '−' : ''}
                {moneyAxis(Math.abs(t.v))}
              </span>
            )}
          </div>
        ))}
        <div className="pointer-events-none absolute right-0 left-0 border-t border-ink-3/40" style={{ top: zero }}>
          <span className="num absolute -top-2.5 right-0 bg-card pl-1.5 text-[11px] text-ink-3">$0</span>
        </div>
        <div className="absolute inset-0 right-9 flex">
          {data.map((d, i) => {
            const b = bars[i];
            const on = selected === i;
            return (
              <button
                key={d.key}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => onKey(e, i)}
                onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${d.title}: ${d.projected ? 'scheduled' : 'earned'} ${money(d.earned)}, set aside ${money(d.setAside)}, spent ${money(d.spent)}, ${signed(b.net)} left`}
                aria-pressed={on}
                className="group relative h-full min-w-0 flex-1 outline-none"
              >
                <span
                  className={clsx(
                    'absolute inset-0 transition-opacity',
                    d.projected ? (on ? 'opacity-75' : 'opacity-40 group-hover:opacity-60') : selected != null && !on && 'opacity-55 group-hover:opacity-90',
                  )}
                >
                  <span className="absolute left-1/2 flex w-[64%] max-w-6 -translate-x-1/2 flex-col-reverse gap-[2px]" style={{ bottom: height - zero }}>
                    {b.up.map((s, k) => (
                      <span
                        key={s.key}
                        className={clsx('block w-full transition-[height] duration-300', k === b.up.length - 1 && 'rounded-t-[4px]')}
                        style={{ height: s.h, background: s.color }}
                      />
                    ))}
                  </span>
                  <span className="absolute left-1/2 flex w-[64%] max-w-6 -translate-x-1/2 flex-col gap-[2px]" style={{ top: zero }}>
                    {b.down.map((s, k) => (
                      <span
                        key={s.key}
                        className={clsx('block w-full transition-[height] duration-300', k === b.down.length - 1 && 'rounded-b-[4px]')}
                        style={{ height: s.h, background: s.color }}
                      />
                    ))}
                  </span>
                  {!b.up.length && !b.down.length && (
                    <span className="absolute left-1/2 h-[2px] w-[64%] max-w-6 -translate-x-1/2 rounded-full bg-grid" style={{ top: zero - 1 }} />
                  )}
                </span>
                {on && (
                  <span className="num absolute left-1/2 z-10 -translate-x-1/2 text-[12px] font-semibold whitespace-nowrap text-ink" style={{ top: b.peak - 18 }}>
                    {signed(b.net)}
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
      {tip && (
        <div
          className="pointer-events-none absolute z-20 w-max max-w-72 rounded-2xl border border-line bg-card px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
          style={{
            top: tip.b.peak - 8,
            left: `calc(${((tip.i + 0.5) / data.length) * 100}% - ${((tip.i + 0.5) / data.length) * 36}px)`,
            transform: `translate(${tip.i < 2 ? '-20%' : tip.i > data.length - 3 ? '-85%' : '-50%'}, -100%)`,
          }}
        >
          <p className="text-[12px] text-ink-2">{tip.d.title}</p>
          <div className="num mt-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 text-[12px]">
            <Swatch />
            <span className="text-ink-2">{tip.d.projected ? 'Scheduled' : 'Earned'}</span>
            <span className="text-right font-semibold">{money(tip.d.earned)}</span>
            <Swatch color={BUDGET_COLORS.setAside} />
            <span className="text-ink-2">Set aside</span>
            <span className="text-right font-semibold">{tip.d.setAside > 0.005 ? minus(tip.d.setAside) : money(0)}</span>
            {(tip.d.setAsideParts?.length ?? 0) > 0 && (
              <span className="col-span-2 col-start-2 -mt-0.5 text-[11px] text-ink-3">
                {tip.d.setAsideParts!.map((p) => `${p.name} ${money(p.value)}`).join(' · ')}
              </span>
            )}
            <Swatch color={BUDGET_COLORS.spent} />
            <span className="text-ink-2">Spent</span>
            <span className="text-right font-semibold">{tip.d.spent < -0.005 ? signed(-tip.d.spent) : tip.d.spent > 0.005 ? minus(tip.d.spent) : money(0)}</span>
            <span className="col-span-3 my-0.5 border-t border-line" />
            <Swatch color={BUDGET_COLORS.left} />
            <span className="font-medium">Left</span>
            <span className="text-right text-[13px] font-semibold">{signed(tip.b.net)}</span>
          </div>
          {tip.d.projected && <p className="mt-1.5 text-[12px] text-ink-3">If you work as scheduled</p>}
        </div>
      )}
    </div>
  );
}
