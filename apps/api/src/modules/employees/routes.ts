import type { FastifyInstance } from 'fastify';
import {
  AuditAction,
  Role,
  createEmployeeSchema,
  employeeListQuerySchema,
  updateEmployeeSchema,
} from '@workpulse/shared';
import { adminOf } from '../../plugins/auth.js';
import { toObjectId } from '../../lib/ids.js';
import { recordAudit } from '../audit/service.js';
import * as employeeService from './service.js';

export async function employeeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const query = employeeListQuerySchema.parse(request.query);
    return employeeService.listEmployees(admin, query);
  });

  app.get('/:id', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { id: string }).id, 'employee id');
    const employee = await employeeService.getEmployee(admin, employeeId);

    // Opening someone's record is itself auditable (spec §33).
    await recordAudit(request, admin, {
      action: AuditAction.EmployeeViewed,
      targetType: 'employee',
      targetId: employeeId,
      targetLabel: employee.name,
    });

    return employee;
  });

  app.post('/', { preHandler: app.requireRole(Role.HrAdmin) }, async (request, reply) => {
    const admin = adminOf(request);
    const body = createEmployeeSchema.parse(request.body);
    const employee = await employeeService.createEmployee(admin, body);

    await recordAudit(request, admin, {
      action: AuditAction.EmployeeCreated,
      targetType: 'employee',
      targetId: employee.id,
      targetLabel: employee.name,
    });

    return reply.status(201).send(employee);
  });

  app.patch('/:id', { preHandler: app.requireRole(Role.HrAdmin) }, async (request) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { id: string }).id, 'employee id');
    const body = updateEmployeeSchema.parse(request.body);
    const employee = await employeeService.updateEmployee(admin, employeeId, body);

    await recordAudit(request, admin, {
      action: AuditAction.EmployeeUpdated,
      targetType: 'employee',
      targetId: employeeId,
      targetLabel: employee.name,
      metadata: { fields: Object.keys(body) },
    });

    return employee;
  });

  // -------------------------------------------------------------------------
  // Credentials
  // -------------------------------------------------------------------------

  app.get('/:id/credentials', { preHandler: app.requireRole(Role.HrAdmin) }, async (request) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { id: string }).id, 'employee id');
    return employeeService.getCredentialStatus(admin, employeeId);
  });

  /**
   * Issues the one-time password. The response is the ONLY time the plaintext
   * exists outside the admin's screen, which is why this route is restricted
   * to HR_ADMIN and always audited.
   */
  app.post('/:id/credentials', { preHandler: app.requireRole(Role.HrAdmin) }, async (request, reply) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { id: string }).id, 'employee id');
    const credentials = await employeeService.generateCredentials(admin, employeeId);

    await recordAudit(request, admin, {
      action: AuditAction.CredentialsGenerated,
      targetType: 'employee',
      targetId: employeeId,
      targetLabel: credentials.userId,
      // Never record the password itself, not even hashed.
      metadata: { userId: credentials.userId },
    });

    return reply.status(201).send(credentials);
  });

  app.delete('/:id/credentials', { preHandler: app.requireRole(Role.HrAdmin) }, async (request) => {
    const admin = adminOf(request);
    const employeeId = toObjectId((request.params as { id: string }).id, 'employee id');
    await employeeService.revokeCredentials(admin, employeeId);

    await recordAudit(request, admin, {
      action: AuditAction.CredentialsRevoked,
      targetType: 'employee',
      targetId: employeeId,
    });

    return { ok: true };
  });

  app.post('/disconnect-confirm', async (request, reply) => {
    // Public endpoint for email link
    const { deviceId, employeeId, isAccident } = request.body as any;
    
    // Here we would typically record the reason to the database (e.g. Audit Log or Device timeline)
    console.log(`[API] Received disconnect confirm for device ${deviceId}, employee ${employeeId}. Accident: ${isAccident}`);

    return reply.status(200).send({ ok: true, message: 'Confirmation received.' });
  });
}
