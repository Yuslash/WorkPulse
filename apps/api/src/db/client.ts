import { MongoClient, type Db } from 'mongodb';
import { env } from '../config/env.js';
import type {
  AgentLogDoc,
  AppCategoryDoc,
  AppSessionDoc,
  AttendanceDayDoc,
  AuditLogDoc,
  DepartmentDoc,
  DeviceDoc,
  EmployeeCredentialDoc,
  EmployeeDoc,
  HeartbeatDoc,
  InactivityDoc,
  OrganizationDoc,
  PolicyDoc,
  RefreshTokenDoc,
  UserDoc,
} from './types.js';

/**
 * A single MongoClient for the process. The driver pools internally, so
 * opening more than one connection per process is wasted file descriptors.
 */

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectDatabase(): Promise<Db> {
  if (database) return database;

  client = new MongoClient(env.MONGODB_URI, {
    // Atlas free tiers are latency-prone; fail fast rather than hanging a request.
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 20,
    retryWrites: true,
  });

  await client.connect();
  database = client.db(env.databaseName);
  return database;
}

export function getDb(): Db {
  if (!database) {
    throw new Error('Database not connected. Call connectDatabase() first.');
  }
  return database;
}

export async function closeDatabase(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}

/**
 * Drops every WorkPulse collection. Guarded so it can only ever fire against
 * the configured test database — the shared cluster holds unrelated
 * production data and a stray call here would be unrecoverable.
 */
export async function resetTestDatabase(): Promise<void> {
  const db = getDb();
  if (db.databaseName !== env.MONGODB_TEST_DB) {
    throw new Error(
      `refusing to reset "${db.databaseName}" — only "${env.MONGODB_TEST_DB}" may be reset`,
    );
  }

  const existing = await db.listCollections({}, { nameOnly: true }).toArray();
  await Promise.all(existing.map((c) => db.dropCollection(c.name).catch(() => undefined)));
}

export const COLLECTIONS = {
  organizations: 'organizations',
  departments: 'departments',
  users: 'users',
  employees: 'employees',
  employeeCredentials: 'employeeCredentials',
  devices: 'devices',
  policies: 'policies',
  appSessions: 'appSessions',
  inactivity: 'inactivity',
  heartbeats: 'heartbeats',
  attendanceDaily: 'attendanceDaily',
  appCategories: 'appCategories',
  auditLogs: 'auditLogs',
  agentLogs: 'agentLogs',
  refreshTokens: 'refreshTokens',
} as const;

/** Typed accessors — the only sanctioned way to reach a collection. */
export const collections = {
  organizations: () => getDb().collection<OrganizationDoc>(COLLECTIONS.organizations),
  departments: () => getDb().collection<DepartmentDoc>(COLLECTIONS.departments),
  users: () => getDb().collection<UserDoc>(COLLECTIONS.users),
  employees: () => getDb().collection<EmployeeDoc>(COLLECTIONS.employees),
  employeeCredentials: () =>
    getDb().collection<EmployeeCredentialDoc>(COLLECTIONS.employeeCredentials),
  devices: () => getDb().collection<DeviceDoc>(COLLECTIONS.devices),
  policies: () => getDb().collection<PolicyDoc>(COLLECTIONS.policies),
  appSessions: () => getDb().collection<AppSessionDoc>(COLLECTIONS.appSessions),
  inactivity: () => getDb().collection<InactivityDoc>(COLLECTIONS.inactivity),
  heartbeats: () => getDb().collection<HeartbeatDoc>(COLLECTIONS.heartbeats),
  attendanceDaily: () => getDb().collection<AttendanceDayDoc>(COLLECTIONS.attendanceDaily),
  appCategories: () => getDb().collection<AppCategoryDoc>(COLLECTIONS.appCategories),
  auditLogs: () => getDb().collection<AuditLogDoc>(COLLECTIONS.auditLogs),
  agentLogs: () => getDb().collection<AgentLogDoc>(COLLECTIONS.agentLogs),
  refreshTokens: () => getDb().collection<RefreshTokenDoc>(COLLECTIONS.refreshTokens),
};

export type Collections = {
  [K in keyof typeof collections]: ReturnType<(typeof collections)[K]>;
};
