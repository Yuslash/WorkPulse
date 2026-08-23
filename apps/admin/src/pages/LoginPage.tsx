import { useState } from 'react';
import { Activity } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';

export function LoginPage() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email.trim(), password);
    } catch (caught) {
      // The server deliberately returns the same message for a wrong password
      // and an unknown account; surface it as-is rather than guessing.
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
        <div className="mb-7 flex items-center justify-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg shadow-warm-sm">
            <Activity className="h-5 w-5" strokeWidth={2.25} />
          </div>
          <span className="font-display text-xl font-bold tracking-tight text-fg">WorkPulse</span>
        </div>

        <Card className="p-7">
          <h1 className="font-display text-lg font-bold text-fg">Sign in to the admin console</h1>
          <p className="mt-1.5 text-sm text-muted">
            Employee agent logins are issued from the Employees page, not here.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="label mb-1.5 block">
                Email
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
              />
            </div>

            <div>
              <label htmlFor="password" className="label mb-1.5 block">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
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
              disabled={!email || !password}
            >
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-xs text-faint">
          Administrative actions in this console are recorded in the audit log.
        </p>
      </div>
    </div>
  );
}
