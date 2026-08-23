import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { formatDuration } from '@workpulse/shared';
import { useAttendanceDay, useRecomputeAttendance } from '@/features/queries';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { formatTime, todayKey } from '@/lib/format';

/** Attendance, derived rather than clocked (spec §10). */
export function AttendancePage() {
  const [date, setDate] = useState(todayKey());
  const query = useAttendanceDay(date);
  const recompute = useRecomputeAttendance();

  const rows = query.data?.rows ?? [];

  const totals = rows.reduce(
    (sum, row) => ({
      active: sum.active + row.activeSec,
      idle: sum.idle + row.idleSec,
      session: sum.session + row.sessionSec,
    }),
    { active: 0, idle: 0, session: 0 },
  );

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Calculated from reported activity — first and last signs of work, not a clock-in button."
        action={
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              max={todayKey()}
              onChange={(event) => setDate(event.target.value)}
              className="w-auto"
              aria-label="Attendance date"
            />
            <Button
              loading={recompute.isPending}
              onClick={() => recompute.mutate({ date })}
              title="Rollups run about once a minute; this recalculates immediately."
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recalculate
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Present" value={rows.length} hint="Employees with activity" />
        <Stat label="Total active" value={formatDuration(totals.active)} tone="active" />
        <Stat label="Total idle" value={formatDuration(totals.idle)} tone="idle" />
        <Stat
          label="Average session"
          value={rows.length > 0 ? formatDuration(Math.round(totals.session / rows.length)) : '—'}
        />
      </div>

      <Card className="mt-4">
        {query.isLoading ? (
          <LoadingBlock label="Loading attendance" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No attendance for this day"
            description="Nobody reported activity on this date. If you expected data, check that agents are enrolled and reporting on the Agent Health page."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>First activity</Th>
                <Th>Last activity</Th>
                <Th className="text-right">Active</Th>
                <Th className="text-right">Idle</Th>
                <Th className="text-right">Locked</Th>
                <Th className="text-right">Session</Th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => b.activeSec - a.activeSec)
                .map((row) => (
                  <tr key={row.employeeId} className="hover:bg-elevated/40">
                    <Td>
                      <Link to={`/employees/${row.employeeId}`} className="hover:text-accent">
                        {row.employeeName}
                      </Link>
                    </Td>
                    <Td className="tabular text-muted">{formatTime(row.firstSeen)}</Td>
                    <Td className="tabular text-muted">{formatTime(row.lastSeen)}</Td>
                    <Td className="tabular text-right">{formatDuration(row.activeSec)}</Td>
                    <Td className="tabular text-right text-muted">{formatDuration(row.idleSec)}</Td>
                    <Td className="tabular text-right text-muted">{formatDuration(row.lockedSec)}</Td>
                    <Td className="tabular text-right">{formatDuration(row.sessionSec)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-3 text-2xs text-faint">
        Session is the wall-clock span from first to last activity and includes breaks. Active
        excludes time the machine was idle or locked.
      </p>
    </>
  );
}
