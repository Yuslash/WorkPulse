import { cn } from '@/lib/format';

/**
 * Small chart primitives for the Overview dashboard.
 *
 * Each one takes real numbers — hourly activity buckets, category
 * percentages, presence counts — rather than standing in for a static
 * illustration. No charting library: at this size a hand-rolled SVG reads
 * better than a dependency, and it is what lets the smooth wave and the
 * segmented bar share the exact warm palette as everything else.
 */

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Quadratic-through-midpoints smoothing — enough to read as a curve without
 *  pulling in a spline library for four sparklines. */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;

  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;
    d += ` Q${p0.x},${p0.y} ${mx},${my}`;
  }
  const last = points[points.length - 1]!;
  d += ` T${last.x},${last.y}`;
  return d;
}

function normalize(values: number[], height: number, padding = 5): number[] {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  return values.map((v) => height - padding - ((v - min) / range) * (height - padding * 2));
}

// ---------------------------------------------------------------------------
// Hero stat — solid accent card with a smooth wave sparkline
// ---------------------------------------------------------------------------

export function HeroStatCard({
  label,
  value,
  icon,
  trend,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  /** Recent-hours series, oldest to newest. */
  trend: number[];
}) {
  const width = 240;
  const height = 40;
  const ys = normalize(trend, height, 6);
  const step = trend.length > 1 ? width / (trend.length - 1) : width;
  const points = ys.map((y, i) => ({ x: i * step, y }));
  const path = smoothPath(points);

  return (
    <div className="flex min-h-[152px] animate-rise flex-col gap-3 rounded-card bg-accent p-5 text-accent-fg shadow-warm-md">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-accent-fg/85">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20">{icon}</span>
      </div>
      <div className="font-display text-[32px] font-bold leading-none tracking-tight">{value}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-auto h-9 w-full" preserveAspectRatio="none">
        <path d={path} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={3} strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar sparkline — last N hours as vertical bars
// ---------------------------------------------------------------------------

export function BarStatCard({
  label,
  value,
  icon,
  bars,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  bars: number[];
}) {
  const width = 240;
  const height = 40;
  const max = Math.max(...bars, 1);
  const n = bars.length;
  const gap = 6;
  const barWidth = (width - gap * (n - 1)) / n;

  return (
    <div className="flex min-h-[152px] animate-rise flex-col gap-3 rounded-card bg-surface p-5 shadow-warm-sm" style={{ animationDelay: '60ms' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-fg">{icon}</span>
      </div>
      <div className="font-display text-[32px] font-bold leading-none tracking-tight text-fg">{value}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-auto h-9 w-full">
        {bars.map((v, i) => {
          const h = Math.max(4, (v / max) * (height - 4));
          const isPeak = v === max && v > 0;
          return (
            <rect
              key={i}
              x={i * (barWidth + gap)}
              y={height - h}
              width={barWidth}
              height={h}
              rx={barWidth / 2.4}
              className="origin-bottom animate-grow"
              style={{ animationDelay: `${140 + i * 40}ms` }}
              fill={isPeak ? 'rgb(var(--accent))' : 'rgb(var(--border-strong))'}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tick row — 24 hourly ticks, business hours highlighted
// ---------------------------------------------------------------------------

export function TickStatCard({
  label,
  value,
  icon,
  ticks,
  highlightFrom = 9,
  highlightTo = 17,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  ticks: number[];
  highlightFrom?: number;
  highlightTo?: number;
}) {
  const width = 240;
  const height = 40;
  const max = Math.max(...ticks, 1);
  const n = ticks.length;
  const step = width / n;

  return (
    <div className="flex min-h-[152px] animate-rise flex-col gap-3 rounded-card bg-surface p-5 shadow-warm-sm" style={{ animationDelay: '120ms' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-fg">{icon}</span>
      </div>
      <div className="font-display text-[32px] font-bold leading-none tracking-tight text-fg">{value}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-auto h-9 w-full">
        {ticks.map((v, hour) => {
          const h = Math.max(4, (v / max) * (height - 6));
          const inWindow = hour >= highlightFrom && hour < highlightTo;
          return (
            <rect
              key={hour}
              x={hour * step + step / 2 - 1.5}
              y={(height - h) / 2}
              width={3}
              height={h}
              rx={1.5}
              className="origin-center animate-grow"
              style={{ animationDelay: `${140 + hour * 15}ms` }}
              fill={inWindow ? 'rgb(var(--accent))' : 'rgb(var(--border-strong))'}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wave fill — a percentage, filled proportionally
// ---------------------------------------------------------------------------

export function WaveStatCard({
  label,
  value,
  icon,
  percent,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  percent: number;
}) {
  const width = 240;
  const height = 40;
  // Higher percent -> the wave sits higher (lower y) in the card.
  const baseline = height - 4 - (Math.min(100, Math.max(0, percent)) / 100) * (height - 14);
  const path = `M0,${baseline} C30,${baseline - 8} 50,${baseline - 8} 80,${baseline} S130,${baseline + 10} 160,${baseline} S210,${baseline - 10} 240,${baseline - 2}`;
  const fillPath = `${path} L240,${height} L0,${height} Z`;

  return (
    <div className="flex min-h-[152px] animate-rise flex-col gap-3 overflow-hidden rounded-card bg-surface p-5 shadow-warm-sm" style={{ animationDelay: '180ms' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-fg">{icon}</span>
      </div>
      <div className="font-display text-[32px] font-bold leading-none tracking-tight text-fg">{value}</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-auto h-9 w-full" preserveAspectRatio="none">
        <path d={fillPath} fill="rgb(var(--accent) / 0.18)" />
        <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut — category breakdown
// ---------------------------------------------------------------------------

const DONUT_COLORS = ['viz-1', 'viz-3', 'viz-2', 'viz-4'] as const;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * 80;

export function Donut({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: Array<{ label: string; percent: number }>;
  centerLabel: string;
  centerValue: React.ReactNode;
}) {
  let cumulative = 0;

  return (
    <div className="relative mx-auto h-[188px] w-[188px] shrink-0">
      <svg viewBox="0 0 200 200" className="h-[188px] w-[188px] drop-shadow-[0_8px_14px_rgba(60,52,44,0.16)]">
        <circle cx="100" cy="100" r="80" fill="none" stroke="rgb(var(--border))" strokeWidth="15" />
        {segments.map((segment, i) => {
          if (segment.percent <= 0) return null;
          const dash = (segment.percent / 100) * DONUT_CIRCUMFERENCE;
          const rotation = -90 + (cumulative / 100) * 360;
          cumulative += segment.percent;
          const colorVar = DONUT_COLORS[i % DONUT_COLORS.length];

          return (
            <circle
              key={segment.label}
              cx="100"
              cy="100"
              r="80"
              fill="none"
              stroke={`rgb(var(--${colorVar}))`}
              strokeWidth="15"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${DONUT_CIRCUMFERENCE}`}
              style={{ transformOrigin: '50% 50%', transform: `rotate(${rotation}deg)` }}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-display text-2xl font-bold leading-none text-fg">{centerValue}</div>
          <div className="mt-1.5 text-2xs font-semibold text-faint">{centerLabel}</div>
        </div>
      </div>
    </div>
  );
}

export function DonutLegend({
  segments,
}: {
  segments: Array<{ label: string; percent: number; duration: string }>;
}) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-4">
      {segments.map((segment, i) => {
        const colorVar = DONUT_COLORS[i % DONUT_COLORS.length];
        return (
          <div key={segment.label}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-bold" style={{ color: `rgb(var(--${colorVar}))` }}>
                <span className="h-2 w-2 rounded-full" style={{ background: `rgb(var(--${colorVar}))` }} />
                {segment.label}
              </span>
              <span className="font-bold text-fg">{segment.duration}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full transition-[width] duration-1000 ease-spring"
                style={{ width: `${segment.percent}%`, background: `rgb(var(--${colorVar}))` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented budget bar
// ---------------------------------------------------------------------------

export function SegmentedBar({ total, filled }: { total: number; filled: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn('h-3.5 flex-1 rounded-[4px] transition-colors duration-500', i < filled ? 'bg-accent' : 'bg-elevated')}
          style={{ transitionDelay: `${i * 25}ms` }}
        />
      ))}
    </div>
  );
}
