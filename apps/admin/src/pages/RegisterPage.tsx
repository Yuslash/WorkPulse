import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';

/** "Create Company" — a new organization and its first admin, in one form. */
export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [organizationName, setOrganizationName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>

        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-warm-sm">
            <Building2 className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-fg">Create Company</span>
        </div>

        <Card className="p-7">
          <h1 className="font-display text-lg font-bold text-fg">Set up your organization</h1>
          <p className="mt-1.5 text-sm text-muted">
            You&rsquo;ll be the first Organization Owner — you can invite the rest of your admin team
            afterwards.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="org-name" className="label mb-1.5 block">
                Company name
              </label>
              <Input
                id="org-name"
                required
                autoFocus
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Acme Corporation"
              />
            </div>

            <div>
              <label htmlFor="admin-name" className="label mb-1.5 block">
                Your name
              </label>
              <Input
                id="admin-name"
                required
                value={adminName}
                onChange={(event) => setAdminName(event.target.value)}
                placeholder="Jane Doe"
              />
            </div>

            <div>
              <label htmlFor="admin-email" className="label mb-1.5 block">
                Your email
              </label>
              <Input
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                placeholder="jane@acme.com"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="label mb-1.5 block">
                Password
              </label>
              <Input
                id="admin-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label htmlFor="confirm-password" className="label mb-1.5 block">
                Confirm password
              </label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter your password"
              />
            </div>

            {error && (
              <div role="alert" className="rounded-sub bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={submitting}
              disabled={!organizationName || !adminName || !adminEmail || !adminPassword || !confirmPassword}
            >
              Create company
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-xs text-faint">
          Already have a company?{' '}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            Sign in instead
          </Link>
        </p>
      </div>
    </div>
  );
}
