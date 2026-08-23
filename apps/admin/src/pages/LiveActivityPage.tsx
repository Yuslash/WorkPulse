import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AppWindow,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  LayoutGrid,
  List,
  MonitorSmartphone,
  Search,
} from 'lucide-react';
import { PresenceState, formatDuration } from '@workpulse/shared';
import { useEmployees } from '@/features/queries';
import { useRealtime } from '@/lib/realtime';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { LiveDuration, PresenceBadge } from '@/components/status/PresenceDot';
import { cn, formatRelative, initials } from '@/lib/format';

type ViewMode = 'grid' | 'list';

const AVATAR_GRADIENTS = [
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-fuchsia-600',
];

function getAvatarGradient(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]!;
}

/**
 * Activity waveform sparkline with rich visual contrast
 */
function ActivitySparkline({
  activeSec,
  isOnline,
  index = 0,
}: {
  activeSec: number;
  isOnline: boolean;
  index?: number;
}) {
  const sparklineData = useMemo(() => {
    const points: string[] = [];
    const count = 32;
    for (let i = 0; i <= count; i++) {
      const x = (i / count) * 200;
      let y = 10;
      if (isOnline || activeSec > 0) {
        const seed = (index * 11 + i * 17) % 100;
        y = seed > 50 ? 3 + (seed % 9) : 9 + (seed % 5);
      } else {
        const jitter = (index * 5 + i * 9) % 10;
        y = jitter > 7 ? 8.5 : jitter > 3 ? 10.5 : 9.5;
      }
      points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return points.join(' ');
  }, [activeSec, isOnline, index]);

  const strokeColor = isOnline
    ? '#10B981'
    : activeSec > 0
    ? '#F43F5E'
    : 'rgba(168, 85, 247, 0.35)';

  return (
    <svg
      viewBox="0 0 200 18"
      className="h-3.5 flex-1 mx-3 overflow-visible"
      preserveAspectRatio="none"
    >
      <path
        d={sparklineData}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LiveActivityPage() {
  const { presence } = useRealtime();
  const [filter, setFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(12);

  const query = useEmployees({ page: 1, limit: 200 });
  const rawEmployees = query.data?.items ?? [];

  const counts = useMemo<Record<PresenceState, number>>(() => {
    const tally: Record<PresenceState, number> = {
      ACTIVE: 0,
      IDLE: 0,
      LOCKED: 0,
      OFFLINE: 0,
    };
    for (const employee of rawEmployees) {
      const state = (presence.get(employee.id)?.state ?? employee.presence.state) as PresenceState;
      if (state in tally) {
        tally[state] = (tally[state] ?? 0) + 1;
      }
    }
    return tally;
  }, [rawEmployees, presence]);

  const allFilteredRows = useMemo(() => {
    const merged = rawEmployees.map((employee) => {
      const live = presence.get(employee.id);
      return {
        ...employee,
        state: (live?.state ?? employee.presence.state) as PresenceState,
        currentApplication: live?.currentApplication ?? employee.presence.currentApplication,
        stateSinceSec: live?.stateSinceSec ?? employee.presence.stateSinceSec,
        lastSeenAt: live?.lastSeenAt ?? employee.presence.lastSeenAt,
      };
    });

    const order: PresenceState[] = [
      PresenceState.Active,
      PresenceState.Idle,
      PresenceState.Locked,
      PresenceState.Offline,
    ];

    return merged
      .filter((row) => {
        if (filter && row.state !== filter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            row.name.toLowerCase().includes(q) ||
            (row.departmentName ?? '').toLowerCase().includes(q) ||
            (row.currentApplication ?? '').toLowerCase().includes(q) ||
            row.email.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const byState = order.indexOf(a.state) - order.indexOf(b.state);
        return byState !== 0 ? byState : b.todayActiveSec - a.todayActiveSec;
      });
  }, [rawEmployees, presence, filter, search]);

  const totalPages = Math.ceil(allFilteredRows.length / pageSize) || 1;

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return allFilteredRows.slice(start, start + pageSize);
  }, [allFilteredRows, currentPage, pageSize]);

  return (
    <div className="space-y-6">
      {/* 1. Header Row with Title + Unified Reference Statistics Bar */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg sm:text-3xl">
            Live Activity
          </h1>
          <p className="mt-1.5 text-xs text-muted sm:text-sm">
            Live telemetry streaming in real time from enrolled devices.
          </p>
        </div>

        {/* Unified Statistics Capsule Bar matching Reference HTML */}
        <div className="rounded-2xl bg-surface border border-border/80 flex flex-row items-center py-3 px-5 sm:px-6 gap-5 sm:gap-7 shadow-warm-sm max-w-full overflow-x-auto">
          {/* Active Item */}
          <button
            type="button"
            onClick={() => {
              setFilter(filter === PresenceState.Active ? '' : PresenceState.Active);
              setCurrentPage(1);
            }}
            className={cn(
              'flex items-center gap-3.5 min-w-max text-left transition-opacity',
              filter && filter !== PresenceState.Active ? 'opacity-40 hover:opacity-100' : 'opacity-100'
            )}
          >
            <div className="w-[42px] h-[42px] rounded-[12px] bg-[#122820] flex items-center justify-center shrink-0 border border-emerald-800/40">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d67b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div className="flex flex-col justify-center">
              <div className="text-[20px] font-bold text-fg leading-tight tracking-wide">{counts.ACTIVE}</div>
              <div className="text-[13px] text-muted font-medium mt-0.5">Active</div>
              <div className="text-[11px] text-muted/80 mt-0.5 font-medium">
                <span className="text-[#22d67b] font-semibold">+12%</span> vs yesterday
              </div>
            </div>
          </button>

          <div className="w-[1px] h-[36px] bg-border/80 shrink-0 hidden sm:block" />

          {/* Idle Item */}
          <button
            type="button"
            onClick={() => {
              setFilter(filter === PresenceState.Idle ? '' : PresenceState.Idle);
              setCurrentPage(1);
            }}
            className={cn(
              'flex items-center gap-3.5 min-w-max text-left transition-opacity',
              filter && filter !== PresenceState.Idle ? 'opacity-40 hover:opacity-100' : 'opacity-100'
            )}
          >
            <div className="w-[42px] h-[42px] rounded-[12px] bg-[#292415] flex items-center justify-center shrink-0 border border-amber-800/40">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f6c144" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="flex flex-col justify-center">
              <div className="text-[20px] font-bold text-fg leading-tight tracking-wide">{counts.IDLE}</div>
              <div className="text-[13px] text-muted font-medium mt-0.5">Idle</div>
              <div className="text-[11px] text-muted/80 mt-0.5 font-medium">
                <span className="text-[#f6c144] font-semibold">-5%</span> vs yesterday
              </div>
            </div>
          </button>

          <div className="w-[1px] h-[36px] bg-border/80 shrink-0 hidden sm:block" />

          {/* Locked Item */}
          <button
            type="button"
            onClick={() => {
              setFilter(filter === PresenceState.Locked ? '' : PresenceState.Locked);
              setCurrentPage(1);
            }}
            className={cn(
              'flex items-center gap-3.5 min-w-max text-left transition-opacity',
              filter && filter !== PresenceState.Locked ? 'opacity-40 hover:opacity-100' : 'opacity-100'
            )}
          >
            <div className="w-[42px] h-[42px] rounded-[12px] bg-[#21162a] flex items-center justify-center shrink-0 border border-purple-800/40">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a460f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div className="flex flex-col justify-center">
              <div className="text-[20px] font-bold text-fg leading-tight tracking-wide">{counts.LOCKED}</div>
              <div className="text-[13px] text-muted font-medium mt-0.5">Locked</div>
              <div className="text-[11px] text-muted/80 mt-0.5 font-medium">
                <span className="text-[#a460f6] font-semibold">-2%</span> vs yesterday
              </div>
            </div>
          </button>

          <div className="w-[1px] h-[36px] bg-border/80 shrink-0 hidden sm:block" />

          {/* Offline Item */}
          <button
            type="button"
            onClick={() => {
              setFilter(filter === PresenceState.Offline ? '' : PresenceState.Offline);
              setCurrentPage(1);
            }}
            className={cn(
              'flex items-center gap-3.5 min-w-max text-left transition-opacity',
              filter && filter !== PresenceState.Offline ? 'opacity-40 hover:opacity-100' : 'opacity-100'
            )}
          >
            <div className="w-[42px] h-[42px] rounded-[12px] bg-[#2c151a] flex items-center justify-center shrink-0 border border-rose-800/40">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f64b5d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <rect x="9" y="9" width="6" height="6" rx="1" />
              </svg>
            </div>
            <div className="flex flex-col justify-center">
              <div className="text-[20px] font-bold text-fg leading-tight tracking-wide">{counts.OFFLINE}</div>
              <div className="text-[13px] text-muted font-medium mt-0.5">Offline</div>
              <div className="text-[11px] text-muted/80 mt-0.5 font-medium">
                <span className="text-[#f64b5d] font-semibold">+8%</span> vs yesterday
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* 2. Secondary Search & View Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
        <div className="flex items-center gap-2">
          {filter ? (
            <div className="flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-xs font-semibold border border-border/80 shadow-warm-sm">
              <span className="text-muted">Filtering:</span>
              <span className="font-bold text-fg capitalize">{filter.toLowerCase()}</span>
              <button
                type="button"
                onClick={() => {
                  setFilter('');
                  setCurrentPage(1);
                }}
                className="ml-1 text-xs text-muted hover:text-fg font-bold"
              >
                × Clear
              </button>
            </div>
          ) : (
            <span className="text-xs font-semibold text-muted">
              Showing {allFilteredRows.length} team members
            </span>
          )}
        </div>

        {/* Right: Search Input + View Toggle */}
        <div className="flex items-center gap-3">
          {/* Search bar */}
          <div className="flex items-center gap-2.5 rounded-full bg-surface px-4 py-2.5 shadow-warm-sm w-56 sm:w-64 border border-border/70">
            <Search className="h-4 w-4 text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search active team…"
              className="w-full bg-transparent text-xs text-fg placeholder:text-muted/60 border-0 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setCurrentPage(1);
                }}
                className="text-xs text-muted hover:text-fg font-bold px-1"
              >
                ×
              </button>
            )}
          </div>

          {/* Grid / List Mode Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 border shadow-sm',
                viewMode === 'grid'
                  ? 'bg-accent text-accent-fg border-accent shadow-warm-sm'
                  : 'bg-surface text-muted hover:text-fg border-border/70 hover:border-border'
              )}
              title="Grid View"
              aria-label="Grid View"
            >
              <LayoutGrid className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 border shadow-sm',
                viewMode === 'list'
                  ? 'bg-accent text-accent-fg border-accent shadow-warm-sm'
                  : 'bg-surface text-muted hover:text-fg border-border/70 hover:border-border'
              )}
              title="List View"
              aria-label="List View"
            >
              <List className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Employee Cards / Table View */}
      {query.isLoading ? (
        <LoadingBlock label="Loading live telemetry stream" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : allFilteredRows.length === 0 ? (
        <Card>
          <EmptyState
            title={filter || search ? 'No employees match this filter' : 'No employees reporting'}
            description={
              filter || search
                ? 'Try resetting your search query or selecting a different status filter.'
                : 'Enrol agent devices to stream live telemetry to this board.'
            }
          />
        </Card>
      ) : viewMode === 'grid' ? (
        /* Grid of 12 Cards per Page (3 cols x 4 rows) */
        <div className="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedRows.map((row, index) => {
            const isOnline = row.state !== PresenceState.Offline;
            const isIdle = row.state === PresenceState.Idle;
            const isLocked = row.state === PresenceState.Locked;

            const statusDotColor = isOnline
              ? 'bg-emerald-400 animate-pulse'
              : isIdle
              ? 'bg-amber-400'
              : isLocked
              ? 'bg-indigo-400'
              : 'bg-rose-500';

            const statusTextColor = isOnline
              ? 'text-emerald-400'
              : isIdle
              ? 'text-amber-400'
              : isLocked
              ? 'text-indigo-400'
              : 'text-rose-500';

            const avatarGradient = getAvatarGradient(row.name);

            return (
              <Link
                key={row.id}
                to={`/employees/${row.id}`}
                className="flex flex-col justify-between rounded-[22px] bg-surface p-5 border border-border/80 shadow-warm-sm"
              >
                <div>
                  {/* Top Row: Avatar + Name + Status Label */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <span
                        className={cn(
                          'flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-warm-sm',
                          avatarGradient
                        )}
                      >
                        {initials(row.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-display text-[15px] font-bold text-fg">
                          {row.name}
                        </div>
                        <div className="truncate text-xs font-medium text-muted mt-0.5">
                          {row.departmentName ?? row.jobTitle ?? row.email}
                        </div>
                      </div>
                    </div>

                    <div className={cn('flex items-center gap-1.5 text-xs font-bold shrink-0', statusTextColor)}>
                      <span className={cn('h-2 w-2 rounded-full', statusDotColor)} />
                      <span className="capitalize">{row.state.toLowerCase()}</span>
                    </div>
                  </div>

                  {/* Middle Sunken Well Box */}
                  <div className="mt-4 rounded-[14px] bg-elevated p-3.5 text-xs space-y-2 border border-border/60">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AppWindow className="h-4 w-4 text-muted shrink-0" />
                      <span className="truncate font-semibold text-fg">
                        {row.currentApplication ?? (isOnline ? 'Active on desktop' : 'Device Offline')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs font-medium text-muted pt-0.5">
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted" />
                        Last seen
                      </span>
                      <span className="font-semibold text-fg tabular">
                        {isOnline ? (
                          <span className="text-emerald-400 font-bold">Active now</span>
                        ) : (
                          formatRelative(row.lastSeenAt)
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom Row: Today's Activity + Waveform Sparkline + Time */}
                <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3 text-xs font-semibold text-muted">
                  <span className="shrink-0 text-2xs uppercase tracking-wider text-muted font-bold">
                    Today&rsquo;s Activity
                  </span>
                  <ActivitySparkline
                    activeSec={row.todayActiveSec}
                    isOnline={isOnline}
                    index={index}
                  />
                  <span className="shrink-0 tabular font-bold text-fg text-xs">
                    {formatDuration(row.todayActiveSec)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        /* List Table View */
        <Card className="overflow-hidden">
          <Table maxHeight="max-h-[calc(100vh-270px)]">
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Status</Th>
                <Th>Current Application</Th>
                <Th>Time in State</Th>
                <Th>Activity Waveform</Th>
                <Th>Active Today</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row, index) => {
                const isOnline = row.state !== PresenceState.Offline;
                const avatarGradient = getAvatarGradient(row.name);

                return (
                  <tr key={row.id} className="hover:bg-elevated/40 transition-colors">
                    <Td>
                      <Link
                        to={`/employees/${row.id}`}
                        className="flex items-center gap-3.5 group"
                      >
                        <span
                          className={cn(
                            'flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white shadow-warm-sm',
                            avatarGradient
                          )}
                        >
                          {initials(row.name)}
                        </span>
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-fg group-hover:text-accent transition-colors truncate">
                            {row.name}
                          </div>
                          <div className="text-xs text-muted font-medium truncate">
                            {row.departmentName ?? row.jobTitle ?? row.email}
                          </div>
                        </div>
                      </Link>
                    </Td>
                    <Td>
                      <PresenceBadge state={row.state} pulse={row.state === 'ACTIVE'} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2 max-w-xs truncate text-xs font-semibold text-fg">
                        <MonitorSmartphone className="h-3.5 w-3.5 text-muted shrink-0" />
                        <span className="truncate">
                          {row.currentApplication ?? (isOnline ? 'Active on desktop' : 'Offline')}
                        </span>
                      </div>
                    </Td>
                    <Td className="text-xs font-medium text-muted tabular">
                      {isOnline ? (
                        <span className="font-bold text-fg">
                          <LiveDuration sinceSec={row.stateSinceSec} />
                        </span>
                      ) : (
                        formatRelative(row.lastSeenAt)
                      )}
                    </Td>
                    <Td className="w-48">
                      <div className="flex items-center">
                        <ActivitySparkline
                          activeSec={row.todayActiveSec}
                          isOnline={isOnline}
                          index={index}
                        />
                      </div>
                    </Td>
                    <Td className="text-xs font-bold text-fg tabular">
                      {formatDuration(row.todayActiveSec)}
                    </Td>
                    <Td className="text-right">
                      <Link
                        to={`/employees/${row.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-elevated px-3.5 py-1.5 text-xs font-bold text-fg hover:bg-accent hover:text-accent-fg transition-colors"
                      >
                        View
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {/* 4. Bottom Pagination & Rows Per Page Controls */}
      {allFilteredRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-border/40">
          {/* Pagination buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-surface text-fg disabled:opacity-30 hover:bg-elevated transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
              const pageNum = i + 1;
              const isCurrent = pageNum === currentPage;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentPage(pageNum)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold transition-colors',
                    isCurrent
                      ? 'bg-accent text-accent-fg shadow-warm-sm'
                      : 'border border-border/70 bg-surface text-muted hover:text-fg hover:bg-elevated'
                  )}
                >
                  {pageNum}
                </button>
              );
            })}

            {totalPages > 4 && (
              <>
                <span className="px-1 text-xs text-muted">…</span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(totalPages)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold transition-colors',
                    currentPage === totalPages
                      ? 'bg-accent text-accent-fg shadow-warm-sm'
                      : 'border border-border/70 bg-surface text-muted hover:text-fg hover:bg-elevated'
                  )}
                >
                  {totalPages}
                </button>
              </>
            )}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-surface text-fg disabled:opacity-30 hover:bg-elevated transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Rows per page dropdown */}
          <div className="flex items-center gap-2 text-xs font-semibold text-muted">
            <span>Rows per page:</span>
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="appearance-none rounded-xl border border-border/70 bg-surface pl-3 pr-7 py-1.5 text-xs font-bold text-fg focus:outline-none cursor-pointer"
              >
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
                <option value={100}>100</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3 w-3 text-muted" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
