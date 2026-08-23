import { useState } from 'react';
import { AuditAction } from '@workpulse/shared';
import { useAuditLogs } from '@/features/queries';
import {
  Badge,
  Button,
  Card,
  Dropdown,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

/**
 * The audit trail (spec §33).
 *
 * Reading it is itself privileged, because it reveals who looked at whom.
 * Access is gated to HR_ADMIN and above by both the route guard and the API.
 */

const ACTION_LABELS: Record<string, string> = {
  [AuditAction.AdminLogin]: 'Admin signed in',
  [AuditAction.AdminLoginFailed]: 'Failed sign-in attempt',
  [AuditAction.AdminLogout]: 'Admin signed out',
  [AuditAction.EmployeeCreated]: 'Employee created',
  [AuditAction.EmployeeUpdated]: 'Employee updated',
  [AuditAction.EmployeeViewed]: 'Employee record viewed',
  [AuditAction.CredentialsGenerated]: 'Agent login issued',
  [AuditAction.CredentialsRevoked]: 'Agent login revoked',
  [AuditAction.DeviceEnrolled]: 'Device enrolled',
  [AuditAction.DeviceRevoked]: 'Device revoked',
  [AuditAction.PolicyUpdated]: 'Policy changed',
  [AuditAction.AppCategoryUpdated]: 'Category rule changed',
  [AuditAction.ReportExported]: 'Report exported',
};

/** Actions worth visually flagging when scanning the list. */
const TONES: Record<string, 'danger' | 'warn' | 'accent'> = {
  [AuditAction.AdminLoginFailed]: 'danger',
  [AuditAction.DeviceRevoked]: 'danger',
  [AuditAction.CredentialsRevoked]: 'danger',
  [AuditAction.PolicyUpdated]: 'warn',
  [AuditAction.CredentialsGenerated]: 'accent',
  [AuditAction.DeviceEnrolled]: 'accent',
};

export function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const query = useAuditLogs({ page, limit: 50, action: action || undefined });
  const rows = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Every privileged action in this console, including who viewed which employee record."
        action={
          <Dropdown
            value={action}
            onChange={(next) => {
              setAction(next);
              setPage(1);
            }}
            ariaLabel="Filter by action"
            align="right"
            options={[
              { value: '', label: 'All actions' },
              ...Object.entries(ACTION_LABELS).map(([key, label]) => ({ value: key, label })),
            ]}
          />
        }
      />

      <Card>
        {query.isLoading ? (
          <LoadingBlock label="Loading audit trail" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={action ? 'No entries for this action' : 'No audit entries yet'}
            description="Entries appear as administrators sign in, view records and change settings."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Details</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="hover:bg-elevated/40">
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {formatDateTime(entry.createdAt)}
                  </Td>
                  <Td className="text-xs">{entry.actorName}</Td>
                  <Td>
                    {TONES[entry.action] ? (
                      <Badge tone={TONES[entry.action]}>
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </Badge>
                    ) : (
                      <span className="text-xs">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">
                    {entry.targetLabel ?? entry.targetType ?? '—'}
                  </Td>
                  <Td className="max-w-[240px] truncate text-2xs text-faint">
                    {entry.metadata ? summarize(entry.metadata) : '—'}
                  </Td>
                  <Td className="text-2xs text-faint">{entry.ip ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {query.data && query.data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
            <span className="text-faint">
              Page {query.data.page} of {query.data.pages} · {query.data.total} entries
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" disabled={page >= query.data.pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      <p className="mt-3 text-2xs text-faint">
        Audit entries are retained for one year and cannot be edited or deleted from this console.
      </p>
    </>
  );
}

/** Renders metadata compactly; a policy diff is the common case. */
function summarize(metadata: Record<string, unknown>): string {
  if (Array.isArray(metadata.changed) && metadata.changed.length > 0) {
    return `changed: ${(metadata.changed as string[]).join(', ')}`;
  }

  return Object.entries(metadata)
    .filter(([key]) => key !== 'before' && key !== 'after')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}
