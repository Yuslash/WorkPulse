import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, resetDatabase, seedOrganization, type TestOrg } from '../factories.js';

/**
 * The rest of the suite runs with rate limiting off, because it logs in far
 * more often than any human would. This file builds an app with the limiter
 * explicitly enabled so the protection itself does not go untested.
 */
describe('rate limiting', () => {
  let app: FastifyInstance;
  let org: TestOrg;

  beforeAll(async () => {
    await resetDatabase();
    app = await createApp({ rateLimit: true });
    org = await seedOrganization();
  });

  afterAll(async () => {
    await app.close();
  });

  it('throttles repeated failed logins from one address', async () => {
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: org.ownerEmail, password: 'wrong-password' },
        remoteAddress: '203.0.113.10',
      });

    const statuses: number[] = [];
    // The route allows 10/minute; the 11th must be refused.
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await attempt()).statusCode);
    }

    expect(statuses.filter((s) => s === 401).length).toBe(10);
    expect(statuses).toContain(429);
  });

  it('returns RATE_LIMITED so the agent knows to back off', async () => {
    const enroll = () =>
      app.inject({
        method: 'POST',
        url: '/api/agent/enroll',
        payload: {
          userId: 'EMP-0000',
          password: 'does-not-matter',
          device: {
            hostname: 'RL-PC',
            os: 'Windows',
            osVersion: '10.0',
            arch: 'x86_64',
            agentVersion: '1.0.0',
          },
        },
        remoteAddress: '203.0.113.20',
      });

    let limited: { statusCode: number; body: string } | null = null;
    // Enrollment allows 5/minute.
    for (let i = 0; i < 8 && !limited; i += 1) {
      const response = await enroll();
      if (response.statusCode === 429) limited = { statusCode: 429, body: response.body };
    }

    expect(limited).toBeTruthy();
    expect(JSON.parse(limited!.body).error.code).toBe('RATE_LIMITED');
  });

  it('buckets separately per address', async () => {
    // A different office must not be locked out by one noisy client.
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: org.ownerEmail, password: org.ownerPassword },
      remoteAddress: '203.0.113.99',
    });

    expect(response.statusCode).toBe(200);
  });
});
