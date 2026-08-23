import { AdminClient } from '../AdminClient.js';
import { VirtualAgent, appSession, inactivity } from '../VirtualAgent.js';
import type { Scenario } from '../harness.js';
import { adminCredentials } from '../config.js';

/**
 * A small fleet reporting concurrently.
 *
 * Sequential scenarios cannot catch the failures that matter at scale: an
 * unindexed query, presence entries colliding between employees, or the
 * overview counting the same person twice. Twelve concurrent agents is enough
 * to expose those without making the suite slow.
 */
const FLEET_SIZE = 12;

export const scaleScenario: Scenario = {
  name: 'Concurrent fleet',
  description: 'A fleet of agents enrols and reports concurrently without cross-talk.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const stamp = Date.now();

    // --- create the fleet --------------------------------------------------
    const employees = await Promise.all(
      Array.from({ length: FLEET_SIZE }, (_, index) =>
        admin.createEmployee(`Fleet ${index + 1}`, `fleet-${stamp}-${index}@tester.local`),
      ),
    );
    ctx.expectEqual('all employees created', employees.length, FLEET_SIZE);

    const credentials = await Promise.all(
      employees.map((employee) => admin.generateCredentials(employee.id)),
    );

    const userIds = new Set(credentials.map((credential) => credential.userId));
    ctx.expectEqual('every user ID is unique', userIds.size, FLEET_SIZE);

    const passwords = new Set(credentials.map((credential) => credential.tempPassword));
    ctx.expectEqual('every password is unique', passwords.size, FLEET_SIZE);

    // --- enrol concurrently ------------------------------------------------
    const agents = employees.map(
      (_, index) =>
        new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: `FLEET-${stamp}-${index}` }),
    );

    await Promise.all(
      agents.map((agent, index) =>
        agent.enroll(credentials[index]!.userId, credentials[index]!.tempPassword),
      ),
    );

    const deviceIds = new Set(agents.map((agent) => agent.id));
    ctx.expectEqual('every device gets a distinct id', deviceIds.size, FLEET_SIZE);

    ctx.expectTrue(
      'each agent is bound to its own employee',
      agents.every((agent, index) => agent.employeeId === employees[index]!.id),
    );

    // --- report concurrently -----------------------------------------------
    const base = new Date(Date.now() - 2 * 3600 * 1000);

    await Promise.all(
      agents.map(async (agent, index) => {
        // Stagger durations so a mix-up between employees would show up as a
        // wrong number rather than as an identical one.
        const durationSec = 600 + index * 60;

        agent.enqueue(appSession('Visual Studio Code', 'Code.exe', base, durationSec));
        agent.enqueue(
          inactivity('idle', new Date(base.getTime() + durationSec * 1000), 300),
        );

        await agent.flush();
        await agent.heartbeat(index % 3 === 0 ? 'IDLE' : 'ACTIVE', {
          idleSeconds: index % 3 === 0 ? 700 : 0,
          currentApplication: index % 3 === 0 ? null : 'Visual Studio Code',
        });
      }),
    );

    // --- each employee's data must be their own ---------------------------
    const dateKey = base.toISOString().slice(0, 10);

    const sampled = [0, Math.floor(FLEET_SIZE / 2), FLEET_SIZE - 1];
    for (const index of sampled) {
      const expected = 600 + index * 60;
      const applications = await admin.getApplications({
        from: dateKey,
        to: dateKey,
        employeeId: employees[index]!.id,
      });

      const code = applications.applications.find((row) => row.exeName === 'code.exe');
      ctx.expectEqual(
        `employee ${index + 1} has only their own activity`,
        code?.durationSec,
        expected,
      );
    }

    // --- presence is per employee, not shared -----------------------------
    const idleCount = agents.filter((_, index) => index % 3 === 0).length;
    const activeCount = FLEET_SIZE - idleCount;

    const overview = await admin.getOverview();
    ctx.expectTrue(
      'the overview counts at least the fleet as online',
      overview.online >= FLEET_SIZE,
      `online=${overview.online}, fleet=${FLEET_SIZE}`,
    );
    ctx.expectTrue(
      'active and idle are counted separately',
      overview.active >= activeCount && overview.idle >= idleCount,
      `active=${overview.active} (>=${activeCount}), idle=${overview.idle} (>=${idleCount})`,
    );
    ctx.expectTrue(
      'no employee is counted in two states at once',
      overview.active + overview.idle + overview.locked + overview.offline === overview.employees,
      `${overview.active}+${overview.idle}+${overview.locked}+${overview.offline} != ${overview.employees}`,
    );

    // --- the device inventory agrees --------------------------------------
    const devices = await admin.listDevices();
    const fleetDevices = devices.items.filter((device) =>
      device.hostname.startsWith(`FLEET-${stamp}-`),
    );
    ctx.expectEqual('every device appears in the inventory', fleetDevices.length, FLEET_SIZE);

    const health = await admin.getAgentHealth();
    ctx.expectTrue(
      'agent health accounts for the fleet',
      health.installed >= FLEET_SIZE,
      `installed=${health.installed}`,
    );
  },
};
