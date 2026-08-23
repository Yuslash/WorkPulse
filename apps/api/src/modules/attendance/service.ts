import { ObjectId } from 'mongodb';
import { InactivityKind, dayBounds, toDateKey, type AttendanceDay } from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { env } from '../../config/env.js';

/**
 * Attendance rollups (spec §10).
 *
 * Attendance is *derived*, never reported. Recomputing a day from its source
 * spans is idempotent, which matters because an offline agent can deliver
 * yesterday's data today — an incremental counter would double-count on
 * replay, whereas a recompute simply produces the right answer again.
 *
 * Recompute is debounced: telemetry ingest marks a (employee, day) dirty and a
 * worker drains the set on an interval, so a 500-event batch triggers one
 * recompute instead of 500.
 */

interface DirtyKey {
  organizationId: ObjectId;
  employeeId: ObjectId;
  dateKey: string;
}

const dirty = new Map<string, DirtyKey>();

export function markAttendanceDirty(
  organizationId: ObjectId,
  employeeId: ObjectId,
  dateKey: string,
): void {
  dirty.set(`${employeeId.toHexString()}:${dateKey}`, { organizationId, employeeId, dateKey });
}

export function pendingAttendanceCount(): number {
  return dirty.size;
}

/**
 * Recomputes one employee-day from source spans.
 *
 * `activeSec` is time in a foreground application, minus any overlap with an
 * idle or locked span. The agent should not emit overlapping spans, but a
 * clock adjustment or a crash mid-session can produce them, and double
 * counting would inflate someone's working day.
 */
export async function recomputeAttendance(
  organizationId: ObjectId,
  employeeId: ObjectId,
  dateKey: string,
): Promise<AttendanceDay | null> {
  const { start, end } = dayBounds(dateKey);
  const window = { $gte: start, $lt: end };

  const [appSessions, inactivity, firstHeartbeat, lastHeartbeat] = await Promise.all([
    collections
      .appSessions()
      .find({ employeeId, startedAt: window })
      .project<{ startedAt: Date; endedAt: Date }>({ startedAt: 1, endedAt: 1 })
      .toArray(),
    collections
      .inactivity()
      .find({ employeeId, startedAt: window })
      .project<{ kind: string; startedAt: Date; endedAt: Date }>({ kind: 1, startedAt: 1, endedAt: 1 })
      .toArray(),
    collections
      .heartbeats()
      .find({ 'meta.employeeId': employeeId, ts: window })
      .sort({ ts: 1 })
      .limit(1)
      .toArray(),
    collections
      .heartbeats()
      .find({ 'meta.employeeId': employeeId, ts: window })
      .sort({ ts: -1 })
      .limit(1)
      .toArray(),
  ]);

  const idleSpans = inactivity.filter((s) => s.kind !== InactivityKind.Locked);
  const lockedSpans = inactivity.filter((s) => s.kind === InactivityKind.Locked);

  const idleSec = mergedDurationSec(idleSpans);
  const lockedSec = mergedDurationSec(lockedSpans);
  const appSec = mergedDurationSec(appSessions);

  // Foreground-app time that overlaps an idle/locked span is not active work:
  // the window stays focused while the person is away from the keyboard.
  const overlapSec = overlapDurationSec(appSessions, inactivity);
  const activeSec = Math.max(0, appSec - overlapSec);

  const candidates: Date[] = [
    ...appSessions.map((s) => s.startedAt),
    ...inactivity.map((s) => s.startedAt),
    ...(firstHeartbeat[0] ? [firstHeartbeat[0].ts] : []),
  ];
  const endCandidates: Date[] = [
    ...appSessions.map((s) => s.endedAt),
    ...inactivity.map((s) => s.endedAt),
    ...(lastHeartbeat[0] ? [lastHeartbeat[0].ts] : []),
  ];

  if (candidates.length === 0 && endCandidates.length === 0) {
    // Nothing happened; remove any stale row rather than leaving zeros that
    // would read as "present but did nothing".
    await collections.attendanceDaily().deleteOne({ employeeId, dateKey });
    return null;
  }

  const firstSeen = candidates.length > 0 ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
  const lastSeen = endCandidates.length > 0 ? new Date(Math.max(...endCandidates.map((d) => d.getTime()))) : null;

  const sessionSec =
    firstSeen && lastSeen ? Math.max(0, Math.round((lastSeen.getTime() - firstSeen.getTime()) / 1000)) : 0;

  const now = new Date();
  await collections.attendanceDaily().updateOne(
    { employeeId, dateKey },
    {
      $set: {
        organizationId,
        firstSeen,
        lastSeen,
        activeSec,
        idleSec,
        lockedSec,
        sessionSec,
        updatedAt: now,
      },
      $setOnInsert: { _id: new ObjectId(), employeeId, dateKey },
    },
    { upsert: true },
  );

  const employee = await collections.employees().findOne({ _id: employeeId }, { projection: { name: 1 } });

  return {
    employeeId: employeeId.toHexString(),
    employeeName: employee?.name ?? 'Unknown',
    date: dateKey,
    firstSeen: firstSeen?.toISOString() ?? null,
    lastSeen: lastSeen?.toISOString() ?? null,
    activeSec,
    idleSec,
    lockedSec,
    sessionSec,
  };
}

interface Span {
  startedAt: Date;
  endedAt: Date;
}

/**
 * Total covered time after merging overlaps — the union, not the sum.
 * Two overlapping app sessions (a race at a window switch) must not count
 * their shared seconds twice.
 */
export function mergedDurationSec(spans: Span[]): number {
  if (spans.length === 0) return 0;

  const sorted = [...spans].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  let total = 0;
  let currentStart = sorted[0]!.startedAt.getTime();
  let currentEnd = sorted[0]!.endedAt.getTime();

  for (let i = 1; i < sorted.length; i += 1) {
    const span = sorted[i]!;
    const start = span.startedAt.getTime();
    const end = span.endedAt.getTime();

    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }

  total += currentEnd - currentStart;
  return Math.max(0, Math.round(total / 1000));
}

/** Seconds where the merged union of `a` intersects the merged union of `b`. */
export function overlapDurationSec(a: Span[], b: Span[]): number {
  if (a.length === 0 || b.length === 0) return 0;

  const mergeRanges = (spans: Span[]): Array<[number, number]> => {
    const sorted = [...spans].sort((x, y) => x.startedAt.getTime() - y.startedAt.getTime());
    const ranges: Array<[number, number]> = [];

    for (const span of sorted) {
      const start = span.startedAt.getTime();
      const end = span.endedAt.getTime();
      const last = ranges[ranges.length - 1];

      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        ranges.push([start, end]);
      }
    }
    return ranges;
  };

  const rangesA = mergeRanges(a);
  const rangesB = mergeRanges(b);

  let total = 0;
  let i = 0;
  let j = 0;

  // Two-pointer sweep over both sorted range lists.
  while (i < rangesA.length && j < rangesB.length) {
    const [startA, endA] = rangesA[i]!;
    const [startB, endB] = rangesB[j]!;

    const start = Math.max(startA, startB);
    const end = Math.min(endA, endB);
    if (end > start) total += end - start;

    if (endA < endB) i += 1;
    else j += 1;
  }

  return Math.max(0, Math.round(total / 1000));
}

/** Drains the dirty set. Returns how many employee-days were recomputed. */
export async function flushAttendance(): Promise<number> {
  if (dirty.size === 0) return 0;

  const batch = [...dirty.values()];
  dirty.clear();

  await Promise.all(
    batch.map((key) =>
      recomputeAttendance(key.organizationId, key.employeeId, key.dateKey).catch(() => undefined),
    ),
  );

  return batch.length;
}

let flushTimer: NodeJS.Timeout | null = null;

export function startAttendanceWorker(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushAttendance().catch(() => undefined);
  }, env.ROLLUP_INTERVAL_SEC * 1000);
  flushTimer.unref();
}

export function stopAttendanceWorker(): void {
  if (!flushTimer) return;
  clearInterval(flushTimer);
  flushTimer = null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getAttendanceForDay(
  organizationId: ObjectId,
  dateKey: string,
  employeeIds?: ObjectId[],
): Promise<AttendanceDay[]> {
  const filter: Record<string, unknown> = { organizationId, dateKey };
  if (employeeIds) filter.employeeId = { $in: employeeIds };

  const rows = await collections.attendanceDaily().find(filter).toArray();
  if (rows.length === 0) return [];

  const employees = await collections
    .employees()
    .find({ _id: { $in: rows.map((r) => r.employeeId) } })
    .project<{ _id: ObjectId; name: string }>({ name: 1 })
    .toArray();

  const nameById = new Map(employees.map((e) => [e._id.toHexString(), e.name]));

  return rows.map((row) => ({
    employeeId: row.employeeId.toHexString(),
    employeeName: nameById.get(row.employeeId.toHexString()) ?? 'Unknown',
    date: row.dateKey,
    firstSeen: row.firstSeen?.toISOString() ?? null,
    lastSeen: row.lastSeen?.toISOString() ?? null,
    activeSec: row.activeSec,
    idleSec: row.idleSec,
    lockedSec: row.lockedSec,
    sessionSec: row.sessionSec,
  }));
}

export async function getAttendanceRange(
  organizationId: ObjectId,
  employeeId: ObjectId,
  fromKey: string,
  toKey: string,
): Promise<AttendanceDay[]> {
  const rows = await collections
    .attendanceDaily()
    .find({ organizationId, employeeId, dateKey: { $gte: fromKey, $lte: toKey } })
    .sort({ dateKey: 1 })
    .toArray();

  const employee = await collections.employees().findOne({ _id: employeeId }, { projection: { name: 1 } });

  return rows.map((row) => ({
    employeeId: row.employeeId.toHexString(),
    employeeName: employee?.name ?? 'Unknown',
    date: row.dateKey,
    firstSeen: row.firstSeen?.toISOString() ?? null,
    lastSeen: row.lastSeen?.toISOString() ?? null,
    activeSec: row.activeSec,
    idleSec: row.idleSec,
    lockedSec: row.lockedSec,
    sessionSec: row.sessionSec,
  }));
}

/** Today's totals for one employee, used by the employee list rows. */
export async function getTodayTotals(
  employeeIds: ObjectId[],
  dateKey = toDateKey(new Date()),
): Promise<Map<string, { activeSec: number; idleSec: number }>> {
  if (employeeIds.length === 0) return new Map();

  const rows = await collections
    .attendanceDaily()
    .find({ employeeId: { $in: employeeIds }, dateKey })
    .project<{ employeeId: ObjectId; activeSec: number; idleSec: number }>({
      employeeId: 1,
      activeSec: 1,
      idleSec: 1,
    })
    .toArray();

  return new Map(
    rows.map((row) => [row.employeeId.toHexString(), { activeSec: row.activeSec, idleSec: row.idleSec }]),
  );
}
