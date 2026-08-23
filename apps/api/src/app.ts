import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { ObjectId } from 'mongodb';
import { env } from './config/env.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { authPlugin, adminOf } from './plugins/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { agentRoutes } from './modules/agent/routes.js';
import { employeeRoutes } from './modules/employees/routes.js';
import { deviceRoutes } from './modules/devices/routes.js';
import { activityRoutes } from './modules/activity/routes.js';
import { attendanceRoutes } from './modules/attendance/routes.js';
import { policyRoutes } from './modules/policies/routes.js';
import { auditRoutes } from './modules/audit/routes.js';
import { realtimeRoutes } from './modules/realtime/routes.js';
import { getOverview } from './modules/overview/service.js';
import { getDb } from './db/client.js';

/**
 * Builds the Fastify instance.
 *
 * Exported separately from `server.ts` so tests mount the identical app
 * in-process — the integration suite exercises the real middleware stack,
 * not a stripped-down variant that could diverge from production.
 */
export interface BuildAppOptions {
  /** Overrides the env default; the rate-limit test turns it back on. */
  rateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const rateLimitEnabled = options.rateLimit ?? env.rateLimitEnabled;
  const app = Fastify({
    logger: env.isTest
      ? false
      : {
          level: env.isProduction ? 'info' : 'debug',
          transport: env.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
        },
    // Agents sit behind whatever proxy the customer runs; without this the
    // rate limiter would bucket every endpoint under the proxy's IP.
    trustProxy: true,
    bodyLimit: 4 * 1024 * 1024,
  });

  registerErrorHandler(app);

  await app.register(helmet, {
    // The dashboard is served separately; the API returns only JSON, so the
    // restrictive default CSP would be meaningless here.
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.corsOrigins,
    credentials: true,
  });

  await app.register(cookie);

  if (rateLimitEnabled) {
    await app.register(rateLimit, {
      global: false,
      max: 300,
      timeWindow: '1 minute',
      // Per-device buckets: one noisy agent must not throttle the whole fleet
      // behind the same NAT.
      keyGenerator: (request) => {
        const auth = request.headers.authorization;
        return auth ? `${request.ip}:${auth.slice(-24)}` : request.ip;
      },
    });
  }

  await app.register(websocket);
  await app.register(authPlugin);

  app.get('/health', async () => {
    // A liveness probe that never touches the database would stay green while
    // the API is unable to serve a single request.
    await getDb().command({ ping: 1 });
    return { ok: true, service: 'workpulse-api', time: new Date().toISOString() };
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(agentRoutes, { prefix: '/agent' });
      await api.register(employeeRoutes, { prefix: '/employees' });
      await api.register(deviceRoutes, { prefix: '/devices' });
      await api.register(activityRoutes, { prefix: '/activity' });
      await api.register(attendanceRoutes, { prefix: '/attendance' });
      await api.register(policyRoutes, { prefix: '/policies' });
      await api.register(auditRoutes, { prefix: '/audit' });

      api.get('/overview', { preHandler: api.requireAdmin }, async (request) =>
        getOverview(new ObjectId(adminOf(request).organizationId)),
      );
    },
    { prefix: '/api' },
  );

  await app.register(realtimeRoutes, { prefix: '/ws' });

  return app;
}
