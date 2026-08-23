<div align="center">

# WorkPulse v2

### **Enterprise-Grade, Privacy-First Workforce Analytics & Activity Platform**

*Native Windows Rust Endpoint Agent • Real-Time Fastify & WebSocket Telemetry Engine • Modern React Admin Dashboard*

<br />

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-1.75+-DEA584?style=for-the-badge&logo=rust&logoColor=black)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-4.x-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.0+-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.x-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev/)

<br />

---

</div>

## 📸 Product Previews & Themes

### 🎨 Interactive Theme & Layout Switcher
*WorkPulse features 5 curated color palettes and 2 adaptive navigation modes (Topbar & Left Sidebar with ⌘K search). Click below to preview each theme:*

<details open>
<summary><b>☀️ Warm Cream (Light — Signature Classic)</b></summary>
<br/>

> *Warm parchment ground with energized coral accents and rich espresso typography.*

![Warm Cream Theme](preview/03_overview_dashboard.png)
</details>

<details>
<summary><b>🌙 Obsidian Midnight (Dark — Cyber Luxury)</b></summary>
<br/>

> *Deep cosmic dark backdrop with glowing electric indigo highlights and crisp silver typography.*

![Obsidian Midnight Theme](preview/15_dark_theme_dashboard.png)
</details>

<details>
<summary><b>❄️ Nordic Frost (Light — Pure Minimalist Ice)</b></summary>
<br/>

> *Scandinavian minimalist light palette with pure porcelain cards and vivid azure sky accents.*

![Nordic Frost Theme](preview/theme_nordic_frost.png)
</details>

<details>
<summary><b>🌲 Emerald Forest (Dark — Velvet Botanical)</b></summary>
<br/>

> *Deep botanical dark theme with velvety evergreen tones and luminous spring mint highlights.*

![Emerald Forest Theme](preview/theme_emerald_forest.png)
</details>

<details>
<summary><b>🌇 Cyberpunk Sunset (Dark — Synthwave Night)</b></summary>
<br/>

> *High-energy synthwave night theme with deep plum surfaces, neon rose focal points, and radiant amber micro-accents.*

![Cyberpunk Sunset Theme](preview/theme_cyberpunk_sunset.png)
</details>

---

### 📱 Adaptive Navigation Layouts (Topbar vs. Left Sidebar)
Switch seamlessly between a sleek floating topbar and an enterprise collapsible sidebar navigation.

<div align="center">
  <img src="preview/sidebar_layout_light.png" alt="Sidebar Layout - Light Mode" width="49%" />
  <img src="preview/sidebar_layout_dark.png" alt="Sidebar Layout - Dark Mode" width="49%" />
</div>

---

### ⚡ Real-Time Operations & Live Activity
Instant, live-updating visibility into team member focus, active window foreground titles, online/idle/offline status, and live heartbeats.

<div align="center">
  <img src="preview/04_live_activity.png" alt="Live Team Activity Light" width="49%" />
  <img src="preview/16_dark_theme_live.png" alt="Live Team Activity Dark" width="49%" />
</div>

---

### 📊 Deep Work & Productivity Analytics
Track application utilization patterns categorized by productive, neutral, and distracting tools alongside automated attendance timesheets.

<div align="center">
  <img src="preview/06_applications.png" alt="Application Usage Breakdown" width="49%" />
  <img src="preview/07_attendance.png" alt="Attendance & Timesheets" width="49%" />
</div>

---

### 🛡️ Fleet Management & Security Policies
Manage enrolled endpoint hardware, agent telemetry health, data collection boundaries, and immutable RBAC audit logs.

<div align="center">
  <img src="preview/08_devices.png" alt="Device Fleet Management" width="49%" />
  <img src="preview/09_agent_health.png" alt="Agent Telemetry Health" width="49%" />
</div>

<div align="center">
  <img src="preview/10_policies.png" alt="Collection Policies" width="49%" />
  <img src="preview/11_audit_logs.png" alt="RBAC Audit Logs" width="49%" />
</div>

---

## 🌟 Key Highlights & Architecture

- 🛡️ **Strict Privacy by Design**: Records **activity metadata** only (application in focus, idle/locked timestamps, attendance times). **Zero keystroke logging, zero screen grabs, zero microphone/webcam access, zero clipboard reading.**
- 👁️ **Employee Transparency Tray**: Ships with `WorkPulseTray.exe` allowing employees to inspect live server collection policies and see exactly what metadata is collected in real time.
- 🦀 **Native Windows Rust Agent (`wp-agent`)**: Lightweight, robust background daemon utilizing official Windows APIs (`GetForegroundWindow`, `GetLastInputInfo`, DPAPI data protection at rest).
- ⚡ **Real-Time WebSocket Hub**: Immediate updates across executive and manager dashboards with sub-second event streaming.
- 🔒 **Enterprise-Grade RBAC**: Fine-grained role hierarchy (`TEAM_LEAD` $\rightarrow$ `MANAGER` $\rightarrow$ `HR_ADMIN` $\rightarrow$ `ORG_OWNER` $\rightarrow$ `SUPER_ADMIN`) with full audit logging.
- 🧪 **Comprehensive Test Suite**: Playwright E2E tests, vitest integration suites, simulated virtual agent swarms, and Rust unit tests.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** v18+ & **npm**
- **MongoDB** v6+ (running locally on `:27017` or configured via `.env`)
- **Rust Toolchain** (optional, for compiling the native agent binary)

### 2. Installation & Seed
```bash
# Clone the repository
git clone https://github.com/Yuslash/WorkPulse.git
cd WorkPulse

# Install monorepo dependencies
npm install

# Initialize database collections and indexes
npm run db:indexes

# Seed initial organization, admin accounts, and sample employees
npm run seed
```

### 3. Launch Development Environment
```bash
npm run dev
```
- **Admin Dashboard**: [http://localhost:5173](http://localhost:5173)
- **API Server**: [http://localhost:4000](http://localhost:4000)

*Default seed credentials: `admin@acme.test` / `Admin123!pass`*

---

## 🦀 Building & Enrolling the Native Windows Agent

```bash
# 1. Build the Rust agent workspace
npm run agent:build

# 2. In Admin Dashboard: Navigate to Employees -> Select Employee -> Generate Login Credentials

# 3. Enroll device with generated one-time credentials
cd agent/target/release
./WorkPulseAgent.exe --enroll --server http://localhost:4000 \
    --user-id EMP-1234 --password 'Xk7f-2Qmb-91Zc'

# 4. Start agent service or run in console mode
./WorkPulseAgent.exe --console
```

---

## 📂 Repository Structure

```text
├── packages/
│   ├── shared/          # Zod schemas, DTOs, Enums, and Agent<->API protocol contracts
│   └── tsconfig/        # Shared TypeScript configurations
├── apps/
│   ├── admin/           # Vite + React 18 + TailwindCSS + Lucide Icons dashboard
│   ├── api/             # Fastify + MongoDB + WebSocket realtime telemetry backend
│   └── tester/          # Virtual agent load tester & workday scenario simulator
├── agent/               # Native Windows Rust workspace
│   ├── crates/wp-core/  # State machine, sessionizer, encrypted offline queue, retry logic
│   ├── crates/wp-win/   # Safe Windows OS syscall wrappers (foreground, idle, DPAPI)
│   ├── crates/wp-agent/ # WorkPulseAgent.exe CLI, enrollment, and Windows service daemon
│   └── crates/wp-tray/  # WorkPulseTray.exe system tray employee transparency app
├── docs/                # Architecture, Protocol, Privacy, and Deployment specifications
├── e2e/                 # End-to-end browser test suites with Playwright
├── preview/             # High-resolution screenshots and UI previews
└── scripts/             # Setup, Rust installer, and validation scripts
```

---

## 🧪 Verification & Quality Assurance

Run the automated test pipeline across all layers:

```bash
npm run verify
```

| Verification Stage | Scope & Coverage |
|---|---|
| **`typecheck`** | TypeScript type safety across `@workpulse/shared`, `api`, `admin`, and `tester` |
| **`api`** | Integration test suite against real MongoDB database |
| **`rust`** | Unit & property tests for Rust state machine, queue encryption, and sessionizer |
| **`system`** | Virtual agent swarm simulation validating multi-device telemetry flows |
| **`e2e`** | Playwright end-to-end browser scenarios testing UI interactions |

---

## 📖 Deep-Dive Documentation

- 📘 [System Architecture](docs/architecture.md) — Multi-tier topology, offline queueing, and data pipelines
- 🔒 [Privacy & Compliance Standards](docs/privacy.md) — What is captured, cryptographic isolation, and transparency
- 📡 [Agent-Server Protocol](docs/protocol.md) — WebSocket and REST telemetry communication specs
- 🚀 [Production Deployment Guide](docs/deployment.md) — Containerization, reverse proxying, and SSL setup

---

<div align="center">
  <sub>Built with ❤️ by the WorkPulse Team • Licensed under the MIT License</sub>
</div>
