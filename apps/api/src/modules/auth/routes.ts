import type { FastifyInstance } from 'fastify';
import { AuditAction, loginRequestSchema, registerOrganizationSchema } from '@workpulse/shared';
import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { adminOf } from '../../plugins/auth.js';
import { recordAudit, recordSystemAudit } from '../audit/service.js';
import * as authService from './service.js';

const REFRESH_COOKIE = 'wp_refresh';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.isProduction,
    path: '/api/auth',
  };

  app.post('/login', {
    // Brute-force protection is per-IP; a distributed attack still has to
    // survive the scrypt cost on every single attempt.
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    handler: async (request, reply) => {
      const body = loginRequestSchema.parse(request.body);

      try {
        const result = await authService.login(body.email, body.password);

        reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
          ...cookieOptions,
          expires: result.refreshExpiresAt,
        });

        await recordAudit(request, result.actor, {
          action: AuditAction.AdminLogin,
          targetType: 'user',
          targetId: result.user.id,
        });

        return {
          accessToken: result.accessToken,
          accessTokenExpiresAt: result.accessTokenExpiresAt,
          user: result.user,
        };
      } catch (error) {
        // A failed attempt is itself security-relevant. An unknown email has
        // no tenant to attribute it to, so it is logged but not stored.
        const organizationId = await authService.organizationForEmail(body.email);
        if (organizationId) {
          await recordSystemAudit(request, organizationId, body.email, {
            action: AuditAction.AdminLoginFailed,
            targetType: 'user',
            targetLabel: body.email,
          });
        } else {
          request.log.warn({ email: body.email }, 'login attempt for unknown account');
        }
        throw error;
      }
    },
  });

  app.post('/register', {
    // Account-creation abuse is higher-value than a login guess, so this is
    // stricter than /login: five new companies per hour per address.
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    handler: async (request, reply) => {
      const body = registerOrganizationSchema.parse(request.body);
      const result = await authService.registerOrganization(body);

      reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
        ...cookieOptions,
        expires: result.refreshExpiresAt,
      });

      await recordAudit(request, result.actor, {
        action: AuditAction.OrganizationCreated,
        targetType: 'organization',
        targetId: result.user.organizationId,
        targetLabel: result.user.organizationName,
      });

      return reply.status(201).send({
        accessToken: result.accessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        user: result.user,
      });
    },
  });

  app.post('/refresh', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) throw ApiError.unauthorized('No session', 'NO_REFRESH_TOKEN');

    const result = await authService.refresh(token);

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
      ...cookieOptions,
      expires: result.refreshExpiresAt,
    });

    return {
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
      user: result.user,
    };
  });

  app.post('/logout', async (request, reply) => {
    await authService.logout(request.cookies[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, cookieOptions);
    return { ok: true };
  });

  app.get('/me', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);
    return authService.currentUser(admin.userId);
  });
}
