import { formatClock, formatDuration } from '@workpulse/shared';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class joiner: later classes win over earlier conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { formatDuration, formatClock };

/** `09:04` in the viewer's local timezone. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** `19 Aug 2026`. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${formatDate(iso)} ${formatTime(iso)}`;
}

/**
 * `3 sec ago`, `17 min ago`. The live board leans on this heavily, so it
 * stays terse rather than grammatically complete.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';

  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/** `YYYY-MM-DD` for the viewer's today, used to seed date pickers. */
export function todayKey(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-${day}`;
}

export function daysAgoKey(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Megabytes as reported by the agent, rendered as `16 GB`. */
export function formatRam(megabytes: number | null | undefined): string {
  if (!megabytes) return '—';
  return megabytes >= 1024 ? `${Math.round(megabytes / 1024)} GB` : `${megabytes} MB`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
