import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp, resetDatabase } from '../factories.js';
import { collections } from '../../src/db/client.js';

/**
 * Self-service company creation — the "Create Company" option on the
 * pre-login welcome screen. Public and unauthenticated, so it gets its own
 * scrutiny: duplicate handling, immediate sign-in, and that it is audited
 * like every other privileged action even though nobody was signed in yet
 * when it happened.
 */
describe('organization registration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await resetDatabase();
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an organization, an ORG_OWNER, and signs them in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Globex Corporation',
        adminName: 'Hank Scorpio',
        adminEmail: 'hank@globex.test',
        adminPassword: 'SuperSecure123!',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    expect(body.accessToken).toBeTruthy();
    expect(body.user.role).toBe('ORG_OWNER');
    expect(body.user.organizationName).toBe('Globex Corporation');
    expect(body.user.email).toBe('hank@globex.test');

    // The refresh cookie must be set exactly as a normal login would.
    const cookie = response.headers['set-cookie'];
    expect(String(cookie)).toContain('wp_refresh=');
  });

  it('gives the new organization a working default policy', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Initech',
        adminName: 'Bill Lumbergh',
        adminEmail: 'bill@initech.test',
        adminPassword: 'SuperSecure123!',
      },
    });
    const token = login.json().accessToken;

    const policy = await app.inject({
      method: 'GET',
      url: '/api/policies',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(policy.statusCode).toBe(200);
    expect(policy.json().trackScreenshots).toBe(false);
  });

  it('rejects a second signup with the same email', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Acme A',
        adminName: 'Wile E',
        adminEmail: 'wile@acme.test',
        adminPassword: 'SuperSecure123!',
      },
    });

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Acme B',
        adminName: 'Wile E Coyote',
        adminEmail: 'wile@acme.test',
        adminPassword: 'AnotherPassword1!',
      },
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('EMAIL_TAKEN');
  });

  it('gives two organizations with the same name distinct slugs', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Duplicate Name Inc',
        adminName: 'First Owner',
        adminEmail: 'first@dup.test',
        adminPassword: 'SuperSecure123!',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Duplicate Name Inc',
        adminName: 'Second Owner',
        adminEmail: 'second@dup.test',
        adminPassword: 'SuperSecure123!',
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().user.organizationId).not.toBe(second.json().user.organizationId);

    const orgs = await collections.organizations().find({ name: 'Duplicate Name Inc' }).toArray();
    expect(orgs).toHaveLength(2);
    expect(orgs[0]!.slug).not.toBe(orgs[1]!.slug);
  });

  it('records the creation in the new organization\'s audit trail', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Audited Co',
        adminName: 'Owner Name',
        adminEmail: 'owner@audited.test',
        adminPassword: 'SuperSecure123!',
      },
    });
    const token = login.json().accessToken;

    const audit = await app.inject({
      method: 'GET',
      url: '/api/audit?action=organization.created&limit=10',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(audit.statusCode).toBe(200);
    expect(audit.json().items.length).toBeGreaterThan(0);
  });

  it('rejects a password shorter than the minimum', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        organizationName: 'Short Password Co',
        adminName: 'Someone',
        adminEmail: 'short@pw.test',
        adminPassword: 'short',
      },
    });

    expect(response.statusCode).toBe(422);
  });
});
