import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Calendar,
  Clock,
  KeyRound,
  Laptop,
  Mail,
  PauseCircle,
  PieChart as PieIcon,
  RefreshCw,
  TrendingUp,
  User,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
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
  Badge,
  Button,
  Card,
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
} from '@/components/ui';
import { cn, daysAgoKey, formatDate, formatTime, initials, todayKey } from '@/lib/format';

type ActiveTab = 'timeline' | 'apps' | 'attendance' | 'rhythm';

const appsChartConfig = {
  PRODUCTIVE: {
    label: 'Productive Work',
    color: '#228B41',
  },
  NEUTRAL: {
    label: 'Neutral Utility',
    color: '#EC6C3A',
  },
  BREAK: {
    label: 'Breaks & Standby',
    color: '#D97706',
  },
  RESTRICTED: {
    label: 'Restricted Apps',
    color: '#DC2626',
  },
} satisfies ChartConfig;

const attendanceChartConfig = {
  activeHours: {
    label: 'Active Work Hours',
    color: '#EC6C3A',
  },
  idleHours: {
    label: 'Idle Time',
    color: '#D97706',
  },
} satisfies ChartConfig;

const rhythmChartConfig = {
  activeMin: {
    label: 'Active Minutes',
    color: '#EC6C3A',
  },
  idleMin: {
    label: 'Idle Minutes',
    color: '#D97706',
  },
} satisfies ChartConfig;

/** The employee detail view with official shadcn/ui Tabs & Charts. */
export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [date, setDate] = useState(todayKey());
  const [activeTab, setActiveTab] = useState<ActiveTab>('attendance');
  const [showCredentials, setShowCredentials] = useState(false);

  const employee = useEmployee(id);
  const timeline = useTimeline(id, date);
  const applications = useApplications({ employeeId: id, from: date, to: date });
  const attendance = useAttendanceRange(id, daysAgoKey(13), todayKey());
  const recompute = useRecomputeAttendance();

  const live = useEmployeePresence(id ?? '');

  if (employee.isLoading) return <LoadingBlock label="Loading employee profile..." />;
  if (employee.isError) return <ErrorState error={employee.error} onRetry={() => employee.refetch()} />;
  if (!employee.data) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/employees')}
          className="group flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-xs font-bold text-fg shadow-warm-sm border border-border/80 hover:bg-elevated hover:text-accent transition-all cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 text-accent" />
          <span>Back to Employees</span>
        </button>
        <EmptyState title="Employee not found" description="The requested employee record could not be loaded." />
      </div>
    );
  }

  const person = employee.data;
  const presenceState = live?.state ?? person?.presence?.state ?? 'OFFLINE';
  const currentApp = live?.currentApplication ?? person?.presence?.currentApplication ?? null;
  const stateSince = live?.stateSinceSec ?? person?.presence?.stateSinceSec ?? 0;
  const isToday = date === todayKey();

  const todayAttendance = attendance.data?.rows?.find((row) => row.date === date);

  // 14-Day Attendance chart data
  const attendanceChartData = useMemo(() => {
    return (attendance.data?.rows ?? []).map((row) => {
      const activeHours = +(row.activeSec / 3600).toFixed(2);
      const idleHours = +(row.idleSec / 3600).toFixed(2);
      return {
        date: row.date.slice(5),
        fullDate: row.date,
        activeHours,
        idleHours,
        totalHours: +(activeHours + idleHours).toFixed(2),
        activeSec: row.activeSec,
        idleSec: row.idleSec,
        firstSeen: row.firstSeen,
        lastSeen: row.lastSeen,
      };
    });
  }, [attendance.data?.rows]);

  // Hourly Work Rhythm Data from timeline
  const rhythmData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: `${i.toString().padStart(2, '0')}:00`,
      hourNum: i,
      activeSec: 0,
      idleSec: 0,
    }));

    (timeline.data?.entries ?? []).forEach((entry) => {
      const start = new Date(entry.startedAt).getHours();
      if (hours[start]) {
        if (entry.kind === 'app') {
          hours[start]!.activeSec += entry.durationSec;
        } else {
          hours[start]!.idleSec += entry.durationSec;
        }
      }
    });

    return hours.slice(6, 23).map((h) => ({
      hour: h.hour,
      activeMin: Math.round(h.activeSec / 60),
      idleMin: Math.round(h.idleSec / 60),
    }));
  }, [timeline.data?.entries]);

  // Applications Pie data
  const categoryPieData = useMemo(() => {
    const cats = applications.data?.categories ?? [];
    return cats.map((c) => ({
      name: c.category,
      value: c.durationSec,
      percent: c.percent,
      fill: appsChartConfig[c.category as keyof typeof appsChartConfig]?.color ?? '#EC6C3A',
    }));
  }, [applications.data?.categories]);

  // Productivity %
  const totalAppSec = (applications.data?.categories ?? []).reduce((sum, c) => sum + c.durationSec, 0);
  const productiveAppSec = applications.data?.categories.find((c) => c.category === 'PRODUCTIVE')?.durationSec ?? 0;
  const productivityPercent = totalAppSec > 0 ? Math.round((productiveAppSec / totalAppSec) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* 1. Top Bar with Back Button & Credentials */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate('/employees')}
          className="group flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-xs font-bold text-fg shadow-warm-sm border border-border/80 hover:bg-elevated hover:text-accent transition-all cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 text-accent" />
          <span>Back to Employees</span>
        </button>

        <div className="flex items-center gap-2.5">
          {can(Role.HrAdmin) && (
            <Button
              variant="secondary"
              onClick={() => setShowCredentials(true)}
              className="rounded-full shadow-warm-sm text-xs"
            >
              <KeyRound className="h-3.5 w-3.5 text-accent" />
              <span>Agent Credentials</span>
            </Button>
          )}
        </div>
      </div>

      {/* 2. Employee Profile Header Card */}
      <Card className="p-6 transition-all hover:shadow-warm-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-fg font-display text-xl font-bold shadow-warm-md">
              {initials(person.name)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-display text-2xl font-bold tracking-tight text-fg">{person.name}</h1>
                <PresenceBadge state={presenceState} pulse />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs font-medium text-muted">
                {person.jobTitle && (
                  <span className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5 text-accent" />
                    {person.jobTitle}
                  </span>
                )}
                {person.departmentName && (
                  <>
                    <span>•</span>
                    <Badge tone="default">
                      {person.departmentName}
                    </Badge>
                  </>
                )}
                {person.email && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5 text-muted" />
                      {person.email}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-2xl bg-elevated/70 p-3 px-4 border border-border/60">
            <Laptop className="h-4 w-4 text-accent" />
            <div className="text-xs">
              <span className="font-bold text-fg">{person.deviceCount}</span>{' '}
              <span className="text-muted">device{person.deviceCount === 1 ? '' : 's'} enrolled</span>
            </div>
          </div>
        </div>
      </Card>

      {/* 3. Key Telemetry Stat Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Status Card */}
        <Card className="p-4">
          <div className="flex items-center justify-between text-2xs font-bold uppercase tracking-wider text-muted">
            <span>Presence</span>
            <Activity className="h-3.5 w-3.5 text-accent" />
          </div>
          <div className="mt-1.5 font-display text-xl font-bold text-fg">
            {presenceState.charAt(0) + presenceState.slice(1).toLowerCase()}
          </div>
          <div className="mt-1 text-2xs text-muted font-medium">
            {presenceState === 'OFFLINE' ? (
              person.presence.lastSeenAt ? `Seen ${formatTime(person.presence.lastSeenAt)}` : 'Offline'
            ) : (
              <span>Active for <LiveDuration sinceSec={stateSince} className="font-bold text-fg" /></span>
            )}
          </div>
        </Card>

        {/* Current Window */}
        <Card className="p-4">
          <div className="flex items-center justify-between text-2xs font-bold uppercase tracking-wider text-muted">
            <span>Current Window</span>
            <Laptop className="h-3.5 w-3.5 text-accent" />
          </div>
          <div className="mt-1.5 truncate font-display text-base font-bold text-fg">
            {currentApp ?? 'No active app'}
          </div>
          <div className="mt-1 text-2xs text-muted">
            {presenceState === 'ACTIVE' ? 'Focused workstation' : 'Standby'}
          </div>
        </Card>

        {/* Active Work */}
        <Card className="p-4">
          <div className="flex items-center justify-between text-2xs font-bold uppercase tracking-wider text-muted">
            <span>{isToday ? 'Active Today' : `Active (${date.slice(5)})`}</span>
            <Clock className="h-3.5 w-3.5 text-accent" />
          </div>
          <div className="mt-1.5 font-display text-xl font-bold text-active">
            {formatDuration(todayAttendance?.activeSec ?? (isToday ? person.todayActiveSec : 0))}
          </div>
          <div className="mt-1 text-2xs text-muted">Productive duration</div>
        </Card>

        {/* Idle Duration */}
        <Card className="p-4">
          <div className="flex items-center justify-between text-2xs font-bold uppercase tracking-wider text-muted">
            <span>{isToday ? 'Idle Today' : `Idle (${date.slice(5)})`}</span>
            <PauseCircle className="h-3.5 w-3.5 text-warn" />
          </div>
          <div className="mt-1.5 font-display text-xl font-bold text-warn">
            {formatDuration(todayAttendance?.idleSec ?? (isToday ? person.todayIdleSec : 0))}
          </div>
          <div className="mt-1 text-2xs text-muted">Inactive duration</div>
        </Card>
      </div>

      {/* 4. Shadcn Tabs Navigation & Controls */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as ActiveTab)} className="space-y-4">
        {/* Controls Ribbon */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-surface border border-border/80 shadow-warm-sm">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="timeline" className="gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <span>Timeline</span>
            </TabsTrigger>
            <TabsTrigger value="apps" className="gap-1.5">
              <PieIcon className="h-3.5 w-3.5" />
              <span>Apps & Productivity</span>
            </TabsTrigger>
            <TabsTrigger value="attendance" className="gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>14-Day Attendance</span>
            </TabsTrigger>
            <TabsTrigger value="rhythm" className="gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              <span>Work Rhythm</span>
            </TabsTrigger>
          </TabsList>

          {/* Date Selector & Recalculate */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-accent" />
              <Input
                type="date"
                value={date}
                max={todayKey()}
                onChange={(e) => setDate(e.target.value)}
                className="w-auto h-8 text-xs font-semibold py-1"
              />
            </div>

            <Button
              size="sm"
              variant="secondary"
              loading={recompute.isPending}
              onClick={() => recompute.mutate({ employeeId: id, date })}
              className="rounded-full text-xs h-8"
            >
              <RefreshCw className="h-3 w-3 text-accent" />
              <span>Recalculate</span>
            </Button>
          </div>
        </div>

        {/* TAB 1: ACTIVITY TIMELINE & LOGS */}
        <TabsContent value="timeline">
          <Card className="p-6 shadow-warm-md">
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
              <div>
                <h2 className="font-display text-base font-bold tracking-tight text-fg">
                  Continuous Activity Timeline — {formatDate(`${date}T00:00:00.000Z`)}
                </h2>
                <p className="text-2xs text-muted mt-0.5">
                  Visual telemetry spans showing focused windows, idle pauses, and locked states.
                </p>
              </div>
              <Badge tone="accent">
                {timeline.data?.entries.length ?? 0} spans recorded
              </Badge>
            </div>

            {timeline.isLoading ? (
              <div className="flex justify-center py-12">
                <LoadingBlock />
              </div>
            ) : timeline.isError ? (
              <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />
            ) : (
              <div>
                <Timeline entries={timeline.data?.entries ?? []} />
                <div className="mt-5 border-t border-border/60 pt-4">
                  <h3 className="text-xs font-bold text-muted uppercase tracking-wider mb-2.5">
                    Chronological Activity Log
                  </h3>
                  <TimelineList entries={timeline.data?.entries ?? []} />
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* TAB 2: APPLICATIONS & PRODUCTIVITY (Official Shadcn Pie Chart) */}
        <TabsContent value="apps">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr]">
            {/* Donut Category Chart */}
            <Card className="p-6 shadow-warm-sm flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-fg">Productivity Distribution</h2>
                    <p className="text-2xs text-muted">Category ratio computed by agent rules</p>
                  </div>
                  <Badge tone="accent">
                    {productivityPercent}% Productive
                  </Badge>
                </div>

                {categoryPieData.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted">
                    No categorized applications recorded for {date}.
                  </div>
                ) : (
                  <ChartContainer config={appsChartConfig} className="mx-auto aspect-square max-h-[240px]">
                    <PieChart>
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            hideLabel
                            formatter={(value, name) => (
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-fg">{name}:</span>
                                <span className="font-mono font-bold text-accent">
                                  {formatDuration(Number(value))}
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Pie
                        data={categoryPieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={80}
                        strokeWidth={2}
                        stroke="rgb(var(--surface))"
                      >
                        {categoryPieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <ChartLegend content={<ChartLegendContent nameKey="name" />} className="-translate-y-2 flex-wrap" />
                    </PieChart>
                  </ChartContainer>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/60">
                {categoryPieData.map((cat) => (
                  <div key={cat.name} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-bold text-fg">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.fill }} />
                      <span>{cat.name}</span>
                    </span>
                    <span className="font-mono text-muted">{formatDuration(cat.value)}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Applications Detailed Table */}
            <Card className="p-6 shadow-warm-sm">
              <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
                <h2 className="font-display text-base font-bold text-fg">Application Usage Table</h2>
                <span className="text-xs text-muted font-medium">
                  {applications.data?.applications.length ?? 0} active apps
                </span>
              </div>

              {applications.isLoading ? (
                <LoadingBlock />
              ) : (applications.data?.applications.length ?? 0) === 0 ? (
                <EmptyState title="No application sessions recorded for this day" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr className="border-b border-border/60 text-[10px] uppercase font-bold text-muted">
                        <Th>Application</Th>
                        <Th>Category</Th>
                        <Th className="text-right">Active Time</Th>
                        <Th className="text-right">Sessions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 text-xs">
                      {applications.data?.applications.map((app) => (
                        <tr key={app.exeName} className="hover:bg-elevated/40 transition-colors">
                          <Td className="font-bold text-fg">{app.appName}</Td>
                          <Td className="text-xs">
                            <span
                              className="inline-block px-2 py-0.5 rounded-full text-2xs font-bold"
                              style={{
                                color: appsChartConfig[app.category as keyof typeof appsChartConfig]?.color ?? 'inherit',
                                backgroundColor: `${appsChartConfig[app.category as keyof typeof appsChartConfig]?.color ?? '#999'}20`,
                              }}
                            >
                              {app.category}
                            </span>
                          </Td>
                          <Td className="tabular font-mono font-bold text-accent text-right">
                            {formatDuration(app.durationSec)}
                          </Td>
                          <Td className="tabular text-right text-muted">{app.sessionCount}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* TAB 3: 14-DAY ATTENDANCE (Official Shadcn Bar Chart + Timesheets) */}
        <TabsContent value="attendance">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
            {/* 14-Day Active Hours Chart */}
            <Card className="p-6 shadow-warm-sm flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-fg">14-Day Work Consistency Chart</h2>
                    <p className="text-2xs text-muted">Daily active hours vs idle workstation time</p>
                  </div>
                  <Badge tone="default">14 Days</Badge>
                </div>

                <ChartContainer config={attendanceChartConfig} className="h-64 w-full">
                  <BarChart data={attendanceChartData} barSize={28} maxBarSize={36}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} tickMargin={10} axisLine={false} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val: number) => (val >= 1 ? `${val}h` : `${Math.round(val * 60)}m`)}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          indicator="dashed"
                          formatter={(value, name) => (
                            <div className="flex items-center justify-between gap-4 w-full">
                              <span className="text-muted">{name}:</span>
                              <span className="font-mono font-bold text-fg">
                                {formatDuration(Number(value) * 3600)}
                              </span>
                            </div>
                          )}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="activeHours" fill="var(--color-activeHours)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="idleHours" fill="var(--color-idleHours)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </div>

              <div className="mt-2 text-2xs text-muted text-center pt-2 border-t border-border/40">
                Tracked daily from employee desktop agent heartbeats and window activity.
              </div>
            </Card>

            {/* Attendance Ledger Table */}
            <Card className="p-6 shadow-warm-sm flex flex-col justify-between">
              <div>
                <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
                  <h2 className="font-display text-base font-bold text-fg">Attendance Timesheets</h2>
                  <span className="text-2xs text-muted font-medium">Click row to inspect</span>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr className="border-b border-border/60 text-[10px] uppercase font-bold text-muted">
                        <Th>Date</Th>
                        <Th>First</Th>
                        <Th>Last</Th>
                        <Th className="text-right">Active</Th>
                        <Th className="text-right">Idle</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 text-xs">
                      {[...(attendance.data?.rows ?? [])].reverse().map((row) => (
                        <tr
                          key={row.date}
                          className={cn(
                            'cursor-pointer transition-colors',
                            row.date === date
                              ? 'bg-accent/15 font-bold text-accent'
                              : 'hover:bg-elevated/40'
                          )}
                          onClick={() => setDate(row.date)}
                        >
                          <Td className="font-semibold text-fg">{row.date}</Td>
                          <Td className="tabular text-muted">{formatTime(row.firstSeen)}</Td>
                          <Td className="tabular text-muted">{formatTime(row.lastSeen)}</Td>
                          <Td className="tabular font-mono font-bold text-right text-active">
                            {formatDuration(row.activeSec)}
                          </Td>
                          <Td className="tabular font-mono text-right text-muted">
                            {formatDuration(row.idleSec)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>

              <div className="pt-3 border-t border-border/40 text-2xs text-muted text-right font-medium">
                {attendance.data?.rows.length ?? 0} active recorded days
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 4: DAILY WORK RHYTHM (Official Shadcn Area Chart) */}
        <TabsContent value="rhythm">
          <Card className="p-6 shadow-warm-md">
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
              <div>
                <h2 className="font-display text-base font-bold text-fg">
                  Daily Work Rhythm & Focus Intensity — {formatDate(`${date}T00:00:00.000Z`)}
                </h2>
                <p className="text-2xs text-muted">Hourly distribution of active work minutes across the shift.</p>
              </div>
              <Badge tone="accent">
                <Zap className="h-3 w-3 inline mr-1" /> Telemetry Flow
              </Badge>
            </div>

            <ChartContainer config={rhythmChartConfig} className="h-72 w-full mt-4">
              <AreaChart data={rhythmData}>
                <defs>
                  <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-activeMin)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-activeMin)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} unit="m" />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      formatter={(val) => (
                        <span className="font-mono font-bold text-accent">{val} minutes active</span>
                      )}
                    />
                  }
                />
                <Area
                  type="natural"
                  dataKey="activeMin"
                  stroke="var(--color-activeMin)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#activeGrad)"
                />
              </AreaChart>
            </ChartContainer>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-border/60 text-center">
              <div className="rounded-xl bg-elevated/70 p-3">
                <div className="text-2xs font-bold text-muted uppercase">Peak Focus Hour</div>
                <div className="font-display text-lg font-bold text-fg mt-0.5">
                  {rhythmData.reduce((max, h) => (h.activeMin > max.activeMin ? h : max), rhythmData[0] ?? { hour: '—', activeMin: 0, idleMin: 0 }).hour}
                </div>
              </div>
              <div className="rounded-xl bg-elevated/70 p-3">
                <div className="text-2xs font-bold text-muted uppercase">Total Work Spans</div>
                <div className="font-display text-lg font-bold text-active mt-0.5">
                  {timeline.data?.entries.filter((e) => e.kind === 'app').length ?? 0} focused sprints
                </div>
              </div>
              <div className="rounded-xl bg-elevated/70 p-3">
                <div className="text-2xs font-bold text-muted uppercase">Total Shift Length</div>
                <div className="font-display text-lg font-bold text-accent mt-0.5">
                  {formatDuration(todayAttendance?.sessionSec ?? 0)}
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {showCredentials && id && (
        <CredentialsDialog
          employeeId={id}
          employeeName={person.name}
          open
          onClose={() => setShowCredentials(false)}
        />
      )}
    </div>
  );
}
