import { toDateKey } from '@workpulse/shared';
import { AdminClient } from '../AdminClient.js';
import { VirtualAgent, ProtocolError, agentLog, appSession, inactivity } from '../VirtualAgent.js';
import type { Scenario } from '../harness.js';
import { adminCredentials } from '../config.js';

/**
 * The offline path (spec §22).
 *
 * A laptop that loses Wi-Fi must keep collecting, then deliver everything on
 * reconnect — exactly once. This is the scenario where a naive implementation
 * either loses the outage window or double-counts it on replay, and neither
 * failure is visible from a single API call.
 */
export const offlineReplayScenario: Scenario = {
  name: 'Offline replay',
  description: 'Activity collected during an outage is delivered exactly once on reconnect.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Offline Tester',
      `offline-${Date.now()}@tester.local`,
    );
    const credentials = await admin.generateCredentials(employee.id);

    const agent = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'OFFLINE-PC' });
    await agent.enroll(credentials.userId, credentials.tempPassword);

    const base = new Date(Date.now() - 4 * 3600 * 1000);
    const at = (offsetMin: number) => new Date(base.getTime() + offsetMin * 60_000);

    // --- online, working normally -----------------------------------------
    agent.enqueue(appSession('Visual Studio Code', 'Code.exe', at(0), 1800));
    const first = await agent.flush();
    ctx.expectEqual('pre-outage event delivered', first.accepted, 1);

    // --- the network drops -------------------------------------------------
    agent.setOnline(false);

    agent.enqueue(appSession('Google Chrome', 'chrome.exe', at(30), 1200));
    agent.enqueue(inactivity('idle', at(50), 600));
    agent.enqueue(appSession('Slack', 'slack.exe', at(60), 900));
    agent.enqueue(agentLog('WARN', 'Network unavailable', at(30)));

    ctx.expectEqual('events queue locally while offline', agent.queueDepth, 4);

    let heartbeatFailed = false;
    try {
      await agent.heartbeat('ACTIVE', { currentApplication: 'Slack' });
    } catch (error) {
      heartbeatFailed = error instanceof ProtocolError;
    }
    ctx.expectTrue('heartbeat fails while offline', heartbeatFailed);

    let flushFailed = false;
    try {
      await agent.flush();
    } catch (error) {
      flushFailed = error instanceof ProtocolError;
    }
    ctx.expectTrue('flush fails while offline', flushFailed);
    // The critical property: a failed delivery must not discard the queue.
    ctx.expectEqual('queue survives a failed flush', agent.queueDepth, 4);

    // --- the network comes back -------------------------------------------
    agent.setOnline(true);

    const replay = await agent.flush();
    ctx.expectEqual('backlog delivered on reconnect', replay.accepted, 4);
    ctx.expectEqual('queue drained after reconnect', agent.queueDepth, 0);

    // --- an interrupted upload replays the same batch ----------------------
    const duplicateBatch = [
      appSession('Microsoft Teams', 'teams.exe', at(90), 600),
      inactivity('locked', at(100), 300),
    ];

    const originalSend = await agent.resend(duplicateBatch);
    ctx.expectEqual('first delivery of the batch is accepted', originalSend.accepted, 2);

    // The agent never saw the acknowledgement and sends it again.
    const retry = await agent.resend(duplicateBatch);
    ctx.expectEqual('replayed batch stores nothing new', retry.accepted, 0);
    ctx.expectEqual('replayed batch is counted as duplicates', retry.duplicates, 2);

    // --- the outage must be visible, and counted once ---------------------
    const dateKey = toDateKey(base);
    const timeline = await admin.getTimeline(employee.id, dateKey);

    // 3 app sessions + 1 idle from before/during the outage, plus the
    // 2-event duplicate batch = 6 spans. The agent_log is not a timeline span.
    ctx.expectEqual('every span appears exactly once', timeline.entries.length, 6);

    const chromeSpans = timeline.entries.filter((entry) => entry.label === 'Google Chrome');
    ctx.expectEqual('the outage window is present once', chromeSpans.length, 1);

    const teamsSpans = timeline.entries.filter((entry) => entry.label === 'Microsoft Teams');
    ctx.expectEqual('the replayed span is not duplicated', teamsSpans.length, 1);

    // --- application totals must not be inflated by the replay ------------
    const applications = await admin.getApplications({
      from: dateKey,
      to: dateKey,
      employeeId: employee.id,
    });

    const teams = applications.applications.find((row) => row.exeName === 'teams.exe');
    ctx.expectEqual('replayed time counted once', teams?.durationSec, 600);
  },
};
