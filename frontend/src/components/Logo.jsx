import { config } from '../lib/config.js';

/**
 * Two-tone wordmark: the stem in the surface colour, the tail in brand cyan.
 * `tone="light"` is for the blue app bar, `tone="dark"` for white surfaces.
 */
export default function Logo({ tone = 'light', className = '' }) {
  const name = config.appName;
  const split = Math.ceil(name.length * 0.6);
  return (
    <span
      className={`select-none text-[19px] font-extrabold tracking-[-0.035em] ${className}`}
      aria-label={name}
    >
      <span className={tone === 'light' ? 'text-white' : 'text-navy'}>{name.slice(0, split)}</span>
      <span className="text-sky">{name.slice(split)}</span>
    </span>
  );
}
