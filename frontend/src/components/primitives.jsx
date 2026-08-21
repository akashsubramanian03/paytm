import { forwardRef } from 'react';
import Icon from './Icon.jsx';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ---------------------------------------------------------------- Avatar -- */

export function Avatar({ initials, color = '#012B72', size = 40, className = '' }) {
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none', className)}
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

/* ---------------------------------------------------------------- Button -- */

const BUTTON_VARIANTS = {
  primary: 'bg-navy text-white hover:bg-navy-800 active:bg-navy-950 disabled:bg-navy/40',
  sky: 'bg-sky text-navy-950 font-bold hover:bg-sky-600 active:bg-sky-600 disabled:bg-sky/40',
  outline: 'border border-navy/25 text-navy bg-white hover:bg-sky-50 active:bg-sky-100 disabled:opacity-50',
  ghost: 'text-navy hover:bg-sky-50 active:bg-sky-100 disabled:opacity-50',
  danger: 'bg-debit text-white hover:brightness-95 active:brightness-90 disabled:opacity-50',
};

const BUTTON_SIZES = {
  sm: 'h-9 px-3.5 text-[13px] rounded-lg',
  md: 'h-11 px-5 text-[15px] rounded-xl',
  lg: 'h-[52px] px-6 text-[16px] rounded-xl',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, full = false, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 font-semibold transition-all',
        'disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner size={16} className="text-current" />}
      {children}
    </button>
  );
});

/* --------------------------------------------------------------- Spinner -- */

export function Spinner({ size = 20, className = '' }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      className={cx('animate-spin', className)} aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.22" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/* ----------------------------------------------------------------- Field -- */

export const Field = forwardRef(function Field(
  { label, error, hint, prefix, suffix, className = '', id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name;
  return (
    <label htmlFor={inputId} className={cx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-muted">{label}</span>
      )}
      <span
        className={cx(
          'flex items-center gap-2 rounded-xl border bg-white px-3.5 transition-colors',
          'focus-within:border-sky focus-within:ring-2 focus-within:ring-sky/25',
          error ? 'border-debit' : 'border-line',
        )}
      >
        {prefix && <span className="shrink-0 text-ink-muted">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          className="h-12 w-full bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
          {...rest}
        />
        {suffix && <span className="shrink-0 text-ink-muted">{suffix}</span>}
      </span>
      {error ? (
        <span className="mt-1.5 flex items-start gap-1 text-[12.5px] font-medium text-debit">
          <Icon name="alert" size={14} className="mt-px shrink-0" />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-[12.5px] text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
});

/* ------------------------------------------------------------------ Card -- */

export function Card({ className = '', children, ...rest }) {
  return (
    <section className={cx('card', className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, action, className = '' }) {
  return (
    <div className={cx('flex items-center justify-between px-4 pt-3.5 pb-2', className)}>
      <h2 className="section-title">{title}</h2>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------ Row / List -- */

export function ListRow({ icon, title, subtitle, right, onClick, as = 'button', className = '' }) {
  const Tag = onClick ? 'button' : as === 'button' ? 'div' : as;
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
        onClick && 'hover:bg-sky-50 active:bg-sky-100',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold text-ink">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">{subtitle}</span>}
      </span>
      {right ?? <Icon name="chevronRight" size={18} className="shrink-0 text-ink-faint" />}
    </Tag>
  );
}

/* ------------------------------------------------------------ EmptyState -- */

export function EmptyState({ icon = 'passbook', title, description, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-navy">
        <Icon name={icon} size={26} />
      </span>
      <p className="text-[15px] font-bold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-[34ch] text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- MockBadge -- */

/** Repeated wherever fake money moves, so the demo is never mistaken for real. */
export function MockBadge({ className = '', children = 'Simulated — no real money moves' }) {
  return (
    <p className={cx('flex items-center justify-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.07em] text-ink-faint', className)}>
      <Icon name="info" size={13} />
      {children}
    </p>
  );
}

export { cx };
