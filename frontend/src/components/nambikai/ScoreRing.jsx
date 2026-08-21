import { cx } from '../primitives.jsx';

/**
 * The score, as a ring.
 *
 * Hand-rolled SVG rather than a charting library: this is one circle with a
 * dash offset, and pulling in several d3 sub-packages to draw it would be the
 * largest dependency in the app by a wide margin.
 *
 * The ring shows the GRADE, never the risk band. A person should not be told by
 * their own app that they are a "high risk" — that is a lender's vocabulary, it
 * is not actionable, and it is not what this screen is for.
 */
const GRADE_COLOR = {
  STRONG: '#0E9F6E',
  GOOD: '#00B9F1',
  FAIR: '#B45309',
  BUILDING: '#98A2B3',
};

export default function ScoreRing({ value, grade, size = 168, stroke = 13, className = '' }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const filled = (clamped / 100) * circumference;
  const color = GRADE_COLOR[grade] ?? GRADE_COLOR.BUILDING;

  return (
    <div className={cx('relative', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.18)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          // Start at twelve o'clock rather than three.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.32,0.72,0,1)' }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum text-[44px] font-bold leading-none tracking-[-0.03em] text-white">
          {clamped}
        </span>
        <span className="mt-1 text-2xs font-bold uppercase tracking-[0.13em] text-sky-200">
          out of 100
        </span>
      </div>
      <span className="sr-only">
        Your Nambikai score is {clamped} out of 100, rated {grade}.
      </span>
    </div>
  );
}
