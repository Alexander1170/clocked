import { useState, type ReactNode } from 'react';

export interface DonutSegment {
  key: string;
  name: string;
  value: number;
  color: string;
}

/**
 * A thin ring for a part-to-whole at a glance (keep it to a handful of parts).
 * Parts are separated by a 2px gap; hover or focus a part for its numbers.
 * The caller shows the legend with the values.
 */
export function Donut({
  segments,
  center,
  size = 180,
  thickness = 18,
  ariaLabel,
  format,
}: {
  segments: DonutSegment[];
  center?: ReactNode;
  size?: number;
  thickness?: number;
  ariaLabel: string;
  format(v: number): string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const parts = segments.filter((s) => s.value > 0.005);
  const total = parts.reduce((t, s) => t + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = parts.length > 1 ? 2 : 0;
  let start = 0;
  const arcs = parts.map((s) => {
    const len = total > 0 ? (s.value / total) * c : 0;
    const arc = { ...s, dash: Math.max(0.5, len - gap), offset: -start, share: total > 0 ? s.value / total : 0 };
    start += len;
    return arc;
  });
  const tip = hover != null ? arcs[hover] : null;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-raised)" strokeWidth={thickness} />
        {arcs.map((a, i) => (
          <circle
            key={a.key}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={hover === i ? thickness + 4 : thickness}
            strokeDasharray={`${a.dash} ${c - a.dash}`}
            strokeDashoffset={a.offset}
            className="cursor-default transition-[stroke-width] duration-150 outline-none"
            style={{ pointerEvents: 'stroke' }}
            tabIndex={0}
            aria-label={`${a.name}: ${format(a.value)}, ${Math.round(a.share * 100)}%`}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        {tip ? (
          <div className="px-6">
            <p className="text-[12px] text-ink-2">{tip.name}</p>
            <p className="num text-[18px] font-bold tracking-tight">{format(tip.value)}</p>
            <p className="num text-[12px] text-ink-2">{Math.round(tip.share * 100)}%</p>
          </div>
        ) : (
          center
        )}
      </div>
    </div>
  );
}
