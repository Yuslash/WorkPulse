import { ObjectId, type Filter } from 'mongodb';
import {
  EntityStatus,
  PresenceState,
  type AgentHealthResponse,
  type Device,
  type DeviceListQuery,
  type Paginated,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
import { presence } from '../../services/presence.js';
import type { AdminIdentity } from '../../plugins/auth.js';
import type { DeviceDoc } from '../../db/types.js';

/** Device inventory and the agent-health view (spec §29). */

function toDto(doc: DeviceDoc, employeeName: string): Device {
  const live = presence.get(doc._id.toHexString());

  return {
    id: doc._id.toHexString(),
    organizationId: doc.organizationId.toHexString(),
    employeeId: doc.employeeId.toHexString(),
    employeeName,
    hostname: doc.hostname,
    os: doc.os,
    osVersion: doc.osVersion,
    arch: doc.arch,
    cpu: doc.cpu,
    cpuCores: doc.cpuCores,
    ramMb: doc.ramMb,
    agentVersion: doc.agentVersion,
    status: doc.status,
    presence: live?.state ?? PresenceState.Offline,
    lastSeenAt: doc.lastSeenAt?.toISOString() ?? null,
    enrolledAt: doc.enrolledAt.toISOString(),
  };
}

async function employeeNames(ids: ObjectId[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const employees = await collections
    .employees()
    .find({ _id: { $in: ids } })
    .project<{ _id: ObjectId; name: string }>({ name: 1 })
    .toArray();

  return new Map(employees.map((e) => [e._id.toHexString(), e.name]));
}

export async function listDevices(
  admin: AdminIdentity,
  query: DeviceListQuery,
): Promise<Paginated<Device>> {
  const filter: Filter<DeviceDoc> = { organizationId: admin.organizationId };
  if (query.status) filter.status = query.status;
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.hostname = { $regex: escaped, $options: 'i' };
  }

  const skip = (query.page - 1) * query.limit;
  const [docs, total] = await Promise.all([
    collections.devices().find(filter).sort({ lastSeenAt: -1 }).skip(skip).limit(query.limit).toArray(),
    collections.devices().countDocuments(filter),
  ]);

  const names = await employeeNames(docs.map((d) => d.employeeId));
  let items = docs.map((doc) => toDto(doc, names.get(doc.employeeId.toHexString()) ?? 'Unknown'));

  if (query.presence) items = items.filter((item) => item.presence === query.presence);

  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit),
  };
}

export async function getDevice(admin: AdminIdentity, deviceId: ObjectId): Promise<Device> {
  const doc = await collections
    .devices()
    .findOne({ _id: deviceId, organizationId: admin.organizationId });
  if (!doc) throw ApiError.notFound('Device');

  const names = await employeeNames([doc.employeeId]);
  return toDto(doc, names.get(doc.employeeId.toHexString()) ?? 'Unknown');
}

/**
 * Revoking kills the machine's access immediately: its device secret stops
 * exchanging for tokens, and `requireAgent` rejects any access token it still
 * holds because the check hits the database, not just the JWT.
 */
export async function revokeDevice(admin: AdminIdentity, deviceId: ObjectId): Promise<Device> {
  const result = await collections.devices().updateOne(
    { _id: deviceId, organizationId: admin.organizationId },
    { $set: { status: EntityStatus.Revoked, updatedAt: new Date() } },
  );

  if (result.matchedCount === 0) throw ApiError.notFound('Device');

  // Drop it from the live board rather than leaving it showing as active.
  presence.remove(deviceId.toHexString());

  return getDevice(admin, deviceId);
}

/**
 * Fleet health (spec §29).
 *
 * "Latest version" is derived from what is actually deployed rather than
 * configured, so the outdated count is meaningful the moment a new agent
 * rolls out without anyone updating a setting.
 */
export async function getAgentHealth(admin: AdminIdentity): Promise<AgentHealthResponse> {
  const devices = await collections
    .devices()
    .find({ organizationId: admin.organizationId })
    .project<{ _id: ObjectId; agentVersion: string; status: EntityStatus }>({
      agentVersion: 1,
      status: 1,
    })
    .toArray();

  const versionCounts = new Map<string, number>();
  let revoked = 0;

  for (const device of devices) {
    if (device.status !== EntityStatus.Active) {
      revoked += 1;
      continue;
    }
    versionCounts.set(device.agentVersion, (versionCounts.get(device.agentVersion) ?? 0) + 1);
  }

  const versions = [...versionCounts.entries()]
    .map(([version, count]) => ({ version, count }))
    .sort((a, b) => compareVersions(b.version, a.version));

  const latestVersion = versions[0]?.version ?? null;

  let healthy = 0;
  let outdated = 0;
  let offline = 0;

  for (const device of devices) {
    if (device.status !== EntityStatus.Active) continue;

    const live = presence.get(device._id.toHexString());
    const isOnline = live && live.state !== PresenceState.Offline;

    if (!isOnline) offline += 1;
    else if (latestVersion && device.agentVersion !== latestVersion) outdated += 1;
    else healthy += 1;
  }

  return {
    installed: devices.length,
    healthy,
    outdated,
    offline,
    revoked,
    latestVersion,
    versions,
  };
}

/** Semver-ish comparison; unparsable segments sort as 0 rather than throwing. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .replace(/^v/, '')
      .split(/[.\-+]/)
      .map((part) => Number.parseInt(part, 10))
      .map((n) => (Number.isNaN(n) ? 0 : n));

  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
