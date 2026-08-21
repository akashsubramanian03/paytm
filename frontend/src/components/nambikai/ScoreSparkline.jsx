/**
 * The score over time.
 *
 * A single number is a verdict; a line is a story. For someone whose score is
 * recovering, the direction of travel is the part worth seeing.
 *
 * One polyline, no dependencies.
 */
export default function ScoreSparkline({ points, width = 260, height = 54 }) {
  if (!points || points.length < 2) return null;

  const values = points.map((p) => p.score);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pad = 4;

  const coords = values.map((value, i) => {
    const x = pad + (i * (width - pad * 2)) / (values.length - 1);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  });

  const last = values[values.length - 1];
  const first = values[0];
  const rising = last >= first;
  const color = rising ? '#0E9F6E' : '#E8442E';

  return (
    <div className="flex items-center gap-3">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <polyline
          points={coords.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="3.4" fill={color} />
      </svg>
      <span className="tnum shrink-0 text-[12.5px] font-bold" style={{ color }}>
        {rising ? '+' : ''}
        {last - first}
      </span>
      <span className="sr-only">
        Your score moved from {first} to {last} over the last {values.length} readings.
      </span>
    </div>
  );
}
