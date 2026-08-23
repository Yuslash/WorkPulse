import type { FastifyInstance } from 'fastify';
import { Role, auditListQuerySchema } from '@workpulse/shared';
import { adminOf } from '../../plugins/auth.js';
import * as auditService from './service.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  /**
   * The audit trail exposes who looked at whom, so reading it is itself a
   * privileged action — restricted to HR_ADMIN and above rather than any
   * signed-in admin.
   */
  app.get('/', { preHandler: app.requireRole(Role.HrAdmin) }, async (request) => {
    const admin = adminOf(request);
    const query = auditListQuerySchema.parse(request.query);

    return auditService.listAuditLogs(admin.organizationId, {
      page: query.page,
      limit: query.limit,
      action: query.action,
      actorId: query.actorId,
    });
  });
}
