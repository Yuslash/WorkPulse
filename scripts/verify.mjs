#!/usr/bin/env node
/**
 * `npm run verify` — the whole suite, one command.
 *
 * Runs the stages in dependency order and stops at the first failure, because
 * a broken typecheck makes every later failure noise. The API is started and
 * torn down here, so the tester and the browser tests never need a terminal
 * left open in the background.
 *
 *   --fast   skip the Rust build and the browser tests
 *   --only=  run one stage by name
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === 'win32';

/**
 * Resolves the Rust toolchain without depending on the caller's PATH.
 *
 * rustup installs to the user profile and does not modify PATH by default,
 * and the windows-gnu target needs mingw's dlltool alongside it. A shell that
 * was opened before either was installed would otherwise fail this stage even
 * though the toolchain is present.
 */
function rustPath() {
  const extra = [];
  const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
  if (existsSync(cargoBin)) extra.push(cargoBin);

  if (isWindows) {
    const packages = path.join(
      os.homedir(),
      'AppData',
      'Local',
      'Microsoft',
      'WinGet',
      'Packages',
    );

    try {
      for (const entry of readdirSync(packages)) {
        if (!entry.startsWith('BrechtSanders.WinLibs')) continue;
        const bin = path.join(packages, entry, 'mingw64', 'bin');
        if (existsSync(bin)) extra.push(bin);
      }
    } catch {
      // No winget packages directory; the linker may already be on PATH.
    }
  }

  return extra.length > 0 ? `${extra.join(path.delimiter)}${path.delimiter}${process.env.PATH}` : process.env.PATH;
}

function hasCargo() {
  return existsSync(path.join(os.homedir(), '.cargo', 'bin', isWindows ? 'cargo.exe' : 'cargo'));
}

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

const args = process.argv.slice(2);
const fast = args.includes('--fast');
const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);

/** Runs a command, streaming output. Resolves with the exit code. */
function run(command, commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? root,
      // Windows needs a shell to resolve npm/npx/cargo shims.
      shell: isWindows,
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...options.env },
    });

    let output = '';
    if (options.quiet) {
      child.stdout?.on('data', (chunk) => (output += chunk));
      child.stderr?.on('data', (chunk) => (output += chunk));
    }

    child.on('close', (code) => resolve({ code: code ?? 1, output }));
    child.on('error', (error) => resolve({ code: 1, output: String(error) }));
  });
}

/** Starts the API and waits for /health. Returns a stop function. */
async function startApi() {
  const env = {
    NODE_ENV: 'development',
    // The suite hammers login and enrollment far harder than a human would.
    RATE_LIMIT_ENABLED: 'false',
  };

  const child = spawn('npm', ['run', 'dev:api'], {
    cwd: root,
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });

  let log = '';
  child.stdout?.on('data', (chunk) => (log += chunk));
  child.stderr?.on('data', (chunk) => (log += chunk));

  const port = process.env.API_PORT ?? '4000';
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      console.error(`${RED}The API exited before becoming ready:${RESET}\n${log}`);
      return null;
    }

    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) {
        return () =>
          new Promise((resolve) => {
            child.once('close', () => resolve());
            // On Windows a plain kill leaves the tsx child running.
            if (isWindows) {
              spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true });
            } else {
              child.kill('SIGTERM');
            }
            setTimeout(resolve, 5000);
          });
      }
    } catch {
      // Not listening yet.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.error(`${RED}The API did not become ready within 60s:${RESET}\n${log}`);
  return null;
}

const stages = [
  {
    name: 'typecheck',
    description: 'shared + api + tester + admin',
    run: async () => {
      // The shared package must be built first: everything imports its .d.ts.
      const build = await run('npm', ['run', 'build:shared']);
      if (build.code !== 0) return build.code;
      return (await run('npm', ['run', 'typecheck'])).code;
    },
  },
  {
    name: 'api',
    description: 'vitest against a real workpulse_test database',
    run: async () => (await run('npm', ['run', 'test:api'])).code,
  },
  {
    name: 'rust',
    description: 'cargo test across the agent workspace',
    skip: () => fast,
    run: async () => {
      if (!existsSync(path.join(root, 'agent', 'Cargo.toml'))) {
        console.log(`${YELLOW}  no agent workspace; skipping${RESET}`);
        return 0;
      }
      if (!hasCargo()) {
        console.log(`${YELLOW}  Rust is not installed; skipping${RESET}`);
        console.log(`${DIM}  install it with: powershell -File scripts/install-rust.ps1${RESET}`);
        return 0;
      }

      return (
        await run('cargo', ['test', '--workspace'], {
          cwd: path.join(root, 'agent'),
          env: { PATH: rustPath(), Path: rustPath() },
        })
      ).code;
    },
  },
  {
    name: 'system',
    description: 'virtual agents driving the full pipeline',
    needsApi: true,
    run: async () => (await run('npm', ['run', 'test:sim'])).code,
  },
  {
    name: 'e2e',
    description: 'playwright against the real dashboard',
    needsApi: true,
    skip: () => fast,
    run: async () => {
      if (!existsSync(path.join(root, 'node_modules', '@playwright', 'test'))) {
        console.log(`${YELLOW}  playwright is not installed; skipping${RESET}`);
        console.log(`${DIM}  install it with: npm run e2e:install${RESET}`);
        return 0;
      }
      return (await run('npm', ['run', 'test:e2e'])).code;
    },
  },
];

async function main() {
  const selected = only ? stages.filter((stage) => stage.name === only) : stages;

  if (selected.length === 0) {
    console.error(`${RED}Unknown stage: ${only}${RESET}`);
    console.error(`Available: ${stages.map((stage) => stage.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`${BOLD}WorkPulse verify${RESET}${fast ? `${DIM} (fast)${RESET}` : ''}\n`);

  // Only pay the API startup cost if a selected stage actually needs it.
  const needsApi = selected.some((stage) => stage.needsApi && !stage.skip?.());
  let stopApi = null;

  if (needsApi) {
    console.log(`${DIM}Starting the API...${RESET}`);
    stopApi = await startApi();
    if (!stopApi) process.exit(1);
    console.log(`${GREEN}API ready.${RESET}\n`);
  }

  const results = [];
  let failed = false;

  try {
    for (const [index, stage] of selected.entries()) {
      if (stage.skip?.()) {
        console.log(`${YELLOW}[${index + 1}/${selected.length}] ${stage.name} — skipped${RESET}\n`);
        results.push({ name: stage.name, status: 'skipped' });
        continue;
      }

      console.log(
        `${BOLD}[${index + 1}/${selected.length}] ${stage.name}${RESET} ${DIM}${stage.description}${RESET}`,
      );

      const started = Date.now();
      const code = await stage.run();
      const seconds = ((Date.now() - started) / 1000).toFixed(1);

      if (code === 0) {
        console.log(`${GREEN}  passed${RESET} ${DIM}(${seconds}s)${RESET}\n`);
        results.push({ name: stage.name, status: 'passed', seconds });
      } else {
        console.log(`${RED}  failed${RESET} ${DIM}(${seconds}s)${RESET}\n`);
        results.push({ name: stage.name, status: 'failed', seconds });
        failed = true;
        // Later stages depend on earlier ones; continuing would only add noise.
        break;
      }
    }
  } finally {
    if (stopApi) {
      console.log(`${DIM}Stopping the API...${RESET}`);
      await stopApi();
    }
  }

  console.log(`${BOLD}Result${RESET}`);
  for (const result of results) {
    const mark =
      result.status === 'passed'
        ? `${GREEN}pass${RESET}`
        : result.status === 'failed'
          ? `${RED}FAIL${RESET}`
          : `${YELLOW}skip${RESET}`;
    console.log(`  ${mark}  ${result.name}${result.seconds ? ` ${DIM}${result.seconds}s${RESET}` : ''}`);
  }

  if (failed) {
    console.log(`\n${RED}${BOLD}Verification failed.${RESET}`);
    process.exit(1);
  }

  console.log(`\n${GREEN}${BOLD}Everything passed.${RESET}`);
}

main().catch((error) => {
  console.error(`${RED}verify crashed:${RESET}`, error);
  process.exit(1);
});
