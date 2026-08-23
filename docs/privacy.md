# Privacy design

This document is the one to read if you are deciding whether to deploy this
software, or if you are an employee being asked to run it.

The design principle is from the product brief and is load-bearing throughout
the code: build a tool that gives an organization an accurate picture of
workforce availability and activity — not one that watches everything a person
does.

---

## What is collected

| Signal | Detail | Policy |
|---|---|---|
| Presence | ACTIVE / IDLE / LOCKED, plus derived OFFLINE | always |
| Application activity | Which executable has focus, and for how long | `trackApplications` (default **on**) |
| Window titles | The title bar text of the focused window | `trackWindowTitles` (default **off**) |
| Attendance | First and last activity, active/idle/locked totals | derived, always |
| Device health | Hostname, OS, CPU cores, RAM, agent version | always |

Attendance is **derived**, never reported. There is no clock-in button; the
row is recomputed from the underlying spans, which is also why a delayed
upload from an offline laptop produces the right answer rather than a double
count.

---

## What is never collected

These are properties of the software, not settings. No policy, role, or
configuration enables any of them, and there is no code path that could.

- Keystrokes or key logging of any kind
- Clipboard contents
- Passwords or credentials
- Screen contents or screenshots
- Microphone audio
- Webcam video
- File contents or personal files
- Browsing history or page contents

The agent's entire Windows API surface is listed in the README and lives in one
crate (`agent/crates/wp-win`) precisely so this claim is auditable in an
afternoon rather than taken on trust.

### Idle detection does not read input

`GetLastInputInfo` returns *when* the last keyboard or mouse event happened. It
does not return what it was. That distinction is the whole difference between
activity tracking and keylogging, and it is why idle detection can be honest
about being non-invasive.

---

## Transparency to the employee

The tray application (`WorkPulseTray.exe`) shows a live screen listing what is
and is not being collected. Two things make it meaningful rather than
decorative:

1. **It is generated from the server's current policy**, not hard-coded. If an
   admin enables window titles, the employee's screen says so within one
   config refresh. The software cannot collect something while telling the
   employee it does not.

2. **When it cannot reach the server it says so** rather than guessing. An
   offline screen states only the guarantees that hold regardless of policy.

The same list appears in the admin console under Settings, so administrators
and employees are looking at the same thing.

```
WorkPulse

Organization : Acme Corporation
Employee     : John Doe
Device       : JOHN-PC

Monitoring status: Active

Currently collected:
   Y  Active / idle state
   Y  Attendance times
   Y  Device health
   Y  Application activity

Not collected:
   N  Keyboard input
   N  Clipboard contents
   N  Passwords
   N  Microphone
   N  Webcam
   N  Personal files
   N  Window titles
   N  Websites visited
   N  Screenshots
```

---

## Categories are not a verdict

The product ships with **no opinion** about which applications are productive.
Every unmapped application counts as Neutral until an administrator says
otherwise, and the dashboard presents the split as *Activity Insights* —
a description of where time went, not a judgement about a person.

Two supporting decisions:

- Changing a category rule affects **new** activity only. Existing records keep
  the category they were recorded with, so a rule change cannot silently
  rewrite last month's report.
- The Agent Health page exists so a reporting gap is never mistaken for
  inactivity. A machine that was asleep, offline, or had a stopped agent looks
  completely different from a person who was not working, and conflating the
  two is the most likely way this class of product produces an unfair
  conclusion.

---

## Data protection

**On the endpoint.** The queue of not-yet-delivered telemetry is encrypted at
rest with AES-256-GCM, keyed by a value derived from the device secret. The
device secret itself is sealed with Windows DPAPI, so it is bound to that user
account on that machine. Revoking a device makes any queue file left behind
permanently unreadable.

**In transit.** HTTPS in any real deployment. Agents authenticate with a
short-lived (15 minute) access token obtained from a per-device secret, never
with the employee's password — the password is used exactly once, at
enrollment, and then discarded by the agent.

**At rest.** Passwords are hashed with scrypt. Device secrets and refresh
tokens are stored as SHA-256 hashes; the plaintext exists only on the endpoint.
The one-time password is displayed once and is not retrievable afterwards by
any endpoint, including by the administrator who generated it.

**Retention.** Raw heartbeats expire after 30 days, agent logs after 14, audit
entries after a year, all enforced by MongoDB TTL indexes rather than by a
cleanup job that can silently stop running.

---

## Accountability for administrators

Monitoring software concentrates a lot of power in whoever holds the admin
account, so the console audits reads as well as writes:

- Opening an employee's record is recorded (`employee.viewed`)
- Issuing or revoking an agent login is recorded
- Enrolling or revoking a device is recorded
- Changing collection policy is recorded, with a before/after diff
- Failed sign-in attempts are recorded

Reading the audit trail is itself restricted to HR_ADMIN and above, because it
reveals who looked at whom. Audit entries cannot be edited or deleted through
the console.

Collection policy — the switch that decides what happens on every employee's
machine — requires the ORG_OWNER role, one level above the role that manages
people and devices.

---

## Deployment recommendations

The software supports a responsible deployment; it cannot enforce one.

- Tell employees before you deploy, and point them at the tray application.
- Leave window-title tracking off unless you have a specific, stated reason.
  Titles routinely contain document names, customer names and subject lines.
- Set retention to the shortest period that meets your actual need.
- Give managers the MANAGER role, scoped to their department, rather than
  HR_ADMIN. The scoping is enforced server-side.
- Review the audit log periodically. It exists to make administrator access
  accountable, which only works if somebody looks at it.

Employment monitoring is regulated differently across jurisdictions, and in
several it requires notice, consultation, or a documented lawful basis before
you begin. Get local advice before deploying; nothing here is a substitute for
it.
