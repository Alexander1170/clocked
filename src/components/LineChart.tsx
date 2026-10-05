import { useEffect, useRef, useState } from 'react';
import { moneyAxis } from '../lib/format.ts';

export interface LineSeries {
  key: string;
  name: string;
  color: string;
  values: number[];
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

const PAD_RIGHT = 40;
const PAD_TOP = 8;

/**
 * Lines over evenly spaced points (days, usually). Points after `actualUntil`
 * are projections and draw faded and dashed. Hover or tap for a crosshair with
 * every series' value; the caller shows the legend.
 */
export function LineChart({
  series,
  labels,
  titles,
  actualUntil,
  height = 180,
  labelEvery = 1,
  format,
  ariaLabel,
}: {
  series: LineSeries[];
  /** Axis label per point. */
  labels: string[];
  /** Tooltip title per point. */
  titles: string[];
  /** Last index that's real rather than projected. */
  actualUntil: number;
  height?: number;
  labelEvery?: number;
  format(v: number): string;
  ariaLabel: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const plotW = width - PAD_RIGHT;
  const plotH = height - PAD_TOP;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD_TOP + plotH - (Math.max(0, v) / max) * plotH;
  const path = (vals: number[], from: number, to: number) =>
    vals
      .slice(from, to + 1)
      .map((v, k) => `${k ? 'L' : 'M'}${x(from + k).toFixed(1)},${y(v).toFixed(1)}`)
      .join('');
  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const i = Math.round(((clientX - rect.left) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="relative select-none" role="group" aria-label={ariaLabel}>
      <div
        ref={box}
        className="relative touch-pan-y"
        style={{ height }}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={width} height={height} className="block overflow-visible">
          {[max, max / 2, 0].map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--c-ink-3)' : 'var(--c-grid)'} strokeOpacity={t === 0 ? 0.4 : 1} strokeWidth={1} />
              <text x={width} y={y(t) + 4} textAnchor="end" className="num fill-ink-3 text-[11px]">
                {moneyAxis(t)}
              </text>
            </g>
          ))}
          {series.map((s) => (
            <g key={s.key} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={path(s.values, 0, Math.min(actualUntil, n - 1))} />
              {actualUntil < n - 1 && <path d={path(s.values, Math.max(0, actualUntil), n - 1)} strokeDasharray="4 5" strokeOpacity={0.5} />}
            </g>
          ))}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="var(--c-ink-3)" strokeOpacity={0.5} strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="var(--c-card)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hover != null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-max rounded-2xl border border-line bg-card px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.16)]"
            style={{ left: x(hover), transform: `translate(${hover > n * 0.6 ? 'calc(-100% - 12px)' : '12px'}, 0)` }}
          >
            <p className="text-[12px] text-ink-2">
              {titles[hover]}
              {hover > actualUntil && ' · expected'}
            </p>
            {series.map((s) => (
              <p key={s.key} className="mt-1 flex items-center gap-2 text-[12px]">
                <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
                <span className="num font-semibold">{format(s.values[hover] ?? 0)}</span>
                <span className="text-ink-2">{s.name}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex" style={{ width: plotW }}>
        {labels.map((l, i) => (
          <span key={i} className="min-w-0 flex-1 text-center text-[11px] whitespace-nowrap text-ink-3">
            {i % labelEvery === 0 ? l : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
