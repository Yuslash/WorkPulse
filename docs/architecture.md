# Architecture

```
                    ┌─────────────────────────────┐
                    │       Admin Dashboard       │
                    │  React · Vite · Tailwind    │
                    │  JetBrains Mono, light/dark │
                    └──────────────┬──────────────┘
                       HTTPS + one WebSocket
                                   │
                    ┌──────────────▼──────────────┐
                    │        API (Fastify)        │
                    │  auth · RBAC · agent proto  │
                    │  presence hub · rollups     │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │      MongoDB (Atlas)        │
                    │  core collections           │
                    │  heartbeats (time-series)   │
                    │  TTL-enforced retention     │
                    └─────────────────────────────┘
                                   ▲
                          HTTPS, batched
                                   │
                    ┌──────────────┴──────────────┐
                    │   WorkPulseAgent.exe (Rust) │
                    │   service │ console │ enrol │
                    │   encrypted offline queue   │
                    ├─────────────────────────────┤
                    │   WorkPulseTray.exe (Rust)  │
                    │   employee transparency     │
                    └─────────────────────────────┘
```

## Why this shape

**MongoDB alone, not Postgres + ClickHouse + Redis.** The original brief
proposed three data stores. One covers this workload: time-series collections
handle the heartbeat volume, TTL indexes handle retention without a cleanup
job, and presence is an in-process cache rehydrated from Mongo on boot. Adding
Redis buys horizontal scaling of the WebSocket layer, which is the natural
first change when a single API process is no longer enough — not before.

**Rust for the agent.** It runs on every employee's machine, so its footprint
is the customer's cost: a 3.4 MB single binary, no runtime to install, and no
garbage collector pausing a background service. It also builds for
`x86_64-pc-windows-gnu`, which means the toolchain installs without Visual
Studio.

**Logic separated from syscalls.** `wp-core` is pure and platform-independent;
`wp-win` holds every Windows API call. That split is what lets an eight-hour
workday be simulated in a millisecond in a unit test, and it keeps the list of
things the software touches on someone's machine short enough to audit.

---

## Presence: the status engine

Presence has two sources of truth that must be reconciled:

- what the agent last **said** — ACTIVE, IDLE, or LOCKED
- whether it is still **talking** — heartbeats arriving

`OFFLINE` is never reported by an agent. A machine that loses power cannot
send "I'm gone", so the server derives it: a sweeper marks devices offline once
heartbeats stop for longer than `PRESENCE_OFFLINE_AFTER_SEC`. It runs on an
interval rather than being computed at read time, specifically so the
transition emits a WebSocket event and the dashboard shows someone dropping off
without a refresh.

The in-memory presence map is a cache over the `devices` collection, not a
second source of truth. It is rebuilt on boot, so an API restart does not blank
the live board — and devices that went quiet while the API was down come back
as OFFLINE rather than frozen in whatever they last reported.

`stateSince` is stamped only on a genuine transition. Without that, a steady
stream of 30-second ACTIVE heartbeats would reset "active for 2h 17m" twice a
minute.

---

## Telemetry ingest

The agent sessionizes locally: it turns a stream of foreground-window samples
into completed spans and uploads those. One document per span instead of one
per sample is the difference between a few hundred writes a day and a few
hundred thousand.

Ingest is **idempotent on `eventId`**, enforced by a unique index. An agent
that loses its connection mid-upload replays the same batch, and duplicates are
counted rather than stored. Bulk writes are unordered so one duplicate cannot
abort the rest of a batch.

Spans are validated on arrival. A span that ends before it starts, ends in the
future, or whose `durationSec` disagrees with its timestamps is rejected with a
reason. Endpoint clocks drift and are sometimes simply wrong, and a
future-dated span would otherwise inflate someone's working day.

---

## Attendance is derived

Attendance is recomputed from source spans, never incremented:

```
activeSec = union(app spans) − overlap(app spans, idle/locked spans)
```

Two properties fall out of this that a counter would not give:

- **Replay-safe.** An offline agent delivering yesterday's data today produces
  the right answer again. An incremental counter would double-count.
- **Overlap-correct.** An editor left focused while someone is away from the
  keyboard is foreground time but not active work. The union-then-subtract
  handles both overlapping app sessions (a race at a window switch) and
  idle-inside-a-session without double counting.

Recompute is debounced: ingest marks an (employee, day) dirty and a worker
drains the set, so a 500-event batch triggers one recompute rather than 500.

---

## Realtime

One WebSocket serves the whole dashboard; every page reads from it. Connections
are grouped by organization, so tenant isolation applies to the socket exactly
as it does to HTTP.

Presence changes are pushed immediately. Overview snapshots are throttled to
one recompute per organization every few seconds — a header showing "72 active"
does not need to be recalculated on every heartbeat across a large fleet.

Browsers cannot set an `Authorization` header on a WebSocket handshake, so the
token arrives as a query parameter and is verified before a single frame is
accepted.

---

## Multi-tenancy

Every tenant-scoped document carries `organizationId`, and reads go through
`lib/scope.ts` rather than each route writing its own filter.

Department-scoped roles (MANAGER, TEAM_LEAD) are narrowed further. The scope
helper fails **closed**: an admin with a department-scoped role and no
department assigned sees nobody. Filtering on `departmentId: null` would
instead have matched every unassigned employee — a data leak produced by a
missing assignment. That case is covered by a test.

Cross-tenant lookups return 404, not 403, so the response cannot be used to
confirm that an id exists somewhere in the system.

---

## Data model

| Collection | Notes |
|---|---|
| `organizations`, `departments`, `users` | tenants and admin accounts |
| `employees` | the people being measured |
| `employeeCredentials` | userId + scrypt hash; one per employee |
| `devices` | per-machine identity, secret hash, last-seen, reported state |
| `policies` | one per org; `configVersion` drives agent refresh |
| `appSessions`, `inactivity` | completed spans, unique on `eventId` |
| `heartbeats` | **time-series**, TTL 30d |
| `attendanceDaily` | recomputed rollups, unique on (employee, day) |
| `appCategories` | org-configurable app classification |
| `auditLogs` | TTL 1y |
| `agentLogs` | TTL 14d |
| `refreshTokens` | hashed, rotating, TTL on `expiresAt` |

`db/indexes.ts` creates all of it idempotently on boot, so a fresh clone plus
`npm run dev` is a working system.

---

## Testing strategy

Four layers, each catching what the others structurally cannot:

| Layer | Catches |
|---|---|
| Rust unit tests | logic bugs in the state machine, sessionizer, queue, backoff |
| API integration | auth, RBAC, tenant isolation, ingest, rollups — against a real database |
| System scenarios | end-to-end behaviour: does a reported day produce the right numbers on the pages an admin reads |
| Playwright | the dashboard actually renders and wires up |

The system tester deserves a note. `apps/tester` runs **virtual agents** that
speak the real protocol and validate every response against the shared Zod
schemas. That makes it a conformance check, not just a load generator: if the
API renames a field, it fails immediately rather than the breakage surfacing
weeks later on deployed binaries.

The Rust agent's `--selftest` closes the remaining gap. The TypeScript
simulator proves the server behaves; `--selftest` proves the **shipped binary**
and the server still agree on the wire format.
