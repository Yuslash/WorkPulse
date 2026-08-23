import { ObjectId, type AnyBulkWriteOperation, type Collection, type Document } from 'mongodb';
import {
  EntityStatus,
  PresenceState,
  toDateKey,
  type AgentConfig,
  type DeviceInfo,
  type EnrollResponse,
  type HeartbeatRequest,
  type TelemetryEvent,
  type TelemetryRequest,
  type TelemetryResponse,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
import { hashToken, randomToken, verifyPassword } from '../../lib/crypto.js';
import { signAgentAccessToken } from '../../lib/tokens.js';
import { presence } from '../../services/presence.js';
import { getAgentConfig } from '../policies/service.js';
import { CategoryResolver, normalizeExeName } from '../activity/categorize.js';
import type { AgentLogDoc, AppSessionDoc, InactivityDoc } from '../../db/types.js';
import { markAttendanceDirty } from '../attendance/service.js';

/**
 * The agent-facing API. Everything an endpoint does passes through here.
 */

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

/**
 * Trades one-time employee credentials for a durable device identity.
 *
 * The password is verified once and then discarded — the agent never stores
 * it, so a stolen laptop yields a revocable device secret rather than a
 * reusable human credential.
 */
export async function enroll(
  userId: string,
  password: string,
  device: DeviceInfo,
): Promise<{ response: EnrollResponse; deviceId: ObjectId; organizationId: ObjectId }> {
  const credential = await collections.employeeCredentials().findOne({ userId: userId.trim() });

  const invalid = ApiError.unauthorized('Invalid user ID or password', 'INVALID_CREDENTIALS');
  if (!credential) {
    // Equalize timing against the "user exists" path so enrollment cannot be
    // used to discover valid user IDs.
    await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    throw invalid;
  }

  if (!(await verifyPassword(password, credential.passwordHash))) throw invalid;

  if (credential.status !== EntityStatus.Active) {
    throw ApiError.forbidden('These credentials have been revoked', 'CREDENTIALS_REVOKED');
  }

  const employee = await collections.employees().findOne({ _id: credential.employeeId });
  if (!employee) throw ApiError.notFound('Employee');
  if (employee.status !== EntityStatus.Active) {
    throw ApiError.forbidden('Employee account is not active', 'CREDENTIALS_REVOKED');
  }

  const organization = await collections.organizations().findOne({ _id: employee.organizationId });
  if (!organization) throw ApiError.notFound('Organization');

  const deviceSecret = randomToken(32);
  const now = new Date();

  // Re-enrolling the same machine must not accumulate duplicate devices, so we
  // key on (employee, hostname) and rotate the secret in place.
  const existing = await collections.devices().findOne({
    organizationId: employee.organizationId,
    employeeId: employee._id,
    hostname: device.hostname,
  });

  const deviceId = existing?._id ?? new ObjectId();

  await collections.devices().updateOne(
    { _id: deviceId },
    {
      $set: {
        organizationId: employee.organizationId,
        employeeId: employee._id,
        secretHash: hashToken(deviceSecret),
        hostname: device.hostname,
        os: device.os,
        osVersion: device.osVersion,
        arch: device.arch,
        cpu: device.cpu ?? null,
        cpuCores: device.cpuCores ?? null,
        ramMb: device.ramMb ?? null,
        agentVersion: device.agentVersion,
        // Re-enrollment reactivates a previously revoked machine only because
        // valid credentials were presented again.
        status: EntityStatus.Active,
        updatedAt: now,
      },
      $setOnInsert: {
        lastSeenAt: null,
        lastReportedState: null,
        currentApplication: null,
        stateSince: null,
        enrolledAt: now,
      },
    },
    { upsert: true },
  );

  await collections
    .employeeCredentials()
    .updateOne({ _id: credential._id }, { $set: { lastLoginAt: now, updatedAt: now } });

  const config = await getAgentConfig(employee.organizationId);
  const access = await signAgentAccessToken({
    deviceId: deviceId.toHexString(),
    organizationId: employee.organizationId.toHexString(),
    employeeId: employee._id.toHexString(),
  });

  return {
    deviceId,
    organizationId: employee.organizationId,
    response: {
      deviceId: deviceId.toHexString(),
      deviceSecret,
      employee: {
        id: employee._id.toHexString(),
        name: employee.name,
        organizationId: organization._id.toHexString(),
        organizationName: organization.name,
      },
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      config,
    },
  };
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeToken(
  deviceIdHex: string,
  deviceSecret: string,
): Promise<{ accessToken: string; accessTokenExpiresAt: string; configVersion: number }> {
  if (!ObjectId.isValid(deviceIdHex)) {
    throw ApiError.unauthorized('Unknown device', 'DEVICE_UNKNOWN');
  }

  const device = await collections.devices().findOne({ _id: new ObjectId(deviceIdHex) });
  if (!device) throw ApiError.unauthorized('Unknown device', 'DEVICE_UNKNOWN');

  if (device.status !== EntityStatus.Active) {
    throw ApiError.forbidden('Device has been revoked', 'DEVICE_REVOKED');
  }

  // Secrets are high-entropy, so a hash comparison is sufficient and fast.
  if (hashToken(deviceSecret) !== device.secretHash) {
    throw ApiError.unauthorized('Invalid device secret', 'INVALID_CREDENTIALS');
  }

  const [access, config] = await Promise.all([
    signAgentAccessToken({
      deviceId: device._id.toHexString(),
      organizationId: device.organizationId.toHexString(),
      employeeId: device.employeeId.toHexString(),
    }),
    getAgentConfig(device.organizationId),
  ]);

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    configVersion: config.configVersion,
  };
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export async function heartbeat(
  identity: { deviceId: ObjectId; employeeId: ObjectId; organizationId: ObjectId },
  body: HeartbeatRequest,
): Promise<{ configVersion: number; serverTime: string }> {
  const now = new Date();
  const state = body.status as PresenceState;
  const currentApplication = body.currentApplication ?? null;

  const { changed } = presence.record({
    deviceId: identity.deviceId,
    employeeId: identity.employeeId,
    organizationId: identity.organizationId,
    state,
    currentApplication,
    at: now,
  });

  const deviceUpdate: Record<string, unknown> = {
    lastSeenAt: now,
    lastReportedState: state,
    currentApplication,
    agentVersion: body.agentVersion,
    updatedAt: now,
  };
  // Only stamp stateSince on a genuine transition, so the dashboard's
  // "active for" clock is not reset by every 30-second heartbeat.
  if (changed) deviceUpdate.stateSince = now;

  const [config] = await Promise.all([
    getAgentConfig(identity.organizationId),
    collections.devices().updateOne({ _id: identity.deviceId }, { $set: deviceUpdate }),
    collections.heartbeats().insertOne({
      ts: now,
      meta: {
        organizationId: identity.organizationId,
        employeeId: identity.employeeId,
        deviceId: identity.deviceId,
      },
      state,
      idleSeconds: body.idleSeconds,
      currentApplication,
      agentVersion: body.agentVersion,
      queueDepth: body.queueDepth ?? null,
    }),
  ]);

  // A heartbeat proves presence, which is what "first seen / last seen" on the
  // attendance row means — so it must extend the day even with no telemetry.
  markAttendanceDirty(identity.organizationId, identity.employeeId, toDateKey(now));

  return { configVersion: config.configVersion, serverTime: now.toISOString() };
}

// ---------------------------------------------------------------------------
// Telemetry ingest
// ---------------------------------------------------------------------------

/**
 * Accepts a batch of completed spans.
 *
 * Ingest is idempotent on `eventId`: an agent that loses its connection
 * mid-upload replays the same batch, and duplicates must be counted, not
 * stored twice. That is enforced by unique indexes plus `ordered: false`
 * bulk writes, so one duplicate cannot abort the rest of the batch.
 */
export async function ingestTelemetry(
  identity: { deviceId: ObjectId; employeeId: ObjectId; organizationId: ObjectId },
  body: TelemetryRequest,
): Promise<TelemetryResponse> {
  const now = new Date();
  const rejected: Array<{ eventId: string; reason: string }> = [];
  const touchedDays = new Set<string>();

  const appOps: AnyBulkWriteOperation<AppSessionDoc>[] = [];
  const idleOps: AnyBulkWriteOperation<InactivityDoc>[] = [];
  const logOps: AnyBulkWriteOperation<AgentLogDoc>[] = [];

  const resolver = new CategoryResolver(identity.organizationId);

  for (const event of body.events) {
    const validation = validateEvent(event);
    if (validation) {
      rejected.push({ eventId: event.eventId, reason: validation });
      continue;
    }

    switch (event.type) {
      case 'app_session': {
        const startedAt = new Date(event.startedAt);
        const dateKey = toDateKey(startedAt);
        const exeName = normalizeExeName(event.exeName);

        appOps.push({
          insertOne: {
            document: {
              _id: new ObjectId(),
              organizationId: identity.organizationId,
              employeeId: identity.employeeId,
              deviceId: identity.deviceId,
              eventId: event.eventId,
              appName: event.appName,
              exeName,
              windowTitle: event.windowTitle ?? null,
              category: await resolver.resolve(exeName),
              startedAt,
              endedAt: new Date(event.endedAt),
              durationSec: event.durationSec,
              dateKey,
              createdAt: now,
            },
          },
        });
        touchedDays.add(dateKey);
        break;
      }

      case 'inactivity': {
        const startedAt = new Date(event.startedAt);
        const dateKey = toDateKey(startedAt);

        idleOps.push({
          insertOne: {
            document: {
              _id: new ObjectId(),
              organizationId: identity.organizationId,
              employeeId: identity.employeeId,
              deviceId: identity.deviceId,
              eventId: event.eventId,
              kind: event.kind,
              startedAt,
              endedAt: new Date(event.endedAt),
              durationSec: event.durationSec,
              dateKey,
              createdAt: now,
            },
          },
        });
        touchedDays.add(dateKey);
        break;
      }

      case 'agent_log': {
        logOps.push({
          insertOne: {
            document: {
              _id: new ObjectId(),
              organizationId: identity.organizationId,
              employeeId: identity.employeeId,
              deviceId: identity.deviceId,
              eventId: event.eventId,
              level: event.level,
              message: event.message,
              occurredAt: new Date(event.occurredAt),
              createdAt: now,
            },
          },
        });
        break;
      }
    }
  }

  const [appResult, idleResult, logResult] = await Promise.all([
    bulkWriteIgnoringDuplicates(collections.appSessions(), appOps),
    bulkWriteIgnoringDuplicates(collections.inactivity(), idleOps),
    bulkWriteIgnoringDuplicates(collections.agentLogs(), logOps),
  ]);

  for (const dateKey of touchedDays) {
    markAttendanceDirty(identity.organizationId, identity.employeeId, dateKey);
  }

  const accepted = appResult.inserted + idleResult.inserted + logResult.inserted;
  const duplicates = appResult.duplicates + idleResult.duplicates + logResult.duplicates;

  return {
    ok: true,
    accepted,
    duplicates,
    rejected,
    serverTime: now.toISOString(),
  };
}

/** Returns a rejection reason, or null when the event is acceptable. */
function validateEvent(event: TelemetryEvent): string | null {
  if (event.type === 'agent_log') return null;

  const startedAt = new Date(event.startedAt);
  const endedAt = new Date(event.endedAt);

  if (endedAt < startedAt) return 'endedAt precedes startedAt';

  // Clocks on endpoints drift and can be wrong outright. A span claiming to
  // end in the future would corrupt "active time today", so we reject it
  // rather than silently clamping and reporting impossible totals.
  const skewMs = endedAt.getTime() - Date.now();
  if (skewMs > 5 * 60 * 1000) return 'endedAt is in the future';

  const actualSec = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
  if (Math.abs(actualSec - event.durationSec) > 5) return 'durationSec disagrees with timestamps';

  return null;
}

interface BulkOutcome {
  inserted: number;
  duplicates: number;
}

/**
 * Duplicate keys are the expected outcome of a queue replay, not an error.
 * `ordered: false` lets the non-duplicate documents in the same batch land.
 */
async function bulkWriteIgnoringDuplicates<T extends Document>(
  collection: Collection<T>,
  ops: AnyBulkWriteOperation<T>[],
): Promise<BulkOutcome> {
  if (ops.length === 0) return { inserted: 0, duplicates: 0 };

  try {
    const result = await collection.bulkWrite(ops, { ordered: false });
    return { inserted: result.insertedCount, duplicates: ops.length - result.insertedCount };
  } catch (error) {
    const bulkError = error as {
      code?: number;
      writeErrors?: Array<{ code: number }>;
      result?: { insertedCount?: number; nInserted?: number };
    };

    const writeErrors = bulkError.writeErrors ?? [];
    const duplicates = writeErrors.filter((e) => e.code === 11000).length;

    // Anything other than duplicate keys is a genuine failure.
    if (duplicates !== writeErrors.length) throw error;

    const inserted = bulkError.result?.insertedCount ?? bulkError.result?.nInserted ?? ops.length - duplicates;
    return { inserted, duplicates };
  }
}
