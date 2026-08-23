import { useState } from 'react';
import { AlertTriangle, Check, Copy, KeyRound } from 'lucide-react';
import type { GeneratedCredentials } from '@workpulse/shared';
import { Role } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import {
  useCredentialStatus,
  useGenerateCredentials,
  useRevokeCredentials,
} from '@/features/queries';
import { Badge, Button, Modal, Spinner } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

/**
 * Issuing an employee's agent login (spec §5).
 *
 * The one-time password is shown exactly once, in this dialog. It is held in
 * component state and dropped when the dialog closes — it is never written to
 * the query cache, localStorage, or the URL.
 */
export function CredentialsDialog({
  employeeId,
  employeeName,
  open,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const status = useCredentialStatus(employeeId, open);
  const generate = useGenerateCredentials(employeeId);
  const revoke = useRevokeCredentials(employeeId);

  const [issued, setIssued] = useState<GeneratedCredentials | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const mayManage = can(Role.HrAdmin);

  const handleClose = () => {
    // Clearing here is the whole reason the password is component state.
    setIssued(null);
    setCopied(null);
    setConfirmingRevoke(false);
    onClose();
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be blocked; the value is on screen to type.
      setCopied(null);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={`Agent login — ${employeeName}`} width="max-w-lg">
      {issued ? (
        <div className="space-y-4">
          <div className="rounded-sub bg-warn/10 px-4 py-3 text-sm text-warn">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This password is shown once and cannot be retrieved again. Give it to{' '}
                {employeeName} now; generate a new one if it is lost.
              </p>
            </div>
          </div>

          <Field label="User ID" value={issued.userId} onCopy={copy} copied={copied === 'User ID'} />
          <Field
            label="One-time password"
            value={issued.tempPassword}
            onCopy={copy}
            copied={copied === 'One-time password'}
          />

          <div className="rounded-sub bg-elevated px-4 py-3.5">
            <div className="label mb-1.5">The employee enters these once, in the agent</div>
            <code className="block whitespace-pre-wrap break-all font-mono text-2xs text-muted">
              WorkPulseAgent --enroll --user-id {issued.userId} --password {issued.tempPassword}
            </code>
          </div>

          <Button variant="primary" className="w-full" onClick={handleClose}>
            I have shared these credentials
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {status.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : status.data?.exists ? (
            <div className="space-y-2 text-xs">
              <Row label="User ID" value={status.data.userId ?? '—'} />
              <Row
                label="Status"
                value={
                  <Badge tone={status.data.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {status.data.status}
                  </Badge>
                }
              />
              <Row label="Issued" value={formatDateTime(status.data.generatedAt)} />
              <Row
                label="Last used"
                value={status.data.lastLoginAt ? formatDateTime(status.data.lastLoginAt) : 'Never'}
              />
              {status.data.mustChangePassword && (
                <p className="pt-1 text-2xs text-faint">
                  The employee has not enrolled a device with these credentials yet.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">
              {employeeName} does not have an agent login yet. Generating one produces a user ID and
              a one-time password to enrol their device.
            </p>
          )}

          {(generate.isError || revoke.isError) && (
            <div className="rounded-sub bg-danger/10 px-4 py-3 text-sm text-danger">
              {(generate.error ?? revoke.error) instanceof Error
                ? ((generate.error ?? revoke.error) as Error).message
                : 'The action failed.'}
            </div>
          )}

          {!mayManage ? (
            <p className="text-2xs text-faint">
              Issuing credentials requires the HR Admin role or higher.
            </p>
          ) : confirmingRevoke ? (
            <div className="space-y-2">
              <p className="text-xs text-muted">
                Revoking prevents new device enrolments. Devices already enrolled keep working —
                revoke those individually from the Devices page.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  loading={revoke.isPending}
                  onClick={async () => {
                    await revoke.mutateAsync();
                    setConfirmingRevoke(false);
                  }}
                >
                  Revoke login
                </Button>
                <Button size="sm" onClick={() => setConfirmingRevoke(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="primary"
                loading={generate.isPending}
                onClick={async () => setIssued(await generate.mutateAsync())}
              >
                <KeyRound className="h-3.5 w-3.5" />
                {status.data?.exists ? 'Generate a new password' : 'Generate login'}
              </Button>

              {status.data?.exists && status.data.status === 'ACTIVE' && (
                <Button variant="danger" onClick={() => setConfirmingRevoke(true)}>
                  Revoke
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Field({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => void;
  copied: boolean;
}) {
  return (
    <div>
      <div className="label mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all rounded-sub bg-elevated px-4 py-2.5 font-mono text-sm">
          {value}
        </code>
        <Button size="sm" onClick={() => onCopy(label, value)} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-faint">{label}</span>
      <span className="text-fg">{value}</span>
    </div>
  );
}
