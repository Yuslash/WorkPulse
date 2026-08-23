import type { FastifyInstance } from 'fastify';
import { AuditAction, Role, deviceListQuerySchema } from '@workpulse/shared';
import { adminOf } from '../../plugins/auth.js';
import { toObjectId } from '../../lib/ids.js';
import { recordAudit } from '../audit/service.js';
import * as deviceService from './service.js';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    return deviceService.listDevices(admin, deviceListQuerySchema.parse(request.query));
  });

  app.get('/health', { preHandler: app.requireAdmin }, async (request) => {
    return deviceService.getAgentHealth(adminOf(request));
  });

  app.get('/:id', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    return deviceService.getDevice(admin, toObjectId((request.params as { id: string }).id, 'device id'));
  });

  app.post('/:id/revoke', { preHandler: app.requireRole(Role.HrAdmin) }, async (request) => {
    const admin = adminOf(request);
    const deviceId = toObjectId((request.params as { id: string }).id, 'device id');
    const device = await deviceService.revokeDevice(admin, deviceId);

    await recordAudit(request, admin, {
      action: AuditAction.DeviceRevoked,
      targetType: 'device',
      targetId: deviceId,
      targetLabel: device.hostname,
    });

    return device;
  });
}
