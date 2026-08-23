import type { FastifyInstance } from 'fastify';
import {
  AuditAction,
  enrollRequestSchema,
  heartbeatRequestSchema,
  telemetryRequestSchema,
  tokenRequestSchema,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
import { agentOf } from '../../plugins/auth.js';
import { getAgentConfig } from '../policies/service.js';
import { recordSystemAudit } from '../audit/service.js';
import * as agentService from './service.js';

/**
 * Agent endpoints. Only `/enroll` and `/token` are unauthenticated — and both
 * are rate limited, because they are the only places a secret is guessed.
 */
export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/enroll', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    handler: async (request) => {
      const body = enrollRequestSchema.parse(request.body);
      const { response, deviceId, organizationId } = await agentService.enroll(
        body.userId,
        body.password,
        body.device,
      );

      await recordSystemAudit(request, organizationId, body.userId, {
        action: AuditAction.DeviceEnrolled,
        targetType: 'device',
        targetId: deviceId,
        targetLabel: body.device.hostname,
        metadata: { agentVersion: body.device.agentVersion, os: body.device.os },
      });

      return response;
    },
  });

  app.post('/token', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (request) => {
      const body = tokenRequestSchema.parse(request.body);
      return agentService.exchangeToken(body.deviceId, body.deviceSecret);
    },
  });

  app.post('/heartbeat', {
    preHandler: app.requireAgent,
    // A 30s heartbeat needs ~2/min; this allows for retries and clock jitter
    // without letting a broken agent hammer the API.
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    handler: async (request) => {
      const identity = agentOf(request);
      const body = heartbeatRequestSchema.parse(request.body);
      const result = await agentService.heartbeat(identity, body);
      return { ok: true as const, ...result };
    },
  });

  app.post('/telemetry', {
    preHandler: app.requireAgent,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    handler: async (request) => {
      const identity = agentOf(request);
      const body = telemetryRequestSchema.parse(request.body);
      return agentService.ingestTelemetry(identity, body);
    },
  });

  app.get('/config', {
    preHandler: app.requireAgent,
    handler: async (request) => {
      const identity = agentOf(request);
      return {
        config: await getAgentConfig(identity.organizationId),
        serverTime: new Date().toISOString(),
      };
    },
  });

  /**
   * Powers the tray's transparency screen (spec §43). The `collected` and
   * `notCollected` lists are generated from the live policy rather than
   * hard-coded, so what the employee is shown always matches what the agent
   * is actually permitted to do.
   */
  app.get('/status', {
    preHandler: app.requireAgent,
    handler: async (request) => {
      const identity = agentOf(request);

      const [device, employee, organization, config] = await Promise.all([
        collections.devices().findOne({ _id: identity.deviceId }),
        collections.employees().findOne({ _id: identity.employeeId }),
        collections.organizations().findOne({ _id: identity.organizationId }),
        getAgentConfig(identity.organizationId),
      ]);

      if (!device || !employee || !organization) throw ApiError.notFound('Device');

      const collected = ['Active / idle state', 'Attendance times', 'Device health'];
      if (config.trackApplications) collected.push('Application activity');
      if (config.trackWindowTitles) collected.push('Window titles');
      if (config.trackWebsites) collected.push('Website domains');
      if (config.trackScreenshots) collected.push('Periodic screenshots');

      // These are guarantees of the product, not policy toggles — there is no
      // configuration that turns any of them on (spec §17).
      const notCollected = [
        'Keyboard input',
        'Clipboard contents',
        'Passwords',
        'Microphone',
        'Webcam',
        'Personal files',
      ];
      if (!config.trackWindowTitles) notCollected.push('Window titles');
      if (!config.trackWebsites) notCollected.push('Websites visited');
      if (!config.trackScreenshots) notCollected.push('Screenshots');

      return {
        employee: { id: employee._id.toHexString(), name: employee.name },
        organization: { id: organization._id.toHexString(), name: organization.name },
        device: {
          id: device._id.toHexString(),
          hostname: device.hostname,
          status: device.status,
          enrolledAt: device.enrolledAt.toISOString(),
        },
        collected,
        notCollected,
        serverTime: new Date().toISOString(),
      };
    },
  });
}
