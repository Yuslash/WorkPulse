//! WorkPulse agent core.
//!
//! Everything in this crate is platform-independent and unit-testable. The
//! Windows syscalls live in `wp-win`, and the binaries in `wp-agent` /
//! `wp-tray` wire the two together. Keeping the logic here is what lets an
//! eight-hour workday be simulated in a millisecond.

pub mod backoff;
pub mod client;
pub mod identity;
pub mod protocol;
pub mod queue;
pub mod sessionizer;
pub mod state;

pub use backoff::Backoff;
pub use client::{ApiClient, ClientError};
pub use identity::{DeviceIdentity, IdentityStore, PlaintextStore, SecretStore};
pub use protocol::{AgentConfig, TelemetryEvent};
pub use queue::EventQueue;
pub use sessionizer::{ForegroundWindow, Sessionizer};
pub use state::{PresenceState, Sample, StateMachine};

/// The version reported to the server and shown in the agent-health view.
pub const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Event ids are generated on the endpoint because ingest is idempotent on
/// them: a queue replay re-sends the same id and the server counts it as a
/// duplicate rather than storing the span twice.
pub fn new_event_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn event_ids_are_unique() {
        let ids: HashSet<String> = (0..1000).map(|_| new_event_id("app")).collect();
        assert_eq!(ids.len(), 1000);
    }

    #[test]
    fn event_ids_carry_their_prefix() {
        assert!(new_event_id("app").starts_with("app-"));
    }

    #[test]
    fn event_ids_fit_the_server_length_limit() {
        // The server validates 8..=64 characters.
        let id = new_event_id("inactivity");
        assert!(id.len() >= 8 && id.len() <= 64, "length was {}", id.len());
    }
}
