import { toDateKey } from '@workpulse/shared';
import { AdminClient } from '../AdminClient.js';
import { VirtualAgent, appSession, inactivity } from '../VirtualAgent.js';
import type { Scenario } from '../harness.js';
import { adminCredentials } from '../config.js';

/**
 * A full working day, end to end.
 *
 * The point is not that each endpoint returns 200 — the API test suite covers
 * that. It is that a day of reported activity produces the *right numbers* on
 * the pages an admin actually reads: the timeline, the application breakdown
 * and the attendance row.
 */
export const workdayScenario: Scenario = {
  name: 'Workday',
  description: 'One employee works a full day; the dashboard reflects it accurately.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Workday Tester',
      `workday-${Date.now()}@tester.local`,
    );
    const credentials = await admin.generateCredentials(employee.id);

    ctx.expectTrue(
      'credentials use the EMP-nnnn format',
      /^EMP-\d{4}$/.test(credentials.userId),
      credentials.userId,
    );

    const agent = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'WORKDAY-PC' });
    await agent.enroll(credentials.userId, credentials.tempPassword);

    ctx.expectTrue('agent enrolled', agent.employeeId === employee.id);
    ctx.expectTrue('screenshots are off by default', agent.config?.trackScreenshots === false);
    ctx.expectTrue('websites are off by default', agent.config?.trackWebsites === false);

    // Anchored to 02:00 UTC yesterday: always in the past (so nothing is
    // rejected as future-dated) and always inside one UTC day, whatever time
    // the suite happens to run.
    const dayStart = new Date(Date.now() - 24 * 3600 * 1000);
    dayStart.setUTCHours(2, 0, 0, 0);
    const at = (offsetMin: number) => new Date(dayStart.getTime() + offsetMin * 60_000);

    // A day with a deliberate overlap: the editor stays focused from 02:00 to
    // 04:00, but the person is away from the keyboard from 03:20 to 03:40.
    // Those 20 minutes are foreground time that is NOT active work, and the
    // exact-value assertions below are what catch double counting.
    //
    //   02:00–03:00  VS Code        3600s
    //   03:00–04:00  VS Code        3600s
    //   03:20–03:40  idle           1200s   (inside the VS Code block)
    //   04:00–04:40  Chrome         2400s
    //   04:40–05:25  locked         2700s
    //   05:25–06:40  VS Code        4500s
    agent.enqueue(appSession('Visual Studio Code', 'Code.exe', at(0), 3600));
    agent.enqueue(appSession('Visual Studio Code', 'Code.exe', at(60), 3600));
    agent.enqueue(inactivity('idle', at(80), 1200));
    agent.enqueue(appSession('Google Chrome', 'chrome.exe', at(120), 2400));
    agent.enqueue(inactivity('locked', at(160), 2700));
    agent.enqueue(appSession('Visual Studio Code', 'Code.exe', at(205), 4500));

    const flush = await agent.flush();
    ctx.expectEqual('all six events accepted', flush.accepted, 6);
    ctx.expectEqual('nothing rejected', flush.rejected, 0);
    ctx.expectEqual('queue drained', agent.queueDepth, 0);

    await agent.heartbeat('ACTIVE', { currentApplication: 'Visual Studio Code' });

    // --- the timeline an admin would open ---------------------------------
    const dateKey = toDateKey(dayStart);
    const timeline = await admin.getTimeline(employee.id, dateKey);

    ctx.expectEqual('timeline has six spans', timeline.entries.length, 6);
    ctx.expectTrue(
      'timeline is chronological',
      timeline.entries.every(
        (entry, index) => index === 0 || entry.startedAt >= timeline.entries[index - 1]!.startedAt,
      ),
    );
    ctx.expectTrue(
      'timeline merges applications and inactivity',
      timeline.entries.some((entry) => entry.kind === 'app') &&
        timeline.entries.some((entry) => entry.kind === 'idle') &&
        timeline.entries.some((entry) => entry.kind === 'locked'),
    );

    // --- application analytics --------------------------------------------
    const applications = await admin.getApplications({
      from: dateKey,
      to: dateKey,
      employeeId: employee.id,
    });

    const code = applications.applications.find((row) => row.exeName === 'code.exe');
    const chrome = applications.applications.find((row) => row.exeName === 'chrome.exe');

    // Three separate VS Code sessions must aggregate into one row.
    ctx.expectEqual('VS Code time is summed across sessions', code?.durationSec, 3600 + 3600 + 4500);
    ctx.expectEqual('Chrome time recorded', chrome?.durationSec, 2400);
    ctx.expectTrue(
      'the executable name is normalized to lowercase',
      applications.applications.every((row) => row.exeName === row.exeName.toLowerCase()),
    );

    // --- attendance --------------------------------------------------------
    await admin.recomputeAttendance(employee.id, dateKey);
    const attendance = await admin.getAttendance(dateKey);
    const row = attendance.rows.find((entry) => entry.employeeId === employee.id);

    ctx.expectTrue('attendance row exists', Boolean(row));

    if (row) {
      ctx.expectEqual('idle time recorded', row.idleSec, 1200);
      ctx.expectEqual('locked time recorded', row.lockedSec, 2700);

      // Foreground time is the union of the app spans, not their sum:
      // 02:00–04:40 is contiguous (9600s) plus 05:25–06:40 (4500s) = 14100s.
      // The 1200s idle sits inside that block and must be subtracted once,
      // giving 12900s. A naive sum would report 14100 and a double-subtract
      // would report less — the exact value is what pins the behaviour down.
      ctx.expectEqual('active time excludes the overlapping idle', row.activeSec, 12900);

      // The lock sits between two app spans and overlaps neither, so it must
      // not be subtracted a second time.
      ctx.expectTrue(
        'the non-overlapping lock is not double counted',
        row.activeSec + row.idleSec === 14100,
        `active ${row.activeSec} + idle ${row.idleSec}`,
      );

      const sessionSpan = Math.round(
        (new Date(row.lastSeen!).getTime() - new Date(row.firstSeen!).getTime()) / 1000,
      );
      ctx.expectEqual('session spans first to last activity', sessionSpan, 280 * 60);
      ctx.expectTrue(
        'session seconds match the span',
        Math.abs(row.sessionSec - sessionSpan) <= 1,
        `sessionSec ${row.sessionSec} vs span ${sessionSpan}`,
      );
      ctx.expectTrue(
        'session time exceeds active time because it includes breaks',
        row.sessionSec > row.activeSec,
      );
    }

    // --- the employee row on the list page --------------------------------
    const refreshed = await admin.getEmployee(employee.id);
    ctx.expectTrue('employee shows one enrolled device', refreshed.deviceCount === 1);
    ctx.expectTrue('employee shows credentials issued', refreshed.hasCredentials);
  },
};
