import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Eye, EyeOff, Lock, LogIn, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';
import { ThemeToggleDropdown } from '@/components/ThemeToggleDropdown';

export function LoginPage() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-fg selection:bg-accent/20">
      {/* Top Bar controls */}
      <div className="absolute top-6 left-6 z-20">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs font-bold text-muted hover:text-fg transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </Link>
      </div>

      <div className="absolute top-6 right-6 z-20">
        <ThemeToggleDropdown />
      </div>

      {/* Main Login Card - True Vertical Center */}
      <main className="w-full max-w-sm">
        {/* Brand header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-warm-md">
            <Activity className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
            Sign In to WorkPulse
          </h1>
          <p className="mt-1 text-xs text-muted">
            Administrative console & workforce observability portal
          </p>
        </div>

        <Card className="w-full p-6 sm:p-7 shadow-warm-md border border-border/80 bg-surface">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="label mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">
                Admin Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@company.com"
                className="bg-elevated border border-border/60"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="label block text-xs font-bold uppercase tracking-wider text-muted">
                  Password
                </label>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  className="bg-elevated border border-border/60 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-sub bg-danger/10 p-3.5 text-xs font-medium text-danger border border-danger/20"
              >
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full mt-2 h-11 text-sm font-bold shadow-warm-md hover:brightness-105"
              loading={submitting}
              disabled={!email || !password}
            >
              <LogIn className="h-4 w-4 mr-1.5" />
              Sign in
            </Button>
          </form>

          <div className="mt-5 border-t border-border/60 pt-4 text-center text-xs text-muted">
            <span>Don&rsquo;t have an organization yet? </span>
            <Link to="/register" className="font-bold text-accent hover:underline">
              Create company
            </Link>
          </div>
        </Card>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-6 left-0 right-0 text-center">
        <p className="flex items-center justify-center gap-1.5 text-2xs text-muted">
          <Lock className="h-3 w-3 text-accent" />
          <span>Administrative actions are recorded in the audit log.</span>
        </p>
      </footer>
    </div>
  );
}
