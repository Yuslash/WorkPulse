import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { AppCategory, PresenceState, toDateKey } from '@workpulse/shared';
import {
  authHeader,
  createApp,
  createAppCategory,
  createEmployee,
  eventId,
  isoAt,
  loginAdmin,
  resetDatabase,
  seedOrganization,
  type TestOrg,
} from '../factories.js';
import { collections } from '../../src/db/client.js';
import { presence } from '../../src/services/presence.js';

/**
 * The end-to-end agent path: credentials -> enrollment -> token -> heartbeat
 * -> telemetry -> attendance. This is the pipeline the whole product rests on,
 * so it is exercised through the real HTTP surface rather than by calling
 * services directly.
 */
describe('agent pipeline', () => {
  let app: FastifyInstance;
  let org: TestOrg;
  let adminToken: string;
  let employeeId: ObjectId;

  // Captured during enrollment and reused across the suite.
  let userId: string;
  let tempPassword: string;
  let deviceId: string;
  let deviceSecret: string;
  let agentToken: string;

  const device = {
    hostname: 'TEST-PC',
    os: 'Windows',
    osVersion: '10.0.19045',
    arch: 'x86_64',
    cpu: 'Test CPU',
    cpuCores: 8,
    ramMb: 16384,
    agentVersion: '1.0.0',
  };

  beforeAll(async () => {
    await resetDatabase();
    app = await createApp();
    org = await seedOrganization();

    const login = await loginAdmin(app, org.ownerEmail);
    adminToken = login.token;

    employeeId = await createEmployee(org.organizationId, { name: 'Pipeline Tester' });
    await createAppCategory(org.organizationId, 'code.exe', AppCategory.Productive);
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates one-time credentials for an employee', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/employees/${employeeId.toHexString()}/credentials`,
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.userId).toMatch(/^EMP-\d{4}$/);
    expect(body.tempPassword).toBeTruthy();
    expect(body.mustChangePassword).toBe(true);

    userId = body.userId;
    tempPassword = body.tempPassword;
  });

  it('never stores the password in plaintext', async () => {
    const credential = await collections.employeeCredentials().findOne({ userId });
    expect(credential).toBeTruthy();
    expect(credential!.passwordHash).not.toContain(tempPassword);
    expect(credential!.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('never returns the password again', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/employees/${employeeId.toHexString()}/credentials`,
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(tempPassword);
    expect(response.json().userId).toBe(userId);
  });

  it('rejects enrollment with a wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/enroll',
      payload: { userId, password: 'not-the-password', device },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('enrolls a device and returns a device secret exactly once', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/enroll',
      payload: { userId, password: tempPassword, device },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.deviceId).toBeTruthy();
    expect(body.deviceSecret).toBeTruthy();
    expect(body.employee.name).toBe('Pipeline Tester');
    expect(body.config.trackApplications).toBe(true);
    // Privacy defaults must be off (spec §16, §17).
    expect(body.config.trackScreenshots).toBe(false);
    expect(body.config.trackWebsites).toBe(false);

    deviceId = body.deviceId;
    deviceSecret = body.deviceSecret;
    agentToken = body.accessToken;
  });

  it('stores only a hash of the device secret', async () => {
    const doc = await collections.devices().findOne({ _id: new ObjectId(deviceId) });
    expect(doc).toBeTruthy();
    expect(doc!.secretHash).not.toBe(deviceSecret);
    expect(doc!.secretHash).toHaveLength(64);
  });

  it('does not create a duplicate device when the same machine re-enrolls', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/enroll',
      payload: { userId, password: tempPassword, device },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().deviceId).toBe(deviceId);

    const count = await collections.devices().countDocuments({ employeeId });
    expect(count).toBe(1);

    // The secret rotates on re-enrollment, so refresh our copy.
    deviceSecret = response.json().deviceSecret;
    agentToken = response.json().accessToken;
  });

  it('exchanges the device secret for an access token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/token',
      payload: { deviceId, deviceSecret },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBeTruthy();
    expect(response.json().configVersion).toBeGreaterThan(0);
  });

  it('rejects a wrong device secret', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/token',
      payload: { deviceId, deviceSecret: 'wrong-secret' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an admin token on an agent route', async () => {
    // The audience claim is what keeps the two identities separate even
    // though both are signed with the same key.
    const response = await app.inject({
      method: 'GET',
      url: '/api/agent/config',
      headers: authHeader(adminToken),
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an agent token on an admin route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/employees',
      headers: authHeader(agentToken),
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a heartbeat and updates presence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/heartbeat',
      headers: authHeader(agentToken),
      payload: {
        status: 'ACTIVE',
        idleSeconds: 0,
        currentApplication: 'Visual Studio Code',
        agentVersion: '1.0.0',
        queueDepth: 0,
        sentAt: new Date().toISOString(),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ok).toBe(true);
    expect(response.json().configVersion).toBeGreaterThan(0);

    const live = presence.get(deviceId);
    expect(live?.state).toBe(PresenceState.Active);
    expect(live?.currentApplication).toBe('Visual Studio Code');
  });

  it('writes the heartbeat to the time-series collection', async () => {
    const count = await collections
      .heartbeats()
      .countDocuments({ 'meta.deviceId': new ObjectId(deviceId) });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('does not reset the state timer on repeated identical heartbeats', async () => {
    const before = presence.get(deviceId)!.stateSince.getTime();

    await app.inject({
      method: 'POST',
      url: '/api/agent/heartbeat',
      headers: authHeader(agentToken),
      payload: {
        status: 'ACTIVE',
        idleSeconds: 0,
        currentApplication: 'Visual Studio Code',
        agentVersion: '1.0.0',
        sentAt: new Date().toISOString(),
      },
    });

    // "Active for 2h 17m" must not restart every 30 seconds.
    expect(presence.get(deviceId)!.stateSince.getTime()).toBe(before);
  });

  it('resets the state timer on a genuine transition', async () => {
    const before = presence.get(deviceId)!.stateSince.getTime();
    await new Promise((resolve) => setTimeout(resolve, 15));

    await app.inject({
      method: 'POST',
      url: '/api/agent/heartbeat',
      headers: authHeader(agentToken),
      payload: {
        status: 'IDLE',
        idleSeconds: 600,
        currentApplication: null,
        agentVersion: '1.0.0',
        sentAt: new Date().toISOString(),
      },
    });

    expect(presence.get(deviceId)!.state).toBe(PresenceState.Idle);
    expect(presence.get(deviceId)!.stateSince.getTime()).toBeGreaterThan(before);
  });

  it('ingests telemetry and categorizes applications', async () => {
    const base = new Date(Date.now() - 3600 * 1000);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/telemetry',
      headers: authHeader(agentToken),
      payload: {
        batchId: eventId('batch'),
        events: [
          {
            type: 'app_session',
            eventId: eventId('app'),
            appName: 'Visual Studio Code',
            exeName: 'Code.exe',
            windowTitle: null,
            startedAt: isoAt(base, 0),
            endedAt: isoAt(base, 1800),
            durationSec: 1800,
          },
          {
            type: 'inactivity',
            eventId: eventId('idle'),
            kind: 'idle',
            startedAt: isoAt(base, 1800),
            endedAt: isoAt(base, 2100),
            durationSec: 300,
          },
          {
            type: 'agent_log',
            eventId: eventId('log'),
            level: 'INFO',
            message: 'Agent started',
            occurredAt: isoAt(base, 0),
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toBe(3);
    expect(body.duplicates).toBe(0);
    expect(body.rejected).toEqual([]);

    const session = await collections.appSessions().findOne({ employeeId });
    // The exe name is normalized and the admin's category rule applied.
    expect(session!.exeName).toBe('code.exe');
    expect(session!.category).toBe(AppCategory.Productive);
  });

  it('treats a replayed batch as duplicates, not new data', async () => {
    const base = new Date(Date.now() - 7200 * 1000);
    const replayId = eventId('replay');

    const payload = {
      batchId: eventId('batch'),
      events: [
        {
          type: 'app_session' as const,
          eventId: replayId,
          appName: 'Chrome',
          exeName: 'chrome.exe',
          windowTitle: null,
          startedAt: isoAt(base, 0),
          endedAt: isoAt(base, 600),
          durationSec: 600,
        },
      ],
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/agent/telemetry',
      headers: authHeader(agentToken),
      payload,
    });
    expect(first.json().accepted).toBe(1);

    // An agent that loses its connection mid-upload re-sends the same batch.
    const second = await app.inject({
      method: 'POST',
      url: '/api/agent/telemetry',
      headers: authHeader(agentToken),
      payload,
    });
    expect(second.json().accepted).toBe(0);
    expect(second.json().duplicates).toBe(1);

    expect(await collections.appSessions().countDocuments({ eventId: replayId })).toBe(1);
  });

  it('accepts good events in a batch that also contains a bad one', async () => {
    const base = new Date(Date.now() - 5400 * 1000);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/telemetry',
      headers: authHeader(agentToken),
      payload: {
        batchId: eventId('batch'),
        events: [
          {
            type: 'app_session',
            eventId: eventId('good'),
            appName: 'Slack',
            exeName: 'slack.exe',
            windowTitle: null,
            startedAt: isoAt(base, 0),
            endedAt: isoAt(base, 300),
            durationSec: 300,
          },
          {
            type: 'app_session',
            eventId: eventId('bad'),
            appName: 'Broken',
            exeName: 'broken.exe',
            windowTitle: null,
            // durationSec disagrees with the timestamps — a clock problem
            // that would otherwise inflate someone's working day.
            startedAt: isoAt(base, 0),
            endedAt: isoAt(base, 300),
            durationSec: 9999,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toBe(1);
    expect(response.json().rejected).toHaveLength(1);
    expect(response.json().rejected[0].reason).toContain('durationSec');
  });

  it('rejects a span that ends in the future', async () => {
    const future = new Date(Date.now() + 3600 * 1000);

    const response = await app.inject({
      method: 'POST',
      url: '/api/agent/telemetry',
      headers: authHeader(agentToken),
      payload: {
        batchId: eventId('batch'),
        events: [
          {
            type: 'app_session',
            eventId: eventId('future'),
            appName: 'Future App',
            exeName: 'future.exe',
            windowTitle: null,
            startedAt: isoAt(future, 0),
            endedAt: isoAt(future, 600),
            durationSec: 600,
          },
        ],
      },
    });

    expect(response.json().accepted).toBe(0);
    expect(response.json().rejected[0].reason).toContain('future');
  });

  it('computes attendance from the ingested spans', async () => {
    const dateKey = toDateKey(new Date());

    const response = await app.inject({
      method: 'POST',
      url: '/api/attendance/recompute',
      headers: authHeader(adminToken),
      payload: { employeeId: employeeId.toHexString(), date: dateKey },
    });
    expect(response.statusCode).toBe(200);

    const row = await collections.attendanceDaily().findOne({ employeeId, dateKey });
    expect(row).toBeTruthy();
    expect(row!.activeSec).toBeGreaterThan(0);
    expect(row!.idleSec).toBe(300);
    expect(row!.firstSeen).toBeTruthy();
    expect(row!.lastSeen).toBeTruthy();
  });

  it('serves the tray transparency screen from live policy', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/agent/status',
      headers: authHeader(agentToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.collected).toContain('Application activity');
    // These are product guarantees, not toggles (spec §17).
    expect(body.notCollected).toContain('Keyboard input');
    expect(body.notCollected).toContain('Webcam');
    expect(body.notCollected).toContain('Passwords');
    expect(body.notCollected).toContain('Screenshots');
  });

  it('stops the device the moment it is revoked', async () => {
    const revoke = await app.inject({
      method: 'POST',
      url: `/api/devices/${deviceId}/revoke`,
      headers: authHeader(adminToken),
    });
    expect(revoke.statusCode).toBe(200);

    // The still-unexpired access token must stop working immediately,
    // because authorization consults the database and not just the JWT.
    const heartbeat = await app.inject({
      method: 'POST',
      url: '/api/agent/heartbeat',
      headers: authHeader(agentToken),
      payload: {
        status: 'ACTIVE',
        idleSeconds: 0,
        currentApplication: 'Code',
        agentVersion: '1.0.0',
        sentAt: new Date().toISOString(),
      },
    });
    expect(heartbeat.statusCode).toBe(403);
    expect(heartbeat.json().error.code).toBe('DEVICE_REVOKED');

    const token = await app.inject({
      method: 'POST',
      url: '/api/agent/token',
      payload: { deviceId, deviceSecret },
    });
    expect(token.statusCode).toBe(403);
    expect(token.json().error.code).toBe('DEVICE_REVOKED');
  });
});
