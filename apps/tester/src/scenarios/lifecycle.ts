import { AdminClient } from '../AdminClient.js';
import { VirtualAgent, ProtocolError, appSession } from '../VirtualAgent.js';
import type { Scenario } from '../harness.js';
import { adminCredentials } from '../config.js';

/**
 * Policy propagation and device revocation.
 *
 * Both are control-plane actions whose whole value is that they take effect
 * on a *running* endpoint — a test that only checks the HTTP response would
 * miss the case where the agent never notices.
 */
export const policyPropagationScenario: Scenario = {
  name: 'Policy propagation',
  description: 'A policy change reaches a running agent within one heartbeat.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Policy Tester',
      `policy-${Date.now()}@tester.local`,
    );
    const credentials = await admin.generateCredentials(employee.id);

    const agent = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'POLICY-PC' });
    await agent.enroll(credentials.userId, credentials.tempPassword);

    const initialVersion = agent.config!.configVersion;
    const initialThreshold = agent.config!.idleThresholdSec;

    // Pick a value that is definitely different from the current one.
    const newThreshold = initialThreshold === 900 ? 600 : 900;
    const updated = await admin.updatePolicy({ idleThresholdSec: newThreshold });

    ctx.expectEqual('policy value changed', updated.idleThresholdSec, newThreshold);
    ctx.expectTrue(
      'config version was bumped',
      updated.configVersion > initialVersion,
      `${initialVersion} -> ${updated.configVersion}`,
    );

    // The heartbeat response is how a running agent learns to refetch.
    const heartbeat = await agent.heartbeat('ACTIVE', { currentApplication: 'Test' });
    ctx.expectEqual(
      'heartbeat reports the new config version',
      heartbeat.configVersion,
      updated.configVersion,
    );
    ctx.expectTrue(
      'the agent can detect the change from its heartbeat alone',
      heartbeat.configVersion !== initialVersion,
    );

    const refetched = await agent.fetchConfig();
    ctx.expectEqual('agent picks up the new threshold', refetched.idleThresholdSec, newThreshold);
    ctx.expectTrue(
      'screenshots remain off after an unrelated change',
      refetched.trackScreenshots === false,
    );

    // Restore, so a re-run starts from the same place.
    await admin.updatePolicy({ idleThresholdSec: initialThreshold });
  },
};

export const revocationScenario: Scenario = {
  name: 'Device revocation',
  description: 'Revoking a device stops it reporting immediately, and keeps its history.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Revoke Tester',
      `revoke-${Date.now()}@tester.local`,
    );
    const credentials = await admin.generateCredentials(employee.id);

    const agent = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'REVOKE-PC' });
    await agent.enroll(credentials.userId, credentials.tempPassword);

    const startedAt = new Date(Date.now() - 3600 * 1000);
    agent.enqueue(appSession('Visual Studio Code', 'Code.exe', startedAt, 1800));
    await agent.flush();
    await agent.heartbeat('ACTIVE', { currentApplication: 'Visual Studio Code' });

    const before = await admin.getAgentHealth();

    // --- revoke ------------------------------------------------------------
    const revoked = await admin.revokeDevice(agent.id);
    ctx.expectEqual('device is marked revoked', revoked.status, 'REVOKED');

    // The agent still holds an unexpired access token. Authorization must
    // consult the database, not just the JWT.
    let heartbeatRejected = false;
    let heartbeatCode = '';
    try {
      await agent.heartbeat('ACTIVE', { currentApplication: 'Visual Studio Code' });
    } catch (error) {
      if (error instanceof ProtocolError) {
        heartbeatRejected = true;
        heartbeatCode = error.code;
      }
    }
    ctx.expectTrue('a still-valid token stops working immediately', heartbeatRejected);
    ctx.expectEqual('the agent is told the device was revoked', heartbeatCode, 'DEVICE_REVOKED');

    // The device secret must not mint a fresh token either.
    agent.expireToken();
    let tokenRejected = false;
    try {
      await agent.heartbeat('ACTIVE');
    } catch (error) {
      tokenRejected = error instanceof ProtocolError;
    }
    ctx.expectTrue('the device secret no longer exchanges for a token', tokenRejected);

    // --- history is preserved ---------------------------------------------
    const applications = await admin.getApplications({
      from: new Date(startedAt).toISOString().slice(0, 10),
      to: new Date(startedAt).toISOString().slice(0, 10),
      employeeId: employee.id,
    });

    ctx.expectTrue(
      'activity recorded before revocation is kept',
      applications.applications.some((row) => row.exeName === 'code.exe'),
    );

    const after = await admin.getAgentHealth();
    ctx.expectTrue(
      'agent health counts the revoked device',
      after.revoked > before.revoked,
      `${before.revoked} -> ${after.revoked}`,
    );
  },
};

/**
 * Re-enrolling the same machine must rotate its secret rather than
 * accumulating duplicate devices — otherwise a laptop reimaged twice a year
 * shows up three times in the inventory.
 */
export const reEnrollmentScenario: Scenario = {
  name: 'Re-enrollment',
  description: 'Re-enrolling a machine rotates its secret without duplicating the device.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Reenroll Tester',
      `reenroll-${Date.now()}@tester.local`,
    );
    const credentials = await admin.generateCredentials(employee.id);

    const hostname = `REENROLL-${Date.now().toString().slice(-6)}`;

    const first = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname });
    await first.enroll(credentials.userId, credentials.tempPassword);
    const firstDeviceId = first.id;

    const second = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname });
    await second.enroll(credentials.userId, credentials.tempPassword);

    ctx.expectEqual('the same machine keeps its device id', second.id, firstDeviceId);

    const devices = await admin.listDevices();
    const matching = devices.items.filter((device) => device.hostname === hostname);
    ctx.expectEqual('only one device row exists for the machine', matching.length, 1);

    // The new agent works with the rotated secret.
    await second.heartbeat('ACTIVE', { currentApplication: 'Test' });
    ctx.expectTrue('the re-enrolled agent can report', true);

    // Generating a new password must not break an already-enrolled device:
    // the device secret is independent of the human credential by design.
    await admin.generateCredentials(employee.id);
    second.expireToken();
    await second.heartbeat('ACTIVE', { currentApplication: 'Test' });
    ctx.expectTrue('rotating the password does not break enrolled devices', true);
  },
};
