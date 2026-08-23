import { ObjectId } from 'mongodb';
import type { FastifyInstance } from 'fastify';
import { AppCategory, EntityStatus, Role } from '@workpulse/shared';
import { collections, resetTestDatabase } from '../src/db/client.js';
import { syncIndexes } from '../src/db/indexes.js';
import { getDb } from '../src/db/client.js';
import { hashPassword } from '../src/lib/crypto.js';
import { presence } from '../src/services/presence.js';
import { buildApp } from '../src/app.js';

/**
 * Fixtures for the integration suite.
 *
 * Every test file starts from a clean database. That is slower than sharing
 * state, but it means a failure points at the test that caused it rather than
 * at whatever ran before it.
 */

export interface TestOrg {
  organizationId: ObjectId;
  departmentId: ObjectId;
  otherDepartmentId: ObjectId;
  ownerId: ObjectId;
  ownerEmail: string;
  ownerPassword: string;
}

export const TEST_PASSWORD = 'TestPassw0rd!';

/** Wipes the (guarded) test database and rebuilds indexes. */
export async function resetDatabase(): Promise<void> {
  await resetTestDatabase();
  await syncIndexes(getDb());
  presence.clear();
}

export async function createApp(
  options: { rateLimit?: boolean } = {},
): Promise<FastifyInstance> {
  const app = await buildApp(options);
  await app.ready();
  return app;
}

export async function seedOrganization(name = 'Test Org'): Promise<TestOrg> {
  const now = new Date();
  const organizationId = new ObjectId();
  const slug = `${name.toLowerCase().replace(/\W+/g, '-')}-${organizationId.toHexString().slice(-6)}`;

  await collections.organizations().insertOne({
    _id: organizationId,
    name,
    slug,
    createdAt: now,
    updatedAt: now,
  });

  const departmentId = new ObjectId();
  const otherDepartmentId = new ObjectId();
  await collections.departments().insertMany([
    { _id: departmentId, organizationId, name: 'Engineering', createdAt: now },
    { _id: otherDepartmentId, organizationId, name: 'Design', createdAt: now },
  ]);

  const ownerId = new ObjectId();
  const ownerEmail = `owner-${organizationId.toHexString().slice(-6)}@test.local`;

  await collections.users().insertOne({
    _id: ownerId,
    organizationId,
    email: ownerEmail,
    name: 'Test Owner',
    passwordHash: await hashPassword(TEST_PASSWORD),
    role: Role.OrgOwner,
    departmentId: null,
    status: EntityStatus.Active,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    organizationId,
    departmentId,
    otherDepartmentId,
    ownerId,
    ownerEmail,
    ownerPassword: TEST_PASSWORD,
  };
}

export async function createAdmin(
  organizationId: ObjectId,
  role: Role,
  departmentId: ObjectId | null = null,
): Promise<{ id: ObjectId; email: string; password: string }> {
  const now = new Date();
  const id = new ObjectId();
  const email = `${role.toLowerCase()}-${id.toHexString().slice(-6)}@test.local`;

  await collections.users().insertOne({
    _id: id,
    organizationId,
    email,
    name: `Test ${role}`,
    passwordHash: await hashPassword(TEST_PASSWORD),
    role,
    departmentId,
    status: EntityStatus.Active,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return { id, email, password: TEST_PASSWORD };
}

export async function createEmployee(
  organizationId: ObjectId,
  overrides: { name?: string; departmentId?: ObjectId | null } = {},
): Promise<ObjectId> {
  const now = new Date();
  const id = new ObjectId();

  await collections.employees().insertOne({
    _id: id,
    organizationId,
    name: overrides.name ?? `Employee ${id.toHexString().slice(-4)}`,
    email: `emp-${id.toHexString().slice(-8)}@test.local`,
    jobTitle: 'Engineer',
    departmentId: overrides.departmentId ?? null,
    managerId: null,
    status: EntityStatus.Active,
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function createAppCategory(
  organizationId: ObjectId,
  exeName: string,
  category: AppCategory,
): Promise<void> {
  await collections.appCategories().insertOne({
    _id: new ObjectId(),
    organizationId,
    exeName: exeName.toLowerCase(),
    displayName: exeName,
    category,
    updatedAt: new Date(),
  });
}

/** Logs an admin in and returns the bearer token plus the refresh cookie. */
export async function loginAdmin(
  app: FastifyInstance,
  email: string,
  password = TEST_PASSWORD,
): Promise<{ token: string; cookie: string; userId: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`login failed (${response.statusCode}): ${response.body}`);
  }

  const body = response.json() as { accessToken: string; user: { id: string } };
  const setCookie = response.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie[0] ?? '' : setCookie ?? '';

  return { token: body.accessToken, cookie: cookie.split(';')[0] ?? '', userId: body.user.id };
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Deterministic ISO timestamps for building telemetry spans. */
export function isoAt(base: Date, offsetSec: number): string {
  return new Date(base.getTime() + offsetSec * 1000).toISOString();
}

export function eventId(prefix = 'evt'): string {
  return `${prefix}-${new ObjectId().toHexString()}`;
}
