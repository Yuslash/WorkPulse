import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, RefreshCw } from 'lucide-react';
import { Role, formatDuration } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import { useEmployeePresence } from '@/lib/realtime';
import {
  useApplications,
  useAttendanceRange,
  useEmployee,
  useRecomputeAttendance,
  useTimeline,
} from '@/features/queries';
import { CredentialsDialog } from '@/features/employees/CredentialsDialog';
import { Timeline, TimelineList } from '@/components/timeline/Timeline';
import { PresenceBadge, LiveDuration } from '@/components/status/PresenceDot';
import {
  Button,
  Card,
  CardHeader,
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
import { daysAgoKey, formatDate, formatTime, todayKey } from '@/lib/format';

/** The employee detail view (spec §12 and §49). */
export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();

  const [date, setDate] = useState(todayKey());
  const [showCredentials, setShowCredentials] = useState(false);

  const employee = useEmployee(id);
  const timeline = useTimeline(id, date);
  const applications = useApplications({ employeeId: id, from: date, to: date });
  const attendance = useAttendanceRange(id, daysAgoKey(13), todayKey());
  const recompute = useRecomputeAttendance();

  // Live presence overrides the fetched snapshot, so the header reacts the
  // moment the employee's state changes.
  const live = useEmployeePresence(id ?? '');

  if (employee.isLoading) return <LoadingBlock label="Loading employee" />;
  if (employee.isError) return <ErrorState error={employee.error} onRetry={() => employee.refetch()} />;
  if (!employee.data) return null;

  const person = employee.data;
  const presenceState = live?.state ?? person.presence.state;
  const currentApp = live?.currentApplication ?? person.presence.currentApplication;
  const stateSince = live?.stateSinceSec ?? person.presence.stateSinceSec;
  const isToday = date === todayKey();

  const todayAttendance = attendance.data?.rows.find((row) => row.date === date);

  return (
    <>
      <Link
        to="/employees"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All employees
      </Link>

      <PageHeader
        title={person.name}
        description={[person.jobTitle, person.departmentName, person.email]
          .filter(Boolean)
          .join(' · ')}
        action={
          can(Role.HrAdmin) ? (
            <Button onClick={() => setShowCredentials(true)}>
              <KeyRound className="h-3.5 w-3.5" />
              Agent login
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="px-4 py-3">
          <div className="label">Status</div>
          <div className="mt-1.5">
            <PresenceBadge state={presenceState} pulse />
          </div>
          <div className="mt-1 text-xs text-muted">
            {presenceState === 'OFFLINE' ? (
              person.presence.lastSeenAt ? (
                `Last seen ${formatTime(person.presence.lastSeenAt)}`
              ) : (
                'Never reported'
              )
            ) : (
              // Ticks locally between pushes so it never looks frozen.
              <LiveDuration sinceSec={stateSince} />
            )}
          </div>
        </Card>

        <Card className="px-4 py-3">
          <div className="label">Current application</div>
          <div className="mt-1 truncate text-sm font-medium">{currentApp ?? '—'}</div>
          <div className="mt-1 text-xs text-faint">
            {person.deviceCount} device{person.deviceCount === 1 ? '' : 's'} enrolled
          </div>
        </Card>

        <Stat
          label={isToday ? 'Active today' : 'Active'}
          value={formatDuration(todayAttendance?.activeSec ?? (isToday ? person.todayActiveSec : 0))}
          tone="active"
        />
        <Stat
          label="Idle"
          value={formatDuration(todayAttendance?.idleSec ?? (isToday ? person.todayIdleSec : 0))}
          tone="idle"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="detail-date" className="label">
          Day
        </label>
        <Input
          id="detail-date"
          type="date"
          value={date}
          max={todayKey()}
          onChange={(event) => setDate(event.target.value)}
          className="w-auto"
        />
        <Button
          size="sm"
          loading={recompute.isPending}
          onClick={() => recompute.mutate({ employeeId: id, date })}
          title="Attendance rollups run about once a minute; this recalculates immediately."
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Recalculate
        </Button>
        {todayAttendance && (
          <span className="ml-auto text-xs text-muted">
            {formatTime(todayAttendance.firstSeen)} – {formatTime(todayAttendance.lastSeen)} ·{' '}
            <span className="tabular">{formatDuration(todayAttendance.sessionSec)}</span> session
          </span>
        )}
      </div>

      <Card className="mt-3">
        <CardHeader title={`Activity timeline — ${formatDate(`${date}T00:00:00.000Z`)}`} />
        {timeline.isLoading ? (
          <LoadingBlock />
        ) : timeline.isError ? (
          <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />
        ) : (
          <>
            <Timeline entries={timeline.data?.entries ?? []} />
            <div className="border-t border-border">
              <TimelineList entries={timeline.data?.entries ?? []} />
            </div>
          </>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Applications this day" />
          {applications.isLoading ? (
            <LoadingBlock />
          ) : (applications.data?.applications.length ?? 0) === 0 ? (
            <EmptyState title="No application activity" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Application</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Time</Th>
                  <Th className="text-right">Sessions</Th>
                </tr>
              </thead>
              <tbody>
                {applications.data?.applications.map((app) => (
                  <tr key={app.exeName}>
                    <Td>{app.appName}</Td>
                    <Td className="text-xs text-muted">{app.category}</Td>
                    <Td className="tabular text-right">{formatDuration(app.durationSec)}</Td>
                    <Td className="tabular text-right text-muted">{app.sessionCount}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Attendance — last 14 days" />
          {attendance.isLoading ? (
            <LoadingBlock />
          ) : (attendance.data?.rows.length ?? 0) === 0 ? (
            <EmptyState
              title="No attendance recorded"
              description="Attendance is derived from reported activity; it appears once an enrolled agent starts sending data."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>First</Th>
                  <Th>Last</Th>
                  <Th className="text-right">Active</Th>
                  <Th className="text-right">Idle</Th>
                </tr>
              </thead>
              <tbody>
                {[...(attendance.data?.rows ?? [])].reverse().map((row) => (
                  <tr
                    key={row.date}
                    className="cursor-pointer hover:bg-elevated/40"
                    onClick={() => setDate(row.date)}
                  >
                    <Td>{row.date}</Td>
                    <Td className="tabular text-muted">{formatTime(row.firstSeen)}</Td>
                    <Td className="tabular text-muted">{formatTime(row.lastSeen)}</Td>
                    <Td className="tabular text-right">{formatDuration(row.activeSec)}</Td>
                    <Td className="tabular text-right text-muted">{formatDuration(row.idleSec)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {showCredentials && id && (
        <CredentialsDialog
          employeeId={id}
          employeeName={person.name}
          open
          onClose={() => setShowCredentials(false)}
        />
      )}
    </>
  );
}
