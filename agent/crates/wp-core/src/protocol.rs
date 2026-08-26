//! Wire types, mirroring `packages/shared/src/protocol.ts` field for field.
//!
//! If you change anything here, change that file too. `wp-agent --selftest`
//! runs this crate's types against a live API precisely so the two cannot
//! drift apart unnoticed.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub hostname: String,
    pub os: String,
    pub os_version: String,
    pub arch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_cores: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ram_mb: Option<u64>,
    pub agent_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollRequest {
    pub user_id: String,
    pub password: String,
    pub device: DeviceInfo,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrolledEmployee {
    pub id: String,
    pub name: String,
    pub organization_id: String,
    pub organization_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub device_id: String,
    /// Returned exactly once. Everything afterwards depends on storing it.
    pub device_secret: String,
    pub employee: EnrolledEmployee,
    pub access_token: String,
    pub access_token_expires_at: DateTime<Utc>,
    pub config: AgentConfig,
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenRequest {
    pub device_id: String,
    pub device_secret: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub access_token: String,
    pub access_token_expires_at: DateTime<Utc>,
    pub config_version: u32,
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub config_version: u32,
    pub track_applications: bool,
    pub track_window_titles: bool,
    pub track_websites: bool,
    pub track_screenshots: bool,
    pub idle_threshold_sec: u32,
    pub heartbeat_sec: u32,
    pub telemetry_flush_sec: u32,
    pub config_refresh_sec: u32,
    pub max_queue_bytes: u64,
    pub retention_days: u32,
}

impl Default for AgentConfig {
    /// Used only before the first successful config fetch. The privacy-
    /// sensitive collectors default OFF so an agent that cannot reach the
    /// server never collects more than one that can.
    fn default() -> Self {
        Self {
            config_version: 0,
            track_applications: true,
            track_window_titles: false,
            track_websites: false,
            track_screenshots: false,
            idle_threshold_sec: 600,
            heartbeat_sec: 30,
            telemetry_flush_sec: 45,
            config_refresh_sec: 600,
            max_queue_bytes: 50 * 1024 * 1024,
            retention_days: 90,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigResponse {
    pub config: AgentConfig,
    pub server_time: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ReportedPresence {
    Active,
    Idle,
    Locked,
}

impl ReportedPresence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Idle => "IDLE",
            Self::Locked => "LOCKED",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatRequest {
    pub status: ReportedPresence,
    pub idle_seconds: u32,
    pub current_application: Option<String>,
    pub current_shift: Option<String>,
    pub agent_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_depth: Option<u32>,
    pub sent_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatResponse {
    pub ok: bool,
    pub server_time: DateTime<Utc>,
    /// Compared against the local config version to decide whether to refetch.
    pub config_version: u32,
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

pub const TELEMETRY_MAX_BATCH: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InactivityKind {
    Idle,
    Locked,
    Away,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// Tagged exactly like the Zod discriminated union on the server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TelemetryEvent {
    AppSession {
        #[serde(rename = "eventId")]
        event_id: String,
        #[serde(rename = "appName")]
        app_name: String,
        #[serde(rename = "exeName")]
        exe_name: String,
        #[serde(rename = "windowTitle")]
        window_title: Option<String>,
        #[serde(rename = "startedAt")]
        started_at: DateTime<Utc>,
        #[serde(rename = "endedAt")]
        ended_at: DateTime<Utc>,
        #[serde(rename = "durationSec")]
        duration_sec: u32,
    },
    Inactivity {
        #[serde(rename = "eventId")]
        event_id: String,
        kind: InactivityKind,
        #[serde(rename = "startedAt")]
        started_at: DateTime<Utc>,
        #[serde(rename = "endedAt")]
        ended_at: DateTime<Utc>,
        #[serde(rename = "durationSec")]
        duration_sec: u32,
    },
    AgentLog {
        #[serde(rename = "eventId")]
        event_id: String,
        level: LogLevel,
        message: String,
        #[serde(rename = "occurredAt")]
        occurred_at: DateTime<Utc>,
    },
}

impl TelemetryEvent {
    pub fn event_id(&self) -> &str {
        match self {
            Self::AppSession { event_id, .. }
            | Self::Inactivity { event_id, .. }
            | Self::AgentLog { event_id, .. } => event_id,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryRequest {
    pub batch_id: String,
    pub events: Vec<TelemetryEvent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedEvent {
    pub event_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryResponse {
    pub ok: bool,
    pub accepted: u32,
    pub duplicates: u32,
    pub rejected: Vec<RejectedEvent>,
    pub server_time: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Status (tray)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEmployee {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusOrganization {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDevice {
    pub id: String,
    pub hostname: String,
    pub status: String,
    pub enrolled_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusResponse {
    pub employee: StatusEmployee,
    pub organization: StatusOrganization,
    pub device: StatusDevice,
    /// Rendered verbatim by the tray, so the employee sees exactly what the
    /// server says is being collected.
    pub collected: Vec<String>,
    pub not_collected: Vec<String>,
    pub server_time: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ApiErrorBody {
    pub error: ApiErrorDetail,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiErrorDetail {
    pub code: String,
    pub message: String,
}

/// Errors that mean "stop retrying and forget this identity". Everything else
/// is treated as transient and retried with backoff.
pub const TERMINAL_ERRORS: &[&str] = &["DEVICE_REVOKED", "DEVICE_UNKNOWN", "CREDENTIALS_REVOKED"];

pub fn is_terminal_error(code: &str) -> bool {
    TERMINAL_ERRORS.contains(&code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_app_session_with_the_server_field_names() {
        let event = TelemetryEvent::AppSession {
            event_id: "evt-1".into(),
            app_name: "Visual Studio Code".into(),
            exe_name: "Code.exe".into(),
            window_title: None,
            started_at: "2026-08-19T09:00:00Z".parse().unwrap(),
            ended_at: "2026-08-19T09:30:00Z".parse().unwrap(),
            duration_sec: 1800,
        };

        let json = serde_json::to_value(&event).unwrap();

        // The server discriminates on `type` and validates camelCase keys.
        assert_eq!(json["type"], "app_session");
        assert_eq!(json["eventId"], "evt-1");
        assert_eq!(json["exeName"], "Code.exe");
        assert_eq!(json["durationSec"], 1800);
        assert!(json.get("window_title").is_none());
    }

    #[test]
    fn serializes_inactivity_kind_lowercase() {
        let event = TelemetryEvent::Inactivity {
            event_id: "evt-2".into(),
            kind: InactivityKind::Locked,
            started_at: "2026-08-19T09:00:00Z".parse().unwrap(),
            ended_at: "2026-08-19T09:05:00Z".parse().unwrap(),
            duration_sec: 300,
        };

        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "inactivity");
        assert_eq!(json["kind"], "locked");
    }

    #[test]
    fn serializes_presence_uppercase() {
        assert_eq!(
            serde_json::to_value(ReportedPresence::Active).unwrap(),
            serde_json::json!("ACTIVE")
        );
    }

    #[test]
    fn round_trips_telemetry_events_through_the_queue_encoding() {
        let event = TelemetryEvent::AgentLog {
            event_id: "evt-3".into(),
            level: LogLevel::Warn,
            message: "Network unavailable".into(),
            occurred_at: "2026-08-19T09:00:00Z".parse().unwrap(),
        };

        let encoded = serde_json::to_vec(&event).unwrap();
        let decoded: TelemetryEvent = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(event, decoded);
    }

    #[test]
    fn default_config_keeps_privacy_sensitive_collectors_off() {
        let config = AgentConfig::default();
        assert!(!config.track_screenshots);
        assert!(!config.track_websites);
        assert!(!config.track_window_titles);
    }

    #[test]
    fn recognizes_terminal_errors() {
        assert!(is_terminal_error("DEVICE_REVOKED"));
        assert!(is_terminal_error("DEVICE_UNKNOWN"));
        assert!(!is_terminal_error("TOKEN_EXPIRED"));
        assert!(!is_terminal_error("RATE_LIMITED"));
    }
}
