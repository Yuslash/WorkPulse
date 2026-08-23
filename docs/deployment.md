# Deployment

## Prerequisites

| | Version | Notes |
|---|---|---|
| Node.js | 22+ | API and dashboard |
| MongoDB | 6.0+ | time-series collections are required |
| Rust | 1.82+ | only to build the agent |

On Windows without Visual Studio, install Rust for the GNU target:

```powershell
.\scripts\install-rust.ps1
```

That installs `stable-x86_64-pc-windows-gnu` into the user profile — no
elevation, no ~3 GB Visual Studio Build Tools download. It additionally needs
mingw-w64 for `dlltool.exe`:

```powershell
winget install BrechtSanders.WinLibs.POSIX.MSVCRT
```

Both are user-scope installs. `scripts/verify.mjs` locates them itself, so a
shell opened before the install still works.

---

## Server

### Configuration

Everything reads the single `.env` at the repo root. Generate real secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```ini
NODE_ENV=production
MONGODB_URI=mongodb+srv://user:pass@cluster.example.net
MONGODB_DB=workpulse

JWT_ACCESS_SECRET=<48 random bytes>
JWT_REFRESH_SECRET=<48 random bytes, different>

CORS_ORIGINS=https://workpulse.example.com
```

`NODE_ENV=production` makes the refresh cookie `Secure`, so the dashboard
**must** be served over HTTPS or sign-in will not persist.

### Build and run

```bash
npm ci
npm run build:shared
npm run build -w @workpulse/api
npm run build -w @workpulse/admin

npm run db:indexes          # idempotent; safe on an existing database
node apps/api/dist/server.js
```

`apps/admin/dist` is static — serve it from the same origin as the API so the
refresh cookie and the WebSocket both work without cross-origin configuration.

### First administrator

`npm run seed` creates a demo organization and is for development. For a real
deployment, create the first ORG_OWNER directly:

```js
// node --input-type=module
import { connectDatabase, collections } from './apps/api/dist/db/client.js';
import { hashPassword } from './apps/api/dist/lib/crypto.js';
import { ObjectId } from 'mongodb';

await connectDatabase();
const organizationId = new ObjectId();
const now = new Date();

await collections.organizations().insertOne({
  _id: organizationId, name: 'Your Company', slug: 'your-company',
  createdAt: now, updatedAt: now,
});

await collections.users().insertOne({
  _id: new ObjectId(), organizationId,
  email: 'you@example.com', name: 'Your Name',
  passwordHash: await hashPassword('<a strong password>'),
  role: 'ORG_OWNER', departmentId: null, status: 'ACTIVE',
  lastLoginAt: null, createdAt: now, updatedAt: now,
});
```

### Reverse proxy

The WebSocket upgrade on `/ws` is the part that is easy to get wrong:

```nginx
server {
    listen 443 ssl http2;
    server_name workpulse.example.com;

    root /srv/workpulse/admin;
    index index.html;

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        # Presence goes quiet between transitions; do not cut idle sockets.
        proxy_read_timeout 3600s;
    }
}
```

The API sets `trustProxy`, so `X-Forwarded-For` is what the rate limiter and
the audit log record. Without it every request buckets under the proxy's own
address.

### systemd

```ini
[Unit]
Description=WorkPulse API
After=network-online.target

[Service]
Type=simple
User=workpulse
WorkingDirectory=/srv/workpulse
ExecStart=/usr/bin/node apps/api/dist/server.js
Restart=always
RestartSec=5
EnvironmentFile=/srv/workpulse/.env

[Install]
WantedBy=multi-user.target
```

---

## Agent

### Build

```bash
npm run agent:build
# agent/target/release/WorkPulseAgent.exe   ~3.4 MB
# agent/target/release/WorkPulseTray.exe    ~2.2 MB
```

Sign both binaries before distributing them. An unsigned background service
will be flagged by SmartScreen and by most endpoint protection products, and
signing is also what makes the agent's identity verifiable to the employee.

### Install on a workstation

```powershell
# 1. Copy the binaries
New-Item -ItemType Directory 'C:\Program Files\WorkPulse' -Force
Copy-Item WorkPulseAgent.exe, WorkPulseTray.exe 'C:\Program Files\WorkPulse\'

# 2. Enrol (userId and password come from the admin console)
& 'C:\Program Files\WorkPulse\WorkPulseAgent.exe' --enroll `
    --server https://workpulse.example.com `
    --user-id EMP-4021 --password 'Xk7f-2Qmb-91Zc'

# 3. Auto-start — pick one
& 'C:\Program Files\WorkPulse\WorkPulseAgent.exe' --install-user   # no elevation
.\scripts\install-service.ps1                                       # elevated
```

| | Windows Service | Logon task |
|---|---|---|
| Elevation to install | required | none |
| Starts | at boot, before login | at user logon |
| Survives logout | yes | no |
| Auto-restart on crash | Service Recovery (5s/10s/30s) | at next logon |
| Command | `--install-service` | `--install-user` |

Use the service for managed fleets. The logon task exists so the agent can be
installed on a locked-down workstation where the employee has no admin rights.

The logon task is registered through the Task Scheduler COM API rather than
`schtasks.exe`, because `schtasks /Create` returns "Access is denied" for a
standard user on a default Windows install even for a per-user task.

### Verify an installation

```powershell
WorkPulseAgent.exe --status     # identity, queue depth, live policy
WorkPulseAgent.exe --console    # run in the foreground and watch
WorkPulseTray.exe --print       # the employee transparency screen
```

Confirm protocol compatibility against the server before a fleet rollout:

```powershell
WorkPulseAgent.exe --selftest --server https://workpulse.example.com `
    --user-id EMP-4021 --password '...'
```

Exits non-zero on any mismatch, so it can gate a deployment pipeline.

### Files on the endpoint

```
C:\Program Files\WorkPulse\      WorkPulseAgent.exe, WorkPulseTray.exe
C:\ProgramData\WorkPulse\
    identity.bin                 device secret, sealed with DPAPI
    queue.redb                   pending telemetry, AES-256-GCM
    logs\agent.log               rotated daily, no sensitive content
```

Set `WORKPULSE_DATA_DIR` to relocate the state directory — used by the test
suite to avoid touching a real installation.

### Uninstall

```powershell
WorkPulseAgent.exe --uninstall                 # removes service or logon task
Remove-Item 'C:\ProgramData\WorkPulse' -Recurse -Force
Remove-Item 'C:\Program Files\WorkPulse' -Recurse -Force
```

Revoke the device in the console as well, under Devices — removing the software
stops it reporting, but only revocation invalidates its credential.

---

## Operations

**Retention** is enforced by MongoDB TTL indexes, not a cleanup job that can
silently stop: heartbeats 30 days, agent logs 14 days, audit entries 1 year.
Adjust `retentionDays` on the Policies page.

**Monitoring.** `GET /health` pings the database, so it goes red when the API
is up but unable to serve requests. Watch the Agent Health page for the
offline and outdated counts — a rising offline count usually means a rollout
problem, not a workforce one.

**Backups.** `organizations`, `users`, `employees`, `employeeCredentials`,
`devices`, `policies` and `auditLogs` are the collections worth backing up;
the rest is regenerable telemetry.

**Scaling.** A single API process handles a few thousand agents comfortably at
a 30-second heartbeat. Beyond that, presence and the WebSocket fan-out are the
first things to move — they are the only per-process state, and Redis pub/sub
is the natural substitute.
