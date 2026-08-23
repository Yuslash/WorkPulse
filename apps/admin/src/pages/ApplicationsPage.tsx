import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { AppCategory, formatDuration } from '@workpulse/shared';
import { useApplications } from '@/features/queries';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingBlock,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { daysAgoKey, todayKey } from '@/lib/format';

/**
 * Application analytics (spec §14) and the category split (spec §15).
 *
 * Presented as "Activity Insights", not a productivity score. The spec is
 * explicit that this must not read as a verdict on a person, so the copy
 * describes where time went and points at the configurable rules that
 * decided the categories.
 */

const CATEGORY_COLORS: Record<AppCategory, string> = {
  PRODUCTIVE: 'rgb(var(--active))',
  NEUTRAL: 'rgb(var(--accent))',
  BREAK: 'rgb(var(--idle))',
  RESTRICTED: 'rgb(var(--offline))',
};

const CATEGORY_TONES: Record<AppCategory, 'success' | 'accent' | 'warn' | 'danger'> = {
  PRODUCTIVE: 'success',
  NEUTRAL: 'accent',
  BREAK: 'warn',
  RESTRICTED: 'danger',
};

export function ApplicationsPage() {
  const [from, setFrom] = useState(daysAgoKey(6));
  const [to, setTo] = useState(todayKey());

  const query = useApplications({ from, to, limit: 50 });

  const categories = query.data?.categories ?? [];
  const applications = query.data?.applications ?? [];
  const totalSec = categories.reduce((sum, entry) => sum + entry.durationSec, 0);

  const pieData = categories
    .filter((entry) => entry.durationSec > 0)
    .map((entry) => ({
      name: entry.category,
      value: entry.durationSec,
      color: CATEGORY_COLORS[entry.category],
    }));

  return (
    <>
      <PageHeader
        title="Applications"
        description="Where tracked time went, grouped by the application categories your organization defines."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="w-auto"
              aria-label="From date"
            />
            <span className="text-xs text-faint">to</span>
            <Input
              type="date"
              value={to}
              min={from}
              max={todayKey()}
              onChange={(event) => setTo(event.target.value)}
              className="w-auto"
              aria-label="To date"
            />
          </div>
        }
      />

      {query.isLoading ? (
        <LoadingBlock label="Loading application activity" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : applications.length === 0 ? (
        <Card>
          <EmptyState
            title="No application activity in this range"
            description="Pick a wider date range, or check that agents are enrolled and reporting."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title={`Applications (${applications.length})`} />
            <Table>
              <thead>
                <tr>
                  <Th>Application</Th>
                  <Th>Executable</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Time</Th>
                  <Th className="text-right">Share</Th>
                  <Th className="text-right">Sessions</Th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => {
                  const share = totalSec > 0 ? (app.durationSec / totalSec) * 100 : 0;

                  return (
                    <tr key={app.exeName} className="hover:bg-elevated/40">
                      <Td className="font-medium">{app.appName}</Td>
                      <Td className="text-2xs text-faint">{app.exeName}</Td>
                      <Td>
                        <Badge tone={CATEGORY_TONES[app.category]}>{app.category}</Badge>
                      </Td>
                      <Td className="tabular text-right">{formatDuration(app.durationSec)}</Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* The bar makes relative weight readable without
                              making the reader compare numbers. */}
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-elevated">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.max(2, share)}%`,
                                background: CATEGORY_COLORS[app.category],
                              }}
                            />
                          </span>
                          <span className="tabular w-10 text-xs text-muted">
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </Td>
                      <Td className="tabular text-right text-muted">{app.sessionCount}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Activity insights" />
              {pieData.length === 0 ? (
                <EmptyState title="Nothing categorized yet" />
              ) : (
                <>
                  <div className="h-48 cursor-default select-none px-2 pt-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={44}
                          outerRadius={70}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {pieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: 'rgb(var(--surface))',
                            border: '1px solid rgb(var(--border))',
                            borderRadius: 6,
                            fontSize: 12,
                            fontFamily: 'inherit',
                          }}
                          formatter={(value: number, name) => [formatDuration(value), name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="select-none space-y-1.5 px-4 pb-4">
                    {categories.map((entry) => (
                      <div key={entry.category} className="flex items-center gap-2 text-xs">
                        <span
                          className="h-2 w-2 shrink-0 rounded-sm"
                          style={{ background: CATEGORY_COLORS[entry.category] }}
                          aria-hidden
                        />
                        <span className="flex-1 text-muted">{entry.category}</span>
                        <span className="tabular">{formatDuration(entry.durationSec)}</span>
                        <span className="tabular w-10 text-right text-faint">{entry.percent}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card className="px-4 py-3">
              <p className="text-2xs leading-relaxed text-muted">
                Categories are defined by your organization on the Policies page, and describe where
                time was spent — not how well anyone worked. Existing records keep the category they
                were recorded with, so changing a rule affects new activity only.
              </p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
