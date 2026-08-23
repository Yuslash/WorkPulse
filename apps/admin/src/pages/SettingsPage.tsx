import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { usePolicy } from '@/features/queries';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { ThemeSelectorSection } from '@/features/theme/ThemeSelectorSection';

export function SettingsPage() {
  const { user } = useAuth();
  const { connected } = useRealtime();
  const policy = usePolicy();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Account preferences, color themes, and agent collection policies."
      />

      <Card>
        <CardHeader title="Account" />
        <div className="space-y-3 px-6 pb-6 text-sm">
          <Row label="Name" value={user?.name ?? '—'} />
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Role" value={<Badge tone="accent">{user?.role}</Badge>} />
          <Row label="Organization" value={user?.organizationName ?? '—'} />
          <Row
            label="Live updates"
            value={
              connected ? <Badge tone="success">Connected</Badge> : <Badge tone="warn">Reconnecting</Badge>
            }
          />
        </div>
      </Card>

      {/* Handcrafted themes section */}
      <ThemeSelectorSection />

      {/*
        The employee-facing transparency screen mirrors this exactly. Showing
        it to admins too means nobody has to take on faith what the agent does.
      */}
      <Card className="mt-6">
        <CardHeader title="What the agent collects" />
        <div className="grid grid-cols-1 gap-6 px-6 pb-6 sm:grid-cols-2">
          <div>
            <div className="label mb-2.5">Currently collected</div>
            <ul className="space-y-1.5 text-sm">
              <Item ok>Active / idle state</Item>
              <Item ok>Attendance times</Item>
              <Item ok>Device health and agent version</Item>
              <Item ok={policy.data?.trackApplications ?? false}>Application activity</Item>
              <Item ok={policy.data?.trackWindowTitles ?? false}>Window titles</Item>
            </ul>
          </div>

          <div>
            <div className="label mb-2.5">Never collected</div>
            <ul className="space-y-1.5 text-sm">
              <Item>Keystrokes</Item>
              <Item>Clipboard contents</Item>
              <Item>Passwords</Item>
              <Item>Microphone</Item>
              <Item>Webcam</Item>
              <Item>Personal files</Item>
              <Item>Screenshots</Item>
            </ul>
          </div>
        </div>

        <div className="px-6 pb-6 pt-2">
          <p className="text-xs leading-relaxed text-faint">
            Employees see this same list in the agent's tray application, generated from the live
            policy rather than from a fixed promise. Items in the "never collected" column have no
            setting that enables them.
          </p>
        </div>
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-fg">{value}</span>
    </div>
  );
}

function Item({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className={ok ? 'text-success' : 'text-faint'} aria-hidden>
        {ok ? '✓' : '✗'}
      </span>
      <span className={ok ? 'text-fg' : 'text-muted'}>{children}</span>
    </li>
  );
}
