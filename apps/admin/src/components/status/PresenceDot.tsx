import { useEffect, useState } from 'react';
import { PresenceState } from '@workpulse/shared';
import { cn, formatClock } from '@/lib/format';

/**
 * Presence colours from spec §11:
 *   green  active   yellow  idle   slate  locked   red  offline
 *
 * Colour is never the only signal — every dot is paired with its label
 * somewhere in the row, so the board is still readable for a colour-blind
 * viewer and in a screenshot printed in greyscale.
 */

const TONES: Record<PresenceState, { dot: string; text: string; label: string }> = {
  ACTIVE: { dot: 'bg-active', text: 'text-active', label: 'Active' },
  IDLE: { dot: 'bg-idle', text: 'text-idle', label: 'Idle' },
  LOCKED: { dot: 'bg-locked', text: 'text-locked', label: 'Locked' },
  OFFLINE: { dot: 'bg-offline', text: 'text-offline', label: 'Offline' },
};

export function PresenceDot({ state, pulse }: { state: PresenceState; pulse?: boolean }) {
  const tone = TONES[state] ?? TONES.OFFLINE;

  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', tone.dot, pulse && state === 'ACTIVE' && 'animate-pulse-dot')}
      role="img"
      aria-label={tone.label}
    />
  );
}

export function PresenceLabel({ state }: { state: PresenceState }) {
  const tone = TONES[state] ?? TONES.OFFLINE;
  return <span className={cn('text-xs font-medium', tone.text)}>{tone.label}</span>;
}

export function PresenceBadge({ state, pulse }: { state: PresenceState; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PresenceDot state={state} pulse={pulse} />
      <PresenceLabel state={state} />
    </span>
  );
}

/**
 * A clock that ticks forward locally between server pushes.
 *
 * Presence updates arrive only on a state change, so without this the
 * "active for" figure would sit frozen at 02:17:31 for an hour and look
 * broken. `sinceSec` re-seeds it whenever the server does send an update.
 */
export function LiveDuration({
  sinceSec,
  className,
  paused,
}: {
  sinceSec: number | null;
  className?: string;
  paused?: boolean;
}) {
  const [elapsed, setElapsed] = useState(sinceSec ?? 0);

  useEffect(() => {
    setElapsed(sinceSec ?? 0);
  }, [sinceSec]);

  useEffect(() => {
    if (sinceSec === null || paused) return;

    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [sinceSec, paused]);

  if (sinceSec === null) return <span className={cn('text-faint', className)}>—</span>;

  return <span className={cn('tabular', className)}>{formatClock(elapsed)}</span>;
}
