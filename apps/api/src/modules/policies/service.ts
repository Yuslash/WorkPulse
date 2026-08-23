import { ObjectId } from 'mongodb';
import type { AgentConfig, Policy, UpdatePolicyRequest } from '@workpulse/shared';
import { collections } from '../../db/client.js';
import type { PolicyDoc } from '../../db/types.js';
import { idToString } from '../../lib/ids.js';

/**
 * Organization policy (spec §30) — the single switchboard for what agents may
 * collect. Screenshots and website tracking default OFF; nothing turns them on
 * except an explicit admin action, which is audited.
 */

export const DEFAULT_POLICY: Omit<AgentConfig, 'configVersion'> = {
  trackApplications: true,
  trackWindowTitles: false,
  trackWebsites: false,
  trackScreenshots: false,
  idleThresholdSec: 600,
  heartbeatSec: 30,
  telemetryFlushSec: 45,
  configRefreshSec: 600,
  maxQueueBytes: 50 * 1024 * 1024,
  retentionDays: 90,
};

function toConfig(doc: PolicyDoc): AgentConfig {
  return {
    configVersion: doc.configVersion,
    trackApplications: doc.trackApplications,
    trackWindowTitles: doc.trackWindowTitles,
    trackWebsites: doc.trackWebsites,
    trackScreenshots: doc.trackScreenshots,
    idleThresholdSec: doc.idleThresholdSec,
    heartbeatSec: doc.heartbeatSec,
    telemetryFlushSec: doc.telemetryFlushSec,
    configRefreshSec: doc.configRefreshSec,
    maxQueueBytes: doc.maxQueueBytes,
    retentionDays: doc.retentionDays,
  };
}

/**
 * Reads the org's policy, creating the default on first access. Upsert rather
 * than insert so two agents enrolling simultaneously cannot race into a
 * duplicate-key error.
 */
export async function getOrCreatePolicy(organizationId: ObjectId): Promise<PolicyDoc> {
  const existing = await collections.policies().findOne({ organizationId });
  if (existing) return existing;

  const now = new Date();
  await collections.policies().updateOne(
    { organizationId },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        organizationId,
        configVersion: 1,
        ...DEFAULT_POLICY,
        updatedBy: null,
        updatedAt: now,
      },
    },
    { upsert: true },
  );

  const created = await collections.policies().findOne({ organizationId });
  if (!created) throw new Error('failed to create default policy');
  return created;
}

export async function getAgentConfig(organizationId: ObjectId): Promise<AgentConfig> {
  return toConfig(await getOrCreatePolicy(organizationId));
}

export async function getPolicy(organizationId: ObjectId): Promise<Policy> {
  const doc = await getOrCreatePolicy(organizationId);
  return {
    ...toConfig(doc),
    organizationId: doc.organizationId.toHexString(),
    updatedAt: doc.updatedAt.toISOString(),
    updatedBy: idToString(doc.updatedBy),
  };
}

/**
 * Applies an admin's changes and bumps `configVersion`.
 *
 * The version bump is what tells agents to re-fetch: they compare the version
 * on every heartbeat response, so a policy change reaches every endpoint
 * within one heartbeat instead of waiting for the next config refresh.
 */
export async function updatePolicy(
  organizationId: ObjectId,
  updates: UpdatePolicyRequest,
  updatedBy: ObjectId,
): Promise<Policy> {
  await getOrCreatePolicy(organizationId);

  // Drop undefined so a partial update never blanks an unspecified field.
  const changes = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  );

  await collections.policies().updateOne(
    { organizationId },
    {
      $set: { ...changes, updatedBy, updatedAt: new Date() },
      $inc: { configVersion: 1 },
    },
  );

  return getPolicy(organizationId);
}
