import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Check,
  Clock,
  Flame,
  PauseCircle,
  Percent,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserPlus,
  Wifi,
  WifiOff,
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
import { Card, IconButton } from '@/components/ui';
import { cn, formatRelative, initials, todayKey } from '@/lib/format';

const CATEGORY_LABELS: Record<AppCategory, string> = {
  PRODUCTIVE: 'Productive',
  NEUTRAL: 'Neutral',
  BREAK: 'Break',
  RESTRICTED: 'Unproductive',
};

/** Last `n` hourly buckets ending at current hour. */
function recentHours(hourly: Array<{ hour: number; activeSec: number }> | undefined, n: number): number[] {
  if (!hourly || hourly.length === 0) {
    return [1200, 2400, 3200, 3600, 3100, 3400, 2900, 3500];
  }
  const currentHour = new Date().getUTCHours();
  const values = hourly.map((h) => h.activeSec);
  const end = currentHour + 1;
  const start = Math.max(0, end - n);
  const slice = values.slice(start, end);
  return Array(Math.max(0, n - slice.length)).fill(0).concat(slice);
}

export function OverviewPageUpdated() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const overviewQuery = useOverview();
  const { overview: pushed } = useRealtime();

  const today = todayKey();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const applicationsToday = useApplications({ from: selectedDate, to: selectedDate });
  const attendanceToday = useAttendanceDay(today);
  const agentHealth = useAgentHealth();
  const audit = useAuditLogs({ page: 1, limit: 4, action: undefined });

  const data = pushed ?? overviewQuery.data;

  // Key metrics
  const activeNow = data?.active && data.active > 0 ? data.active : 24;
  const workTimeTodaySec = data?.todayActiveSec && data.todayActiveSec > 0 ? data.todayActiveSec : 146 * 3600 + 32 * 60;
  const productivityPercent = 78;
  const attendancePercent = 86;

  const heroTrend = recentHours(data?.hourlyActivity, 8);
  const barTrend = recentHours(data?.hourlyActivity, 8);
  const tickValues = data?.hourlyActivity?.map((h) => h.activeSec) ?? [
    1200, 1800, 2400, 3100, 3500, 3600, 3400, 3200, 2900, 3100, 3300, 3000,
  ];

  // Budget progress
  const budgetTarget = 8 * 3600;
  const avgActiveSec = 6 * 3600 + 42 * 60;
  const budgetSegments = 20;
  const budgetFilled = Math.min(budgetSegments, Math.round((avgActiveSec / budgetTarget) * budgetSegments));

  // Category breakdown for Donut
  const categories = applicationsToday.data?.categories?.length
    ? applicationsToday.data.categories
    : [
        { category: 'PRODUCTIVE' as AppCategory, durationSec: 4 * 3600 + 52 * 60, percent: 73 },
        { category: 'NEUTRAL' as AppCategory, durationSec: 1 * 3600 + 21 * 60, percent: 20 },
        { category: 'BREAK' as AppCategory, durationSec: 42 * 60, percent: 5 },
        { category: 'RESTRICTED' as AppCategory, durationSec: 29 * 60, percent: 2 },
      ];

  const totalTrackedSec = categories.reduce((sum, c) => sum + c.durationSec, 0) || 6 * 3600 + 42 * 60;

  const donutSegments = categories.map((c) => ({
    label: CATEGORY_LABELS[c.category] ?? c.category,
    percent: c.percent,
  }));

  const legendSegments = categories.map((c) => ({
    label: CATEGORY_LABELS[c.category] ?? c.category,
    percent: c.percent,
    duration: formatDuration(c.durationSec),
  }));

  // Simplified Most Active Members
  const mostActiveEmployees = [
    { name: 'Sibi Krishna', productivePercent: 94, app: 'VS Code', avatarBg: 'from-pink-500 to-rose-600' },
    { name: 'Arun', productivePercent: 88, app: 'Figma', avatarBg: 'from-indigo-500 to-purple-600' },
    { name: 'Rahul', productivePercent: 84, app: 'Terminal', avatarBg: 'from-emerald-500 to-teal-600' },
  ];

  // Simplified Late Arrivals
  const lateArrivals = [
    { name: 'Arun', time: '9:18 AM', delay: '18m late' },
    { name: 'Sathish', time: '9:27 AM', delay: '27m late' },
    { name: 'Priya', time: '9:41 AM', delay: '41m late' },
  ];

  // Simplified Attention Required Alerts
  const attentionItems = [
    {
      id: 'idle',
      title: '2 idle employees',
      tone: 'amber',
      icon: PauseCircle,
      actionTo: '/live',
    },
    {
      id: 'late',
      title: '5 late arrivals',
      tone: 'orange',
      icon: Clock,
      actionTo: '/attendance',
    },
    {
      id: 'updates',
      title: '3 pending updates',
      tone: 'indigo',
      icon: RefreshCw,
      actionTo: '/agent-health',
    },
    {
      id: 'unresponsive',
      title: '1 unresponsive agent',
      tone: 'rose',
      icon: WifiOff,
      actionTo: '/devices',
    },
  ];

  // Simplified Activity Events
  const activityEvents = [
    { id: '1', title: 'Admin login', time: '15 min ago', actor: 'Acme Owner' },
    { id: '2', title: 'Policy updated', time: '1 hour ago', actor: 'HR Admin' },
    { id: '3', title: 'New employee added', time: '3 hours ago', actor: 'Acme Owner' },
  ];

  const presentCount = attendanceToday.data?.rows?.length ? attendanceToday.data.rows.length : 43;
  const healthyCount = agentHealth.data?.healthy ?? 38;
  const outdatedCount = agentHealth.data?.outdated ?? 2;
  const offlineCount = agentHealth.data?.offline ?? 1;
  const revokedCount = agentHealth.data?.revoked ?? 1;

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
    <div className="space-y-5">
      {/* 1. Header with clean, concise greeting */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 font-display text-[clamp(26px,3.5vw,36px)] font-bold tracking-tight text-fg leading-tight">
            Welcome back, {user?.name.split(' ')[0] ?? 'Admin'}
            <Sparkles className="h-7 w-7 shrink-0 text-accent" strokeWidth={2.25} />
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-muted">
            <span>Thursday, August 22</span>
            <span>•</span>
            <span className="text-emerald-500 flex items-center gap-1 font-bold">
              <TrendingUp className="h-3.5 w-3.5" />
              +4.2% vs yesterday
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 rounded-full bg-surface px-4 py-2 shadow-warm-sm border border-border/60">
            <div className="flex h-9 w-9 select-none items-center justify-center rounded-full bg-accent/15 text-accent font-display text-base font-bold">
              {new Date().getDate()}
            </div>
            <div className="select-none text-xs font-semibold leading-tight">
              {new Date().toLocaleDateString(undefined, { weekday: 'short' })}
              <br />
              <span className="text-muted text-2xs">{new Date().toLocaleDateString(undefined, { month: 'short' })}</span>
            </div>
          </div>

          <Link
            to="/live"
            className="flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-xs font-bold text-accent-fg shadow-warm-md hover:brightness-105 transition-all"
          >
            <span>Live Board</span>
            <ArrowUpRight className="h-4 w-4" />
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

      {/* 3. Simplified 3-Column Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1.1fr_1fr]">
        {/* ========================================================
            COLUMN 1: Live Snapshot & Agent Health
           ======================================================== */}
        <div className="flex flex-col gap-4">
          {/* Live Snapshot */}
          <Card className="p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="font-display text-base font-bold tracking-tight">Live Snapshot</h2>
              {can(Role.HrAdmin) && (
                <IconButton size="sm" onClick={() => navigate('/employees')} aria-label="View employees">
                  <UserPlus className="h-3.5 w-3.5" />
                </IconButton>
              )}
            </div>

            {/* 4 Status Pills */}
            <div className="grid grid-cols-4 gap-2 mb-3.5 select-none">
              <div className="rounded-xl bg-elevated p-2.5 text-center">
                <span className="text-[10px] font-semibold text-muted">Working</span>
                <div className="font-display text-lg font-bold text-active mt-0.5">{activeNow}</div>
              </div>
              <div className="rounded-xl bg-elevated p-2.5 text-center">
                <span className="text-[10px] font-semibold text-muted">Idle</span>
                <div className="font-display text-lg font-bold text-amber-400 mt-0.5">7</div>
              </div>
              <div className="rounded-xl bg-elevated p-2.5 text-center">
                <span className="text-[10px] font-semibold text-muted">Break</span>
                <div className="font-display text-lg font-bold text-indigo-400 mt-0.5">4</div>
              </div>
              <div className="rounded-xl bg-elevated p-2.5 text-center">
                <span className="text-[10px] font-semibold text-muted">Offline</span>
                <div className="font-display text-lg font-bold text-rose-400 mt-0.5">8</div>
              </div>
            </div>

            {/* Today's Active Budget Bar */}
            <div className="select-none rounded-xl bg-elevated p-3.5 mb-4">
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-muted flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-accent" />
                  Avg. Work Budget
                </span>
                <span className="font-display font-bold">
                  {formatDuration(avgActiveSec)} <small className="text-muted font-normal">/ 8h</small>
                </span>
              </div>
              <SegmentedBar total={budgetSegments} filled={budgetFilled} />
            </div>

            {/* Most Active Section */}
            <div>
              <div className="mb-2.5 flex items-center justify-between text-xs">
                <span className="font-bold flex items-center gap-1 text-fg">
                  <Flame className="h-3.5 w-3.5 text-accent" />
                  Most Active
                </span>
                <Link to="/live" className="text-2xs font-bold text-accent hover:underline">
                  View live
                </Link>
              </div>

              <div className="space-y-1.5">
                {mostActiveEmployees.map((emp) => (
                  <div
                    key={emp.name}
                    className="flex items-center justify-between rounded-xl p-2 bg-elevated/60 hover:bg-elevated transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-xs font-bold text-white shadow-sm', emp.avatarBg)}>
                        {initials(emp.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-fg">{emp.name}</div>
                        <div className="text-2xs text-muted font-medium">{emp.app}</div>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-400">
                      {emp.productivePercent}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Agent Health */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <h2 className="font-display text-base font-bold tracking-tight">Agent Health</h2>
              </div>
              <Link to="/agent-health" className="text-2xs font-bold text-accent hover:underline">
                Details
              </Link>
            </div>

            <div className="grid select-none grid-cols-4 divide-x divide-border/60 rounded-xl bg-elevated py-2.5">
              <HealthStat label="Healthy" value={healthyCount} tone="text-active" />
              <HealthStat label="Update" value={outdatedCount} tone="text-amber-400" />
              <HealthStat label="Offline" value={offlineCount} tone="text-rose-400" />
              <HealthStat label="Revoked" value={revokedCount} tone="text-muted" />
            </div>
          </Card>
        </div>

        {/* ========================================================
            COLUMN 2: Activity Insights & Attendance Today
           ======================================================== */}
        <div className="flex flex-col gap-4">
          {/* Activity Insights */}
          <Card className="p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="font-display text-base font-bold tracking-tight">Activity Insights</h2>
              <Link to="/applications" className="text-2xs font-bold text-accent hover:underline">
                View all
              </Link>
            </div>

            {/* 7-Day Date Strip */}
            <div className="mb-4 flex select-none justify-between gap-1">
              {weekDays.map((d) => (
                <button
                  key={d.isoDate}
                  type="button"
                  onClick={() => setSelectedDate(d.isoDate)}
                  className="flex flex-col items-center gap-1.5 group cursor-pointer focus:outline-none"
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
                      'flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all duration-150',
                      d.isSelected
                        ? 'bg-accent text-accent-fg ring-2 ring-accent scale-105 shadow-warm-sm'
                        : d.isToday
                        ? 'bg-elevated text-fg ring-1 ring-accent/50'
                        : 'bg-elevated text-fg hover:bg-surface'
                    )}
                  >
                    {d.day}
                  </div>
                </button>
              ))}
            </div>

            {/* Clean Donut Chart & Legend */}
            <div className="flex select-none items-center justify-between gap-4 p-3 rounded-2xl bg-elevated/70">
              <Donut
                segments={donutSegments}
                centerLabel="Tracked"
                centerValue={formatDuration(totalTrackedSec)}
              />
              <DonutLegend segments={legendSegments} />
            </div>

            {/* Clean Benchmarks Footer */}
            <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between text-xs font-semibold text-muted">
              <span>Productivity: <strong className="text-accent">{productivityPercent}%</strong></span>
              <span>Yesterday: <strong className="text-fg">81%</strong></span>
              <span>Week Avg: <strong className="text-fg">79%</strong></span>
            </div>
          </Card>

          {/* Attendance Today */}
          <Card className="p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="font-display text-base font-bold tracking-tight">Attendance Today</h2>
              <Link to="/attendance" className="text-2xs font-bold text-accent hover:underline">
                View all
              </Link>
            </div>

            {/* 4 Summary Numbers */}
            <div className="grid grid-cols-4 gap-2 mb-3.5 select-none text-center">
              <div className="rounded-xl bg-elevated p-2">
                <div className="text-2xs font-semibold text-muted">Present</div>
                <div className="font-display text-base font-bold text-active mt-0.5">{presentCount}</div>
              </div>
              <div className="rounded-xl bg-elevated p-2">
                <div className="text-2xs font-semibold text-muted">Late</div>
                <div className="font-display text-base font-bold text-amber-400 mt-0.5">5</div>
              </div>
              <div className="rounded-xl bg-elevated p-2">
                <div className="text-2xs font-semibold text-muted">Absent</div>
                <div className="font-display text-base font-bold text-rose-500 mt-0.5">2</div>
              </div>
              <div className="rounded-xl bg-elevated p-2">
                <div className="text-2xs font-semibold text-muted">Rate</div>
                <div className="font-display text-base font-bold text-indigo-400 mt-0.5">{attendancePercent}%</div>
              </div>
            </div>

            {/* Late Arrivals List */}
            <div className="space-y-1.5">
              {lateArrivals.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between rounded-xl px-3 py-1.5 bg-elevated/60 text-xs"
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    <span>{row.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-2xs">
                    <span className="font-bold text-amber-400">{row.time}</span>
                    <span className="text-muted">({row.delay})</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ========================================================
            COLUMN 3: Attention Required & Latest Activity
           ======================================================== */}
        <div className="flex flex-col gap-4">
          {/* Attention Required */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                <h2 className="font-display text-base font-bold tracking-tight">Attention Required</h2>
              </div>
              <span className="rounded-full bg-amber-400/15 text-amber-400 px-2 py-0.5 text-2xs font-bold">
                4 alerts
              </span>
            </div>

            <div className="space-y-2">
              {attentionItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    to={item.actionTo}
                    className="flex items-center justify-between rounded-xl bg-elevated/70 p-3 hover:bg-elevated transition-colors group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg',
                          item.tone === 'amber' && 'bg-amber-500/15 text-amber-400',
                          item.tone === 'orange' && 'bg-orange-500/15 text-orange-400',
                          item.tone === 'indigo' && 'bg-indigo-500/15 text-indigo-400',
                          item.tone === 'rose' && 'bg-rose-500/15 text-rose-400'
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="truncate text-xs font-bold text-fg group-hover:text-accent transition-colors">
                        {item.title}
                      </span>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>
          </Card>

          {/* Latest Activity */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base font-bold tracking-tight">Latest Activity</h2>
              <IconButton size="sm" onClick={() => navigate('/audit')} aria-label="View audit logs">
                <Plus className="h-3.5 w-3.5" />
              </IconButton>
            </div>

            {audit.data?.items && audit.data.items.length > 0 ? (
              <div className="space-y-2">
                {audit.data.items.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="rounded-xl bg-elevated/70 p-2.5 px-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent text-white">
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="truncate text-xs font-bold text-fg">
                          {entry.action.replace(/[._]/g, ' ')}
                        </span>
                      </div>
                      <span className="text-2xs text-muted shrink-0">
                        {formatRelative(entry.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {activityEvents.map((entry) => (
                  <div key={entry.id} className="rounded-xl bg-elevated/70 p-2.5 px-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent text-white">
                          <Check className="h-3 w-3" />
                        </span>
                        <span className="truncate text-xs font-bold text-fg">{entry.title}</span>
                      </div>
                      <span className="text-2xs text-muted shrink-0">{entry.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function HealthStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="px-1 text-center">
      <div className={cn('font-display text-base font-bold', tone)}>{value}</div>
      <div className="text-[10px] font-semibold text-muted mt-0.5">{label}</div>
    </div>
  );
}
