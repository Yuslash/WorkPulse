import { Context, runScenario, type Scenario, type ScenarioResult } from './harness.js';
import { apiUrl, wsUrl } from './config.js';

import { workdayScenario } from './scenarios/workday.js';
import { offlineReplayScenario } from './scenarios/offline-replay.js';
import { realtimeScenario, realtimeAuthScenario } from './scenarios/realtime.js';
import {
  policyPropagationScenario,
  revocationScenario,
  reEnrollmentScenario,
} from './scenarios/lifecycle.js';
import { privacyScenario, credentialScenario } from './scenarios/privacy.js';
import { scaleScenario } from './scenarios/scale.js';

/**
 * The tester.
 *
 * Drives a running API the way real agents and real dashboards do, then
 * prints a pass/fail matrix. Exits non-zero on any failure so `npm run
 * verify` and CI can gate on it.
 */

const SCENARIOS: Scenario[] = [
  workdayScenario,
  offlineReplayScenario,
  realtimeScenario,
  realtimeAuthScenario,
  policyPropagationScenario,
  revocationScenario,
  reEnrollmentScenario,
  privacyScenario,
  credentialScenario,
  scaleScenario,
];

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

async function waitForApi(url: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function printResult(result: ScenarioResult): void {
  const failed = result.checks.filter((check) => !check.passed);
  const icon = failed.length === 0 && !result.error ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;

  console.log(
    `\n  ${icon}  ${BOLD}${result.name}${RESET} ${DIM}(${result.checks.length} checks, ${result.durationMs}ms)${RESET}`,
  );

  for (const check of result.checks) {
    if (check.passed) {
      console.log(`         ${GREEN}+${RESET} ${DIM}${check.name}${RESET}`);
    } else {
      console.log(`         ${RED}-${RESET} ${check.name}`);
      if (check.detail) console.log(`           ${RED}${check.detail}${RESET}`);
    }
  }

  if (result.error) {
    console.log(`         ${RED}! scenario aborted: ${result.error}${RESET}`);
  }
}

async function main(): Promise<void> {
  console.log(`${BOLD}WorkPulse system tester${RESET}`);
  console.log(`  api : ${apiUrl}`);
  console.log(`  ws  : ${wsUrl}`);

  // Filter by name from the command line: `npm run test:sim -- workday`.
  const filter = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  const selected =
    filter.length > 0
      ? SCENARIOS.filter((scenario) =>
          filter.some((name) => scenario.name.toLowerCase().includes(name.toLowerCase())),
        )
      : SCENARIOS;

  if (selected.length === 0) {
    console.error(`\n${RED}No scenarios matched: ${filter.join(', ')}${RESET}`);
    process.exit(1);
  }

  if (!(await waitForApi(apiUrl))) {
    console.error(
      `\n${RED}The API at ${apiUrl} is not responding.${RESET}\n` +
        `Start it with ${BOLD}npm run dev:api${RESET}, or run ${BOLD}npm run verify${RESET} which starts it for you.`,
    );
    process.exit(1);
  }

  const results: ScenarioResult[] = [];
  const started = Date.now();

  // Scenarios run sequentially: several mutate shared organization policy,
  // and interleaving them would produce failures that are about ordering
  // rather than about the system.
  for (const scenario of selected) {
    const ctx = new Context(apiUrl, wsUrl);
    const result = await runScenario(scenario, ctx);
    results.push(result);
    printResult(result);
  }

  // --- summary -----------------------------------------------------------
  const allChecks = results.flatMap((result) => result.checks);
  const failedChecks = allChecks.filter((check) => !check.passed);
  const failedScenarios = results.filter(
    (result) => result.error || result.checks.some((check) => !check.passed),
  );

  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  Scenarios : ${results.length - failedScenarios.length}/${results.length} passed`);
  console.log(`  Checks    : ${allChecks.length - failedChecks.length}/${allChecks.length} passed`);
  console.log(`  Duration  : ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (failedScenarios.length > 0) {
    console.log(`\n${RED}${BOLD}Failed scenarios:${RESET}`);
    for (const result of failedScenarios) {
      console.log(`  ${RED}-${RESET} ${result.name}`);
      for (const check of result.checks.filter((c) => !c.passed)) {
        console.log(`      ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
      }
      if (result.error) console.log(`      aborted: ${result.error}`);
    }
    process.exit(1);
  }

  console.log(`\n${GREEN}${BOLD}All scenarios passed.${RESET}`);
}

main().catch((error) => {
  console.error(`\n${RED}The tester crashed:${RESET}`, error);
  process.exit(1);
});
