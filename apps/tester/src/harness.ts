import { setTimeout as sleep } from 'node:timers/promises';

/**
 * A tiny scenario harness.
 *
 * Deliberately not a test framework: scenarios drive a running system over
 * HTTP and WebSocket, and the value is in the pass/fail matrix at the end,
 * not in per-assertion tooling.
 */

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
  durationMs: number;
}

export interface ScenarioResult {
  name: string;
  checks: CheckResult[];
  error?: string;
  durationMs: number;
}

export class Context {
  readonly checks: CheckResult[] = [];

  constructor(
    readonly apiUrl: string,
    readonly wsUrl: string,
  ) {}

  /** Records a check. Never throws, so one failure does not hide later ones. */
  check(name: string, passed: boolean, detail?: string): boolean {
    this.checks.push({ name, passed, detail, durationMs: 0 });
    return passed;
  }

  expectEqual<T>(name: string, actual: T, expected: T): boolean {
    const passed = Object.is(actual, expected);
    return this.check(name, passed, passed ? undefined : `expected ${String(expected)}, got ${String(actual)}`);
  }

  expectTrue(name: string, value: boolean, detail?: string): boolean {
    return this.check(name, value, detail);
  }

  /**
   * Polls until `predicate` holds. Background workers (attendance rollups,
   * the presence sweeper) are asynchronous, so scenarios wait for a condition
   * rather than sleeping a guessed interval.
   */
  async waitFor(
    name: string,
    predicate: () => Promise<boolean>,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<boolean> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const intervalMs = options.intervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        if (await predicate()) return this.check(name, true);
      } catch {
        // Transient failures while waiting are expected; keep polling.
      }
      await sleep(intervalMs);
    }

    return this.check(name, false, `condition not met within ${timeoutMs}ms`);
  }
}

export interface Scenario {
  name: string;
  description: string;
  run: (ctx: Context) => Promise<void>;
}

export async function runScenario(scenario: Scenario, ctx: Context): Promise<ScenarioResult> {
  const started = Date.now();
  const before = ctx.checks.length;
  let error: string | undefined;

  try {
    await scenario.run(ctx);
  } catch (caught) {
    // A thrown error means the scenario could not continue; it is reported
    // alongside whatever checks did complete.
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
  }

  return {
    name: scenario.name,
    checks: ctx.checks.slice(before),
    error,
    durationMs: Date.now() - started,
  };
}

export { sleep };
