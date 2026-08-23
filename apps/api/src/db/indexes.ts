import type { Db } from 'mongodb';
import { COLLECTIONS, getDb } from './client.js';

/**
 * Idempotent schema setup: a fresh clone plus `npm run db:indexes` yields a
 * working database. Called on API boot and by the test bootstrap, so it must
 * stay safe to run repeatedly against an already-populated database.
 */

const DAY_SEC = 86_400;

/** Heartbeats are high-volume and low-value after the fact. */
const HEARTBEAT_RETENTION_SEC = 30 * DAY_SEC;
const AGENT_LOG_RETENTION_SEC = 14 * DAY_SEC;
const AUDIT_RETENTION_SEC = 365 * DAY_SEC;
const REFRESH_TOKEN_GRACE_SEC = 0;

async function ensureTimeSeriesCollection(db: Db): Promise<void> {
  const existing = await db
    .listCollections({ name: COLLECTIONS.heartbeats }, { nameOnly: true })
    .toArray();
  if (existing.length > 0) return;

  // Time-series buckets heartbeats by device, which is exactly how we read
  // them back (one device's recent history), and compresses far better than a
  // regular collection would at 2 writes/minute/device.
  await db.createCollection(COLLECTIONS.heartbeats, {
    timeseries: {
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'seconds',
    },
    expireAfterSeconds: HEARTBEAT_RETENTION_SEC,
  });
}

export async function syncIndexes(db: Db = getDb()): Promise<void> {
  await ensureTimeSeriesCollection(db);

  await Promise.all([
    db.collection(COLLECTIONS.organizations).createIndexes([
      { key: { slug: 1 }, name: 'slug_unique', unique: true },
    ]),

    db.collection(COLLECTIONS.departments).createIndexes([
      { key: { organizationId: 1, name: 1 }, name: 'org_name_unique', unique: true },
    ]),

    db.collection(COLLECTIONS.users).createIndexes([
      // Admins log in by email alone, so this is unique globally, not per-org.
      { key: { email: 1 }, name: 'email_unique', unique: true },
      { key: { organizationId: 1, role: 1 }, name: 'org_role' },
    ]),

    db.collection(COLLECTIONS.employees).createIndexes([
      { key: { organizationId: 1, email: 1 }, name: 'org_email_unique', unique: true },
      { key: { organizationId: 1, status: 1 }, name: 'org_status' },
      { key: { organizationId: 1, departmentId: 1 }, name: 'org_department' },
      // Powers the employee search box.
      { key: { organizationId: 1, name: 1 }, name: 'org_name' },
    ]),

    db.collection(COLLECTIONS.employeeCredentials).createIndexes([
      { key: { userId: 1 }, name: 'user_id_unique', unique: true },
      { key: { employeeId: 1 }, name: 'employee_unique', unique: true },
      { key: { organizationId: 1 }, name: 'org' },
    ]),

    db.collection(COLLECTIONS.devices).createIndexes([
      { key: { organizationId: 1, employeeId: 1 }, name: 'org_employee' },
      { key: { organizationId: 1, status: 1 }, name: 'org_status' },
      // The presence sweeper scans by lastSeenAt across all live devices.
      { key: { status: 1, lastSeenAt: 1 }, name: 'status_last_seen' },
      { key: { organizationId: 1, agentVersion: 1 }, name: 'org_agent_version' },
    ]),

    db.collection(COLLECTIONS.policies).createIndexes([
      { key: { organizationId: 1 }, name: 'org_unique', unique: true },
    ]),

    db.collection(COLLECTIONS.appSessions).createIndexes([
      // Idempotent ingest: a replayed queue re-sends the same eventIds.
      { key: { eventId: 1 }, name: 'event_id_unique', unique: true },
      { key: { organizationId: 1, employeeId: 1, startedAt: -1 }, name: 'org_employee_started' },
      { key: { organizationId: 1, employeeId: 1, dateKey: 1 }, name: 'org_employee_date' },
      { key: { organizationId: 1, dateKey: 1 }, name: 'org_date' },
      { key: { deviceId: 1, startedAt: -1 }, name: 'device_started' },
    ]),

    db.collection(COLLECTIONS.inactivity).createIndexes([
      { key: { eventId: 1 }, name: 'event_id_unique', unique: true },
      { key: { organizationId: 1, employeeId: 1, startedAt: -1 }, name: 'org_employee_started' },
      { key: { organizationId: 1, employeeId: 1, dateKey: 1 }, name: 'org_employee_date' },
    ]),

    db.collection(COLLECTIONS.attendanceDaily).createIndexes([
      { key: { employeeId: 1, dateKey: 1 }, name: 'employee_date_unique', unique: true },
      { key: { organizationId: 1, dateKey: 1 }, name: 'org_date' },
    ]),

    db.collection(COLLECTIONS.appCategories).createIndexes([
      { key: { organizationId: 1, exeName: 1 }, name: 'org_exe_unique', unique: true },
    ]),

    db.collection(COLLECTIONS.auditLogs).createIndexes([
      { key: { organizationId: 1, createdAt: -1 }, name: 'org_created' },
      { key: { organizationId: 1, action: 1, createdAt: -1 }, name: 'org_action_created' },
      { key: { actorId: 1, createdAt: -1 }, name: 'actor_created' },
      { key: { createdAt: 1 }, name: 'ttl', expireAfterSeconds: AUDIT_RETENTION_SEC },
    ]),

    db.collection(COLLECTIONS.agentLogs).createIndexes([
      { key: { eventId: 1 }, name: 'event_id_unique', unique: true },
      { key: { organizationId: 1, deviceId: 1, occurredAt: -1 }, name: 'org_device_occurred' },
      { key: { createdAt: 1 }, name: 'ttl', expireAfterSeconds: AGENT_LOG_RETENTION_SEC },
    ]),

    db.collection(COLLECTIONS.refreshTokens).createIndexes([
      { key: { tokenHash: 1 }, name: 'token_hash_unique', unique: true },
      { key: { subjectType: 1, subjectId: 1 }, name: 'subject' },
      // Mongo reaps expired tokens for us; no cleanup job needed.
      { key: { expiresAt: 1 }, name: 'ttl', expireAfterSeconds: REFRESH_TOKEN_GRACE_SEC },
    ]),
  ]);
}
