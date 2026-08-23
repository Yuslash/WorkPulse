import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PresenceState, formatDuration } from '@workpulse/shared';
import { useEmployees } from '@/features/queries';
import { useRealtime } from '@/lib/realtime';
import { Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/ui';
import { PresenceDot } from '@/components/status/PresenceDot';

/**
 * Department view (spec §27).
 *
 * Derived from the employee roster rather than a separate endpoint: the
 * grouping is cheap in the client and always agrees with the list page.
 */
export function TeamsPage() {
  const { presence } = useRealtime();
  const query = useEmployees({ page: 1, limit: 200 });

  const groups = useMemo(() => {
    const byDepartment = new Map<
      string,
      {
        name: string;
        employees: number;
        active: number;
        idle: number;
        locked: number;
        offline: number;
        activeSec: number;
        members: Array<{ id: string; name: string; state: PresenceState; activeSec: number }>;
      }
    >();

    for (const employee of query.data?.items ?? []) {
      const key = employee.departmentId ?? 'unassigned';
      const name = employee.departmentName ?? 'No department';

      const group = byDepartment.get(key) ?? {
        name,
        employees: 0,
        active: 0,
        idle: 0,
        locked: 0,
        offline: 0,
        activeSec: 0,
        members: [],
      };

      const state = presence.get(employee.id)?.state ?? employee.presence.state;

      group.employees += 1;
      group.activeSec += employee.todayActiveSec;
      if (state === 'ACTIVE') group.active += 1;
      else if (state === 'IDLE') group.idle += 1;
      else if (state === 'LOCKED') group.locked += 1;
      else group.offline += 1;

      group.members.push({
        id: employee.id,
        name: employee.name,
        state,
        activeSec: employee.todayActiveSec,
      });

      byDepartment.set(key, group);
    }

    return [...byDepartment.values()].sort((a, b) => b.employees - a.employees);
  }, [query.data, presence]);

  if (query.isLoading) return <LoadingBlock label="Loading teams" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <>
      <PageHeader title="Teams" description="Availability and activity grouped by department." />

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            title="No employees to group"
            description="Add employees and assign them to departments to see team-level activity."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.name}>
              <CardHeader
                title={group.name}
                action={
                  <span className="text-xs text-muted">
                    {group.employees} employee{group.employees === 1 ? '' : 's'}
                  </span>
                }
              />

              <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
                <Metric label="Active" value={group.active} tone="text-active" />
                <Metric label="Idle" value={group.idle} tone="text-idle" />
                <Metric label="Locked" value={group.locked} tone="text-locked" />
                <Metric label="Offline" value={group.offline} tone="text-offline" />
              </div>

              <div className="border-b border-border px-4 py-2.5 text-xs">
                <span className="text-faint">Average active today </span>
                <span className="tabular ml-1 font-medium">
                  {formatDuration(
                    group.employees > 0 ? Math.round(group.activeSec / group.employees) : 0,
                  )}
                </span>
              </div>

              <div className="max-h-56 divide-y divide-border overflow-y-auto">
                {[...group.members]
                  .sort((a, b) => b.activeSec - a.activeSec)
                  .map((member) => (
                    <Link
                      key={member.id}
                      to={`/employees/${member.id}`}
                      className="flex items-center gap-2.5 px-4 py-2 text-xs hover:bg-elevated/50"
                    >
                      <PresenceDot state={member.state} />
                      <span className="min-w-0 flex-1 truncate">{member.name}</span>
                      <span className="tabular text-muted">{formatDuration(member.activeSec)}</span>
                    </Link>
                  ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-3 py-2.5 text-center">
      <div className={`tabular text-lg font-medium ${tone}`}>{value}</div>
      <div className="label mt-0.5">{label}</div>
    </div>
  );
}
