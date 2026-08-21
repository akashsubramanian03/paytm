import { cx } from './primitives.jsx';

const QUICK = [100, 500, 1000, 2000];

/**
 * Rupee amount input. Keeps the value as a plain string and lets the backend
 * do the real parsing — the client only prevents obvious nonsense.
 */
export default function AmountEntry({ value, onChange, error, autoFocus = true, quickAmounts = QUICK, max }) {
  const handle = (raw) => {
    // Digits with at most two decimals; nothing else can be typed.
    if (raw === '' || /^\d{0,7}(\.\d{0,2})?$/.test(raw)) onChange(raw);
  };

  return (
    <div>
      <div className="flex items-end justify-center gap-1 py-2">
        <span className="pb-2 text-[30px] font-semibold leading-none text-ink-muted">₹</span>
        <input
          inputMode="decimal"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => handle(e.target.value)}
          placeholder="0"
          aria-label="Amount in rupees"
          aria-invalid={Boolean(error)}
          className="tnum w-full max-w-[220px] border-none bg-transparent text-center text-[44px] font-bold leading-none tracking-[-0.02em] text-ink placeholder:text-ink-faint/50 focus:outline-none"
        />
      </div>

      {error ? (
        <p className="text-center text-[13px] font-semibold text-debit" role="alert">{error}</p>
      ) : (
        <p className="text-center text-[12.5px] text-ink-faint">
          {max !== undefined ? `Available ${max}` : 'Enter an amount to continue'}
        </p>
      )}

      {quickAmounts?.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {quickAmounts.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => onChange(String(amount))}
              className={cx(
                'tnum rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                value === String(amount)
                  ? 'border-navy bg-navy text-white'
                  : 'border-line bg-white text-navy hover:border-sky hover:bg-sky-50',
              )}
            >
              ₹{amount.toLocaleString('en-IN')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
