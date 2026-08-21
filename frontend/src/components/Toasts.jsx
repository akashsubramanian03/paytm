import { useToast } from '../context/ToastContext.jsx';
import Icon from './Icon.jsx';

const TONES = {
  success: { icon: 'check', bar: 'bg-credit', iconWrap: 'bg-credit/10 text-credit' },
  error: { icon: 'alert', bar: 'bg-debit', iconWrap: 'bg-debit/10 text-debit' },
  info: { icon: 'info', bar: 'bg-sky', iconWrap: 'bg-sky-100 text-navy' },
};

export default function Toasts() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-3"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((toast) => {
        const tone = TONES[toast.tone] ?? TONES.info;
        return (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
            className="pointer-events-auto w-full max-w-app animate-toast-in overflow-hidden rounded-xl bg-white shadow-lift"
          >
            <div className="flex items-start gap-3 py-3 pl-3 pr-2">
              <span className={`mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone.iconWrap}`}>
                <Icon name={tone.icon} size={16} strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="block text-[14px] font-semibold leading-snug text-ink">{toast.message}</span>
                {toast.description && (
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-muted">{toast.description}</span>
                )}
              </span>
              <button
                onClick={() => dismiss(toast.id)}
                className="-m-1 rounded-md p-1 text-ink-faint transition-colors hover:bg-canvas hover:text-ink"
                aria-label="Dismiss notification"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <span className={`block h-[3px] w-full ${tone.bar}`} />
          </div>
        );
      })}
    </div>
  );
}
