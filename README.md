# WorkPulse

Transparent employee activity tracking: a Windows endpoint agent, a telemetry
API, and a real-time admin dashboard.

The product records **activity metadata** — which application has focus, when
the machine is idle or locked, attendance times, device health. It does not
record keystrokes, clipboard contents, passwords, screen contents, microphone
or webcam, and there is no setting that turns any of those on. The agent ships
with a tray application that shows each employee exactly what is being
collected, generated from the live server policy rather than from a promise
compiled into the binary.

---

## Quick start

```bash
npm install
npm run db:indexes        # create collections, indexes, TTLs
npm run seed              # demo organization, admin, employees
npm run dev               # api on :4000, dashboard on :5173
```

Sign in at <http://localhost:5173> with the credentials the seed prints
(`admin@acme.test` / `Admin123!pass` by default).

To enrol this machine as an employee device:

```bash
# 1. In the dashboard: Employees -> pick someone -> Login -> Generate login
# 2. Build and enrol the agent
npm run agent:build
cd agent/target/release
./WorkPulseAgent.exe --enroll --server http://localhost:4000 \
    --user-id EMP-1234 --password 'Xk7f-2Qmb-91Zc'
./WorkPulseAgent.exe --console
```

Watch the Live Activity page — the board updates without a refresh.

---

## Verification

One command runs everything:

```bash
npm run verify
```

| Stage | What it proves |
|---|---|
| `typecheck` | shared, api, tester and admin all compile against one set of types |
| `api` | 65 integration tests against a real `workpulse_test` database |
| `rust` | 100+ unit tests: state machine, sessionizer, encrypted queue, backoff |
| `system` | 10 scenarios, ~108 assertions — virtual agents driving the full pipeline |
| `e2e` | 20 Playwright tests against the real dashboard in a real browser |

```bash
npm run verify:fast          # skip the Rust build and browser tests
npm run verify -- --only=api # one stage
npm run test:sim -- workday  # one scenario
```

The API is started and stopped by `verify` itself; nothing needs a terminal
left open. The test-database guard in `apps/api/tests/setup.ts` aborts unless
the target database is exactly `workpulse_test`.

Protocol conformance for the **real Rust binary** (not the TypeScript
simulator) is a separate check:

```bash
./WorkPulseAgent.exe --selftest --server http://localhost:4000 \
    --user-id EMP-1234 --password '...'
```

---

## Layout

```
packages/shared      Zod schemas + types. The agent↔API contract lives here.
apps/api             Fastify + MongoDB. buildApp() is exported so tests mount it.
apps/admin           React + Vite + Tailwind. JetBrains Mono, light + dark.
apps/tester          Virtual agents driving end-to-end scenarios.
agent/               Rust workspace.
  crates/wp-core       Pure logic: state machine, sessionizer, queue, transport.
  crates/wp-win        Every Windows syscall the product makes.
  crates/wp-agent      WorkPulseAgent.exe — service, console, enrol, selftest.
  crates/wp-tray       WorkPulseTray.exe — the employee transparency screen.
e2e/                 Playwright specs.
scripts/             install-rust.ps1, install-service.ps1, verify.mjs
docs/                architecture, protocol, privacy, deployment
```

---

## What the agent touches

The complete list of Windows APIs this software calls, all in
`agent/crates/wp-win`:

| API | Why |
|---|---|
| `GetForegroundWindow`, `GetWindowTextW` | which application has focus |
| `GetWindowThreadProcessId`, `OpenProcess`, `QueryFullProcessImageNameW` | which executable that is |
| `GetLastInputInfo` | how long since any input — a timestamp, never a key |
| `GlobalMemoryStatusEx`, `GetSystemInfo`, registry read | device inventory |
| `CryptProtectData` | sealing the device secret at rest |
| `Shell_NotifyIconW` | the tray icon |

There is no keyboard hook, no clipboard access, no screen capture, and no
process enumeration beyond the focused window.

---

## Authentication

```
ADMIN                              AGENT / DEVICE
POST /api/auth/login               1. Admin generates a login for an employee:
  -> access JWT (15m, in memory)      userId EMP-4021 + one-time password
  -> refresh token (httpOnly, 7d)     (scrypt-hashed; plaintext shown once)
  -> rotates on every refresh
                                   2. The employee enters them once:
Roles, least to most:                 POST /api/agent/enroll
  TEAM_LEAD                           -> deviceId + deviceSecret (once)
  MANAGER    own department           the password is then discarded
  HR_ADMIN   whole organization
  ORG_OWNER  + collection policy    3. Steady state:
  SUPER_ADMIN                          POST /api/agent/token {deviceId, secret}
                                       -> 15m access token
```

Revoking a device kills that machine only, immediately — authorization checks
the database, so an unexpired token stops working the moment it is revoked.

Every privileged action is audited, including *reading* an employee record.

---

## Environment

Everything reads the single `.env` at the repo root. See `.env.example`.

WorkPulse creates and touches only two databases: `workpulse` and
`workpulse_test`. Nothing else on the cluster is read or modified.

---

## Documentation

**Start here:** [`docs/overview.md`](docs/overview.md) — what the project is, the
design decisions worth explaining, and a demo script. Written to be read
top-to-bottom.

Reference:

- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit together
- [`docs/protocol.md`](docs/protocol.md) — the agent↔API contract
- [`docs/privacy.md`](docs/privacy.md) — what is collected and what is not
- [`docs/deployment.md`](docs/deployment.md) — running it for real
