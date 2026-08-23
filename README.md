<div align="center">

# WorkPulse

**Enterprise Workforce Telemetry & Operational Analytics Platform**

*Windows Endpoint Agent (Rust) • Real-Time Event Engine (Fastify/WebSocket) • Analytics Dashboard (React)*

<br />

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.75+-DEA584?style=flat-square&logo=rust&logoColor=black)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-4.x-000000?style=flat-square&logo=fastify&logoColor=white)](https://fastify.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.0+-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.x-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)

</div>

---

## Overview

WorkPulse is a privacy-first workforce analytics system designed for distributed teams and enterprises. It provides real-time visibility into application focus, operational workflows, and active working hours without intrusive surveillance mechanisms.

- **Activity Metadata Only**: Records focused process headers, idle timeouts, and attendance markers. Zero keystroke recording, zero screen capture, zero clipboard monitoring, and zero audio/video access.
- **Endpoint Transparency**: Includes a native desktop tray client allowing employees to verify active data collection policies and live streaming telemetry at any time.
- **Native Endpoint Agent**: Lightweight Rust daemon utilizing low-overhead Win32 APIs with hardware-backed DPAPI credential isolation.
- **Sub-Second Streaming**: Distributed WebSocket hub delivering immediate status transitions to management consoles without polling overhead.

---

## Interface Previews

### Design Themes

WorkPulse includes five curated palettes engineered for high legibility across diverse lighting environments. Click each section below to inspect the interface:

<details open>
<summary><b>Warm Cream — Editorial Light (Default)</b></summary>
<br />

> Parchment background with warm coral accents and espresso typography.

![Warm Cream Theme](preview/03_overview_dashboard.png)
</details>

<details>
<summary><b>Obsidian Midnight — High Contrast Dark</b></summary>
<br />

> Deep obsidian canvas with electric indigo indicators and silver typography.

![Obsidian Midnight Theme](preview/15_dark_theme_dashboard.png)
</details>

<details>
<summary><b>Nordic Frost — Minimalist Light</b></summary>
<br />

> Porcelain cards with cool grey depth and vivid azure accents.

![Nordic Frost Theme](preview/theme_nordic_frost.png)
</details>

<details>
<summary><b>Emerald Forest — Botanical Dark</b></summary>
<br />

> Deep evergreen backdrop with luminous spring mint highlights.

![Emerald Forest Theme](preview/theme_emerald_forest.png)
</details>

<details>
<summary><b>Cyberpunk Sunset — Synthwave Dark</b></summary>
<br />

> Deep violet surfaces with neon rose accents and amber indicators.

![Cyberpunk Sunset Theme](preview/theme_cyberpunk_sunset.png)
</details>

---

### Layout Modes

WorkPulse adapts to workflow preferences with two navigation modes: a floating top bar or an expandable left sidebar with Command Palette (`⌘K` / `Ctrl+K`) integration.

<div align="center">
  <img src="preview/sidebar_layout_light.png" alt="Sidebar Navigation - Light Mode" width="49%" />
  <img src="preview/sidebar_layout_dark.png" alt="Sidebar Navigation - Dark Mode" width="49%" />
</div>

---

### Real-Time Activity Monitoring

Instant telemetry streaming displaying team focus, active window foreground titles, online/idle/offline status, and live heartbeats.

<div align="center">
  <img src="preview/04_live_activity.png" alt="Live Team Activity (Light)" width="49%" />
  <img src="preview/16_dark_theme_live.png" alt="Live Team Activity (Dark)" width="49%" />
</div>

---

### Application Categorization & Attendance Tracking

Automated classification of active process focus into productive, neutral, and distracting categories, alongside precise timesheet calculations.

<div align="center">
  <img src="preview/06_applications.png" alt="Application Usage Breakdown" width="49%" />
  <img src="preview/07_attendance.png" alt="Attendance & Timesheets" width="49%" />
</div>

---

### Device Fleet & Security Governance

Comprehensive endpoint management, agent health monitoring, collection policy configuration, and immutable RBAC audit logs.

<div align="center">
  <img src="preview/08_devices.png" alt="Device Fleet Management" width="49%" />
  <img src="preview/09_agent_health.png" alt="Agent Telemetry Health" width="49%" />
</div>

<div align="center">
  <img src="preview/10_policies.png" alt="Data Collection Policies" width="49%" />
  <img src="preview/11_audit_logs.png" alt="RBAC Security Audit Trail" width="49%" />
</div>

---

## Architecture & Technology Stack

| Component | Technology | Description |
|---|---|---|
| **Admin Dashboard** | React 18, Vite, Tailwind CSS | Single-page analytics console with real-time updates and multiple layout modes. |
| **API Backend** | Fastify, TypeScript, MongoDB | High-throughput telemetry ingestion server with WebSocket distribution. |
| **Native Agent** | Rust (wp-agent, wp-win, wp-core) | Low-overhead Windows daemon with offline buffer queue and DPAPI storage. |
| **Transparency Client** | Rust (wp-tray) | Windows system tray utility providing full employee visibility into active policies. |
| **Shared Contracts** | TypeScript, Zod | Unified schemas, protocol definitions, and DTO specifications. |

---

## Quick Start

### 1. Prerequisites
- **Node.js** 18.x or higher
- **MongoDB** 6.0+ (running locally on port `27017` or configured via `.env`)
- **Rust Toolchain** (optional, required only for native binary builds)

### 2. Setup & Database Initialization
```bash
# Clone the repository
git clone https://github.com/Yuslash/WorkPulse.git
cd WorkPulse

# Install workspace dependencies
npm install

# Initialize collections, compound indexes, and TTL configurations
npm run db:indexes

# Populate test organization, admin accounts, and sample dataset
npm run seed
```

### 3. Start Development Servers
```bash
npm run dev
```

- **Dashboard**: `http://localhost:5173`
- **Telemetry API**: `http://localhost:4000`
- *Default Administrator*: `admin@acme.test` / `Admin123!pass`

---

## Native Agent Deployment

### Compile the Binary
```bash
npm run agent:build
```

### Enrollment & Execution
```bash
# 1. In Dashboard: Navigate to Employees -> Select User -> Generate Login Credentials

# 2. Enroll the local endpoint with one-time credentials
cd agent/target/release
./WorkPulseAgent.exe --enroll \
    --server http://localhost:4000 \
    --user-id EMP-1234 \
    --password 'Xk7f-2Qmb-91Zc'

# 3. Start the daemon (Console or Service mode)
./WorkPulseAgent.exe --console
```

---

## System Verification

Execute the verification test harness covering static types, unit suites, API integration tests, agent simulation swarms, and end-to-end browser flows:

```bash
npm run verify
```

```bash
# Targeted test runs
npm run verify:fast          # Skip native compilation and browser steps
npm run verify -- --only=api # Fastify & database integration suite only
npm run test:sim -- workday  # Execute 8-hour virtual workday simulation
```

---

## Directory Structure

```text
├── packages/
│   ├── shared/          # Zod schemas, DTOs, Enums, and protocol contracts
│   └── tsconfig/        # Shared compiler configurations
├── apps/
│   ├── admin/           # React dashboard application
│   ├── api/             # Fastify REST & WebSocket telemetry engine
│   └── tester/          # Scenario simulation harness and virtual agent swarm
├── agent/               # Rust endpoint workspace
│   ├── crates/wp-core/  # State machine, sessionizer, encrypted offline queue
│   ├── crates/wp-win/   # Safe Win32 syscall wrappers (GetForegroundWindow, DPAPI)
│   ├── crates/wp-agent/ # WorkPulseAgent.exe CLI, enrollment, and daemon service
│   └── crates/wp-tray/  # WorkPulseTray.exe employee transparency utility
├── docs/                # Architecture, protocol, privacy, and deployment docs
├── e2e/                 # Playwright test specifications
├── preview/             # High-resolution interface assets
└── scripts/             # Infrastructure management scripts
```

---

## Technical Documentation

- [Architecture Reference](docs/architecture.md) — Topology, offline storage, and ingestion pipelines.
- [Privacy & Compliance Standards](docs/privacy.md) — Data boundaries, cryptographic isolation, and transparency guarantees.
- [Agent-Server Protocol Specification](docs/protocol.md) — Wire format and WebSocket event contracts.
- [Production Deployment Guide](docs/deployment.md) — Production containerization, reverse proxying, and security hardening.

---

<div align="center">
  <sub>WorkPulse Enterprise Platform • Released under the MIT License</sub>
</div>
