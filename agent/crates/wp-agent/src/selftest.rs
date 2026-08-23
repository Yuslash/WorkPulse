//! Protocol conformance check.
//!
//! Runs the REAL Rust client against a live API and asserts every step of the
//! agent contract. The TypeScript simulator in `apps/tester` proves the
//! server behaves; this proves the shipped binary and the server still agree
//! on the wire format. Without it, a rename in `packages/shared` could break
//! every deployed agent while the whole TypeScript suite stayed green.

use anyhow::{bail, Context, Result};
use chrono::{Duration as ChronoDuration, Utc};
use wp_core::protocol::{
    HeartbeatRequest, InactivityKind, LogLevel, ReportedPresence, TelemetryEvent,
};
use wp_core::{ApiClient, AGENT_VERSION};

struct Report {
    passed: usize,
    failed: Vec<String>,
}

impl Report {
    fn new() -> Self {
        Self {
            passed: 0,
            failed: Vec::new(),
        }
    }

    fn check(&mut self, name: &str, ok: bool, detail: &str) {
        if ok {
            self.passed += 1;
            println!("  PASS  {name}");
        } else {
            self.failed.push(format!("{name}: {detail}"));
            println!("  FAIL  {name} — {detail}");
        }
    }
}

/// `--selftest --server URL --user-id ID --password PW`
///
/// Enrolls a throwaway device, exercises every endpoint, and exits non-zero
/// on any mismatch so CI can gate on it.
pub async fn run(server_url: &str, user_id: &str, password: &str) -> Result<()> {
    println!("WorkPulse agent protocol conformance");
    println!("  server : {server_url}");
    println!("  agent  : {AGENT_VERSION}\n");

    let mut report = Report::new();
    let client = ApiClient::new(server_url).context("building the API client")?;

    // ---- enrollment -------------------------------------------------------
    let mut device = wp_win::device_info(AGENT_VERSION);
    // A distinct hostname so a self-test never collides with the real device
    // enrolled on this machine.
    device.hostname = format!("{}-SELFTEST", device.hostname);

    let enrolled = client
        .enroll(user_id, password, device)
        .await
        .context("enrollment failed")?;

    report.check("enroll returns a device id", !enrolled.device_id.is_empty(), "empty");
    report.check(
        "enroll returns a device secret",
        !enrolled.device_secret.is_empty(),
        "empty",
    );
    report.check(
        "enroll returns the employee",
        !enrolled.employee.name.is_empty(),
        "empty name",
    );
    report.check(
        "enroll returns a usable config",
        enrolled.config.heartbeat_sec >= 5 && enrolled.config.idle_threshold_sec >= 30,
        "config out of range",
    );
    report.check(
        "screenshots default off",
        !enrolled.config.track_screenshots,
        "screenshots enabled by default",
    );

    // ---- token exchange ---------------------------------------------------
    let client = ApiClient::new(server_url)?
        .with_device(enrolled.device_id.clone(), enrolled.device_secret.clone());

    let config = client
        .fetch_config()
        .await
        .context("fetching config with a device-secret token failed")?;

    report.check(
        "device secret exchanges for a token",
        config.config.config_version == enrolled.config.config_version,
        "config version mismatch",
    );

    // ---- heartbeat --------------------------------------------------------
    let heartbeat = client
        .heartbeat(&HeartbeatRequest {
            status: ReportedPresence::Active,
            idle_seconds: 0,
            current_application: Some("Self Test".into()),
            agent_version: AGENT_VERSION.to_string(),
            queue_depth: Some(0),
            sent_at: Utc::now(),
        })
        .await
        .context("heartbeat failed")?;

    report.check("heartbeat is accepted", heartbeat.ok, "ok was false");
    report.check(
        "heartbeat returns the config version",
        heartbeat.config_version == config.config.config_version,
        "version mismatch",
    );

    // ---- telemetry --------------------------------------------------------
    let now = Utc::now();
    let started = now - ChronoDuration::seconds(600);
    let ended = now - ChronoDuration::seconds(300);

    let response = client
        .send_telemetry(vec![
            TelemetryEvent::AppSession {
                event_id: wp_core::new_event_id("selftest-app"),
                app_name: "Self Test App".into(),
                exe_name: "selftest.exe".into(),
                window_title: None,
                started_at: started,
                ended_at: ended,
                duration_sec: 300,
            },
            TelemetryEvent::Inactivity {
                event_id: wp_core::new_event_id("selftest-idle"),
                kind: InactivityKind::Idle,
                started_at: ended,
                ended_at: now - ChronoDuration::seconds(60),
                duration_sec: 240,
            },
            TelemetryEvent::AgentLog {
                event_id: wp_core::new_event_id("selftest-log"),
                level: LogLevel::Info,
                message: "Protocol self test".into(),
                occurred_at: now,
            },
        ])
        .await
        .context("telemetry upload failed")?;

    report.check(
        "all three event types are accepted",
        response.accepted == 3,
        &format!("accepted {} of 3, rejected {:?}", response.accepted, response.rejected),
    );

    // ---- idempotent replay ------------------------------------------------
    let replay_id = wp_core::new_event_id("selftest-replay");
    let replay = TelemetryEvent::AppSession {
        event_id: replay_id.clone(),
        app_name: "Replay".into(),
        exe_name: "replay.exe".into(),
        window_title: None,
        started_at: started,
        ended_at: ended,
        duration_sec: 300,
    };

    let first = client.send_telemetry(vec![replay.clone()]).await?;
    let second = client.send_telemetry(vec![replay]).await?;

    report.check(
        "a replayed event is counted as a duplicate",
        first.accepted == 1 && second.accepted == 0 && second.duplicates == 1,
        &format!(
            "first accepted {}, second accepted {} duplicates {}",
            first.accepted, second.accepted, second.duplicates
        ),
    );

    // ---- clock skew rejection --------------------------------------------
    let future = Utc::now() + ChronoDuration::hours(2);
    let skewed = client
        .send_telemetry(vec![TelemetryEvent::AppSession {
            event_id: wp_core::new_event_id("selftest-future"),
            app_name: "Future".into(),
            exe_name: "future.exe".into(),
            window_title: None,
            started_at: future,
            ended_at: future + ChronoDuration::seconds(300),
            duration_sec: 300,
        }])
        .await?;

    report.check(
        "a future-dated span is rejected",
        skewed.accepted == 0 && !skewed.rejected.is_empty(),
        "server accepted an impossible span",
    );

    // ---- status / transparency -------------------------------------------
    let status = client.fetch_status().await.context("status failed")?;

    report.check(
        "status names the employee and organization",
        !status.employee.name.is_empty() && !status.organization.name.is_empty(),
        "missing names",
    );
    report.check(
        "status lists what is not collected",
        status.not_collected.iter().any(|item| item.contains("Keyboard"))
            && status.not_collected.iter().any(|item| item.contains("Webcam")),
        "transparency list is incomplete",
    );

    // ---- summary ----------------------------------------------------------
    println!("\n  {} passed, {} failed", report.passed, report.failed.len());

    if !report.failed.is_empty() {
        println!("\nFailures:");
        for failure in &report.failed {
            println!("  - {failure}");
        }
        bail!("{} conformance check(s) failed", report.failed.len());
    }

    println!("\nProtocol conformance OK.");
    Ok(())
}
