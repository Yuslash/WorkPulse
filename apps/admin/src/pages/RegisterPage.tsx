import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';
import { ThemeToggleDropdown } from '@/components/ThemeToggleDropdown';

/** "Create Company" — a new organization and its first admin workspace. */
export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [organizationName, setOrganizationName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordsMatch = adminPassword === confirmPassword;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        organizationName: organizationName.trim(),
        adminName: adminName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
      });
      navigate('/dashboard', { replace: true });
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

      {/* Main Register Form - Centered */}
      <main className="w-full max-w-md py-12">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-warm-md">
            <Building2 className="h-6 w-6" strokeWidth={2.25} />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
            Set Up Your Organization
          </h1>
          <p className="mt-1 text-xs text-muted max-w-sm">
            Launch your isolated tenant and establish your Organization Owner admin account.
          </p>
        </div>

        <Card className="w-full p-6 sm:p-7 shadow-warm-md border border-border/80 bg-surface">
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label
                htmlFor="org-name"
                className="label mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
              >
                Company / Organization Name
              </label>
              <Input
                id="org-name"
                required
                autoFocus
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Acme Corporation"
                className="bg-elevated border border-border/60"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="admin-name"
                  className="label mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
                >
                  Admin Name
                </label>
                <Input
                  id="admin-name"
                  required
                  value={adminName}
                  onChange={(event) => setAdminName(event.target.value)}
                  placeholder="Jane Doe"
                  className="bg-elevated border border-border/60"
                />
              </div>

              <div>
                <label
                  htmlFor="admin-email"
                  className="label mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
                >
                  Admin Email
                </label>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  required
                  value={adminEmail}
                  onChange={(event) => setAdminEmail(event.target.value)}
                  placeholder="jane@acme.com"
                  className="bg-elevated border border-border/60"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="label mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
              >
                Password (min 8 chars)
              </label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  placeholder="At least 8 characters"
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

            <div>
              <label
                htmlFor="confirm-password"
                className="label mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
              >
                Confirm Password
              </label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter password"
                  className="bg-elevated border border-border/60 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg transition-colors"
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {adminPassword && confirmPassword && (
                <div className="mt-1 flex items-center gap-1.5 text-2xs">
                  {passwordsMatch ? (
                    <span className="flex items-center gap-1 text-active font-semibold">
                      <CheckCircle2 className="h-3 w-3" /> Passwords match
                    </span>
                  ) : (
                    <span className="text-danger font-semibold">Passwords do not match</span>
                  )}
                </div>
              )}
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
              disabled={
                !organizationName ||
                !adminName ||
                !adminEmail ||
                !adminPassword ||
                !confirmPassword ||
                !passwordsMatch
              }
            >
              <Sparkles className="h-4 w-4 mr-1.5" />
              Create Organization
            </Button>
          </form>

          <div className="mt-5 border-t border-border/60 pt-4 text-center text-xs text-muted">
            <span>Already have an organization? </span>
            <Link to="/login" className="font-bold text-accent hover:underline">
              Sign in instead
            </Link>
          </div>
        </Card>
      </main>

      {/* Footer */}
      <footer className="absolute bottom-6 left-0 right-0 text-center">
        <p className="flex items-center justify-center gap-1.5 text-2xs text-muted">
          <Lock className="h-3 w-3 text-accent" />
          <span>Tenant encryption keys are generated uniquely per organization.</span>
        </p>
      </footer>
    </div>
  );
}
