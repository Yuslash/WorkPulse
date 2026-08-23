import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  Clock,
  MonitorSmartphone,
  PauseCircle,
  Percent,
  Plus,
  Sparkles,
  TrendingUp,
  UserPlus,
  Wifi,
} from 'lucide-react';
import { AppCategory, Role, formatDuration } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { useAgentHealth, useApplications, useAttendanceDay, useAuditLogs, useOverview } from '@/features/queries';
import {
  BarStatCard,
  Donut,
  DonutLegend,
  HeroStatCard,
  SegmentedBar,
  TickStatCard,
  WaveStatCard,
} from '@/features/overview/widgets';
import { Card, EmptyState, ErrorState, IconButton, LoadingBlock, Spinner } from '@/components/ui';
import { PresenceBadge } from '@/components/status/PresenceDot';
import { cn, formatRelative, formatTime, initials, todayKey } from '@/lib/format';

const CATEGORY_LABELS: Record<AppCategory, string> = {
  PRODUCTIVE: 'Productive',
  NEUTRAL: 'Neutral',
  BREAK: 'Break',
  RESTRICTED: 'Restricted',
};

/** Last `n` hourly buckets ending at the current UTC hour, zero-padded at the front. */
function recentHours(hourly: Array<{ hour: number; activeSec: number }>, n: number): number[] {
  const currentHour = new Date().getUTCHours();
  const values = hourly.map((h) => h.activeSec);
  const end = currentHour + 1;
  const start = Math.max(0, end - n);
  const slice = values.slice(start, end);
  return Array(Math.max(0, n - slice.length)).fill(0).concat(slice);
}

/** The flagship dashboard: every widget reads from real presence, activity and audit data. */
export function OverviewPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const overviewQuery = useOverview();
  const { overview: pushed } = useRealtime();

  const today = todayKey();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const applicationsToday = useApplications({ from: selectedDate, to: selectedDate });
  const attendanceToday = useAttendanceDay(today);
  const agentHealth = useAgentHealth();
  const audit = useAuditLogs({ page: 1, limit: 5, action: undefined });

  // Prefer the WebSocket snapshot when one has arrived: it is fresher than
  // the 30s poll and is what makes the counters move without a refresh.
  const data = pushed ?? overviewQuery.data;

  if (overviewQuery.isLoading && !data) return <LoadingBlock label="Loading dashboard" />;
  if (overviewQuery.isError && !data) {
    return <ErrorState error={overviewQuery.error} onRetry={() => overviewQuery.refetch()} />;
  }
  if (!data) return null;

  const heroTrend = recentHours(data.hourlyActivity, 8);
  const barTrend = recentHours(data.hourlyActivity, 8);
  const tickValues = data.hourlyActivity.map((h) => h.activeSec);
  const hoursWithActivity = data.hourlyActivity.filter((h) => h.activeSec > 0).length;
  const attendancePercent = data.employees > 0 ? Math.round((data.online / data.employees) * 100) : 0;

  const budgetTarget = 8 * 3600;
  const budgetSegments = 24;
  const budgetFilled = Math.min(budgetSegments, Math.round((data.todayActiveSec / budgetTarget) * budgetSegments));

  const categories = applicationsToday.data?.categories ?? [];
  const totalTrackedToday = categories.reduce((sum, c) => sum + c.durationSec, 0);
  const donutSegments = categories.map((c) => ({
    label: CATEGORY_LABELS[c.category],
    percent: c.percent,
  }));
  const legendSegments = categories.map((c) => ({
    label: CATEGORY_LABELS[c.category],
    percent: c.percent,
    duration: formatDuration(c.durationSec),
  }));

  const teamPreview = data.topActive.slice(0, 3);

  const attendanceRows = attendanceToday.data?.rows ?? [];
  const attendanceAvgActive =
    attendanceRows.length > 0
      ? Math.round(attendanceRows.reduce((sum, row) => sum + row.activeSec, 0) / attendanceRows.length)
      : 0;
  const attendancePreview = [...attendanceRows].sort((a, b) => b.activeSec - a.activeSec).slice(0, 3);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.now() - (6 - i) * 86_400_000);
    const isoDate = date.toISOString().slice(0, 10);
    return {
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      day: date.getDate(),
      isoDate,
      isToday: isoDate === today,
      isSelected: isoDate === selectedDate,
    };
  });

  return (
    <div className="space-y-4">
      {/* Greeting */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-5">
        <div>
          <div className="text-sm font-semibold text-muted">Here&rsquo;s what&rsquo;s happening today.</div>
          <h1 className="mt-1.5 flex items-center gap-3 font-display text-[clamp(28px,4vw,42px)] font-bold leading-[1.05] tracking-tight text-fg">
            Welcome back, {user?.name.split(' ')[0]}
            <Sparkles className="h-8 w-8 shrink-0 text-accent" strokeWidth={2.25} />
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-[60px] w-[60px] select-none items-center justify-center rounded-full bg-surface font-display text-2xl font-bold shadow-warm-sm">
              {new Date().getDate()}
            </div>
            <div className="select-none text-sm font-semibold leading-tight">
              {new Date().toLocaleDateString(undefined, { weekday: 'short' })}
              <br />
              {new Date().toLocaleDateString(undefined, { month: 'long' })}
            </div>
          </div>
          <div className="hidden h-11 w-px bg-border sm:block" />
          <Link
            to="/live"
            className="hidden items-center rounded-full bg-accent px-6 py-3.5 text-sm font-bold text-accent-fg shadow-warm-md transition-transform duration-150 ease-spring hover:-translate-y-0.5 sm:inline-flex"
          >
            View Live Board
          </Link>
        </div>
      </div>

      {/* Hero stat row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroStatCard label="Active Now" value={data.active} icon={<TrendingUp className="h-4.5 w-4.5" />} trend={heroTrend} />
        <BarStatCard
          label="Active Time Today"
          value={formatDuration(data.todayActiveSec)}
          icon={<Clock className="h-4.5 w-4.5" />}
          bars={barTrend}
        />
        <TickStatCard
          label="Peak Hours"
          value={`${hoursWithActivity} hrs`}
          icon={<Percent className="h-4.5 w-4.5" />}
          ticks={tickValues}
        />
        <WaveStatCard
          label="Attendance"
          value={`${attendancePercent}%`}
          icon={<Wifi className="h-4.5 w-4.5" />}
          percent={attendancePercent}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_1.1fr_1fr]">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold tracking-tight">Live Snapshot</h2>
              {can(Role.HrAdmin) && (
                <IconButton size="sm" onClick={() => navigate('/employees?new=1')} aria-label="Add employee">
                  <UserPlus className="h-4 w-4" />
                </IconButton>
              )}
            </div>

            <div className="mb-3.5 grid grid-cols-2 gap-3 select-none">
              <div className="flex flex-col gap-1.5 rounded-sub bg-elevated p-4">
                <Wifi className="h-5 w-5 text-viz-2" />
                <span className="mt-1 text-xs font-semibold text-muted">Online Devices</span>
                <div className="font-display text-2xl font-bold">{data.devices}</div>
              </div>
              <div className="flex flex-col gap-1.5 rounded-sub bg-elevated p-4">
                <PauseCircle className="h-5 w-5 text-viz-3" />
                <span className="mt-1 text-xs font-semibold text-muted">Idle Now</span>
                <div className="font-display text-2xl font-bold">{data.idle}</div>
              </div>
            </div>

            <div className="select-none rounded-sub bg-elevated p-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface shadow-warm-sm">
                  <Clock className="h-4.5 w-4.5 text-accent" />
                </div>
                <span className="text-sm font-bold">Today&rsquo;s Active Budget</span>
                <div className="ml-auto font-display text-lg font-bold">
                  {formatDuration(data.todayActiveSec)} <small className="text-xs font-semibold text-muted">/ 8h</small>
                </div>
              </div>
              <SegmentedBar total={budgetSegments} filled={budgetFilled} />
            </div>

            <div className="mt-5 mb-3 flex items-center justify-between">
              <h3 className="font-display text-[15px] font-bold">Most Active Right Now</h3>
              <Link to="/live" className="text-xs font-bold text-accent hover:underline">
                View live board
              </Link>
            </div>

            {teamPreview.length === 0 ? (
              <p className="text-sm text-muted">No activity recorded yet today.</p>
            ) : (
              <Link
                to={`/employees/${teamPreview[0]!.employeeId}`}
                className="flex items-center gap-3.5 rounded-sub p-1 transition-colors duration-150 hover:bg-elevated"
              >
                <span className="flex h-[52px] w-[52px] shrink-0 select-none items-center justify-center rounded-2xl bg-gradient-to-br from-viz-3 to-accent text-sm font-bold text-white">
                  {initials(teamPreview[0]!.employeeName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{teamPreview[0]!.employeeName}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-muted">
                    <PresenceBadge state={teamPreview[0]!.presence} />
                    <span className="flex items-center gap-1.5">
                      <MonitorSmartphone className="h-3.5 w-3.5" />
                      {teamPreview[0]!.currentApplication ?? '—'}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-xs font-bold text-accent-fg shadow-warm-sm">
                  View
                </span>
              </Link>
            )}
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold tracking-tight">Agent Health</h2>
              <IconButton size="sm" onClick={() => navigate('/agent-health')} aria-label="View agent health">
                <ArrowUpRight className="h-4 w-4" />
              </IconButton>
            </div>

            {agentHealth.isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : !agentHealth.data || agentHealth.data.installed === 0 ? (
              <p className="text-sm text-muted">No agents enrolled yet.</p>
            ) : (
              <>
                <div className="grid select-none grid-cols-4 divide-x divide-border rounded-sub bg-elevated py-3">
                  <HealthStat label="Healthy" value={agentHealth.data.healthy} tone="text-active" />
                  <HealthStat label="Outdated" value={agentHealth.data.outdated} tone="text-idle" />
                  <HealthStat label="Offline" value={agentHealth.data.offline} tone="text-offline" />
                  <HealthStat label="Revoked" value={agentHealth.data.revoked} tone="text-muted" />
                </div>
                {agentHealth.data.latestVersion && (
                  <p className="mt-3 select-none text-xs text-faint">
                    Latest agent version:{' '}
                    <span className="font-semibold text-muted">{agentHealth.data.latestVersion}</span>
                  </p>
                )}
              </>
            )}
          </Card>
        </div>

        {/* CENTER */}
        <div className="flex flex-col gap-4">
          <Card className="cursor-default p-6">
            <h2 className="mb-5 select-none font-display text-lg font-semibold tracking-tight">
              Activity Insights
            </h2>

            <div className="mb-6 flex select-none justify-between gap-1.5">
              {weekDays.map((d) => (
                <button
                  key={d.isoDate}
                  type="button"
                  onClick={() => setSelectedDate(d.isoDate)}
                  className="flex flex-col items-center gap-2 group cursor-pointer focus:outline-none"
                >
                  <span
                    className={cn(
                      'text-2xs font-semibold transition-colors',
                      d.isSelected ? 'text-accent font-bold' : 'text-muted group-hover:text-fg'
                    )}
                  >
                    {d.label}
                  </span>
                  <div
                    className={cn(
                      'flex h-[42px] w-[42px] items-center justify-center rounded-full text-sm font-bold shadow-warm-sm transition-all duration-150',
                      d.isSelected
                        ? 'bg-accent text-accent-fg ring-2 ring-accent scale-105 shadow-warm-md'
                        : d.isToday
                          ? 'bg-elevated text-fg ring-1 ring-accent/50 hover:bg-surface hover:ring-accent'
                          : 'bg-elevated text-fg hover:bg-surface hover:scale-105'
                    )}
                  >
                    {d.day}
                  </div>
                </button>
              ))}
            </div>

            {applicationsToday.isLoading ? (
              <LoadingBlock />
            ) : categories.length === 0 || totalTrackedToday === 0 ? (
              <EmptyState
                title={selectedDate === today ? 'No tracked activity yet today' : `No tracked activity for ${selectedDate}`}
                description="This chart fills in once agents report application sessions."
              />
            ) : (
              <div className="flex select-none flex-wrap items-center gap-5">
                <Donut
                  segments={donutSegments}
                  centerLabel={selectedDate === today ? 'tracked today' : 'tracked'}
                  centerValue={formatDuration(totalTrackedToday)}
                />
                <DonutLegend segments={legendSegments} />
              </div>
            )}
          </Card>

          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold tracking-tight">Attendance Today</h2>
              <Link to="/attendance" className="text-xs font-bold text-accent hover:underline">
                View all
              </Link>
            </div>

            {attendanceToday.isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : attendanceRows.length === 0 ? (
              <p className="text-sm text-muted">Nobody has reported activity yet today.</p>
            ) : (
              <>
                <div className="mb-4 flex select-none gap-7">
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-muted">Present</div>
                    <div className="font-display text-[28px] font-bold">{attendanceRows.length}</div>
                  </div>
                  <div className="w-px bg-border" />
                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-muted">Avg. Active</div>
                    <div className="font-display text-[28px] font-bold">{formatDuration(attendanceAvgActive)}</div>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  {attendancePreview.map((row) => (
                    <Link
                      key={row.employeeId}
                      to={`/employees/${row.employeeId}`}
                      className="flex items-center gap-3 rounded-sub px-2 py-2 transition-colors duration-150 hover:bg-elevated"
                    >
                      <span className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-viz-2 to-viz-4 text-2xs font-bold text-white">
                        {initials(row.employeeName)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{row.employeeName}</span>
                      <span className="shrink-0 text-xs text-faint">{formatTime(row.firstSeen)} in</span>
                      <span className="tabular shrink-0 text-xs font-bold text-fg">{formatDuration(row.activeSec)}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col gap-4">
          <Card className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold tracking-tight">Latest Activity</h2>
              {can(Role.HrAdmin) && (
                <IconButton size="sm" onClick={() => navigate('/audit')} aria-label="View all audit entries">
                  <Plus className="h-4 w-4" />
                </IconButton>
              )}
            </div>

            {can(Role.HrAdmin) ? (
              audit.isLoading ? (
                <div className="flex justify-center py-4">
                  <Spinner />
                </div>
              ) : (audit.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-muted">No activity recorded yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {audit.data!.items.map((entry) => (
                    <LatestAuditRow key={entry.id} entry={entry} />
                  ))}
                </div>
              )
            ) : (
              <p className="text-sm text-muted">
                Ask an HR Admin or above for visibility into recent administrative activity.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function HealthStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-2 text-center">
      <div className={cn('font-display text-xl font-bold', tone)}>{value}</div>
      <div className="mt-0.5 text-2xs font-semibold text-faint">{label}</div>
    </div>
  );
}

function LatestAuditRow({
  entry,
}: {
  entry: { action: string; actorName: string; targetLabel: string | null; createdAt: string };
}) {
  const label = entry.action
    .split(/[._]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return (
    <div className="select-none rounded-sub bg-elevated p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
          <Check className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{label}</span>
        <span className="shrink-0 rounded-full bg-accent/12 px-2.5 py-1 text-2xs font-bold text-accent">
          {formatRelative(entry.createdAt)}
        </span>
      </div>
      <div className="mt-1.5 truncate pl-8 text-xs text-muted">
        {entry.actorName}
        {entry.targetLabel ? ` · ${entry.targetLabel}` : ''}
      </div>
    </div>
  );
}
