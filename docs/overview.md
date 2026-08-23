# Inside WorkPulse

A walkthrough of the project: what it does, how it's built, the decisions worth
defending, and a demo script.

WorkPulse is a Windows employee-activity tracker built around one deliberate
constraint: it measures **availability and application activity**, and it is
structurally incapable of recording keystrokes, screens, microphone or webcam.
That constraint is the product.

---

## The short version

A small agent runs on each employee's Windows machine. Every five seconds it
asks the OS two questions — which window has focus, and how long since the last
input — then turns the answers into completed spans and uploads them in batches.

A server stores those spans and derives everything else from them: who is online
right now, what they have open, how long they have been active, and an
attendance row for the day. An admin dashboard shows all of it live over a
WebSocket.

The interesting engineering is not the tracking. It is what happens when the
network drops, when two machines report at once, when a laptop sleeps for
sixteen hours, and when someone's access is revoked while their token is still
valid.

| | |
|---|---|
| Lines of code | ~19,000 |
| Automated checks | 302 |
| API endpoints | 36 |
| Dashboard pages | 13 |
| Agent binary | 3.4 MB |

---

## Architecture — four pieces, one contract

The agent and the server never negotiate a format at runtime. One schema file
defines the contract, both sides are built from it, and a self-test proves they
still agree.

```
┌──────────────────────────────────────────────────────┐
│  Windows agent                              [Rust]   │
│                                                      │
│  Reads the foreground window and the idle timer.     │
│  Turns raw samples into spans locally, so the        │
│  server stores one record per activity block         │
│  instead of one per sample. Queues to an encrypted   │
│  local database first, uploads second.               │
│                                                      │
│  Two binaries: the agent, and a tray app that        │
│  shows the employee what is being collected.         │
└───────────────────────┬──────────────────────────────┘
                        │
             batched HTTPS · 15-minute tokens
                        │
┌───────────────────────▼──────────────────────────────┐
│  API                              [Node · Fastify]   │
│                                                      │
│  Enrollment, authentication, role-based access,      │
│  telemetry ingest, and the presence engine that      │
│  decides who counts as online. Runs the background   │
│  worker that recomputes attendance.                  │
└───────────────────────┬──────────────────────────────┘
                        │
              time-series · TTL retention
                        │
┌───────────────────────▼──────────────────────────────┐
│  MongoDB                          [16 collections]   │
│                                                      │
│  Core records in normal collections; heartbeats in   │
│  a time-series collection because they arrive twice  │
│  a minute per device. Retention is enforced by       │
│  database TTL indexes rather than a cleanup job      │
│  that can silently stop running.                     │
└───────────────────────┬──────────────────────────────┘
                        │
             one WebSocket per dashboard
                        │
┌───────────────────────▼──────────────────────────────┐
│  Admin dashboard        [React · Vite · Tailwind]    │
│                                                      │
│  Thirteen pages. Live board, employee timeline,      │
│  attendance, application analytics, device           │
│  inventory, agent health, collection policy, and     │
│  an audit log. JetBrains Mono throughout, light      │
│  theme by default with a dark toggle.                │
└──────────────────────────────────────────────────────┘
```

---

## The five design decisions worth explaining

If you get asked "why did you build it that way", these are the answers.

### 1. Attendance is derived, never counted

There is no clock-in button and no running total. The attendance row is
recomputed from the underlying spans every time something changes.

**Why it matters.** A laptop that was offline all day uploads yesterday's work
today. A counter would double it. A recompute just produces the right answer
again. The same property makes the whole ingest path safe to retry.

### 2. Active time subtracts overlap, it doesn't sum

Active time is the *union* of application spans minus their intersection with
idle and locked spans — not the sum of durations.

**Why it matters.** An editor left focused while someone is away from the
keyboard is foreground time but not work. Summing would bill it twice: once as
app time, once as a day that looks longer than it was.

### 3. Offline is derived by the server

The agent can report active, idle, or locked. It can never report offline — the
server marks a device offline when heartbeats stop.

**Why it matters.** A machine that loses power cannot send "I'm gone". Making
offline a server-side inference is the only way it is ever correct, and it is
what lets the dashboard show someone dropping off without a refresh.

### 4. The password is used once, then discarded

An admin generates a one-time password. The agent trades it for a per-device
secret at enrollment and forgets it. Everything after that runs on fifteen-minute
tokens minted from the device secret.

**Why it matters.** A stolen laptop yields a credential that can be revoked for
that one machine. Revoking checks the database, so an unexpired token stops
working immediately rather than at expiry.

### 5. The product ships with no opinion about productivity

Every application counts as Neutral until an administrator classifies it.
Changing a rule affects new activity only; historical records keep the category
they were recorded with.

**Why it matters.** "VS Code is productive, YouTube is not" is a judgement the
software is in no position to make. And a rule change that silently rewrote last
month's report would make every report untrustworthy.

---

## Why this isn't spyware

This is the part most worth defending, because it is what distinguishes the
project from a hundred others.

| Collected | Never collected |
|---|---|
| active / idle / locked | keystrokes |
| which app has focus | clipboard |
| attendance times | passwords |
| device health | screen contents |
| | microphone |
| | webcam |

The right-hand column is not a setting. There is no policy, role, or
configuration that enables any of it, and no code path that could. Every Windows
API the software calls lives in a single Rust module — six of them, listed in
the README — so the claim is auditable in an afternoon rather than taken on
trust.

The sharpest example is idle detection. `GetLastInputInfo` returns **when** the
last keypress happened. It does not return **what** it was. That distinction is
the entire difference between activity tracking and keylogging.

The employee-facing tray app renders this same list, generated from the server's
live policy rather than hard-coded. If an admin enables window-title tracking,
the employee's screen says so. The software cannot collect something while
telling the person it doesn't.

---

## Verification — one command, four layers

`npm run verify` starts the server, runs everything, and shuts it down. Each
layer catches what the others structurally cannot.

| Layer | Checks | Count | What only this can catch |
|---|---|---:|---|
| Rust unit | state machine, sessionizer, queue, backoff | 109 | logic bugs, simulated in milliseconds |
| API integration | auth, roles, ingest, rollups — real database | 65 | tenant leaks, permission gaps |
| System scenarios | virtual agents driving the full pipeline | 108 | does a reported day produce the right numbers |
| Browser | Playwright against the real dashboard | 20 | the UI actually renders and wires up |

### The part worth pointing at

The system layer runs **virtual agents** — software endpoints that speak the real
wire protocol and validate every response against the shared schema. That makes
them a conformance check, not a load generator: if the API renames a field, it
fails immediately instead of the breakage surfacing weeks later on machines
already deployed.

The real Rust binary closes the last gap with a `--selftest` mode that runs the
same contract against a live server and exits non-zero on any mismatch, so it
can gate a rollout.

```
Result
  pass  typecheck   13.5s
  pass  api         38.0s
  pass  rust         3.9s
  pass  system      26.1s
  pass  e2e         49.7s

Everything passed.
```

---

## Four real bugs the tests caught

Worth mentioning out loud — it shows the tests do something rather than decorate
the repo.

**A manager with no department could see everyone unassigned.**
Department scoping filtered on `departmentId: null`, which matches every
employee who also has no department. A missing assignment silently became a
permission grant. It now fails closed — no department means no visibility.

**A wrong password reported as a network failure.**
The dashboard treated any 401 as an expired token and ran refresh-and-retry,
which swallowed the real message. Users were told to sign in again while they
were already trying to.

**A sixteen-hour sleep billed to whatever was open.**
The gap clamp applied when the focused app stayed the same but not when it
changed, so closing a laptop at 17:00 and opening it at 09:00 charged the night
to the old application. Now clamped on both paths.

**Windows 10 reporting itself as Windows 8.**
`GetVersion()` returns `6.2.9200` on every modern Windows unless the binary
carries a compatibility manifest. Reading the registry instead gives the real
build — `10.0.19045`.

---

## Demo script

Roughly six minutes. Each step sets up the next.

### 1. Start the system

```bash
npm run dev
# dashboard on :5173 · admin@acme.test / Admin123!pass
```

### 2. Issue an employee login

Employees → pick someone → **Login** → **Generate**. Point out that the password
appears once and is never retrievable — the dialog even hands you the enrollment
command.

### 3. Enrol a machine

```powershell
WorkPulseAgent.exe --enroll --server http://localhost:4000 `
    --user-id EMP-7378 --password '...'
```

Show the output: the agent prints exactly what it collects and what it does not,
before it collects anything.

### 4. Start the agent and watch the board

```powershell
WorkPulseAgent.exe --console
```

Open **Live Activity** beside the terminal. Switch between windows — the card
follows within a heartbeat, with no refresh. This is the moment that lands.

### 5. Open the employee timeline

Click through to the detail page. The timeline merges application and idle spans
into one track, so the *shape* of the day is visible — long focused blocks
versus constant switching.

### 6. Change policy, show it propagate

Policies → change the idle threshold → Save. The config version increments, and
the running agent picks it up on its next heartbeat. Then show the same change
sitting in the Audit Log with a before/after diff.

### 7. Revoke the device

Devices → Revoke. The agent's still-valid token stops working on the very next
request, because authorization checks the database rather than trusting the
token. Its recorded history stays.

### 8. Close on the test suite

Run `npm run verify` and let the five green stages land as the last slide.

---

## Where things live

```
packages/shared      the agent↔server contract — one schema, both sides
apps/api             Fastify server, presence engine, rollup worker
apps/admin           React dashboard, 13 pages, light + dark
apps/tester          virtual agents, 10 end-to-end scenarios
agent/               Rust workspace
  crates/wp-core       pure logic — testable off-Windows
  crates/wp-win        every Windows syscall, all six of them
  crates/wp-agent      WorkPulseAgent.exe
  crates/wp-tray       WorkPulseTray.exe — the transparency screen
e2e/                 Playwright specs
docs/                architecture · protocol · privacy · deployment
```

### Going deeper

| Document | Covers |
|---|---|
| [architecture.md](architecture.md) | presence engine, ingest pipeline, why Mongo alone |
| [protocol.md](protocol.md) | the full wire contract, every error code |
| [privacy.md](privacy.md) | what's collected, data protection, deployment advice |
| [deployment.md](deployment.md) | reverse proxy, service install, retention, scaling |

---

## A note before deploying

Employment monitoring is regulated differently across jurisdictions, and several
require notice, consultation, or a documented lawful basis before you begin. The
software supports a responsible deployment; it cannot enforce one. Read
[privacy.md](privacy.md) first.
