import { useEffect, useState } from 'react';
import { AlertTriangle, Plus, Save } from 'lucide-react';
import { AppCategory, Role, type UpdatePolicyRequest } from '@workpulse/shared';
import { useAuth } from '@/lib/auth';
import {
  useAppCategories,
  usePolicy,
  useUpdatePolicy,
  useUpsertAppCategory,
} from '@/features/queries';
import {
  Badge,
  Button,
  Card,
  CardHeader,
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
  Toggle,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';

/**
 * Organization policy (spec §30) — what agents are permitted to collect.
 *
 * This page decides what happens on every employee's machine, so it is
 * ORG_OWNER only, every change is audited, and the privacy-sensitive toggles
 * carry an explicit warning rather than sitting in a row of identical
 * switches.
 */
export function PoliciesPage() {
  const { can } = useAuth();
  const query = usePolicy();
  const update = useUpdatePolicy();

  const [draft, setDraft] = useState<UpdatePolicyRequest>({});
  const mayEdit = can(Role.OrgOwner);

  // Reset the draft whenever the server state changes, so a save (which bumps
  // configVersion) leaves the form showing the truth rather than stale edits.
  useEffect(() => {
    setDraft({});
  }, [query.data?.configVersion]);

  if (query.isLoading) return <LoadingBlock label="Loading policy" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data) return null;

  const policy = query.data;
  const value = <K extends keyof UpdatePolicyRequest>(key: K): NonNullable<UpdatePolicyRequest[K]> =>
    (draft[key] ?? policy[key as keyof typeof policy]) as NonNullable<UpdatePolicyRequest[K]>;

  const dirty = Object.keys(draft).length > 0;

  const set = <K extends keyof UpdatePolicyRequest>(key: K, next: UpdatePolicyRequest[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));

  return (
    <>
      <PageHeader
        title="Policies"
        description="What the agent is allowed to collect. Changes reach every device within one heartbeat."
        action={
          mayEdit ? (
            <Button
              variant="primary"
              disabled={!dirty}
              loading={update.isPending}
              onClick={() => update.mutate(draft)}
            >
              <Save className="h-3.5 w-3.5" />
              Save changes
            </Button>
          ) : (
            <Badge>Read only — requires Organization Owner</Badge>
          )
        }
      />

      {update.isError && (
        <div className="mb-4 rounded-sub bg-danger/10 px-4 py-3 text-sm text-danger">
          {update.error instanceof Error ? update.error.message : 'Could not save the policy.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Data collection" />
          <div className="divide-y divide-border">
            <PolicyToggle
              label="Application tracking"
              description="Records which application has focus and for how long."
              checked={value('trackApplications')}
              disabled={!mayEdit}
              onChange={(next) => set('trackApplications', next)}
            />
            <PolicyToggle
              label="Window titles"
              description="Also records the title of the focused window. Titles often contain document, customer or subject names."
              checked={value('trackWindowTitles')}
              disabled={!mayEdit}
              sensitive
              onChange={(next) => set('trackWindowTitles', next)}
            />
            <PolicyToggle
              label="Website tracking"
              description="Records visited domains for supported browsers. Not implemented in this version."
              checked={value('trackWebsites')}
              disabled
              sensitive
              onChange={(next) => set('trackWebsites', next)}
            />
            <PolicyToggle
              label="Screenshots"
              description="Periodic screen capture. Not implemented in this version; it stays off."
              checked={value('trackScreenshots')}
              disabled
              sensitive
              onChange={(next) => set('trackScreenshots', next)}
            />
          </div>

          <div className="px-6 pb-6 pt-1">
            <p className="text-xs leading-relaxed text-faint">
              Regardless of these settings, the agent never records keystrokes, clipboard contents,
              passwords, microphone, webcam or personal files. The tray application shows each
              employee exactly what this policy currently permits.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Timing and retention" />
          <div className="space-y-4 px-6 pb-6">
            <NumberField
              label="Idle threshold"
              suffix="seconds"
              hint="How long without input before someone is counted as idle."
              min={30}
              max={3600}
              value={value('idleThresholdSec')}
              disabled={!mayEdit}
              onChange={(next) => set('idleThresholdSec', next)}
            />
            <NumberField
              label="Heartbeat interval"
              suffix="seconds"
              hint="How often each agent reports its presence. Lower is more responsive and more traffic."
              min={5}
              max={600}
              value={value('heartbeatSec')}
              disabled={!mayEdit}
              onChange={(next) => set('heartbeatSec', next)}
            />
            <NumberField
              label="Telemetry flush"
              suffix="seconds"
              hint="How often queued activity is uploaded."
              min={10}
              max={600}
              value={value('telemetryFlushSec')}
              disabled={!mayEdit}
              onChange={(next) => set('telemetryFlushSec', next)}
            />
            <NumberField
              label="Retention"
              suffix="days"
              hint="Raw activity older than this is deleted automatically."
              min={1}
              max={3650}
              value={value('retentionDays')}
              disabled={!mayEdit}
              onChange={(next) => set('retentionDays', next)}
            />
          </div>

          <div className="px-6 pb-5 text-xs text-faint">
            Config version {policy.configVersion} · updated {formatDateTime(policy.updatedAt)}
          </div>
        </Card>
      </div>

      <AppCategoriesCard mayEdit={can(Role.HrAdmin)} />
    </>
  );
}

function PolicyToggle({
  label,
  description,
  checked,
  disabled,
  sensitive,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  sensitive?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 px-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{label}</span>
          {/* Sensitive collectors are marked so they are never enabled by
              accident in a row of otherwise-identical switches. */}
          {sensitive && checked && (
            <span className="inline-flex items-center gap-1 text-2xs text-warn">
              <AlertTriangle className="h-3 w-3" />
              privacy sensitive
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={label} />
    </div>
  );
}

function NumberField({
  label,
  suffix,
  hint,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  suffix: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="label mb-1 block">{label}</label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            // Clamp here so the server never has to reject a value the UI
            // allowed the admin to type.
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
          className="w-28"
        />
        <span className="text-xs text-faint">{suffix}</span>
      </div>
      <p className="mt-1 text-2xs text-muted">{hint}</p>
    </div>
  );
}

function AppCategoriesCard({ mayEdit }: { mayEdit: boolean }) {
  const query = useAppCategories();
  const upsert = useUpsertAppCategory();
  const [adding, setAdding] = useState(false);

  const [exeName, setExeName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [category, setCategory] = useState<AppCategory>(AppCategory.Neutral);

  const rules = query.data?.rules ?? [];

  return (
    <Card className="mt-4">
      <CardHeader
        title="Application categories"
        action={
          mayEdit ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add rule
            </Button>
          ) : undefined
        }
      />

      <div className="px-6 pb-4">
        <p className="text-xs leading-relaxed text-faint">
          WorkPulse ships with no opinion about which applications are productive. Anything without a
          rule is counted as Neutral. These categories describe where time went; they are not a
          judgement about an individual, and changing a rule affects new activity only.
        </p>
      </div>

      {query.isLoading ? (
        <LoadingBlock />
      ) : rules.length === 0 ? (
        <EmptyState
          title="No category rules yet"
          description="Every application currently counts as Neutral. Add a rule to group time in the Applications view."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Application</Th>
              <Th>Executable</Th>
              <Th>Category</Th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <Td>{rule.displayName}</Td>
                <Td className="text-2xs text-faint">{rule.exeName}</Td>
                <Td>
                  {mayEdit ? (
                    <Dropdown
                      value={rule.category}
                      onChange={(next) =>
                        upsert.mutate({
                          exeName: rule.exeName,
                          displayName: rule.displayName,
                          category: next as AppCategory,
                        })
                      }
                      ariaLabel={`Category for ${rule.displayName}`}
                      className="h-8 px-3 text-xs"
                      options={Object.values(AppCategory).map((option) => ({ value: option, label: option }))}
                    />
                  ) : (
                    <Badge>{rule.category}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add category rule">
        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await upsert.mutateAsync({
              exeName: exeName.trim(),
              displayName: displayName.trim() || exeName.trim(),
              category,
            });
            setExeName('');
            setDisplayName('');
            setCategory(AppCategory.Neutral);
            setAdding(false);
          }}
        >
          <div>
            <label htmlFor="exe" className="label mb-1 block">
              Executable name
            </label>
            <Input
              id="exe"
              required
              value={exeName}
              onChange={(event) => setExeName(event.target.value)}
              placeholder="code.exe"
            />
          </div>

          <div>
            <label htmlFor="display" className="label mb-1 block">
              Display name
            </label>
            <Input
              id="display"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Visual Studio Code"
            />
          </div>

          <div>
            <label htmlFor="category" className="label mb-1 block">
              Category
            </label>
            <Dropdown
              id="category"
              value={category}
              onChange={(next) => setCategory(next as AppCategory)}
              ariaLabel="Category"
              className="w-full justify-between"
              options={Object.values(AppCategory).map((option) => ({ value: option, label: option }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={upsert.isPending} disabled={!exeName}>
              Add rule
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
