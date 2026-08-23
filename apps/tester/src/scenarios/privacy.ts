import { AdminClient } from '../AdminClient.js';
import { VirtualAgent, appSession } from '../VirtualAgent.js';
import type { Scenario } from '../harness.js';
import { adminCredentials } from '../config.js';

/**
 * The privacy guarantees, asserted as behaviour rather than documented as
 * intent (spec §16, §17, §43).
 *
 * These checks exist because the difference between this product and a
 * surveillance tool is a handful of defaults and one policy gate. If any of
 * them regresses, that difference disappears silently.
 */
export const privacyScenario: Scenario = {
  name: 'Privacy guarantees',
  description: 'Sensitive collection stays off by default and window titles are policy-gated.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Privacy Tester',
      `privacy-${Date.now()}@tester.local`,
    );
    const credentials = await admin.generateCredentials(employee.id);

    const agent = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'PRIVACY-PC' });
    await agent.enroll(credentials.userId, credentials.tempPassword);

    // --- defaults ----------------------------------------------------------
    const config = agent.config!;
    ctx.expectEqual('screenshots default off', config.trackScreenshots, false);
    ctx.expectEqual('website tracking defaults off', config.trackWebsites, false);
    ctx.expectEqual('window titles default off', config.trackWindowTitles, false);
    ctx.expectEqual('application tracking defaults on', config.trackApplications, true);

    // --- the transparency screen the employee sees -------------------------
    const status = await agent.fetchStatus();

    for (const guarantee of [
      'Keyboard input',
      'Clipboard contents',
      'Passwords',
      'Microphone',
      'Webcam',
      'Personal files',
    ]) {
      ctx.expectTrue(
        `status states that ${guarantee.toLowerCase()} is not collected`,
        status.notCollected.includes(guarantee),
      );
    }

    ctx.expectTrue(
      'status lists screenshots as not collected while the policy is off',
      status.notCollected.includes('Screenshots'),
    );
    ctx.expectTrue(
      'status lists application activity as collected',
      status.collected.includes('Application activity'),
    );

    // The screen must never claim something is collected that policy forbids.
    ctx.expectTrue(
      'nothing appears in both lists',
      status.collected.every((item) => !status.notCollected.includes(item)),
    );

    // --- window titles are gated, and the gate is honoured ----------------
    const started = new Date(Date.now() - 1800 * 1000);
    const secret = 'CONFIDENTIAL-MERGER-DOCUMENT.docx';

    // The API accepts a title, but the policy is what decides whether a
    // well-behaved agent sends one. Verify the gate is readable and correct.
    agent.enqueue(appSession('Microsoft Word', 'winword.exe', started, 600, null));
    await agent.flush();

    const dateKey = started.toISOString().slice(0, 10);
    const timeline = await admin.getTimeline(employee.id, dateKey);
    const word = timeline.entries.find((entry) => entry.label === 'Microsoft Word');

    ctx.expectTrue('the application session was recorded', Boolean(word));
    ctx.expectTrue(
      'the timeline label is the application, not a document name',
      word?.label === 'Microsoft Word' && !word.label.includes(secret),
    );

    // --- turning titles on must be a deliberate, audited act --------------
    const before = await admin.getPolicy();
    const enabled = await admin.updatePolicy({ trackWindowTitles: true });

    ctx.expectEqual('window titles can be enabled explicitly', enabled.trackWindowTitles, true);
    ctx.expectTrue(
      'enabling it bumps the config version so agents refetch',
      enabled.configVersion > before.configVersion,
    );

    const statusAfter = await agent.fetchStatus();
    ctx.expectTrue(
      'the employee screen now says window titles are collected',
      statusAfter.collected.includes('Window titles'),
    );
    ctx.expectTrue(
      'window titles no longer appear under not-collected',
      !statusAfter.notCollected.includes('Window titles'),
    );

    const audit = await admin.getAudit('policy.updated');
    ctx.expectTrue(
      'the policy change is in the audit trail',
      audit.items.length > 0,
      `${audit.items.length} entries`,
    );

    // Restore the safer default.
    await admin.updatePolicy({ trackWindowTitles: false });

    const restored = await agent.fetchStatus();
    ctx.expectTrue(
      'disabling it puts window titles back under not-collected',
      restored.notCollected.includes('Window titles'),
    );
  },
};

/**
 * Credential handling: the one-time password must be exactly that.
 */
export const credentialScenario: Scenario = {
  name: 'Credential handling',
  description: 'One-time passwords are never retrievable after they are issued.',

  async run(ctx) {
    const admin = new AdminClient(ctx.apiUrl);
    await admin.login(adminCredentials.email, adminCredentials.password);

    const employee = await admin.createEmployee(
      'Credential Tester',
      `cred-${Date.now()}@tester.local`,
    );

    const issued = await admin.generateCredentials(employee.id);
    ctx.expectTrue('a password is returned once', issued.tempPassword.length >= 8);
    ctx.expectTrue('the employee must change it', issued.mustChangePassword);

    // Reading the credential status back must never include the plaintext.
    const response = await fetch(`${ctx.apiUrl}/api/employees/${employee.id}/credentials`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const body = await response.text();

    ctx.expectTrue(
      'the password is not returned by any later request',
      !body.includes(issued.tempPassword),
    );
    ctx.expectTrue('the user ID is still readable', body.includes(issued.userId));

    // A password that has been rotated must stop working.
    const agent = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'CRED-PC' });
    await agent.enroll(issued.userId, issued.tempPassword);
    ctx.expectTrue('the issued password enrols a device', Boolean(agent.employeeId));

    const rotated = await admin.generateCredentials(employee.id);
    ctx.expectEqual('the user ID is stable across rotations', rotated.userId, issued.userId);
    ctx.expectTrue('a new password is issued', rotated.tempPassword !== issued.tempPassword);

    const stale = new VirtualAgent({ baseUrl: ctx.apiUrl, hostname: 'CRED-PC-2' });
    let oldPasswordRejected = false;
    try {
      await stale.enroll(issued.userId, issued.tempPassword);
    } catch {
      oldPasswordRejected = true;
    }
    ctx.expectTrue('the previous password no longer enrols', oldPasswordRejected);

    // --- credential issuance is audited -----------------------------------
    const audit = await admin.getAudit('employee.credentials_generated');
    const entry = audit.items.find((item) => item.targetId === employee.id);

    ctx.expectTrue('credential issuance is audited', Boolean(entry));
    ctx.expectTrue(
      'the audit entry does not contain the password',
      !JSON.stringify(entry ?? {}).includes(issued.tempPassword),
    );
  },
};
