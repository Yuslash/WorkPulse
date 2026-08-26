import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  CalendarCheck,
  Check,
  ChevronDown,
  FileClock,
  Gauge,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Menu,
  MonitorSmartphone,
  Palette,
  PanelLeft,
  PanelTop,
  Plus,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Users2,
  X,
  Download,
} from 'lucide-react';
import { Role } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { useEmployees } from '@/features/queries';
import { useTheme } from '@/lib/theme';
import { cn, initials } from '@/lib/format';
import { IconButton } from '@/components/ui';

type LayoutMode = 'topbar' | 'sidebar';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole?: Role;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/employees', label: 'Employees', icon: Users2 },
  { to: '/live', label: 'Live Activity', icon: Activity },
  { to: '/devices', label: 'Devices', icon: MonitorSmartphone },
];

const MORE_NAV: NavItem[] = [
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { to: '/applications', label: 'Applications', icon: Gauge },
  { to: '/agent-health', label: 'Agent Health', icon: ShieldCheck },
  { to: '/policies', label: 'Policies', icon: FileClock },
  { to: '/audit', label: 'Audit Logs', icon: ScrollText, minRole: Role.HrAdmin },
  { to: '/client-downloads', label: 'Client Downloads', icon: Download },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const ALL_NAV = [...PRIMARY_NAV, ...MORE_NAV];

export function AppShell() {
  const { user, logout, can } = useAuth();
  const { connected } = useRealtime();
  const { theme, themes, currentTheme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('workpulse_layout_mode') as LayoutMode) || 'topbar';
    }
    return 'topbar';
  });

  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const sidebarSearchRef = useRef<HTMLInputElement>(null);
  const employeesQuery = useEmployees({ page: 1, limit: 100 });
  const allEmployees = employeesQuery.data?.items ?? [];

  // Spreading ripple transition for layout mode changes
  const switchLayoutMode = (nextMode: LayoutMode, event?: React.MouseEvent) => {
    if (nextMode === layoutMode) return;

    const commitLayout = () => {
      setLayoutMode(nextMode);
      localStorage.setItem('workpulse_layout_mode', nextMode);
    };

    const isViewTransitionSupported =
      typeof document !== 'undefined' &&
      'startViewTransition' in document &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!isViewTransitionSupported) {
      commitLayout();
      return;
    }

    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (event && 'clientX' in event && event.clientX > 0) {
      x = event.clientX;
      y = event.clientY;
    }

    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const doc = document as unknown as {
      startViewTransition: (callback: () => void) => { ready: Promise<void> };
    };

    const transition = doc.startViewTransition(() => {
      commitLayout();
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];

      document.documentElement.animate(
        { clipPath },
        {
          duration: 650,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      );
    });
  };

  // Global keyboard shortcut: Ctrl+K or Cmd+K focuses search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (layoutMode === 'sidebar') {
          sidebarSearchRef.current?.focus();
        } else {
          searchInputRef.current?.focus();
        }
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setMoreOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [layoutMode]);

  const matchingEmployees = search.trim()
    ? allEmployees
        .filter((emp) => {
          const q = search.toLowerCase();
          return (
            emp.name.toLowerCase().includes(q) ||
            emp.email.toLowerCase().includes(q) ||
            (emp.departmentName ?? '').toLowerCase().includes(q) ||
            (emp.jobTitle ?? '').toLowerCase().includes(q)
          );
        })
        .slice(0, 5)
    : [];

  const matchingPages = search.trim()
    ? ALL_NAV.filter(
        (nav) =>
          (!nav.minRole || can(nav.minRole)) &&
          nav.label.toLowerCase().includes(search.toLowerCase())
      )
    : [];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const runSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = search.trim();
    setSearchOpen(false);
    navigate(term ? `/employees?q=${encodeURIComponent(term)}` : '/employees');
    setSearch('');
    setMobileOpen(false);
  };

  const pillClass = (isActive: boolean) =>
    cn(
      'flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition-colors duration-150',
      isActive ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
    );

  const onMorePage = MORE_NAV.some((item) => location.pathname.startsWith(item.to));

  const isSidebar = layoutMode === 'sidebar';

  return (
    <div className={cn('min-h-screen bg-bg', !isSidebar && 'px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8')}>
      {isSidebar ? (
        /* ==========================================
           SIDEBAR LAYOUT MODE
           ========================================== */
        <div className="flex min-h-screen bg-bg">
          {/* Desktop Left Sidebar */}
          <aside className="hidden md:flex w-64 xl:w-72 shrink-0 h-screen sticky top-0 bg-surface border-r border-border/80 flex-col justify-between p-5 z-40 overflow-y-auto">
            <div className="space-y-5">
              {/* Brand Header + Mode Switcher */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-warm-sm">
                    <Activity className="h-6 w-6" strokeWidth={2.25} />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="font-display text-base font-bold text-fg truncate">WorkPulse</div>
                    <div className="text-2xs font-semibold text-muted truncate">{user?.organizationName}</div>
                  </div>
                </div>

                {/* Quick Layout Switch button */}
                <button
                  type="button"
                  onClick={(e) => switchLayoutMode('topbar', e)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-elevated text-muted hover:text-fg hover:bg-surface border border-border/60 shadow-warm-sm transition-all"
                  title="Switch to Topbar Navigation"
                  aria-label="Switch to Topbar Navigation"
                >
                  <PanelTop className="h-4 w-4" />
                </button>
              </div>

              {/* Sidebar Search Bar */}
              <div className="relative">
                <form
                  onSubmit={runSearch}
                  className="flex items-center gap-2.5 rounded-full bg-elevated px-4 py-2.5 border border-border/70 shadow-warm-sm"
                >
                  <Search className="h-4 w-4 shrink-0 text-muted" />
                  <input
                    ref={sidebarSearchRef}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                    placeholder="Search team or pages…"
                    className="w-full bg-transparent text-xs text-fg placeholder:text-muted/60 border-0 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        sidebarSearchRef.current?.focus();
                      }}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-xs text-muted hover:text-fg font-bold"
                    >
                      ×
                    </button>
                  ) : (
                    <kbd className="inline-flex items-center gap-0.5 rounded-md bg-surface px-1.5 py-0.5 text-[9px] font-mono font-bold text-muted select-none border border-border/60">
                      ⌘K
                    </kbd>
                  )}
                </form>

                {/* Live Search Autocomplete Popover */}
                {searchOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setSearchOpen(false)}
                      role="presentation"
                    />
                    <div className="absolute left-0 right-0 z-30 mt-2 max-h-[360px] overflow-y-auto rounded-card bg-surface p-2 shadow-warm-md border border-border/80">
                      {search.trim() ? (
                        <>
                          {matchingPages.length > 0 && (
                            <div className="mb-2">
                              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                                Pages
                              </div>
                              <div className="space-y-0.5">
                                {matchingPages.map((page) => (
                                  <button
                                    key={page.to}
                                    type="button"
                                    onClick={() => {
                                      navigate(page.to);
                                      setSearchOpen(false);
                                      setSearch('');
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-fg hover:bg-elevated text-left"
                                  >
                                    <page.icon className="h-4 w-4 text-accent" />
                                    <span>{page.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {matchingEmployees.length > 0 && (
                            <div>
                              <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                                Team Members
                              </div>
                              <div className="space-y-0.5">
                                {matchingEmployees.map((emp) => (
                                  <button
                                    key={emp.id}
                                    type="button"
                                    onClick={() => {
                                      navigate(`/employees/${emp.id}`);
                                      setSearchOpen(false);
                                      setSearch('');
                                    }}
                                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-semibold text-fg hover:bg-elevated text-left"
                                  >
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
                                      {initials(emp.name)}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="font-bold truncate">{emp.name}</div>
                                      <div className="text-2xs text-muted truncate">{emp.email}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="p-3 text-center text-xs text-muted">Type to search…</div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Sidebar Navigation Links */}
              <div className="space-y-4">
                <div>
                  <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    Menu
                  </div>
                  <nav className="space-y-1">
                    {PRIMARY_NAV.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all duration-150',
                            isActive
                              ? 'bg-accent text-accent-fg shadow-warm-sm font-bold'
                              : 'text-muted hover:bg-elevated hover:text-fg'
                          )
                        }
                      >
                        <item.icon className="h-4.5 w-4.5 shrink-0" />
                        <span>{item.label}</span>
                      </NavLink>
                    ))}
                  </nav>
                </div>

                <div>
                  <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                    Manage & Security
                  </div>
                  <nav className="space-y-1">
                    {MORE_NAV.filter((item) => !item.minRole || can(item.minRole)).map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-all duration-150',
                            isActive
                              ? 'bg-accent text-accent-fg shadow-warm-sm font-bold'
                              : 'text-muted hover:bg-elevated hover:text-fg'
                          )
                        }
                      >
                        <item.icon className="h-4.5 w-4.5 shrink-0" />
                        <span>{item.label}</span>
                      </NavLink>
                    ))}
                  </nav>
                </div>
              </div>
            </div>

            {/* Bottom Sidebar Capsule: Themes + User Profile */}
            <div className="pt-4 border-t border-border/70 space-y-3">
              {/* Quick Themes */}
              <div>
                <div className="px-1 mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted">
                  <span className="flex items-center gap-1.5">
                    <Palette className="h-3 w-3" />
                    Theme
                  </span>
                  <span className="text-fg">{currentTheme.name}</span>
                </div>
                <div className="flex items-center justify-between gap-1 p-1.5 rounded-2xl bg-elevated border border-border/60">
                  {themes.map((t) => {
                    const isSelected = t.id === theme;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={(e) => setTheme(t.id, e)}
                        className={cn(
                          'h-7 w-7 rounded-full flex items-center justify-center transition-transform duration-150',
                          isSelected ? 'ring-2 ring-accent scale-110 shadow-sm' : 'hover:scale-105 opacity-80 hover:opacity-100'
                        )}
                        style={{ backgroundColor: t.accentColor }}
                        title={t.name}
                      >
                        {isSelected && <Check className="h-3.5 w-3.5 text-white stroke-[3]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* User Profile Card */}
              <div className="p-3 rounded-2xl bg-elevated border border-border/60 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative">
                    <span className="flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-viz-4 to-accent text-xs font-bold text-white shadow-warm-sm">
                      {initials(user?.name ?? 'Admin')}
                    </span>
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-elevated',
                        connected ? 'bg-active' : 'bg-offline'
                      )}
                    />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <div className="font-bold text-xs text-fg truncate">{user?.name}</div>
                    <div className="text-2xs font-semibold text-muted uppercase tracking-wider truncate">
                      {user?.role.replace('_', ' ')}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1.5 rounded-xl text-muted hover:text-offline hover:bg-offline/10 transition-colors"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>

          {/* Main Content Area */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Mobile Top Header */}
            <div className="md:hidden flex items-center justify-between p-4 bg-surface border-b border-border/80 sticky top-0 z-30">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg">
                  <Activity className="h-5 w-5" />
                </div>
                <span className="font-display font-bold text-fg">WorkPulse</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="p-2 rounded-xl bg-elevated text-fg"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>

            <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
              <Outlet />
            </main>
          </div>
        </div>
      ) : (
        /* ==========================================
           TOPBAR LAYOUT MODE (DEFAULT)
           ========================================== */
        <div className="mx-auto max-w-[1440px] rounded-app bg-elevated p-3 shadow-warm-app sm:p-5 lg:p-7">
          {/* Topbar — single-row layout that never wraps */}
          <div className="mb-6 flex items-center justify-between gap-2.5 sm:gap-3">
            {/* Left: Brand + Nav */}
            <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
              <div className="flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-warm-sm">
                <Activity className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.25} />
              </div>

              <div className="hidden shrink-0 leading-tight 2xl:block">
                <div className="font-display text-sm font-bold text-fg">WorkPulse</div>
                <div className="text-2xs font-semibold text-muted">{user?.organizationName}</div>
              </div>

              {/* Pill nav — desktop */}
              <nav className="hidden items-center gap-0.5 rounded-full bg-surface p-1.5 shadow-warm-sm md:flex">
                {PRIMARY_NAV.map((item) => (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => pillClass(isActive)}>
                    {item.label}
                  </NavLink>
                ))}

                <div className="relative">
                  <button type="button" onClick={() => setMoreOpen((open) => !open)} className={pillClass(onMorePage)}>
                    More
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', moreOpen && 'rotate-180')} />
                  </button>

                  {moreOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} role="presentation" />
                      <div className="absolute left-0 z-20 mt-2 w-56 animate-fade-in rounded-card bg-surface p-1.5 shadow-warm-md">
                        {MORE_NAV.filter((item) => !item.minRole || can(item.minRole)).map((item) => (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={() => setMoreOpen(false)}
                            className={({ isActive }) =>
                              cn(
                                'flex items-center gap-2.5 rounded-full px-3.5 py-2.5 text-sm font-semibold transition-colors',
                                isActive ? 'bg-accent/10 text-accent' : 'text-muted hover:bg-elevated hover:text-fg',
                              )
                            }
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            {item.label}
                          </NavLink>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </nav>
            </div>

            {/* Center: Expansive Search Bar */}
            <div className="relative hidden flex-1 min-w-[200px] max-w-xl lg:block">
              <form
                onSubmit={runSearch}
                className="flex items-center gap-3 rounded-full bg-surface px-5 py-3 shadow-warm-sm border-0 ring-0 outline-none"
              >
                <Search className="h-4 w-4 shrink-0 text-muted" />
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Search employees, departments, or pages…"
                  className="w-full bg-transparent text-sm text-fg placeholder:text-muted/60 border-0 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                />

                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      searchInputRef.current?.focus();
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-xs text-muted hover:text-fg font-bold"
                    aria-label="Clear search"
                  >
                    ×
                  </button>
                ) : (
                  <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-full bg-elevated px-2 py-0.5 text-[10px] font-mono font-bold text-muted select-none">
                    <span>⌘</span>
                    <span>K</span>
                  </kbd>
                )}
              </form>

              {/* Live Search Autocomplete Popover */}
              {searchOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setSearchOpen(false)}
                    role="presentation"
                  />
                  <div className="absolute left-0 right-0 z-30 mt-2 max-h-[380px] overflow-y-auto animate-fade-in rounded-card bg-surface p-2 shadow-warm-md border border-border/80">
                    {search.trim() ? (
                      <>
                        {matchingPages.length > 0 && (
                          <div className="mb-2">
                            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                              Pages
                            </div>
                            <div className="space-y-0.5">
                              {matchingPages.map((page) => (
                                <button
                                  key={page.to}
                                  type="button"
                                  onClick={() => {
                                    navigate(page.to);
                                    setSearchOpen(false);
                                    setSearch('');
                                  }}
                                  className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-xs font-semibold text-fg hover:bg-elevated text-left"
                                >
                                  <page.icon className="h-4 w-4 text-accent" />
                                  <span>{page.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {matchingEmployees.length > 0 && (
                          <div>
                            <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">
                              Team Members
                            </div>
                            <div className="space-y-0.5">
                              {matchingEmployees.map((emp) => (
                                <button
                                  key={emp.id}
                                  type="button"
                                  onClick={() => {
                                    navigate(`/employees/${emp.id}`);
                                    setSearchOpen(false);
                                    setSearch('');
                                  }}
                                  className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-xs font-semibold text-fg hover:bg-elevated text-left"
                                >
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-fg">
                                    {initials(emp.name)}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="font-bold truncate">{emp.name}</div>
                                    <div className="text-2xs text-muted truncate">
                                      {emp.departmentName ?? emp.jobTitle ?? emp.email}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="p-3 text-center text-xs text-muted">
                        Type to search across employees, departments, and pages…
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Right: Quick Action & Profile Capsule */}
            <div className="flex items-center gap-2 sm:gap-2.5">
              {/* Quick Action Button */}
              <IconButton
                onClick={() => navigate('/employees')}
                className="h-10 w-10 sm:h-11 sm:w-11 rounded-full shadow-warm-sm bg-surface hover:bg-elevated"
                aria-label="Add Employee or Policy"
              >
                <Plus className="h-5 w-5" />
              </IconButton>

              {/* Mobile menu toggle */}
              <div className="md:hidden">
                <IconButton
                  onClick={() => setMobileOpen(true)}
                  className="h-10 w-10 rounded-full shadow-warm-sm bg-surface"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </IconButton>
              </div>

              {/* Unified Profile Capsule */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setProfileOpen((open) => !open)}
                  className="flex items-center gap-2.5 rounded-full bg-surface py-1.5 pl-1.5 pr-3.5 shadow-warm-sm transition-transform duration-150 ease-spring hover:-translate-y-0.5"
                >
                  <div className="relative">
                    <span className="flex h-8 w-8 sm:h-9 sm:w-9 select-none items-center justify-center rounded-full bg-gradient-to-br from-viz-4 to-accent text-xs font-bold text-white shadow-warm-sm">
                      {initials(user?.name ?? 'Admin')}
                    </span>
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-surface',
                        connected ? 'bg-active' : 'bg-offline'
                      )}
                    />
                  </div>
                  <div className="hidden text-left leading-tight sm:block">
                    <div className="font-bold text-sm text-fg">{user?.name}</div>
                    <div className="text-2xs font-semibold text-muted uppercase tracking-wider">
                      {user?.role.replace('_', ' ')}
                    </div>
                  </div>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-muted sm:block" />
                </button>

                {profileOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} role="presentation" />
                    <div className="absolute right-0 z-20 mt-2 w-64 animate-fade-in rounded-card bg-surface p-3 shadow-warm-md border border-border/80">
                      <div className="border-b border-border/70 pb-3">
                        <div className="truncate text-sm font-bold text-fg">{user?.name}</div>
                        <div className="truncate text-xs text-muted">{user?.email}</div>
                        <div className="mt-1 text-2xs font-bold text-accent">{user?.organizationName}</div>
                      </div>

                      {/* Quick Theme Switcher inside Profile */}
                      <div className="py-2.5 border-b border-border/70">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <Palette className="h-3 w-3" />
                            Theme: {currentTheme.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 justify-between">
                          {themes.map((t) => {
                            const isSelected = t.id === theme;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={(e) => {
                                  setTheme(t.id, e);
                                }}
                                className={cn(
                                  'h-7 w-7 rounded-full flex items-center justify-center transition-transform duration-150',
                                  isSelected ? 'ring-2 ring-accent scale-110 shadow-sm' : 'hover:scale-105 opacity-80 hover:opacity-100'
                                )}
                                style={{ backgroundColor: t.accentColor }}
                                title={t.name}
                              >
                                {isSelected && <Check className="h-3.5 w-3.5 text-white stroke-[3]" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Navigation Layout Switcher inside Profile */}
                      <div className="py-2.5 border-b border-border/70">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <LayoutTemplate className="h-3 w-3 text-accent" />
                            Layout
                          </span>
                          <span className="text-[10px] font-bold text-accent capitalize">{layoutMode}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-elevated/80 border border-border/60">
                          <button
                            type="button"
                            onClick={(e) => switchLayoutMode('topbar', e)}
                            className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all bg-accent text-accent-fg shadow-warm-sm"
                          >
                            <PanelTop className="h-3.5 w-3.5" />
                            Topbar
                          </button>
                          <button
                            type="button"
                            onClick={(e) => switchLayoutMode('sidebar', e)}
                            className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all text-muted hover:text-fg hover:bg-surface"
                          >
                            <PanelLeft className="h-3.5 w-3.5" />
                            Sidebar
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setProfileOpen(false);
                            navigate('/settings');
                          }}
                          className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-muted hover:bg-elevated hover:text-fg transition-colors"
                        >
                          <Settings className="h-3.5 w-3.5" />
                          Settings
                        </button>

                        <button
                          type="button"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold text-offline hover:bg-offline/10 transition-colors"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          Sign out
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile nav sheet */}
          {mobileOpen && (
            <div className="fixed inset-0 z-40 md:hidden">
              <div className="absolute inset-0 bg-fg/40" onClick={() => setMobileOpen(false)} role="presentation" />
              <div className="absolute inset-x-3 top-4 rounded-card bg-surface p-3 shadow-warm-app">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="font-display text-base font-bold">WorkPulse</span>
                  <button onClick={() => setMobileOpen(false)} aria-label="Close menu">
                    <X className="h-5 w-5 text-muted" />
                  </button>
                </div>

                <form
                  onSubmit={runSearch}
                  className="mb-3 flex items-center gap-2.5 rounded-full bg-elevated px-4 py-2.5 border-0 ring-0 outline-none"
                >
                  <Search className="h-4 w-4 text-muted" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search employees…"
                    className="w-full bg-transparent text-sm text-fg placeholder:text-muted/60 border-0 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
                  />
                </form>

                <div className="flex flex-col gap-0.5">
                  {ALL_NAV.filter((item) => !item.minRole || can(item.minRole)).map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold',
                          isActive ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-elevated hover:text-fg',
                        )
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>

                {/* Mobile layout switcher */}
                <div className="mt-3 border-t border-border pt-3">
                  <div className="mb-2 px-2 text-2xs font-bold uppercase tracking-wider text-muted">
                    Navigation Layout
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        switchLayoutMode('topbar', e);
                        setMobileOpen(false);
                      }}
                      className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all bg-accent text-accent-fg"
                    >
                      <PanelTop className="h-4 w-4" />
                      Topbar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        switchLayoutMode('sidebar', e);
                        setMobileOpen(false);
                      }}
                      className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all bg-elevated text-muted"
                    >
                      <PanelLeft className="h-4 w-4" />
                      Sidebar
                    </button>
                  </div>
                </div>

                {/* Mobile theme bar */}
                <div className="mt-3 border-t border-border pt-3">
                  <div className="mb-2 px-2 text-2xs font-bold uppercase tracking-wider text-muted">
                    Theme Palette
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {themes.map((t) => {
                      const isSelected = t.id === theme;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={(e) => setTheme(t.id, e)}
                          className={cn(
                            'flex flex-col items-center gap-1 rounded-chip p-2 transition-all',
                            isSelected ? 'bg-elevated ring-2 ring-accent' : 'hover:bg-elevated/50'
                          )}
                          title={t.name}
                        >
                          <span
                            className="h-4 w-4 rounded-full shadow-sm"
                            style={{ backgroundColor: t.accentColor }}
                          />
                          <span className="text-[10px] font-semibold truncate max-w-full text-fg">
                            {t.name.split(' ')[0]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      )}
    </div>
  );
}
