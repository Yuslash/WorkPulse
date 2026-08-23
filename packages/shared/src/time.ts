/**
 * Time helpers shared by the API, the tester and the admin app.
 *
 * Everything on the wire is UTC ISO-8601. "Reporting day" boundaries are the
 * one place we deliberately use local wall-clock: an attendance row is about a
 * human's day, so 2026-08-19 must mean midnight-to-midnight where they work.
 */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** `YYYY-MM-DD` for a Date, in UTC. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses `YYYY-MM-DD` to the UTC midnight that starts that day. */
export function fromDateKey(key: string): Date {
  const parsed = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid date key: ${key}`);
  }
  return parsed;
}

/** Inclusive-exclusive UTC bounds for a reporting day. */
export function dayBounds(key: string): { start: Date; end: Date } {
  const start = fromDateKey(key);
  return { start, end: new Date(start.getTime() + DAY) };
}

/** Every date key from `from` to `to`, inclusive. Caps at 366 to bound queries. */
export function dateKeyRange(from: string, to: string): string[] {
  const start = fromDateKey(from);
  const end = fromDateKey(to);
  if (end < start) return [];

  const keys: string[] = [];
  for (let t = start.getTime(); t <= end.getTime() && keys.length < 366; t += DAY) {
    keys.push(toDateKey(new Date(t)));
  }
  return keys;
}

/**
 * Splits a span across UTC day boundaries so an overnight session is
 * attributed to both days rather than landing entirely on the start date.
 */
export function splitAcrossDays(
  startedAt: Date,
  endedAt: Date,
): Array<{ dateKey: string; start: Date; end: Date; durationSec: number }> {
  if (endedAt <= startedAt) return [];

  const parts: Array<{ dateKey: string; start: Date; end: Date; durationSec: number }> = [];
  let cursor = startedAt;

  // Bounded loop: a single span is never allowed to exceed a handful of days.
  for (let guard = 0; cursor < endedAt && guard < 400; guard += 1) {
    const dateKey = toDateKey(cursor);
    const { end: dayEnd } = dayBounds(dateKey);
    const segmentEnd = dayEnd < endedAt ? dayEnd : endedAt;

    parts.push({
      dateKey,
      start: cursor,
      end: segmentEnd,
      durationSec: Math.round((segmentEnd.getTime() - cursor.getTime()) / SECOND),
    });
    cursor = segmentEnd;
  }

  return parts;
}

/** `6h 42m` / `48m` / `31s` — the dashboard's duration format (spec §12). */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** `02:17:31` — used for the live "active for" ticker. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Parses `15m`, `7d`, `30s`, `2h` to milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) throw new Error(`invalid duration: ${value}`);

  const amount = Number(match[1]);
  switch (match[2]) {
    case 'ms':
      return amount;
    case 's':
      return amount * SECOND;
    case 'm':
      return amount * MINUTE;
    case 'h':
      return amount * HOUR;
    default:
      return amount * DAY;
  }
}
