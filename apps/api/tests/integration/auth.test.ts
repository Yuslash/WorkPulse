import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Role } from '@workpulse/shared';
import {
  authHeader,
  createAdmin,
  createApp,
  loginAdmin,
  resetDatabase,
  seedOrganization,
  TEST_PASSWORD,
  type TestOrg,
} from '../factories.js';
import { collections } from '../../src/db/client.js';

describe('admin authentication', () => {
  let app: FastifyInstance;
  let org: TestOrg;

  beforeAll(async () => {
    await resetDatabase();
    app = await createApp();
    org = await seedOrganization();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: org.ownerEmail, password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives an unknown email the same error as a wrong password', async () => {
    // Identical responses are what stop this endpoint being used to discover
    // which admin accounts exist.
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@test.local', password: 'whatever123' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('issues an access token and a refresh cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: org.ownerEmail, password: TEST_PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user.email).toBe(org.ownerEmail);
    expect(body.user.role).toBe(Role.OrgOwner);
    expect(body.user.organizationName).toBe('Test Org');

    const cookie = response.headers['set-cookie'];
    expect(String(cookie)).toContain('wp_refresh=');
    expect(String(cookie)).toContain('HttpOnly');
  });

  it('records both successful and failed logins in the audit trail', async () => {
    const logs = await collections
      .auditLogs()
      .find({ organizationId: org.organizationId })
      .toArray();

    const actions = logs.map((log) => log.action);
    expect(actions).toContain('admin.login');
    expect(actions).toContain('admin.login_failed');
  });

  it('returns the current user from /me', async () => {
    const { token } = await loginAdmin(app, org.ownerEmail);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe(org.ownerEmail);
  });

  it('rejects /me without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const { token } = await loginAdmin(app, org.ownerEmail);
    const tampered = `${token.slice(0, -4)}AAAA`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader(tampered),
    });

    expect(response.statusCode).toBe(401);
  });

  it('rotates the refresh token and invalidates the old one', async () => {
    const { cookie } = await loginAdmin(app, org.ownerEmail);

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);

    // Replaying the original cookie must now fail — that is how a stolen
    // refresh token surfaces instead of silently granting a parallel session.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('invalidates the session on logout', async () => {
    const { cookie } = await loginAdmin(app, org.ownerEmail);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('blocks a suspended admin holding a still-valid token', async () => {
    const admin = await createAdmin(org.organizationId, Role.HrAdmin);
    const { token } = await loginAdmin(app, admin.email);

    // The token is unexpired; the database says the account is suspended.
    // Authorization must follow the database, not the token.
    await collections.users().updateOne({ _id: admin.id }, { $set: { status: 'SUSPENDED' } });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ACCOUNT_INACTIVE');
  });
});
