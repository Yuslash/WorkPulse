import { useMemo, useState } from 'react';
import type { TimelineEntry } from '@workpulse/shared';
import { formatDuration } from '@workpulse/shared';
import { cn, formatTime } from '@/lib/format';

/**
 * The activity timeline (spec §13).
 *
 * Rendered as a single proportional track across the working day rather than
 * a list of rows: the shape of someone's day — long focused blocks versus
 * constant switching — is the thing that carries information, and a table
 * hides it.
 */

const KIND_COLORS: Record<TimelineEntry['kind'], string> = {
  app: 'bg-accent',
  idle: 'bg-idle',
  locked: 'bg-locked',
  away: 'bg-locked',
};

const KIND_LABELS: Record<TimelineEntry['kind'], string> = {
  app: 'Application',
  idle: 'Idle',
  locked: 'Screen locked',
  away: 'Away',
};

interface Positioned extends TimelineEntry {
  leftPct: number;
  widthPct: number;
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const [hovered, setHovered] = useState<Positioned | null>(null);

  const { positioned, startMs, endMs } = useMemo(() => {
    if (entries.length === 0) return { positioned: [], startMs: 0, endMs: 0 };

    const starts = entries.map((entry) => new Date(entry.startedAt).getTime());
    const ends = entries.map((entry) => new Date(entry.endedAt).getTime());

    // Pad by 15 minutes so the first and last blocks are not flush against
    // the edges and remain clickable.
    const rawStart = Math.min(...starts);
    const rawEnd = Math.max(...ends);
    const padding = 15 * 60 * 1000;

    const startMs = rawStart - padding;
    const endMs = rawEnd + padding;
    const span = Math.max(1, endMs - startMs);

    const positioned = entries.map((entry) => {
      const entryStart = new Date(entry.startedAt).getTime();
      const entryEnd = new Date(entry.endedAt).getTime();

      return {
        ...entry,
        leftPct: ((entryStart - startMs) / span) * 100,
        // A 20-second session would otherwise be invisible; floor the width so
        // every recorded span is at least perceivable.
        widthPct: Math.max(0.35, ((entryEnd - entryStart) / span) * 100),
      };
    });

    return { positioned, startMs, endMs };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-xs text-faint">
        No activity recorded for this day.
      </div>
    );
  }

  // Hour gridlines across the visible span.
  const hourMarks: Array<{ leftPct: number; label: string }> = [];
  const span = Math.max(1, endMs - startMs);
  const firstHour = new Date(startMs);
  firstHour.setMinutes(0, 0, 0);

  for (let t = firstHour.getTime(); t <= endMs; t += 3600_000) {
    if (t < startMs) continue;
    hourMarks.push({
      leftPct: ((t - startMs) / span) * 100,
      label: new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }),
    });
  }

  return (
    <div className="px-4 py-4">
      <div className="relative">
        {/* Hour gridlines */}
        <div className="relative h-4">
          {hourMarks.map((mark) => (
            <span
              key={mark.label}
              className="absolute -translate-x-1/2 text-2xs text-faint"
              style={{ left: `${mark.leftPct}%` }}
            >
              {mark.label}
            </span>
          ))}
        </div>

        <div className="relative mt-1 h-14 overflow-hidden rounded-2xl bg-elevated/80 border border-border/80 shadow-warm-sm">
          {hourMarks.map((mark) => (
            <span
              key={`line-${mark.label}`}
              className="absolute top-0 h-full w-px bg-border/60"
              style={{ left: `${mark.leftPct}%` }}
              aria-hidden
            />
          ))}

          {positioned.map((entry, index) => (
            <button
              key={`${entry.startedAt}-${index}`}
              type="button"
              className={cn(
                'absolute top-0 h-full transition-opacity hover:brightness-110 cursor-pointer',
                KIND_COLORS[entry.kind],
                entry.kind !== 'app' && 'opacity-70',
              )}
              style={{ left: `${entry.leftPct}%`, width: `${entry.widthPct}%` }}
              onMouseEnter={() => setHovered(entry)}
              onFocus={() => setHovered(entry)}
              onMouseLeave={() => setHovered(null)}
              onBlur={() => setHovered(null)}
              aria-label={`${entry.label}, ${formatTime(entry.startedAt)} to ${formatTime(entry.endedAt)}, ${formatDuration(entry.durationSec)}`}
            />
          ))}
        </div>

        {/* A fixed-height slot so hovering does not shift the layout. */}
        <div className="mt-2.5 min-h-[36px]">
          {hovered ? (
            <div className="animate-fade-in rounded-xl bg-surface px-4 py-2 text-xs font-semibold shadow-warm-sm border border-border/80 flex items-center justify-between">
              <span className="font-bold text-fg">{hovered.label}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted font-mono">
                  {formatTime(hovered.startedAt)} – {formatTime(hovered.endedAt)}
                </span>
                <span className="tabular font-bold text-accent font-mono">{formatDuration(hovered.durationSec)}</span>
              </div>
            </div>
          ) : (
            <p className="px-1 py-1 text-2xs text-muted font-medium">
              Hover over any timeline segment for continuous window details. ({entries.length} spans recorded)
            </p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 pt-2 border-t border-border/40">
        {(Object.keys(KIND_LABELS) as Array<TimelineEntry['kind']>).map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 text-2xs font-semibold text-muted">
            <span className={cn('h-2 w-2 rounded-full', KIND_COLORS[kind])} aria-hidden />
            {KIND_LABELS[kind]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Chronological list beneath the track, for exact times (spec §13). */
export function TimelineList({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="max-h-80 divide-y divide-border overflow-y-auto">
      {entries.map((entry, index) => (
        <div
          key={`${entry.startedAt}-${index}`}
          className="flex items-center gap-3 px-4 py-2 text-xs"
        >
          <span className="tabular w-12 shrink-0 text-faint">{formatTime(entry.startedAt)}</span>
          <span className={cn('h-2 w-2 shrink-0 rounded-sm', KIND_COLORS[entry.kind])} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          <span className="tabular shrink-0 text-muted">{formatDuration(entry.durationSec)}</span>
        </div>
      ))}
    </div>
  );
}
