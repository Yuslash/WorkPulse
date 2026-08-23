import { ObjectId } from 'mongodb';
import {
  AppCategory,
  InactivityKind,
  dayBounds,
  toDateKey,
  type AppUsage,
  type CategoryBreakdown,
  type TimelineEntry,
  type TimelineResponse,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';

/**
 * Read models for the activity views: the timeline (spec §13) and the
 * application analytics (spec §14).
 */

/**
 * Merges application and inactivity spans into one chronological track.
 *
 * They are separate collections because they are written by different
 * collectors, but the employee's day is a single line and the UI renders it
 * as one — so the merge happens here rather than in the browser.
 */
export async function getTimeline(
  organizationId: ObjectId,
  employeeId: ObjectId,
  dateKey: string,
): Promise<TimelineResponse> {
  const { start, end } = dayBounds(dateKey);
  const window = { $gte: start, $lt: end };

  const [appSessions, inactivity] = await Promise.all([
    collections
      .appSessions()
      .find({ organizationId, employeeId, startedAt: window })
      .sort({ startedAt: 1 })
      .toArray(),
    collections
      .inactivity()
      .find({ organizationId, employeeId, startedAt: window })
      .sort({ startedAt: 1 })
      .toArray(),
  ]);

  const entries: TimelineEntry[] = [
    ...appSessions.map((session) => ({
      kind: 'app' as const,
      label: session.appName,
      category: session.category,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      durationSec: session.durationSec,
    })),
    ...inactivity.map((span) => ({
      kind: span.kind === InactivityKind.Locked ? ('locked' as const) : span.kind === InactivityKind.Away ? ('away' as const) : ('idle' as const),
      label: span.kind === InactivityKind.Locked ? 'Screen locked' : span.kind === InactivityKind.Away ? 'Away' : 'Idle',
      category: null,
      startedAt: span.startedAt.toISOString(),
      endedAt: span.endedAt.toISOString(),
      durationSec: span.durationSec,
    })),
  ].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const firstSeen = entries[0]?.startedAt ?? null;
  const lastSeen = entries.length > 0
    ? entries.reduce((latest, entry) => (entry.endedAt > latest ? entry.endedAt : latest), entries[0]!.endedAt)
    : null;

  return { date: dateKey, entries, firstSeen, lastSeen };
}

/** Per-application totals for a date range (spec §14). */
export async function getAppUsage(
  organizationId: ObjectId,
  options: { employeeId?: ObjectId; fromKey: string; toKey: string; limit?: number },
): Promise<AppUsage[]> {
  const match: Record<string, unknown> = {
    organizationId,
    dateKey: { $gte: options.fromKey, $lte: options.toKey },
  };
  if (options.employeeId) match.employeeId = options.employeeId;

  return collections
    .appSessions()
    .aggregate<AppUsage>([
      { $match: match },
      {
        $group: {
          _id: '$exeName',
          appName: { $first: '$appName' },
          category: { $first: '$category' },
          durationSec: { $sum: '$durationSec' },
          sessionCount: { $sum: 1 },
        },
      },
      { $sort: { durationSec: -1 } },
      { $limit: options.limit ?? 25 },
      {
        $project: {
          _id: 0,
          exeName: '$_id',
          appName: 1,
          category: 1,
          durationSec: 1,
          sessionCount: 1,
        },
      },
    ])
    .toArray();
}

/**
 * Category split (spec §15).
 *
 * Deliberately named "Activity Insights" in the UI, not a productivity score:
 * the percentages describe where time went against admin-defined categories,
 * and nothing here judges an individual.
 */
export async function getCategoryBreakdown(
  organizationId: ObjectId,
  options: { employeeId?: ObjectId; fromKey: string; toKey: string },
): Promise<CategoryBreakdown[]> {
  const match: Record<string, unknown> = {
    organizationId,
    dateKey: { $gte: options.fromKey, $lte: options.toKey },
  };
  if (options.employeeId) match.employeeId = options.employeeId;

  const rows = await collections
    .appSessions()
    .aggregate<{ _id: AppCategory; durationSec: number }>([
      { $match: match },
      { $group: { _id: '$category', durationSec: { $sum: '$durationSec' } } },
    ])
    .toArray();

  const total = rows.reduce((sum, row) => sum + row.durationSec, 0);

  // Always emit every category, so the chart legend is stable rather than
  // appearing and disappearing as data arrives.
  const order: AppCategory[] = [
    AppCategory.Productive,
    AppCategory.Neutral,
    AppCategory.Break,
    AppCategory.Restricted,
  ];

  return order.map((category) => {
    const durationSec = rows.find((row) => row._id === category)?.durationSec ?? 0;
    return {
      category,
      durationSec,
      percent: total > 0 ? Math.round((durationSec / total) * 1000) / 10 : 0,
    };
  });
}

/** Hourly active seconds for the overview chart. */
export async function getHourlyActivity(
  organizationId: ObjectId,
  dateKey = toDateKey(new Date()),
): Promise<Array<{ hour: number; activeSec: number }>> {
  const { start, end } = dayBounds(dateKey);

  const rows = await collections
    .appSessions()
    .aggregate<{ _id: number; activeSec: number }>([
      { $match: { organizationId, startedAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { $hour: { date: '$startedAt', timezone: 'UTC' } },
          activeSec: { $sum: '$durationSec' },
        },
      },
    ])
    .toArray();

  const byHour = new Map(rows.map((row) => [row._id, row.activeSec]));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, activeSec: byHour.get(hour) ?? 0 }));
}

export interface EmployeeUsageRow {
  employeeId: string;
  employeeName: string;
  topAppName: string;
  topAppCategory: AppCategory;
  durationSec: number;
  sessionCount: number;
}

/**
 * Per-employee totals for a date range — the same window as `getAppUsage`,
 * grouped the other way around. Powers the Applications page's "by employee"
 * view, where clicking a row goes to that person's detail page rather than
 * to an application.
 */
export async function getEmployeeUsage(
  organizationId: ObjectId,
  options: { fromKey: string; toKey: string; limit?: number },
): Promise<EmployeeUsageRow[]> {
  const rows = await collections
    .appSessions()
    .aggregate<{
      _id: ObjectId;
      totalDurationSec: number;
      sessionCount: number;
      topApp: { appName: string; category: AppCategory; durationSec: number };
    }>([
      { $match: { organizationId, dateKey: { $gte: options.fromKey, $lte: options.toKey } } },
      {
        // Per (employee, exe) subtotals first, so "top app" reflects the
        // single application used most — not just whichever session happened
        // to sort first.
        $group: {
          _id: { employeeId: '$employeeId', exeName: '$exeName' },
          appName: { $first: '$appName' },
          category: { $first: '$category' },
          durationSec: { $sum: '$durationSec' },
          sessionCount: { $sum: 1 },
        },
      },
      { $sort: { durationSec: -1 } },
      {
        $group: {
          _id: '$_id.employeeId',
          totalDurationSec: { $sum: '$durationSec' },
          sessionCount: { $sum: '$sessionCount' },
          topApp: { $first: { appName: '$appName', category: '$category', durationSec: '$durationSec' } },
        },
      },
      { $sort: { totalDurationSec: -1 } },
      { $limit: options.limit ?? 50 },
    ])
    .toArray();

  if (rows.length === 0) return [];

  const employees = await collections
    .employees()
    .find({ _id: { $in: rows.map((row) => row._id) } })
    .project<{ _id: ObjectId; name: string }>({ name: 1 })
    .toArray();
  const nameById = new Map(employees.map((employee) => [employee._id.toHexString(), employee.name]));

  return rows.map((row) => ({
    employeeId: row._id.toHexString(),
    employeeName: nameById.get(row._id.toHexString()) ?? 'Unknown',
    topAppName: row.topApp.appName,
    topAppCategory: row.topApp.category,
    durationSec: row.totalDurationSec,
    sessionCount: row.sessionCount,
  }));
}

/** Raw inactivity spans for the employee detail page. */
export async function getInactivitySpans(
  organizationId: ObjectId,
  employeeId: ObjectId,
  dateKey: string,
) {
  const { start, end } = dayBounds(dateKey);

  const spans = await collections
    .inactivity()
    .find({ organizationId, employeeId, startedAt: { $gte: start, $lt: end } })
    .sort({ startedAt: 1 })
    .toArray();

  return spans.map((span) => ({
    id: span._id.toHexString(),
    kind: span.kind,
    startedAt: span.startedAt.toISOString(),
    endedAt: span.endedAt.toISOString(),
    durationSec: span.durationSec,
  }));
}
