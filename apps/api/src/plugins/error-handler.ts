import type { FastifyInstance } from 'fastify';
import { MongoServerError } from 'mongodb';
import { ZodError } from 'zod';
import { ApiError, isApiError } from '../lib/errors.js';
import { env } from '../config/env.js';

/**
 * Turns every thrown value into the `{ error: { code, message, details } }`
 * envelope the agent and dashboard both expect. Registered once, so no route
 * needs its own try/catch.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (isApiError(error)) {
      // 4xx are normal traffic (expired token, wrong password) — logging them
      // at error level would bury real failures.
      const level = error.statusCode >= 500 ? 'error' : 'debug';
      request.log[level]({ code: error.code, err: error }, 'request failed');

      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof MongoServerError && error.code === 11000) {
      return reply.status(409).send({
        error: {
          code: 'DUPLICATE_KEY',
          message: 'A record with these values already exists',
          details: env.isProduction ? undefined : error.keyValue,
        },
      });
    }

    // Fastify's own validation/parse errors arrive with a statusCode.
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    const status = fastifyError.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // The agent branches on RATE_LIMITED to back off, so the rate limiter's
      // 429 must carry that code rather than a generic one.
      const code = status === 429 ? 'RATE_LIMITED' : fastifyError.code ?? 'BAD_REQUEST';

      return reply.status(status).send({
        error: { code, message: fastifyError.message ?? 'Request failed' },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    const fallback = ApiError.internal();
    return reply.status(fallback.statusCode).send({
      error: {
        code: fallback.code,
        // Never surface an unexpected exception's text to a client in prod.
        message: env.isProduction ? fallback.message : fastifyError.message ?? fallback.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    }),
  );
}
