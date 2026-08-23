import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Building2, LogIn, X } from 'lucide-react';

/**
 * The very first screen, before any session exists: create a new company,
 * sign in to one that already exists, or leave. Nothing here talks to the
 * API — it is pure navigation, so it works even if the server is briefly
 * unreachable.
 */
export function WelcomePage() {
  const navigate = useNavigate();
  const [closeHint, setCloseHint] = useState(false);

  const handleClose = () => {
    // A script can only close a tab it opened itself; for a tab the user
    // navigated to directly, browsers silently ignore this. Either way we
    // tell them what happened rather than doing nothing.
    window.close();
    setCloseHint(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-3xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-warm-md">
            <Activity className="h-7 w-7" strokeWidth={2.25} />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            WorkPulse
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted">
            Transparent workforce activity tracking. Get started with a new company, or sign in to
            one you already manage.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <WelcomeOption
            icon={<Building2 className="h-6 w-6" />}
            title="Create Company"
            description="Set up a new organization and your admin account."
            accent
            onClick={() => navigate('/register')}
          />
          <WelcomeOption
            icon={<LogIn className="h-6 w-6" />}
            title="Login to Existing Company"
            description="Sign in with an admin account you already have."
            onClick={() => navigate('/login')}
          />
          <WelcomeOption
            icon={<X className="h-6 w-6" />}
            title="Close App"
            description="Exit WorkPulse."
            onClick={handleClose}
          />
        </div>

        {closeHint && (
          <p className="mt-6 text-center text-xs text-faint" role="status">
            Your browser keeps this tab open when it wasn&rsquo;t WorkPulse that opened it — you can
            close it yourself, or just navigate away.
          </p>
        )}

        <p className="mt-8 text-center text-xs text-faint">
          Administrative actions in this console are recorded in an audit log.
        </p>
      </div>
    </div>
  );
}

function WelcomeOption({
  icon,
  title,
  description,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card flex flex-col items-start gap-3 p-6 text-left transition-all duration-150 ease-spring hover:-translate-y-1 hover:shadow-warm-md"
    >
      <span
        className={
          accent
            ? 'flex h-11 w-11 items-center justify-center rounded-full bg-accent text-accent-fg'
            : 'flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-fg'
        }
      >
        {icon}
      </span>
      <span className="font-display text-base font-bold text-fg">{title}</span>
      <span className="text-sm text-muted">{description}</span>
    </button>
  );
}
