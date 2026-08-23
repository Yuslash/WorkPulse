import { ObjectId, type Filter } from 'mongodb';
import {
  EntityStatus,
  PresenceState,
  type CreateEmployeeRequest,
  type CredentialStatus,
  type Employee,
  type EmployeeListQuery,
  type GeneratedCredentials,
  type Paginated,
  type UpdateEmployeeRequest,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
import { generateEmployeeUserId, generateTempPassword, hashPassword } from '../../lib/crypto.js';
import { idToString } from '../../lib/ids.js';
import { presence } from '../../services/presence.js';
import { getTodayTotals } from '../attendance/service.js';
import { employeeScope } from '../../lib/scope.js';
import type { AdminIdentity } from '../../plugins/auth.js';
import type { EmployeeDoc } from '../../db/types.js';

/**
 * Employee directory plus the credential-issuing flow that is the entry point
 * for the whole product: an admin picks an employee, gets a userId and a
 * one-time password, and hands them over.
 */

interface EmployeeContext {
  departmentNames: Map<string, string>;
  deviceCounts: Map<string, number>;
  credentialed: Set<string>;
  todayTotals: Map<string, { activeSec: number; idleSec: number }>;
}

/**
 * Loads everything the list rows need in four queries regardless of page size.
 * Doing this per-employee would be an N+1 that shows up immediately on a
 * 128-person org.
 */
async function loadContext(
  organizationId: ObjectId,
  employees: EmployeeDoc[],
): Promise<EmployeeContext> {
  const employeeIds = employees.map((e) => e._id);
  const departmentIds = employees
    .map((e) => e.departmentId)
    .filter((id): id is ObjectId => id !== null);

  const [departments, deviceCounts, credentials, todayTotals] = await Promise.all([
    departmentIds.length > 0
      ? collections.departments().find({ _id: { $in: departmentIds } }).toArray()
      : Promise.resolve([]),
    employeeIds.length > 0
      ? collections
          .devices()
          .aggregate<{ _id: ObjectId; count: number }>([
            { $match: { organizationId, employeeId: { $in: employeeIds }, status: EntityStatus.Active } },
            { $group: { _id: '$employeeId', count: { $sum: 1 } } },
          ])
          .toArray()
      : Promise.resolve([]),
    employeeIds.length > 0
      ? collections
          .employeeCredentials()
          .find({ employeeId: { $in: employeeIds }, status: EntityStatus.Active })
          .project<{ employeeId: ObjectId }>({ employeeId: 1 })
          .toArray()
      : Promise.resolve([]),
    getTodayTotals(employeeIds),
  ]);

  return {
    departmentNames: new Map(departments.map((d) => [d._id.toHexString(), d.name])),
    deviceCounts: new Map(deviceCounts.map((d) => [d._id.toHexString(), d.count])),
    credentialed: new Set(credentials.map((c) => c.employeeId.toHexString())),
    todayTotals,
  };
}

function toDto(doc: EmployeeDoc, context: EmployeeContext): Employee {
  const id = doc._id.toHexString();
  const live = presence.forEmployee(id);
  const totals = context.todayTotals.get(id);

  return {
    id,
    organizationId: doc.organizationId.toHexString(),
    name: doc.name,
    email: doc.email,
    jobTitle: doc.jobTitle,
    departmentId: idToString(doc.departmentId),
    departmentName: doc.departmentId
      ? context.departmentNames.get(doc.departmentId.toHexString()) ?? null
      : null,
    managerId: idToString(doc.managerId),
    status: doc.status,
    hasCredentials: context.credentialed.has(id),
    deviceCount: context.deviceCounts.get(id) ?? 0,
    presence: {
      state: live?.state ?? PresenceState.Offline,
      currentApplication: live?.currentApplication ?? null,
      stateSinceSec: live ? Math.max(0, Math.round((Date.now() - live.stateSince.getTime()) / 1000)) : null,
      lastSeenAt: live?.lastSeenAt.toISOString() ?? null,
      deviceId: live?.deviceId ?? null,
    },
    todayActiveSec: totals?.activeSec ?? 0,
    todayIdleSec: totals?.idleSec ?? 0,
    createdAt: doc.createdAt.toISOString(),
  };
}

export async function listEmployees(
  admin: AdminIdentity,
  query: EmployeeListQuery,
): Promise<Paginated<Employee>> {
  const filter: Filter<EmployeeDoc> = employeeScope(admin);

  if (query.status) filter.status = query.status;
  if (query.departmentId && ObjectId.isValid(query.departmentId)) {
    filter.departmentId = new ObjectId(query.departmentId);
  }
  if (query.search) {
    // Escaped so a user typing "a.b" cannot inject a regex.
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { email: { $regex: escaped, $options: 'i' } },
    ];
  }

  const skip = (query.page - 1) * query.limit;
  const [docs, total] = await Promise.all([
    collections.employees().find(filter).sort({ name: 1 }).skip(skip).limit(query.limit).toArray(),
    collections.employees().countDocuments(filter),
  ]);

  const context = await loadContext(admin.organizationId, docs);
  let items = docs.map((doc) => toDto(doc, context));

  // Presence lives in memory, not Mongo, so it cannot participate in the
  // database query. Filtering here means the presence filter applies to the
  // current page; the dashboard's live board requests a large page for
  // exactly this reason.
  if (query.presence) {
    items = items.filter((item) => item.presence.state === query.presence);
  }

  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit),
  };
}

export async function getEmployee(admin: AdminIdentity, employeeId: ObjectId): Promise<Employee> {
  const doc = await collections
    .employees()
    .findOne({ ...employeeScope(admin), _id: employeeId } as Filter<EmployeeDoc>);

  if (!doc) throw ApiError.notFound('Employee');

  const context = await loadContext(admin.organizationId, [doc]);
  return toDto(doc, context);
}

export async function createEmployee(
  admin: AdminIdentity,
  input: CreateEmployeeRequest,
): Promise<Employee> {
  const now = new Date();
  const doc: EmployeeDoc = {
    _id: new ObjectId(),
    organizationId: admin.organizationId,
    name: input.name.trim(),
    email: input.email.toLowerCase().trim(),
    jobTitle: input.jobTitle?.trim() ?? null,
    departmentId: input.departmentId ? new ObjectId(input.departmentId) : null,
    managerId: input.managerId ? new ObjectId(input.managerId) : null,
    status: EntityStatus.Active,
    createdAt: now,
    updatedAt: now,
  };

  await collections.employees().insertOne(doc);

  const context = await loadContext(admin.organizationId, [doc]);
  return toDto(doc, context);
}

export async function updateEmployee(
  admin: AdminIdentity,
  employeeId: ObjectId,
  input: UpdateEmployeeRequest,
): Promise<Employee> {
  const changes: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined) changes.name = input.name.trim();
  if (input.email !== undefined) changes.email = input.email.toLowerCase().trim();
  if (input.jobTitle !== undefined) changes.jobTitle = input.jobTitle?.trim() ?? null;
  if (input.status !== undefined) changes.status = input.status;
  if (input.departmentId !== undefined) {
    changes.departmentId = input.departmentId ? new ObjectId(input.departmentId) : null;
  }
  if (input.managerId !== undefined) {
    changes.managerId = input.managerId ? new ObjectId(input.managerId) : null;
  }

  const result = await collections
    .employees()
    .updateOne({ ...employeeScope(admin), _id: employeeId } as Filter<EmployeeDoc>, { $set: changes });

  if (result.matchedCount === 0) throw ApiError.notFound('Employee');

  return getEmployee(admin, employeeId);
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * Issues (or re-issues) the employee's agent login.
 *
 * The plaintext password is returned exactly once and never stored — only its
 * scrypt hash lives in the database. Re-issuing rotates the password and
 * leaves the userId stable so an already-enrolled device keeps working: its
 * device secret is independent of the password by design.
 */
export async function generateCredentials(
  admin: AdminIdentity,
  employeeId: ObjectId,
): Promise<GeneratedCredentials> {
  const employee = await collections
    .employees()
    .findOne({ ...employeeScope(admin), _id: employeeId } as Filter<EmployeeDoc>);

  if (!employee) throw ApiError.notFound('Employee');
  if (employee.status !== EntityStatus.Active) {
    throw ApiError.conflict('Cannot issue credentials for an inactive employee');
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const now = new Date();

  const existing = await collections.employeeCredentials().findOne({ employeeId });

  if (existing) {
    await collections.employeeCredentials().updateOne(
      { _id: existing._id },
      {
        $set: {
          passwordHash,
          mustChangePassword: true,
          status: EntityStatus.Active,
          generatedBy: admin.userId,
          generatedAt: now,
          updatedAt: now,
        },
      },
    );

    return {
      userId: existing.userId,
      tempPassword,
      mustChangePassword: true,
      generatedAt: now.toISOString(),
    };
  }

  // userId is random, so collisions are possible but rare; retry on the
  // unique-index violation rather than pre-checking (which would race).
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const userId = generateEmployeeUserId();
    try {
      await collections.employeeCredentials().insertOne({
        _id: new ObjectId(),
        organizationId: admin.organizationId,
        employeeId,
        userId,
        passwordHash,
        mustChangePassword: true,
        status: EntityStatus.Active,
        lastLoginAt: null,
        generatedBy: admin.userId,
        generatedAt: now,
        updatedAt: now,
      });

      return { userId, tempPassword, mustChangePassword: true, generatedAt: now.toISOString() };
    } catch (error) {
      const isDuplicate = (error as { code?: number }).code === 11000;
      if (!isDuplicate) throw error;
    }
  }

  throw ApiError.internal('Could not allocate a unique user ID; please retry');
}

export async function getCredentialStatus(
  admin: AdminIdentity,
  employeeId: ObjectId,
): Promise<CredentialStatus> {
  const employee = await collections
    .employees()
    .findOne({ ...employeeScope(admin), _id: employeeId } as Filter<EmployeeDoc>);
  if (!employee) throw ApiError.notFound('Employee');

  const credential = await collections.employeeCredentials().findOne({ employeeId });

  if (!credential) {
    return {
      exists: false,
      userId: null,
      status: null,
      mustChangePassword: false,
      lastLoginAt: null,
      generatedAt: null,
    };
  }

  return {
    exists: true,
    userId: credential.userId,
    status: credential.status,
    mustChangePassword: credential.mustChangePassword,
    lastLoginAt: credential.lastLoginAt?.toISOString() ?? null,
    generatedAt: credential.generatedAt.toISOString(),
  };
}

/**
 * Revokes the login. Existing devices keep running on their own secrets —
 * revoking a person's ability to enroll new machines is a different action
 * from revoking the machines they already have.
 */
export async function revokeCredentials(
  admin: AdminIdentity,
  employeeId: ObjectId,
): Promise<void> {
  const employee = await collections
    .employees()
    .findOne({ ...employeeScope(admin), _id: employeeId } as Filter<EmployeeDoc>);
  if (!employee) throw ApiError.notFound('Employee');

  const result = await collections
    .employeeCredentials()
    .updateOne({ employeeId }, { $set: { status: EntityStatus.Revoked, updatedAt: new Date() } });

  if (result.matchedCount === 0) throw ApiError.notFound('Credentials');
}
