import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldOff } from 'lucide-react';
import { EntityStatus, PresenceState, Role } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { useDevices, useRevokeDevice } from '@/features/queries';
import {
  Badge,
  Button,
  Card,
  Dropdown,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { PresenceDot, PresenceLabel } from '@/components/status/PresenceDot';
import { formatDateTime, formatRam, formatRelative } from '@/lib/format';

/** Device inventory and revocation (spec §33). */
export function DevicesPage() {
  const { can } = useAuth();
  const { presence } = useRealtime();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revoking, setRevoking] = useState<{ id: string; hostname: string; employee: string } | null>(
    null,
  );

  const query = useDevices({ page, limit: 25, search: search || undefined, status: status || undefined });
  const revoke = useRevokeDevice();

  const rows = useMemo(() => {
    return (query.data?.items ?? []).map((device) => {
      // Presence is keyed by employee on the socket; a revoked device drops
      // out of the store entirely and correctly falls back to OFFLINE.
      const live = presence.get(device.employeeId);
      const isThisDevice = live?.deviceId === device.id;

      return {
        ...device,
        presence: isThisDevice ? live.state : device.presence,
      };
    });
  }, [query.data, presence]);

  return (
    <>
      <PageHeader
        title="Devices"
        description="Every machine enrolled in your organization."
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search hostname"
                className="w-48 pl-10"
                aria-label="Search devices"
              />
            </div>
            <Dropdown
              value={status}
              onChange={setStatus}
              ariaLabel="Status"
              options={[
                { value: '', label: 'All statuses' },
                { value: EntityStatus.Active, label: 'Active' },
                { value: EntityStatus.Revoked, label: 'Revoked' },
              ]}
            />
          </div>
        }
      />

      <Card>
        {query.isLoading ? (
          <LoadingBlock label="Loading devices" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search || status ? 'No matching devices' : 'No devices enrolled'}
            description={
              search || status
                ? 'Try a different search or clear the status filter.'
                : 'Issue an employee an agent login, then run the enrolment command on their machine.'
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Device</Th>
                <Th>Employee</Th>
                <Th>Status</Th>
                <Th>Agent</Th>
                <Th>Hardware</Th>
                <Th>Last seen</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((device) => (
                <tr key={device.id} className="hover:bg-elevated/40">
                  <Td>
                    <div className="font-medium">{device.hostname}</div>
                    <div className="text-2xs text-faint">
                      {device.os} {device.osVersion} · {device.arch}
                    </div>
                  </Td>
                  <Td>
                    <Link to={`/employees/${device.employeeId}`} className="hover:text-accent">
                      {device.employeeName}
                    </Link>
                  </Td>
                  <Td>
                    {device.status === EntityStatus.Active ? (
                      <span className="inline-flex items-center gap-1.5">
                        <PresenceDot state={device.presence as PresenceState} />
                        <PresenceLabel state={device.presence as PresenceState} />
                      </span>
                    ) : (
                      <Badge tone="danger">Revoked</Badge>
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{device.agentVersion}</Td>
                  <Td className="text-2xs text-muted">
                    {device.cpuCores ? `${device.cpuCores} cores` : '—'}
                    {device.ramMb ? ` · ${formatRam(device.ramMb)}` : ''}
                  </Td>
                  <Td className="text-xs text-muted" title={formatDateTime(device.lastSeenAt)}>
                    {formatRelative(device.lastSeenAt)}
                  </Td>
                  <Td className="text-right">
                    {can(Role.HrAdmin) && device.status === EntityStatus.Active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setRevoking({
                            id: device.id,
                            hostname: device.hostname,
                            employee: device.employeeName,
                          })
                        }
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Revoke</span>
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {query.data && query.data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs">
            <span className="text-faint">
              Page {query.data.page} of {query.data.pages} · {query.data.total} devices
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

      <Modal open={Boolean(revoking)} onClose={() => setRevoking(null)} title="Revoke device">
        {revoking && (
          <div className="space-y-3">
            <p className="text-sm">
              Revoke <span className="font-medium">{revoking.hostname}</span> belonging to{' '}
              <span className="font-medium">{revoking.employee}</span>?
            </p>
            <p className="text-xs text-muted">
              The agent stops reporting immediately and clears its stored identity. Activity already
              recorded is kept. The employee can enrol the machine again with a fresh login.
            </p>

            {revoke.isError && (
              <div className="rounded-sub bg-danger/10 px-4 py-3 text-sm text-danger">
                {revoke.error instanceof Error ? revoke.error.message : 'Could not revoke the device.'}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button onClick={() => setRevoking(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={revoke.isPending}
                onClick={async () => {
                  await revoke.mutateAsync(revoking.id);
                  setRevoking(null);
                }}
              >
                Revoke device
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
