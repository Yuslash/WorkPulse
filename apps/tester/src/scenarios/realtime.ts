import WebSocket from 'ws';
import type { PresenceUpdate, WsServerMessage } from '@workpulse/shared';
import { AdminClient } from '../AdminClient.js';
import { VirtualAgent } from '../VirtualAgent.js';
import type { Scenario } from '../harness.js';
import { adminCredentials } from '../config.js';

/**
 * The live board (spec §23).
 *
 * Asserts that a heartbeat on one connection produces a push on another —
 * the property that makes the dashboard update without a refresh, and the one
 * thing no single-request test can establish.
 */
export const realtimeScenario: Scenario = {
  name: 'Realtime',
  description: 'Agent state changes are pushed to connected dashboards over WebSocket.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Realtime Tester',
      `realtime-${Date.now()}@tester.local`,
    );
    const credentials = await admin.generateCredentials(employee.id);

    // --- connect a dashboard ----------------------------------------------
    const received: PresenceUpdate[] = [];
    let ready = false;
    let subscribed = false;

    const socket = new WebSocket(`${ctx.wsUrl}/ws?token=${encodeURIComponent(admin.token)}`);

    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));

    socket.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as WsServerMessage;

      if (message.type === 'ready') ready = true;
      if (message.type === 'subscribed') subscribed = true;
      if (message.type === 'presence') received.push(message.data);
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });

    socket.send(JSON.stringify({ type: 'subscribe', topics: ['presence', 'overview'] }));

    await ctx.waitFor('server sends ready', async () => ready);
    await ctx.waitFor('subscription acknowledged', async () => subscribed);

    // --- an agent starts reporting ----------------------------------------
    const agent = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'REALTIME-PC' });
    await agent.enroll(credentials.userId, credentials.tempPassword);

    await agent.heartbeat('ACTIVE', { currentApplication: 'Visual Studio Code' });

    await ctx.waitFor('ACTIVE is pushed to the dashboard', async () =>
      received.some(
        (update) => update.employeeId === employee.id && update.state === 'ACTIVE',
      ),
    );

    const activeUpdate = received.find(
      (update) => update.employeeId === employee.id && update.state === 'ACTIVE',
    );
    ctx.expectEqual(
      'the pushed update carries the current application',
      activeUpdate?.currentApplication,
      'Visual Studio Code',
    );

    // --- a repeated identical heartbeat must not push ----------------------
    const beforeRepeat = received.length;
    await agent.heartbeat('ACTIVE', { currentApplication: 'Visual Studio Code' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    ctx.expectEqual(
      'an unchanged heartbeat produces no push',
      received.length,
      beforeRepeat,
    );

    // --- a real transition must push --------------------------------------
    await agent.heartbeat('IDLE', { idleSeconds: 700, currentApplication: null });

    await ctx.waitFor('IDLE transition is pushed', async () =>
      received.some((update) => update.employeeId === employee.id && update.state === 'IDLE'),
    );

    // --- switching application pushes even without a state change ---------
    await agent.heartbeat('ACTIVE', { currentApplication: 'Google Chrome' });

    await ctx.waitFor('an application change is pushed', async () =>
      received.some(
        (update) => update.employeeId === employee.id && update.currentApplication === 'Google Chrome',
      ),
    );

    // --- the overview reflects the live state -----------------------------
    const overview = await admin.getOverview();
    ctx.expectTrue('overview counts at least one active employee', overview.active >= 1);
    ctx.expectTrue('overview counts at least one device', overview.devices >= 1);

    socket.close();
    await closed;
  },
};

/**
 * A dashboard socket must not open without a valid token, and must never
 * carry another tenant's data.
 */
export const realtimeAuthScenario: Scenario = {
  name: 'Realtime auth',
  description: 'The live socket rejects unauthenticated and invalid connections.',

  async run(ctx) {
    const closeCode = async (url: string): Promise<number> => {
      const socket = new WebSocket(url);

      return new Promise<number>((resolve) => {
        // A rejected handshake may surface as an error rather than a close.
        socket.once('close', (code) => resolve(code));
        socket.once('error', () => resolve(-1));
      });
    };

    const noToken = await closeCode(`${ctx.wsUrl}/ws`);
    ctx.expectTrue(
      'a socket without a token is closed',
      noToken === 4401 || noToken === -1,
      `close code ${noToken}`,
    );

    const badToken = await closeCode(`${ctx.wsUrl}/ws?token=not-a-real-token`);
    ctx.expectTrue(
      'a socket with an invalid token is closed',
      badToken === 4401 || badToken === -1,
      `close code ${badToken}`,
    );
  },
};
