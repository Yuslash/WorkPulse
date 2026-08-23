import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, Plus, Search } from 'lucide-react';
import { PresenceState, Role, formatDuration } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { useCreateEmployee, useEmployees } from '@/features/queries';
import { CredentialsDialog } from '@/features/employees/CredentialsDialog';
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

export function EmployeesPage() {
  const { can } = useAuth();
  const { presence: livePresence } = useRealtime();
  const [searchParams, setSearchParams] = useSearchParams();

  // The shell's global search box and the "Add employee" quick action both
  // land here via the URL, so this page has to be able to start pre-filled.
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
  const [presenceFilter, setPresenceFilter] = useState('');
  const [page, setPage] = useState(1);
  const [credentialsFor, setCredentialsFor] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(() => searchParams.get('new') === '1');

  useEffect(() => {
    if (searchParams.has('q') || searchParams.has('new')) {
      setSearchParams({}, { replace: true });
    }
    // Only ever consumed once, on the landing navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filters = useMemo(
    () => ({ page, limit: 25, search: search || undefined }),
    [page, search],
  );

  const query = useEmployees(filters);

  // Merge the live socket state over the fetched rows so the board reacts
  // immediately rather than at the next poll.
  const rows = useMemo(() => {
    const items = (query.data?.items ?? []).map((employee) => {
      const live = livePresence.get(employee.id);
      return live
        ? {
            ...employee,
            presence: {
              ...employee.presence,
              state: live.state,
              currentApplication: live.currentApplication,
              lastSeenAt: live.lastSeenAt,
              stateSinceSec: live.stateSinceSec,
            },
          }
        : employee;
    });

    return presenceFilter ? items.filter((item) => item.presence.state === presenceFilter) : items;
  }, [query.data, livePresence, presenceFilter]);

  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone in your organization, and the agent logins issued to them."
        action={
          can(Role.HrAdmin) ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add employee
            </Button>
          ) : undefined
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email"
            className="pl-10"
            aria-label="Search employees"
          />
        </div>

        <Dropdown
          value={presenceFilter}
          onChange={setPresenceFilter}
          ariaLabel="Filter by presence"
          options={[
            { value: '', label: 'All presence' },
            { value: PresenceState.Active, label: 'Active' },
            { value: PresenceState.Idle, label: 'Idle' },
            { value: PresenceState.Locked, label: 'Locked' },
            { value: PresenceState.Offline, label: 'Offline' },
          ]}
        />
      </div>

      <Card>
        {query.isLoading ? (
          <LoadingBlock label="Loading employees" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={search || presenceFilter ? 'No matching employees' : 'No employees yet'}
            description={
              search || presenceFilter
                ? 'Try a different search or clear the presence filter.'
                : 'Add an employee, then issue them an agent login to start collecting activity.'
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Status</Th>
                <Th>Current app</Th>
                <Th className="text-right">Active today</Th>
                <Th className="text-right">Devices</Th>
                <Th>Login</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((employee) => (
                <tr key={employee.id} className="hover:bg-elevated/40">
                  <Td>
                    <Link to={`/employees/${employee.id}`} className="block hover:text-accent">
                      <div className="font-medium">{employee.name}</div>
                      <div className="text-2xs text-faint">
                        {employee.jobTitle ?? employee.email}
                        {employee.departmentName ? ` · ${employee.departmentName}` : ''}
                      </div>
                    </Link>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <PresenceDot state={employee.presence.state} pulse />
                      <PresenceLabel state={employee.presence.state} />
                    </span>
                  </Td>
                  <Td className="max-w-[180px] truncate text-muted">
                    {employee.presence.currentApplication ?? '—'}
                  </Td>
                  <Td className="tabular text-right">{formatDuration(employee.todayActiveSec)}</Td>
                  <Td className="tabular text-right text-muted">{employee.deviceCount}</Td>
                  <Td>
                    {employee.hasCredentials ? (
                      <Badge tone="success">Issued</Badge>
                    ) : (
                      <Badge>None</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {can(Role.HrAdmin) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCredentialsFor({ id: employee.id, name: employee.name })}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Login</span>
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
              Page {query.data.page} of {query.data.pages} · {query.data.total} employees
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                disabled={page >= query.data.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {credentialsFor && (
        <CredentialsDialog
          employeeId={credentialsFor.id}
          employeeName={credentialsFor.name}
          open
          onClose={() => setCredentialsFor(null)}
        />
      )}

      <CreateEmployeeDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateEmployeeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateEmployee();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');

  const reset = () => {
    setName('');
    setEmail('');
    setJobTitle('');
    create.reset();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await create.mutateAsync({
      name: name.trim(),
      email: email.trim(),
      jobTitle: jobTitle.trim() || undefined,
    });
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add employee"
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="new-name" className="label mb-1 block">
            Full name
          </label>
          <Input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label htmlFor="new-email" className="label mb-1 block">
            Work email
          </label>
          <Input
            id="new-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="new-title" className="label mb-1 block">
            Job title (optional)
          </label>
          <Input id="new-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </div>

        {create.isError && (
          <div className="rounded-sub bg-danger/10 px-4 py-3 text-sm text-danger">
            {create.error instanceof Error ? create.error.message : 'Could not add the employee.'}
          </div>
        )}

        <p className="text-2xs text-faint">
          Adding an employee does not start monitoring. Issue them an agent login and enrol a device
          first.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending} disabled={!name || !email}>
            Add employee
          </Button>
        </div>
      </form>
    </Modal>
  );
}
