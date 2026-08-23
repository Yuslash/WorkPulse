import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ObjectId } from 'mongodb';
import { Role } from '@workpulse/shared';
import {
  authHeader,
  createAdmin,
  createApp,
  createEmployee,
  loginAdmin,
  resetDatabase,
  seedOrganization,
  type TestOrg,
} from '../factories.js';

/**
 * Authorization is the security boundary of a product that holds detailed
 * records of what people did all day. These tests assert the two failures
 * that would matter most: seeing another tenant's data, and a lower-privileged
 * admin performing a privileged action.
 */
describe('RBAC and tenant isolation', () => {
  let app: FastifyInstance;
  let orgA: TestOrg;
  let orgB: TestOrg;

  let employeeInA: ObjectId;
  let employeeInB: ObjectId;
  let engineeringEmployee: ObjectId;
  let designEmployee: ObjectId;

  beforeAll(async () => {
    await resetDatabase();
    app = await createApp();

    orgA = await seedOrganization('Org A');
    orgB = await seedOrganization('Org B');

    employeeInA = await createEmployee(orgA.organizationId, { name: 'Alice in A' });
    employeeInB = await createEmployee(orgB.organizationId, { name: 'Bob in B' });

    engineeringEmployee = await createEmployee(orgA.organizationId, {
      name: 'Eng Person',
      departmentId: orgA.departmentId,
    });
    designEmployee = await createEmployee(orgA.organizationId, {
      name: 'Design Person',
      departmentId: orgA.otherDepartmentId,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('tenant isolation', () => {
    it('lists only the caller organization employees', async () => {
      const { token } = await loginAdmin(app, orgA.ownerEmail);

      const response = await app.inject({
        method: 'GET',
        url: '/api/employees?limit=100',
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(200);
      const names = response.json().items.map((item: { name: string }) => item.name);

      expect(names).toContain('Alice in A');
      expect(names).not.toContain('Bob in B');
    });

    it('returns 404, not 403, for an employee in another organization', async () => {
      const { token } = await loginAdmin(app, orgA.ownerEmail);

      // 404 rather than 403 so the response does not confirm that the id
      // exists somewhere in the system.
      const response = await app.inject({
        method: 'GET',
        url: `/api/employees/${employeeInB.toHexString()}`,
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(404);
    });

    it('refuses to issue credentials for another organization employee', async () => {
      const { token } = await loginAdmin(app, orgA.ownerEmail);

      const response = await app.inject({
        method: 'POST',
        url: `/api/employees/${employeeInB.toHexString()}/credentials`,
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(404);
    });

    it('refuses to read another organization timeline', async () => {
      const { token } = await loginAdmin(app, orgA.ownerEmail);

      const response = await app.inject({
        method: 'GET',
        url: `/api/activity/timeline/${employeeInB.toHexString()}`,
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(404);
    });

    it('scopes the overview counters to one organization', async () => {
      const { token } = await loginAdmin(app, orgB.ownerEmail);

      const response = await app.inject({
        method: 'GET',
        url: '/api/overview',
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(200);
      // Org B has exactly the one employee created above.
      expect(response.json().employees).toBe(1);
    });
  });

  describe('department scoping', () => {
    it('restricts a MANAGER to their own department', async () => {
      const manager = await createAdmin(orgA.organizationId, Role.Manager, orgA.departmentId);
      const { token } = await loginAdmin(app, manager.email);

      const response = await app.inject({
        method: 'GET',
        url: '/api/employees?limit=100',
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(200);
      const names = response.json().items.map((item: { name: string }) => item.name);

      expect(names).toContain('Eng Person');
      expect(names).not.toContain('Design Person');
      // Employees with no department are also outside a scoped manager's view.
      expect(names).not.toContain('Alice in A');
    });

    it('blocks a MANAGER from reading an employee outside their department', async () => {
      const manager = await createAdmin(orgA.organizationId, Role.Manager, orgA.departmentId);
      const { token } = await loginAdmin(app, manager.email);

      const response = await app.inject({
        method: 'GET',
        url: `/api/employees/${designEmployee.toHexString()}`,
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(404);
    });

    it('lets an HR_ADMIN see the whole organization', async () => {
      const hr = await createAdmin(orgA.organizationId, Role.HrAdmin);
      const { token } = await loginAdmin(app, hr.email);

      const response = await app.inject({
        method: 'GET',
        url: '/api/employees?limit=100',
        headers: authHeader(token),
      });

      const names = response.json().items.map((item: { name: string }) => item.name);
      expect(names).toContain('Eng Person');
      expect(names).toContain('Design Person');
    });

    it('shows nothing to a department-scoped admin with no department', async () => {
      // The safe failure direction: an unassigned manager sees nobody rather
      // than everybody.
      const manager = await createAdmin(orgA.organizationId, Role.Manager, null);
      const { token } = await loginAdmin(app, manager.email);

      const response = await app.inject({
        method: 'GET',
        url: '/api/employees?limit=100',
        headers: authHeader(token),
      });

      expect(response.json().items).toHaveLength(0);
    });
  });

  describe('role requirements', () => {
    it('denies a TEAM_LEAD the ability to create employees', async () => {
      const lead = await createAdmin(orgA.organizationId, Role.TeamLead, orgA.departmentId);
      const { token } = await loginAdmin(app, lead.email);

      const response = await app.inject({
        method: 'POST',
        url: '/api/employees',
        headers: authHeader(token),
        payload: { name: 'Should Fail', email: 'fail@test.local' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('denies a MANAGER the ability to issue credentials', async () => {
      const manager = await createAdmin(orgA.organizationId, Role.Manager, orgA.departmentId);
      const { token } = await loginAdmin(app, manager.email);

      const response = await app.inject({
        method: 'POST',
        url: `/api/employees/${engineeringEmployee.toHexString()}/credentials`,
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(403);
    });

    it('denies an HR_ADMIN the ability to change collection policy', async () => {
      // Policy decides what every endpoint records, so it is ORG_OWNER only.
      const hr = await createAdmin(orgA.organizationId, Role.HrAdmin);
      const { token } = await loginAdmin(app, hr.email);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/policies',
        headers: authHeader(token),
        payload: { trackScreenshots: true },
      });

      expect(response.statusCode).toBe(403);
    });

    it('allows an ORG_OWNER to change policy and bumps the config version', async () => {
      const { token } = await loginAdmin(app, orgA.ownerEmail);

      const before = await app.inject({
        method: 'GET',
        url: '/api/policies',
        headers: authHeader(token),
      });
      const beforeVersion = before.json().configVersion;

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/policies',
        headers: authHeader(token),
        payload: { idleThresholdSec: 900 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().idleThresholdSec).toBe(900);
      // The bump is what tells every agent to re-fetch its config.
      expect(response.json().configVersion).toBe(beforeVersion + 1);
    });

    it('denies a MANAGER the ability to read the audit trail', async () => {
      const manager = await createAdmin(orgA.organizationId, Role.Manager, orgA.departmentId);
      const { token } = await loginAdmin(app, manager.email);

      const response = await app.inject({
        method: 'GET',
        url: '/api/audit',
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(403);
    });

    it('shows an HR_ADMIN only their own organization audit entries', async () => {
      const hr = await createAdmin(orgA.organizationId, Role.HrAdmin);
      const { token } = await loginAdmin(app, hr.email);

      const response = await app.inject({
        method: 'GET',
        url: '/api/audit?limit=200',
        headers: authHeader(token),
      });

      expect(response.statusCode).toBe(200);
      const actors = response.json().items.map((item: { actorName: string }) => item.actorName);
      expect(actors).not.toContain('Org B');
    });
  });

  it('records that an employee record was viewed', async () => {
    const { token, userId } = await loginAdmin(app, orgA.ownerEmail);

    await app.inject({
      method: 'GET',
      url: `/api/employees/${employeeInA.toHexString()}`,
      headers: authHeader(token),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/audit?action=employee.viewed&limit=50',
      headers: authHeader(token),
    });

    const entries = response.json().items as Array<{ targetId: string; actorId: string }>;
    const match = entries.find((entry) => entry.targetId === employeeInA.toHexString());

    expect(match).toBeTruthy();
    expect(match!.actorId).toBe(userId);
  });
});
