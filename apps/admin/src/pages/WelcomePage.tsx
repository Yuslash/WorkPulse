import { useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, Building2, LogIn } from 'lucide-react';
import { ThemeToggleDropdown } from '@/components/ThemeToggleDropdown';

/**
 * WorkPulse Landing Screen:
 * Perfectly centered, minimalist, and focused entry point into workspace creation or sign-in.
 */
export function WelcomePage() {
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-fg selection:bg-accent/20">
      {/* Top Bar: Positioned absolutely so it doesn't displace the vertical center */}
      <div className="absolute top-6 right-6 z-20">
        <ThemeToggleDropdown />
      </div>

      {/* Main Center Content: True vertical and horizontal center */}
      <main className="w-full max-w-2xl text-center">
        {/* Brand Icon & Heading */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-warm-md">
            <Activity className="h-7 w-7" strokeWidth={2.25} />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            WorkPulse
          </h1>
          <p className="mt-2 text-sm text-muted max-w-md">
            Workforce activity tracking and real-time presence observability.
          </p>
        </div>

        {/* Focused Action Cards */}
        <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2">
          {/* Create Company Option */}
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="group flex flex-col items-start justify-between rounded-card bg-surface p-7 text-left shadow-warm-sm border border-border/80 hover:border-accent hover:shadow-warm-md transition-all duration-150 ease-spring hover:-translate-y-0.5"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-warm-sm group-hover:scale-105 transition-transform">
              <Building2 className="h-6 w-6" strokeWidth={2.25} />
            </div>

            <div className="my-5">
              <div className="font-display text-lg font-bold text-fg group-hover:text-accent transition-colors">
                Create Organization
              </div>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                Set up a new company workspace and your admin account.
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-bold text-accent">
              <span>Get started</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-1" />
            </div>
          </button>

          {/* Login Option */}
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="group flex flex-col items-start justify-between rounded-card bg-surface p-7 text-left shadow-warm-sm border border-border/80 hover:border-border-strong hover:shadow-warm-md transition-all duration-150 ease-spring hover:-translate-y-0.5"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-elevated text-fg shadow-warm-sm group-hover:scale-105 group-hover:bg-accent/15 group-hover:text-accent transition-all">
              <LogIn className="h-6 w-6" strokeWidth={2.25} />
            </div>

            <div className="my-5">
              <div className="font-display text-lg font-bold text-fg group-hover:text-accent transition-colors">
                Sign In to Console
              </div>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                Access your existing dashboard and active telemetry feeds.
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-bold text-fg/80 group-hover:text-accent transition-colors">
              <span>Sign in</span>
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-1" />
            </div>
          </button>
        </div>
      </main>

      {/* Subtle Footer: Absolute at bottom so it doesn't push the center block down */}
      <footer className="absolute bottom-6 left-0 right-0 text-center">
        <p className="text-xs text-muted">
          Administrative actions in this console are recorded in an audit log.
        </p>
      </footer>
    </div>
  );
}
