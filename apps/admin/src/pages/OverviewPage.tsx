import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock,
  ExternalLink,
  Flame,
  Gauge,
  PauseCircle,
  Percent,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserPlus,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { AppCategory, Role, formatDuration } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import {
  useAgentHealth,
  useApplications,
  useAttendanceDay,
  useAuditLogs,
  useOverview,
} from '@/features/queries';
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
import { cn, formatRelative, initials, todayKey } from '@/lib/format';

type ExpandedPanel =
  | null
  | 'live-snapshot'
  | 'activity-insights'
  | 'attendance-today'
  | 'agent-health'
  | 'attention-required'
  | 'latest-activity';

const CATEGORY_LABELS: Record<AppCategory, string> = {
  PRODUCTIVE: 'Productive',
  NEUTRAL: 'Neutral',
  BREAK: 'Break',
  RESTRICTED: 'Restricted',
};

/** Last `n` hourly buckets ending at current hour. */
function recentHours(hourly: Array<{ hour: number; activeSec: number }> | undefined, n: number): number[] {
  if (!hourly || hourly.length === 0) {
    return Array(n).fill(0);
  }
  const currentHour = new Date().getUTCHours();
  const values = hourly.map((h) => h.activeSec);
  const end = currentHour + 1;
  const start = Math.max(0, end - n);
  const slice = values.slice(start, end);
  return Array(Math.max(0, n - slice.length)).fill(0).concat(slice);
}

export function OverviewPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const overviewQuery = useOverview();
  const { overview: pushed } = useRealtime();

  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>(null);

  // Close expanded panel on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expandedPanel) {
        setExpandedPanel(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedPanel]);

  const today = todayKey();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const applicationsToday = useApplications({ from: selectedDate, to: selectedDate });
  const attendanceToday = useAttendanceDay(today);
  const agentHealth = useAgentHealth();
  const audit = useAuditLogs({ page: 1, limit: 12, action: undefined });

  const data = pushed ?? overviewQuery.data;

  // Key live metrics from server
  const activeNow = data?.active ?? 0;
  const idleNow = data?.idle ?? 0;
  const onlineNow = data?.online ?? 0;
  const totalEmployees = data?.employees ?? 0;
  const offlineNow = Math.max(0, totalEmployees - onlineNow);
  const workTimeTodaySec = data?.todayActiveSec ?? 0;

  // Real categories and productivity percentage
  const categories = applicationsToday.data?.categories ?? [];
  const totalTrackedSec = categories.reduce((sum, c) => sum + c.durationSec, 0);
  const productiveSec = categories.find((c) => c.category === 'PRODUCTIVE')?.durationSec ?? 0;
  const productivityPercent = totalTrackedSec > 0 ? Math.round((productiveSec / totalTrackedSec) * 100) : 0;
  const attendancePercent = totalEmployees > 0 ? Math.round((onlineNow / totalEmployees) * 100) : 0;

  const heroTrend = recentHours(data?.hourlyActivity, 8);
  const barTrend = recentHours(data?.hourlyActivity, 8);
  const tickValues = data?.hourlyActivity?.map((h) => h.activeSec) ?? Array(12).fill(0);

  // Budget progress
  const budgetTarget = 8 * 3600;
  const avgActiveSec = totalEmployees > 0 ? Math.round(workTimeTodaySec / totalEmployees) : workTimeTodaySec;
  const budgetSegments = 20;
  const budgetFilled = Math.min(budgetSegments, Math.round((avgActiveSec / budgetTarget) * budgetSegments));

  const donutSegments = categories.map((c) => ({
    label: CATEGORY_LABELS[c.category] ?? c.category,
    percent: c.percent,
  }));

  const legendSegments = categories.map((c) => ({
    label: CATEGORY_LABELS[c.category] ?? c.category,
    percent: c.percent,
    duration: formatDuration(c.durationSec),
  }));

  // Real Top Active Members from live stream
  const topActiveMembers = data?.topActive ?? [];

  // Real Attendance data
  const attendanceRows = attendanceToday.data?.rows ?? [];
  const presentCount = attendanceRows.length;
  const lateArrivals = attendanceRows.filter((r) => {
    if (!r.firstSeen) return false;
    const hour = new Date(r.firstSeen).getHours();
    const minute = new Date(r.firstSeen).getMinutes();
    return hour > 9 || (hour === 9 && minute > 15);
  });
  const absentCount = Math.max(0, totalEmployees - presentCount);

  // Real Agent Health counters
  const healthyCount = agentHealth.data?.healthy ?? 0;
  const outdatedCount = agentHealth.data?.outdated ?? 0;
  const offlineCount = agentHealth.data?.offline ?? 0;
  const revokedCount = agentHealth.data?.revoked ?? 0;

  // Real dynamic Attention Items
  const attentionItems = [
    ...(idleNow > 0
      ? [
          {
            id: 'idle',
            title: `${idleNow} idle employee${idleNow > 1 ? 's' : ''} detected`,
            description: `${idleNow} team member${idleNow > 1 ? 's are' : ' is'} currently inactive on their workstation.`,
            severity: 'Medium' as const,
            tone: 'amber',
            icon: PauseCircle,
            actionTo: '/live',
          },
        ]
      : []),
    ...(lateArrivals.length > 0
      ? [
          {
            id: 'late',
            title: `${lateArrivals.length} late arrival${lateArrivals.length > 1 ? 's' : ''} today`,
            description: `${lateArrivals.length} employee${lateArrivals.length > 1 ? 's' : ''} checked in after the morning threshold.`,
            severity: 'Low' as const,
            tone: 'orange',
            icon: Clock,
            actionTo: '/attendance',
          },
        ]
      : []),
    ...(outdatedCount > 0
      ? [
          {
            id: 'updates',
            title: `${outdatedCount} outdated agent${outdatedCount > 1 ? 's' : ''}`,
            description: `Workstations require update to the latest agent version (${agentHealth.data?.latestVersion ?? 'v2.4'}).`,
            severity: 'High' as const,
            tone: 'indigo',
            icon: RefreshCw,
            actionTo: '/agent-health',
          },
        ]
      : []),
    ...(offlineCount > 0
      ? [
          {
            id: 'unresponsive',
            title: `${offlineCount} offline workstation${offlineCount > 1 ? 's' : ''}`,
            description: 'Enrolled devices have missed their scheduled heartbeat check-in.',
            severity: 'Critical' as const,
            tone: 'rose',
            icon: WifiOff,
            actionTo: '/devices',
          },
        ]
      : []),
  ];

  // Dynamic 7-day strip
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

  const todayFormatted = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  if (overviewQuery.isLoading && !data) {
    return <LoadingBlock label="Loading workspace overview" />;
  }

  if (overviewQuery.isError && !data) {
    return <ErrorState error={overviewQuery.error} onRetry={() => overviewQuery.refetch()} />;
  }

  return (
    <div className="space-y-5">
      {/* 1. Header with clean greeting and dynamic date */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted">
            <span>{todayFormatted}</span>
            <span>•</span>
            <span className="text-emerald-500 flex items-center gap-1 font-bold">
              <TrendingUp className="h-3.5 w-3.5" />
              {activeNow > 0 ? `${activeNow} active today` : 'Workspace live'}
            </span>
          </div>
          <h1 className="flex items-center gap-3 font-display text-[clamp(26px,3.5vw,36px)] font-bold tracking-tight text-fg leading-tight">
            Welcome back, {user?.name.split(' ')[0] ?? 'Admin'}
            <Sparkles className="h-7 w-7 shrink-0 text-accent" strokeWidth={2.25} />
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {expandedPanel && (
            <button
              type="button"
              onClick={() => setExpandedPanel(null)}
              className="flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-xs font-bold text-fg shadow-warm-sm border border-border/80 hover:bg-elevated transition-all active:translate-y-px"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-accent" />
              <span>Back to Overview Grid</span>
              <kbd className="hidden sm:inline-block rounded bg-elevated px-1.5 py-0.5 text-[10px] font-mono text-muted">
                ESC
              </kbd>
            </button>
          )}

          <Link
            to="/live"
            className="group flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-xs font-bold text-accent-fg shadow-warm-md hover:brightness-105 transition-all active:translate-y-px"
          >
            <Activity className="h-4 w-4" />
            <span>Live Board</span>
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>
      </div>

      {/* 2. Top Hero Stat Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroStatCard
          label="Active Now"
          value={activeNow}
          icon={<TrendingUp className="h-4.5 w-4.5" />}
          trend={heroTrend}
        />
        <BarStatCard
          label="Work Time Today"
          value={formatDuration(workTimeTodaySec)}
          icon={<Clock className="h-4.5 w-4.5" />}
          bars={barTrend}
        />
        <TickStatCard
          label="Productivity"
          value={`${productivityPercent}%`}
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

      {/* 3. Main Content Canvas: Smooth Morphing between 3-Column Grid and Full Expanded Panel */}
      <div className="relative min-h-[500px]">
        {/* ========================================================
            EXPANDED PANEL VIEW (Full Width Focus Mode)
           ======================================================== */}
        {expandedPanel ? (
          <div className="animate-fade-in w-full transition-all duration-300">
            {/* Expanded 1: Live Snapshot */}
            {expandedPanel === 'live-snapshot' && (
              <ExpandedLiveSnapshot
                activeNow={activeNow}
                idleNow={idleNow}
                offlineNow={offlineNow}
                avgActiveSec={avgActiveSec}
                budgetSegments={budgetSegments}
                budgetFilled={budgetFilled}
                topActiveMembers={topActiveMembers}
                onClose={() => setExpandedPanel(null)}
              />
            )}

            {/* Expanded 2: Activity Insights */}
            {expandedPanel === 'activity-insights' && (
              <ExpandedActivityInsights
                weekDays={weekDays}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                donutSegments={donutSegments}
                legendSegments={legendSegments}
                totalTrackedSec={totalTrackedSec}
                productivityPercent={productivityPercent}
                onClose={() => setExpandedPanel(null)}
              />
            )}

            {/* Expanded 3: Attendance Today */}
            {expandedPanel === 'attendance-today' && (
              <ExpandedAttendanceToday
                attendanceRows={attendanceRows}
                presentCount={presentCount}
                lateCount={lateArrivals.length}
                absentCount={absentCount}
                attendancePercent={attendancePercent}
                onClose={() => setExpandedPanel(null)}
              />
            )}

            {/* Expanded 4: Agent Health */}
            {expandedPanel === 'agent-health' && (
              <ExpandedAgentHealth
                agentHealth={agentHealth.data}
                healthyCount={healthyCount}
                outdatedCount={outdatedCount}
                offlineCount={offlineCount}
                revokedCount={revokedCount}
                onClose={() => setExpandedPanel(null)}
              />
            )}

            {/* Expanded 5: Attention Required */}
            {expandedPanel === 'attention-required' && (
              <ExpandedAttentionRequired
                attentionItems={attentionItems}
                onClose={() => setExpandedPanel(null)}
              />
            )}

            {/* Expanded 6: Latest Activity */}
            {expandedPanel === 'latest-activity' && (
              <ExpandedLatestActivity
                audit={audit}
                onClose={() => setExpandedPanel(null)}
              />
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1.1fr_1fr] transition-all duration-300">
            {/* COLUMN 1: Live Snapshot & Agent Health */}
            <div className="flex flex-col gap-5">
              {/* Live Telemetry */}
              <Card className="p-6 transition-all duration-200 hover:shadow-warm-md">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <Activity className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h2 className="font-display text-base font-bold tracking-tight text-fg">Live Telemetry</h2>
                      <p className="text-2xs text-muted font-medium">{totalEmployees} Enrolled Workstations</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {can(Role.HrAdmin) && (
                      <IconButton size="sm" onClick={() => navigate('/employees')} aria-label="View employees">
                        <UserPlus className="h-3.5 w-3.5" />
                      </IconButton>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedPanel('live-snapshot')}
                      className="text-xs font-bold text-accent hover:underline cursor-pointer"
                    >
                      Expand ↗
                    </button>
                  </div>
                </div>

                {/* Telemetry Distribution Bar */}
                <div className="mb-5">
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-border-strong/30 gap-0.5">
                    <div
                      style={{ width: `${totalEmployees > 0 ? (activeNow / totalEmployees) * 100 : 0}%` }}
                      className="bg-active transition-all duration-500 rounded-l-full"
                    />
                    <div
                      style={{ width: `${totalEmployees > 0 ? (idleNow / totalEmployees) * 100 : 0}%` }}
                      className="bg-warn transition-all duration-500"
                    />
                    <div
                      style={{ width: `${totalEmployees > 0 ? (offlineNow / totalEmployees) * 100 : 100}%` }}
                      className="bg-border-strong transition-all duration-500 rounded-r-full"
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-bold text-fg">
                      <span className="h-2 w-2 rounded-full bg-active" />
                      <span>{activeNow} <span className="font-normal text-muted text-2xs">Active</span></span>
                    </span>
                    <span className="flex items-center gap-1.5 font-bold text-fg">
                      <span className="h-2 w-2 rounded-full bg-warn" />
                      <span>{idleNow} <span className="font-normal text-muted text-2xs">Idle</span></span>
                    </span>
                    <span className="flex items-center gap-1.5 font-bold text-fg">
                      <span className="h-2 w-2 rounded-full bg-muted" />
                      <span>{offlineNow} <span className="font-normal text-muted text-2xs">Offline</span></span>
                    </span>
                  </div>
                </div>

                <div className="my-4 border-t border-border/60" />

                {/* Today's Active Budget */}
                <div className="mb-5 select-none">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold text-muted flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-accent" />
                      Avg. Work Budget
                    </span>
                    <span className="font-display font-bold text-fg">
                      {formatDuration(avgActiveSec)} <small className="text-muted font-normal">/ 8h target</small>
                    </span>
                  </div>
                  <SegmentedBar total={budgetSegments} filled={budgetFilled} />
                </div>

                <div className="my-4 border-t border-border/60" />

                {/* Most Active Section */}
                <div>
                  <div className="mb-3 flex items-center justify-between text-xs">
                    <span className="font-bold flex items-center gap-1.5 text-fg">
                      <Flame className="h-3.5 w-3.5 text-accent" />
                      Top Active Members
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedPanel('live-snapshot')}
                      className="text-2xs font-bold text-accent hover:underline cursor-pointer"
                    >
                      View all
                    </button>
                  </div>

                  {topActiveMembers.length === 0 ? (
                    <p className="text-xs text-muted py-2">No active sessions recorded yet today.</p>
                  ) : (
                    <div className="divide-y divide-border/40">
                      {topActiveMembers.slice(0, 3).map((emp) => (
                        <Link
                          key={emp.employeeId}
                          to={`/employees/${emp.employeeId}`}
                          className="flex items-center justify-between py-2.5 hover:bg-elevated/40 px-2 -mx-2 rounded-xl transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent font-bold text-xs">
                              {initials(emp.employeeName)}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-bold text-fg">{emp.employeeName}</div>
                              <div className="text-2xs text-muted font-medium truncate">
                                {emp.currentApplication ?? 'Active'}
                              </div>
                            </div>
                          </div>
                          <span className="text-xs font-mono font-bold text-accent">
                            {formatDuration(emp.activeSec)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              {/* Agent Fleet Health */}
              <Card className="p-6 transition-all duration-200 hover:shadow-warm-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <ShieldCheck className="h-4.5 w-4.5" />
                    </div>
                    <h2 className="font-display text-base font-bold tracking-tight text-fg">Agent Fleet Health</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedPanel('agent-health')}
                    className="text-xs font-bold text-accent hover:underline cursor-pointer"
                  >
                    Details ↗
                  </button>
                </div>

                <div className="grid select-none grid-cols-4 divide-x divide-border/60 py-2 text-center">
                  <HealthStat label="Healthy" value={healthyCount} tone="text-active" />
                  <HealthStat label="Update" value={outdatedCount} tone="text-warn" />
                  <HealthStat label="Offline" value={offlineCount} tone="text-danger" />
                  <HealthStat label="Revoked" value={revokedCount} tone="text-muted" />
                </div>
              </Card>
            </div>

            {/* COLUMN 2: Activity Insights */}
            <div className="flex flex-col gap-5">
              {/* Activity Insights */}
              <Card className="p-6 transition-all duration-200 hover:shadow-warm-md flex flex-col justify-between h-full">
                <div>
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
                        <Gauge className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <h2 className="font-display text-base font-bold tracking-tight text-fg">Activity Insights</h2>
                        <p className="text-2xs text-muted font-medium">Application usage & focus distribution</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedPanel('activity-insights')}
                      className="text-xs font-bold text-accent hover:underline cursor-pointer"
                    >
                      Breakdown ↗
                    </button>
                  </div>

                  {/* 7-Day Date Strip */}
                  <div className="mb-5 flex select-none justify-between gap-1">
                    {weekDays.map((d) => (
                      <button
                        key={d.isoDate}
                        type="button"
                        onClick={() => setSelectedDate(d.isoDate)}
                        className="flex flex-col items-center gap-1 group cursor-pointer focus:outline-none"
                      >
                        <span
                          className={cn(
                            'text-2xs font-bold transition-colors',
                            d.isSelected ? 'text-accent font-bold' : 'text-muted group-hover:text-fg'
                          )}
                        >
                          {d.label}
                        </span>
                        <div
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-150',
                            d.isSelected
                              ? 'bg-accent text-accent-fg ring-2 ring-accent scale-105 shadow-warm-sm'
                              : d.isToday
                              ? 'bg-elevated text-fg ring-1 ring-accent/50'
                              : 'bg-elevated/60 text-fg hover:bg-surface'
                          )}
                        >
                          {d.day}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Donut Chart & Legend */}
                  {applicationsToday.isLoading ? (
                    <div className="flex justify-center py-12">
                      <Spinner />
                    </div>
                  ) : categories.length === 0 || totalTrackedSec === 0 ? (
                    <div className="py-12 text-center">
                      <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-full bg-accent/15 text-accent mb-2.5">
                        <Clock className="h-6 w-6" />
                      </div>
                      <h3 className="font-bold text-sm text-fg">No Activity Telemetry</h3>
                      <p className="text-2xs text-muted mt-1 max-w-xs mx-auto">
                        Desktop agents will record application focus and window telemetry as employees work.
                      </p>
                    </div>
                  ) : (
                    <div className="flex select-none flex-col sm:flex-row items-center justify-between gap-6 py-4">
                      <Donut
                        segments={donutSegments}
                        centerLabel="Tracked"
                        centerValue={formatDuration(totalTrackedSec)}
                      />
                      <DonutLegend segments={legendSegments} />
                    </div>
                  )}
                </div>

                {/* Benchmarks Footer */}
                <div className="mt-5 pt-3.5 border-t border-border/60 flex items-center justify-between text-xs font-semibold text-muted">
                  <span>Productivity: <strong className="text-accent font-bold">{productivityPercent}%</strong></span>
                  <span>Tracked: <strong className="text-fg font-bold">{formatDuration(totalTrackedSec)}</strong></span>
                  <span>Categories: <strong className="text-fg font-bold">{categories.length}</strong></span>
                </div>
              </Card>
            </div>

            {/* COLUMN 3: Attention Center & Attendance Ledger */}
            <div className="flex flex-col gap-5">
              {/* Attention Center */}
              <Card className="p-6 transition-all duration-200 hover:shadow-warm-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <ShieldAlert className="h-4.5 w-4.5" />
                    </div>
                    <h2 className="font-display text-base font-bold tracking-tight text-fg">Attention Center</h2>
                  </div>
                  <span className="rounded-full bg-accent/15 text-accent px-2.5 py-0.5 text-2xs font-bold">
                    {attentionItems.length} alert{attentionItems.length === 1 ? '' : 's'}
                  </span>
                </div>

                {attentionItems.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted">
                    <Check className="h-5 w-5 text-active mx-auto mb-1.5" />
                    All systems and agents are healthy.
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {attentionItems.slice(0, 4).map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setExpandedPanel('attention-required')}
                          className="flex w-full items-center justify-between py-3 hover:bg-elevated/40 px-2 -mx-2 rounded-xl transition-all group text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="truncate text-xs font-bold text-fg group-hover:text-accent transition-colors">
                              {item.title}
                            </span>
                          </div>
                          <ArrowUpRight className="h-3.5 w-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* Attendance Ledger (Replaced Latest Activity) */}
              <Card className="p-6 transition-all duration-200 hover:shadow-warm-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <Clock className="h-4.5 w-4.5" />
                    </div>
                    <h2 className="font-display text-base font-bold tracking-tight text-fg">Attendance Ledger</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedPanel('attendance-today')}
                    className="text-xs font-bold text-accent hover:underline cursor-pointer"
                  >
                    View all ↗
                  </button>
                </div>

                {/* Direct 4 Summary Numbers */}
                <div className="grid select-none grid-cols-4 divide-x divide-border/60 py-2 mb-4 text-center">
                  <div>
                    <div className="font-display text-lg font-bold text-active">{presentCount}</div>
                    <div className="text-2xs font-bold uppercase tracking-wider text-muted mt-0.5">Present</div>
                  </div>
                  <div>
                    <div className="font-display text-lg font-bold text-warn">{lateArrivals.length}</div>
                    <div className="text-2xs font-bold uppercase tracking-wider text-muted mt-0.5">Late</div>
                  </div>
                  <div>
                    <div className="font-display text-lg font-bold text-danger">{absentCount}</div>
                    <div className="text-2xs font-bold uppercase tracking-wider text-muted mt-0.5">Absent</div>
                  </div>
                  <div>
                    <div className="font-display text-lg font-bold text-accent">{attendancePercent}%</div>
                    <div className="text-2xs font-bold uppercase tracking-wider text-muted mt-0.5">Rate</div>
                  </div>
                </div>

                {/* Real Late Arrivals List */}
                {attendanceRows.length === 0 ? (
                  <p className="text-xs text-muted text-center py-2">No check-ins recorded yet today.</p>
                ) : (
                  <div className="divide-y divide-border/40">
                    {attendanceRows.slice(0, 3).map((row) => {
                      const isLate = () => {
                        if (!row.firstSeen) return false;
                        const d = new Date(row.firstSeen);
                        return d.getHours() > 9 || (d.getHours() === 9 && d.getMinutes() > 15);
                      };
                      const statusText = isLate() ? 'Late' : 'Present';

                      return (
                        <div
                          key={row.employeeId}
                          className="flex items-center justify-between py-2 px-1 text-xs"
                        >
                          <div className="flex items-center gap-2 font-semibold">
                            <span className={cn('h-1.5 w-1.5 rounded-full', statusText === 'Late' ? 'bg-warn' : 'bg-active')} />
                            <span className="truncate max-w-[120px]">{row.employeeName}</span>
                          </div>
                          <div className="flex items-center gap-2 text-2xs">
                            <span className="font-mono text-muted">{formatDuration(row.activeSec)}</span>
                            <span className={cn('font-bold', statusText === 'Late' ? 'text-warn' : 'text-active')}>
                              {statusText}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const OverviewPageUpdated = OverviewPage;

function HealthStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-1 text-center">
      <div className={cn('font-display text-base font-bold', tone)}>{value}</div>
      <div className="text-[10px] font-semibold text-muted mt-0.5">{label}</div>
    </div>
  );
}

/* ===========================================================================
   EXPANDED PANEL COMPONENTS (Wired to Live Query Data)
   =========================================================================== */

function ExpandedHeader({
  title,
  subtitle,
  icon: Icon,
  badge,
  actionLink,
  actionText = 'Full Page',
  onClose,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  actionLink?: string;
  actionText?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-4 mb-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-warm-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-xl font-bold tracking-tight text-fg">{title}</h2>
            {badge}
          </div>
          <p className="text-xs text-muted mt-0.5">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {actionLink && (
          <Link
            to={actionLink}
            className="flex items-center gap-1.5 rounded-full bg-elevated px-3.5 py-1.5 text-xs font-semibold text-muted hover:text-fg hover:bg-surface border border-border/60 transition-all"
          >
            <span>{actionText}</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        )}

        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-full bg-surface px-4 py-1.5 text-xs font-bold text-fg shadow-warm-sm border border-border/80 hover:bg-elevated hover:text-accent transition-all cursor-pointer"
        >
          <X className="h-4 w-4" />
          <span>Close (Esc)</span>
        </button>
      </div>
    </div>
  );
}

/** 1. Expanded Live Snapshot */
function ExpandedLiveSnapshot({
  activeNow,
  idleNow,
  offlineNow,
  avgActiveSec,
  budgetSegments,
  budgetFilled,
  topActiveMembers,
  onClose,
}: {
  activeNow: number;
  idleNow: number;
  offlineNow: number;
  avgActiveSec: number;
  budgetSegments: number;
  budgetFilled: number;
  topActiveMembers: Array<{ employeeId: string; employeeName: string; presence: any; currentApplication: string | null; activeSec: number }>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState<string>('');

  const filtered = topActiveMembers.filter((emp) => {
    if (search && !emp.employeeName.toLowerCase().includes(search.toLowerCase()) && !(emp.currentApplication ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <Card className="p-6 sm:p-7 shadow-warm-md">
      <ExpandedHeader
        title="Live Workforce Snapshot & Activity Stream"
        subtitle="Real-time presence, current active windows, and work budget progression."
        icon={Activity}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-active/15 px-2.5 py-0.5 text-2xs font-bold text-active">
            <span className="h-1.5 w-1.5 rounded-full bg-active animate-pulse" /> Live Stream
          </span>
        }
        actionLink="/live"
        actionText="Open Live Board"
        onClose={onClose}
      />

      {/* Top Metric Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Working Now</div>
          <div className="font-display text-2xl font-bold text-active mt-1">{activeNow} members</div>
        </div>

        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Idle State</div>
          <div className="font-display text-2xl font-bold text-amber-400 mt-1">{idleNow} members</div>
        </div>

        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Offline</div>
          <div className="font-display text-2xl font-bold text-rose-400 mt-1">{offlineNow} members</div>
        </div>

        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Avg Work Budget</div>
          <div className="font-display text-2xl font-bold text-fg mt-1">
            {formatDuration(avgActiveSec)} <small className="text-xs text-muted font-normal">/ 8h target</small>
          </div>
          <div className="mt-2">
            <SegmentedBar total={budgetSegments} filled={budgetFilled} />
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2 rounded-full bg-elevated px-4 py-2 border border-border/60 max-w-xs w-full">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search active employee or app..."
            className="w-full bg-transparent text-xs text-fg placeholder:text-muted/60 border-0 outline-none ring-0"
          />
        </div>
      </div>

      {/* Members Grid */}
      {filtered.length === 0 ? (
        <EmptyState title="No active employees found" description="Active team members will populate here as telemetry reports." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((emp) => (
            <Link
              key={emp.employeeId}
              to={`/employees/${emp.employeeId}`}
              className="flex items-center justify-between rounded-2xl p-3.5 bg-elevated/60 border border-border/60 hover:bg-elevated transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent text-sm font-bold shadow-sm">
                  {initials(emp.employeeName)}
                </span>
                <div className="min-w-0">
                  <div className="font-bold text-xs text-fg truncate">{emp.employeeName}</div>
                  <div className="text-2xs text-muted truncate mt-0.5">
                    {emp.currentApplication ?? 'No window focused'}
                  </div>
                  <div className="text-[10px] text-muted">{formatDuration(emp.activeSec)} active</div>
                </div>
              </div>

              <div className="text-right shrink-0">
                <PresenceBadge state={emp.presence} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

/** 2. Expanded Activity Insights */
function ExpandedActivityInsights({
  weekDays,
  selectedDate,
  setSelectedDate,
  donutSegments,
  legendSegments,
  totalTrackedSec,
  productivityPercent,
  onClose,
}: {
  weekDays: Array<{ label: string; day: number; isoDate: string; isToday: boolean; isSelected: boolean }>;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  donutSegments: Array<{ label: string; percent: number }>;
  legendSegments: Array<{ label: string; percent: number; duration: string }>;
  totalTrackedSec: number;
  productivityPercent: number;
  onClose: () => void;
}) {
  return (
    <Card className="p-6 sm:p-7 shadow-warm-md">
      <ExpandedHeader
        title="Activity Insights & Application Observability"
        subtitle={`Categorized application usage and daily focus distribution for ${selectedDate}.`}
        icon={Gauge}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-2xs font-bold text-accent">
            Productivity: {productivityPercent}%
          </span>
        }
        actionLink="/applications"
        actionText="Manage Policies"
        onClose={onClose}
      />

      {/* Date Picker Ribbon */}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3 p-3 rounded-2xl bg-elevated/70 border border-border/60">
        <span className="text-xs font-bold text-fg">Select Date Range:</span>
        <div className="flex items-center gap-1.5">
          {weekDays.map((d) => (
            <button
              key={d.isoDate}
              type="button"
              onClick={() => setSelectedDate(d.isoDate)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-all cursor-pointer',
                d.isSelected
                  ? 'bg-accent text-accent-fg shadow-warm-sm'
                  : 'bg-surface text-fg hover:bg-elevated'
              )}
            >
              <span>{d.label}</span>
              <span className="opacity-70 font-mono text-2xs">{d.day}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Breakdown Section */}
      <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-elevated/60 border border-border/60">
        {totalTrackedSec === 0 ? (
          <EmptyState title="No tracked activity" description="No application sessions recorded for this selected date." />
        ) : (
          <>
            <Donut
              segments={donutSegments}
              centerLabel="Total Tracked"
              centerValue={formatDuration(totalTrackedSec)}
            />
            <div className="w-full max-w-md mt-6">
              <DonutLegend segments={legendSegments} />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** 3. Expanded Attendance Today */
function ExpandedAttendanceToday({
  attendanceRows,
  presentCount,
  lateCount,
  absentCount,
  attendancePercent,
  onClose,
}: {
  attendanceRows: Array<any>;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  attendancePercent: number;
  onClose: () => void;
}) {
  return (
    <Card className="p-6 sm:p-7 shadow-warm-md">
      <ExpandedHeader
        title="Attendance Ledger & Timesheets"
        subtitle="Automated check-ins, active durations, and punctuality logging."
        icon={Clock}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-active/15 px-2.5 py-0.5 text-2xs font-bold text-active">
            {attendancePercent}% Attendance Rate
          </span>
        }
        actionLink="/attendance"
        actionText="Attendance Page"
        onClose={onClose}
      />

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6 text-center">
        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Present</div>
          <div className="font-display text-2xl font-bold text-active mt-1">{presentCount}</div>
        </div>

        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Late Arrivals</div>
          <div className="font-display text-2xl font-bold text-amber-400 mt-1">{lateCount}</div>
        </div>

        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Absent</div>
          <div className="font-display text-2xl font-bold text-rose-500 mt-1">{absentCount}</div>
        </div>

        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="text-2xs font-bold uppercase tracking-wider text-muted">Attendance Rate</div>
          <div className="font-display text-2xl font-bold text-indigo-400 mt-1">{attendancePercent}%</div>
        </div>
      </div>

      {/* Table */}
      {attendanceRows.length === 0 ? (
        <EmptyState title="No attendance recorded" description="Check-in records will appear as employees log in." />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-elevated/60 border border-border/60">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] font-bold uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Active Time</th>
                <th className="px-4 py-3">Idle Time</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {attendanceRows.map((row) => {
                const isLate = () => {
                  if (!row.firstSeen) return false;
                  const d = new Date(row.firstSeen);
                  return d.getHours() > 9 || (d.getHours() === 9 && d.getMinutes() > 15);
                };
                const statusText = isLate() ? 'Late' : 'Present';

                return (
                  <tr key={row.employeeId} className="hover:bg-elevated transition-colors">
                    <td className="px-4 py-3 font-bold text-fg flex items-center gap-2">
                      <span className="h-6 w-6 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-2xs">
                        {initials(row.employeeName)}
                      </span>
                      <span>{row.employeeName}</span>
                    </td>
                    <td className="px-4 py-3 font-mono">{formatDuration(row.activeSec)}</td>
                    <td className="px-4 py-3 font-mono text-muted">{formatDuration(row.idleSec)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        'inline-block px-2.5 py-0.5 rounded-full text-2xs font-bold',
                        statusText === 'Late' ? 'bg-amber-400/15 text-amber-400' : 'bg-active/15 text-active'
                      )}>
                        {statusText}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** 4. Expanded Agent Health */
function ExpandedAgentHealth({
  agentHealth,
  healthyCount,
  outdatedCount,
  offlineCount,
  revokedCount,
  onClose,
}: {
  agentHealth: any;
  healthyCount: number;
  outdatedCount: number;
  offlineCount: number;
  revokedCount: number;
  onClose: () => void;
}) {
  return (
    <Card className="p-6 sm:p-7 shadow-warm-md">
      <ExpandedHeader
        title="Agent Fleet & Device Health Diagnostics"
        subtitle="Telemetry heartbeat status, desktop agent versions, and tamper detection."
        icon={ShieldCheck}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-active/15 px-2.5 py-0.5 text-2xs font-bold text-active">
            {healthyCount} / {healthyCount + outdatedCount + offlineCount + revokedCount} Healthy
          </span>
        }
        actionLink="/agent-health"
        actionText="Agent Settings"
        onClose={onClose}
      />

      {/* Counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6 text-center">
        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="font-display text-2xl font-bold text-active">{healthyCount}</div>
          <div className="text-2xs font-bold text-muted uppercase mt-0.5">Healthy & Synced</div>
        </div>
        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="font-display text-2xl font-bold text-amber-400">{outdatedCount}</div>
          <div className="text-2xs font-bold text-muted uppercase mt-0.5">Pending Update</div>
        </div>
        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="font-display text-2xl font-bold text-rose-500">{offlineCount}</div>
          <div className="text-2xs font-bold text-muted uppercase mt-0.5">Offline Heartbeat</div>
        </div>
        <div className="rounded-card bg-elevated/70 p-4 border border-border/60">
          <div className="font-display text-2xl font-bold text-muted">{revokedCount}</div>
          <div className="text-2xs font-bold text-muted uppercase mt-0.5">Revoked Token</div>
        </div>
      </div>

      {agentHealth?.latestVersion && (
        <div className="p-4 rounded-xl bg-elevated/60 text-xs text-muted">
          Latest stable agent version:{' '}
          <span className="font-bold text-fg">{agentHealth.latestVersion}</span>
        </div>
      )}
    </Card>
  );
}

/** 5. Expanded Attention Required */
function ExpandedAttentionRequired({
  attentionItems,
  onClose,
}: {
  attentionItems: Array<{ id: string; title: string; description: string; severity: string; tone: string; icon: React.ComponentType<{ className?: string }>; actionTo: string }>;
  onClose: () => void;
}) {
  return (
    <Card className="p-6 sm:p-7 shadow-warm-md">
      <ExpandedHeader
        title="Anomaly Triage & Incident Center"
        subtitle="High-priority activity anomalies, policy alerts, and heartbeat disconnections requiring admin review."
        icon={ShieldAlert}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-0.5 text-2xs font-bold text-amber-400">
            {attentionItems.length} Active Alerts
          </span>
        }
        onClose={onClose}
      />

      {attentionItems.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted rounded-2xl bg-elevated/40">
          <Check className="h-6 w-6 text-active mx-auto mb-2" />
          <h3 className="font-bold text-fg text-sm">No Active Anomalies</h3>
          <p className="mt-1">All workforce telemetry and enrolled desktop agents are within normal parameters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {attentionItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-2xl p-5 bg-elevated/70 border border-border/70 hover:border-accent/50 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-xl',
                      item.tone === 'amber' && 'bg-amber-500/15 text-amber-400',
                      item.tone === 'orange' && 'bg-orange-500/15 text-orange-400',
                      item.tone === 'indigo' && 'bg-indigo-500/15 text-indigo-400',
                      item.tone === 'rose' && 'bg-rose-500/15 text-rose-400'
                    )}>
                      <Icon className="h-5 w-5" />
                    </span>

                    <span className={cn(
                      'rounded-full px-2.5 py-0.5 text-2xs font-bold uppercase tracking-wider',
                      item.severity === 'Critical' && 'bg-rose-500/15 text-rose-400',
                      item.severity === 'High' && 'bg-amber-500/15 text-amber-400',
                      item.severity === 'Medium' && 'bg-orange-500/15 text-orange-400',
                      item.severity === 'Low' && 'bg-indigo-500/15 text-indigo-400'
                    )}>
                      {item.severity} Priority
                    </span>
                  </div>

                  <h3 className="font-display text-base font-bold text-fg">{item.title}</h3>
                  <p className="mt-1.5 text-xs text-muted leading-relaxed">{item.description}</p>
                </div>

                <div className="mt-5 pt-3 border-t border-border/60 flex items-center justify-between">
                  <Link
                    to={item.actionTo}
                    className="inline-flex items-center gap-1 text-xs font-bold text-accent hover:underline"
                  >
                    <span>Inspect</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** 6. Expanded Latest Activity & Audit Logs */
function ExpandedLatestActivity({
  audit,
  onClose,
}: {
  audit: ReturnType<typeof useAuditLogs>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const items = audit.data?.items ?? [];
  const filtered = items.filter((row) => {
    if (!search) return true;
    return (
      row.action.toLowerCase().includes(search.toLowerCase()) ||
      (row.actorName ?? '').toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <Card className="p-6 sm:p-7 shadow-warm-md">
      <ExpandedHeader
        title="Organization Audit Log & Security Ledger"
        subtitle="Cryptographically verified trail of all administrative events, authentication actions, and policy updates."
        icon={Plus}
        badge={
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-0.5 text-2xs font-bold text-accent">
            Immutable Audit Trail
          </span>
        }
        actionLink="/audit"
        actionText="Audit Center"
        onClose={onClose}
      />

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-full bg-elevated px-4 py-2 border border-border/60 max-w-sm w-full">
          <Search className="h-3.5 w-3.5 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action or admin actor..."
            className="w-full bg-transparent text-xs text-fg placeholder:text-muted/60 border-0 outline-none ring-0"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No audit entries" description="System audit records will appear here as administrative actions occur." />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-elevated/60 border border-border/60">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-[10px] font-bold uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Event Action</th>
                <th className="px-4 py-3">Actor / Admin</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3 text-right">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-elevated transition-colors">
                  <td className="px-4 py-3 font-bold text-fg flex items-center gap-2">
                    <span className="h-5 w-5 rounded-md bg-accent text-white flex items-center justify-center font-bold">
                      <Check className="h-3 w-3" />
                    </span>
                    <span>{row.action.replace(/[._]/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3 font-semibold text-fg/90">{row.actorName ?? 'System'}</td>
                  <td className="px-4 py-3 font-mono text-muted">{row.ip ?? '127.0.0.1'}</td>
                  <td className="px-4 py-3 text-right text-muted font-mono">{formatRelative(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
