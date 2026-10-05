import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { slotColor, SLOTS, SLOT_NAMES } from '../lib/colors.ts';

export function Dot({ color, className }: { color: number | string; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: typeof color === 'number' ? slotColor(color) : color }}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('card', className)}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-8 mb-3 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Segmented<const T extends string>({
  value,
  options,
  onChange,
  className,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(v: T): void;
  className?: string;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('flex rounded-full bg-raised p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={clsx(
              'h-9 flex-1 rounded-full px-3 text-[14px] font-semibold transition-[background-color,color,box-shadow] duration-200',
              on ? 'bg-card text-ink shadow-[0_1px_3px_rgba(0,0,0,0.14)]' : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ on, onClick, children }: { on: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium transition-colors',
        on ? 'border-ink bg-ink text-inverse' : 'border-line bg-card text-ink-2 hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-money' : 'bg-grid')}
    >
      <span className={clsx('absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function MoneyInput({
  value,
  onChange,
  autoFocus,
  big,
  placeholder = '0.00',
  ariaLabel,
}: {
  value: string;
  onChange(v: string): void;
  autoFocus?: boolean;
  big?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const clean = (s: string) => s.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
  if (big) {
    return (
      <div className="flex items-center justify-center gap-1 py-3">
        <span className="text-4xl font-semibold text-ink-3">$</span>
        <input
          aria-label={ariaLabel}
          className="num min-w-0 bg-transparent text-center text-5xl font-semibold tracking-tight outline-none placeholder:text-ink-3"
          style={{ width: `${Math.max(4, (value || placeholder).length) + 0.5}ch` }}
          inputMode="decimal"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(clean(e.target.value))}
        />
      </div>
    );
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3">$</span>
      <input
        aria-label={ariaLabel}
        className="input num pl-7"
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(clean(e.target.value))}
      />
    </div>
  );
}

export const parseMoney = (s: string) => {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

export function ColorPicker({ value, onChange, used = [] }: { value: number; onChange(v: number): void; used?: number[] }) {
  return (
    <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
      {SLOTS.map((s) => (
        <button
          key={s}
          role="radio"
          aria-checked={value === s}
          aria-label={`${SLOT_NAMES[s - 1]}${used.includes(s) && value !== s ? ' (used by another job)' : ''}`}
          onClick={() => onChange(s)}
          className={clsx('grid size-8 place-items-center rounded-full transition-transform', value === s ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-card' : 'hover:scale-105')}
          style={{ background: slotColor(s) }}
        >
          {used.includes(s) && value !== s && <span className="size-1.5 rounded-full bg-white/80" />}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-raised text-ink-2">{icon}</div>
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-xs text-[15px] text-ink-2">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Bottom sheet on phones, centered dialog on wider screens. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="anim-fade absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={clsx(
          'anim-sheet relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-card outline-none',
          'rounded-t-[28px] sm:rounded-[28px] sm:border sm:border-line',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-grid sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-2 sm:pt-5">
          <h2 className="min-w-0 truncate text-[19px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full bg-raised text-ink-2 hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5">{children}</div>
        {footer && <div className="border-t border-line px-5 pt-3 pb-[max(env(safe-area-inset-bottom),16px)]">{footer}</div>}
      </div>
    </div>
  );
}

