# Agent ↔ API protocol

Version 1.

The contract is defined once in [`packages/shared/src/protocol.ts`](../packages/shared/src/protocol.ts)
as Zod schemas, and mirrored in
[`agent/crates/wp-core/src/protocol.rs`](../agent/crates/wp-core/src/protocol.rs)
as serde types. Changing one means changing the other; `--selftest` exists to
catch the moment they drift apart.

All timestamps are RFC3339 UTC strings. All bodies are JSON.

---

## Lifecycle

```
  ┌── un-enrolled ──┐
  │                 │  POST /api/agent/enroll     userId + one-time password
  │                 ▼
  │            ┌─────────┐
  │            │ enrolled│  holds deviceId + deviceSecret (DPAPI-sealed)
  │            └────┬────┘
  │                 │  POST /api/agent/token      secret -> 15m access token
  │                 ▼
  │            ┌─────────┐
  │            │ running │  heartbeat / telemetry / config
  │            └────┬────┘
  │                 │  DEVICE_REVOKED | DEVICE_UNKNOWN
  └─────────────────┘  wipe identity, stop retrying
```

---

## `POST /api/agent/enroll`

Unauthenticated. Rate limited to 5/minute per address.

```jsonc
{
  "userId": "EMP-4021",
  "password": "Xk7f-2Qmb-91Zc",
  "device": {
    "hostname": "JOHN-PC",
    "os": "Windows",
    "osVersion": "10.0.19045",
    "arch": "AMD64",
    "cpu": "Intel64 Family 6",     // optional
    "cpuCores": 16,                 // optional
    "ramMb": 15791,                 // optional
    "agentVersion": "1.0.0"
  }
}
```

Response:

```jsonc
{
  "deviceId": "6a858a2cec2eaa922285b2ff",
  "deviceSecret": "…",              // returned exactly once, never again
  "employee": { "id": "…", "name": "John Doe",
                "organizationId": "…", "organizationName": "Acme" },
  "accessToken": "…",
  "accessTokenExpiresAt": "2026-08-19T11:05:00.000Z",
  "config": { /* AgentConfig */ }
}
```

The agent stores `deviceSecret` and **discards the password**. Re-enrolling the
same `(employee, hostname)` rotates the secret in place rather than creating a
second device.

Errors: `INVALID_CREDENTIALS` (401), `CREDENTIALS_REVOKED` (403).

---

## `POST /api/agent/token`

Unauthenticated (the secret *is* the credential). Rate limited to 30/minute.

```jsonc
{ "deviceId": "…", "deviceSecret": "…" }
→ { "accessToken": "…", "accessTokenExpiresAt": "…", "configVersion": 3 }
```

Errors: `DEVICE_UNKNOWN` (401), `DEVICE_REVOKED` (403), `INVALID_CREDENTIALS` (401).

---

## `POST /api/agent/heartbeat`

Bearer token. Rate limited to 120/minute.

```jsonc
{
  "status": "ACTIVE",               // ACTIVE | IDLE | LOCKED
  "idleSeconds": 0,
  "currentApplication": "Visual Studio Code",   // or null
  "agentVersion": "1.0.0",
  "queueDepth": 0,                  // optional
  "sentAt": "2026-08-19T10:48:35.821Z"
}
→ { "ok": true, "serverTime": "…", "configVersion": 3 }
```

`OFFLINE` is not a value an agent may report — it is derived server-side when
heartbeats stop.

**`configVersion` is the policy-change signal.** The agent compares it to its
own on every heartbeat; a mismatch triggers a config fetch. That is why a
policy change reaches every endpoint within one heartbeat rather than waiting
for the next scheduled refresh.

---

## `POST /api/agent/telemetry`

Bearer token. Rate limited to 60/minute. Batches are capped at 500 events.

```jsonc
{
  "batchId": "batch-…",
  "events": [
    { "type": "app_session", "eventId": "app-…",
      "appName": "Visual Studio Code", "exeName": "Code.exe",
      "windowTitle": null,
      "startedAt": "…", "endedAt": "…", "durationSec": 1800 },

    { "type": "inactivity", "eventId": "idle-…",
      "kind": "idle",                  // idle | locked | away
      "startedAt": "…", "endedAt": "…", "durationSec": 300 },

    { "type": "agent_log", "eventId": "log-…",
      "level": "INFO", "message": "Agent started", "occurredAt": "…" }
  ]
}
```

Response:

```jsonc
{
  "ok": true,
  "accepted": 2,
  "duplicates": 1,
  "rejected": [ { "eventId": "app-…", "reason": "endedAt is in the future" } ],
  "serverTime": "…"
}
```

### Idempotency

`eventId` is generated on the endpoint and carries a unique index. A replayed
batch reports `duplicates` and stores nothing new. **The agent must only delete
events from its queue after the server acknowledges them** — an interrupted
upload then replays rather than losing the window.

### Rejection

`rejected` entries are permanently unacceptable, not transient. Retrying them
would loop forever, so the agent drops them with the batch. Reasons:

- `endedAt precedes startedAt`
- `endedAt is in the future` — more than 5 minutes ahead of server time
- `durationSec disagrees with timestamps` — more than 5 seconds out

---

## `GET /api/agent/config`

```jsonc
{
  "config": {
    "configVersion": 3,
    "trackApplications": true,
    "trackWindowTitles": false,
    "trackWebsites": false,
    "trackScreenshots": false,
    "idleThresholdSec": 600,
    "heartbeatSec": 30,
    "telemetryFlushSec": 45,
    "configRefreshSec": 600,
    "maxQueueBytes": 52428800,
    "retentionDays": 90
  },
  "serverTime": "…"
}
```

The agent **gates each collector on these flags**: a disabled collector does
not run, rather than running and discarding. A window title is not read when
`trackWindowTitles` is false.

---

## `GET /api/agent/status`

Powers the tray transparency screen. `collected` and `notCollected` are
generated from the live policy, so what the employee is shown always matches
what the agent is permitted to do.

```jsonc
{
  "employee":     { "id": "…", "name": "John Doe" },
  "organization": { "id": "…", "name": "Acme Corporation" },
  "device":       { "id": "…", "hostname": "JOHN-PC",
                    "status": "ACTIVE", "enrolledAt": "…" },
  "collected":    ["Active / idle state", "Attendance times",
                   "Device health", "Application activity"],
  "notCollected": ["Keyboard input", "Clipboard contents", "Passwords",
                   "Microphone", "Webcam", "Personal files",
                   "Window titles", "Websites visited", "Screenshots"],
  "serverTime": "…"
}
```

---

## Errors

```jsonc
{ "error": { "code": "DEVICE_REVOKED", "message": "…", "details": {} } }
```

| Code | Meaning for the agent |
|---|---|
| `INVALID_CREDENTIALS` | wrong userId/password or device secret — do not retry |
| `CREDENTIALS_REVOKED` | **terminal** — wipe identity |
| `DEVICE_REVOKED` | **terminal** — wipe identity |
| `DEVICE_UNKNOWN` | **terminal** — wipe identity |
| `TOKEN_EXPIRED` | refresh the access token and retry |
| `RATE_LIMITED` | back off |
| anything else / 5xx / network | transient — retry with backoff |

Terminal errors mean retrying cannot help. The agent clears its stored identity
and returns to the un-enrolled state rather than looping forever against a
machine that has had its access withdrawn.

---

## Agent cadences

| What | When |
|---|---|
| Sample foreground window + idle + lock | every 5s |
| Heartbeat | `heartbeatSec` (default 30s) |
| Telemetry flush | `telemetryFlushSec` (default 45s) |
| Config refresh | `configRefreshSec` (default 10m), or immediately on version mismatch |

Nothing polls at 100ms. The 5-second sample tick is what keeps CPU well under
1%.

### Sessionizing rules

- Sessions shorter than **3 seconds** are dropped — alt-tabbing through five
  windows should not produce five timeline rows.
- A gap in observations longer than **120 seconds** (sleep, hibernate, agent
  restart) ends the open session at the last real observation. A laptop closed
  at 17:00 and opened at 09:00 must not report sixteen hours of work — and that
  clamp applies whether or not the focused application changed across the gap.
- A title change within the same executable does not split the session.
- An idle span of 30 minutes or more is reclassified `away` rather than `idle`.
