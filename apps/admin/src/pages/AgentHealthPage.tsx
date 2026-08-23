import { useAgentHealth } from '@/features/queries';
import { Badge, Card, CardHeader, EmptyState, ErrorState, LoadingBlock, PageHeader, Stat } from '@/components/ui';

/**
 * Fleet health (spec §29).
 *
 * The monitoring system has to be monitorable itself: an agent that silently
 * stopped reporting looks identical to an employee who is not working, and
 * conflating the two is how this kind of product produces unfair conclusions.
 */
export function AgentHealthPage() {
  const query = useAgentHealth();

  if (query.isLoading) return <LoadingBlock label="Checking agent health" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data) return null;

  const health = query.data;
  const total = health.versions.reduce((sum, entry) => sum + entry.count, 0);

  return (
    <>
      <PageHeader
        title="Agent Health"
        description="The state of the agents themselves, so a reporting gap is never mistaken for inactivity."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Installed" value={health.installed} />
        <Stat label="Healthy" value={health.healthy} tone="active" hint="Online, current version" />
        <Stat label="Outdated" value={health.outdated} tone="idle" hint="Online, older version" />
        <Stat label="Offline" value={health.offline} tone="offline" hint="Not reporting" />
        <Stat label="Revoked" value={health.revoked} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Versions in the field"
            action={
              health.latestVersion ? (
                <Badge tone="accent">Latest: {health.latestVersion}</Badge>
              ) : undefined
            }
          />
          {health.versions.length === 0 ? (
            <EmptyState
              title="No agents enrolled yet"
              description="Issue an employee an agent login and run the enrolment command on their machine."
            />
          ) : (
            <div className="space-y-2 p-4">
              {health.versions.map((entry) => {
                const share = total > 0 ? (entry.count / total) * 100 : 0;
                const isLatest = entry.version === health.latestVersion;

                return (
                  <div key={entry.version} className="flex items-center gap-3 text-xs">
                    <span className="tabular w-16 shrink-0">{entry.version}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                      <span
                        className={`block h-full rounded-full ${isLatest ? 'bg-active' : 'bg-idle'}`}
                        style={{ width: `${Math.max(2, share)}%` }}
                      />
                    </span>
                    <span className="tabular w-10 text-right text-muted">{entry.count}</span>
                    {isLatest && <Badge tone="success">current</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="What these numbers mean" />
          <div className="space-y-3 p-4 text-xs leading-relaxed text-muted">
            <p>
              <span className="font-medium text-fg">Offline</span> means the agent has not sent a
              heartbeat recently. That can be a machine that is switched off, asleep, or off the
              network — it is not, on its own, evidence about the person using it.
            </p>
            <p>
              <span className="font-medium text-fg">Outdated</span> agents are reporting normally but
              running an older build. They keep working; upgrading brings them onto the current
              collection behaviour.
            </p>
            <p>
              <span className="font-medium text-fg">Revoked</span> devices have had their access
              withdrawn from the Devices page. They stop reporting immediately and clear their stored
              identity.
            </p>
            <p>
              The latest version is inferred from what is actually deployed, so the outdated count
              becomes meaningful as soon as a newer agent appears anywhere in the fleet.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
