//! The agent run loop.
//!
//! Four independent cadences (spec §45), all driven from one task so there is
//! a single place where state is mutated:
//!
//!   sample     every 5s     foreground window + idle + lock
//!   heartbeat  policy       presence, current app, queue depth
//!   flush      policy       drain the queue to the server
//!   config     policy       refetch when the version changes
//!
//! Nothing polls at 100ms. The 5s sample tick is what bounds CPU to well
//! under 1%.

use anyhow::{Context, Result};
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;
use wp_core::protocol::{
    AgentConfig, HeartbeatRequest, LogLevel, ReportedPresence, TelemetryEvent, TELEMETRY_MAX_BATCH,
};
use wp_core::{
    ApiClient, Backoff, ClientError, DeviceIdentity, EventQueue, IdentityStore, Sessionizer,
    StateMachine, AGENT_VERSION,
};

/// How often the machine is observed. Everything else is derived from policy.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);

/// Live snapshot for the tray.
#[derive(Debug, Clone)]
pub struct AgentStatus {
    pub presence: &'static str,
    pub current_application: Option<String>,
    pub queue_depth: u64,
    pub connected: bool,
    pub last_error: Option<String>,
}

impl Default for AgentStatus {
    fn default() -> Self {
        Self {
            presence: "ACTIVE",
            current_application: None,
            queue_depth: 0,
            connected: false,
            last_error: None,
        }
    }
}

pub struct Runner {
    client: ApiClient,
    queue: Arc<EventQueue>,
    identity: DeviceIdentity,
    identity_store: IdentityStore,
    config: AgentConfig,
    state: StateMachine,
    sessionizer: Sessionizer,
    backoff: Backoff,
    status_tx: watch::Sender<AgentStatus>,
}

impl Runner {
    pub fn new(
        identity: DeviceIdentity,
        identity_store: IdentityStore,
        queue: Arc<EventQueue>,
        config: AgentConfig,
    ) -> Result<(Self, watch::Receiver<AgentStatus>)> {
        let client = ApiClient::new(identity.server_url.clone())?
            .with_device(identity.device_id.clone(), identity.device_secret.clone());

        let (status_tx, status_rx) = watch::channel(AgentStatus::default());
        let now = Utc::now();

        Ok((
            Self {
                client,
                queue,
                identity,
                identity_store,
                state: StateMachine::new(now, config.idle_threshold_sec),
                sessionizer: Sessionizer::new(config.track_window_titles),
                config,
                backoff: Backoff::default(),
                status_tx,
            },
            status_rx,
        ))
    }

    /// Runs until `shutdown` fires. Returns Ok(()) on a clean stop, and Err
    /// only when the agent must not restart (a terminal auth failure).
    pub async fn run(mut self, mut shutdown: watch::Receiver<bool>) -> Result<()> {
        // Recorded locally and server-side: "which employee is this machine
        // reporting as" is the first question any support case starts with.
        tracing::info!(
            employee = %self.identity.employee_name,
            organization = %self.identity.organization_name,
            device = %self.identity.device_id,
            server = %self.identity.server_url,
            "agent started"
        );

        self.enqueue_log(
            LogLevel::Info,
            &format!("Agent started for {}", self.identity.employee_name),
        );

        let mut sample_tick = tokio::time::interval(SAMPLE_INTERVAL);
        let mut heartbeat_tick = tokio::time::interval(Duration::from_secs(self.config.heartbeat_sec as u64));
        let mut flush_tick = tokio::time::interval(Duration::from_secs(self.config.telemetry_flush_sec as u64));
        let mut config_tick = tokio::time::interval(Duration::from_secs(self.config.config_refresh_sec as u64));

        // The first tick of a tokio interval fires immediately; skip the
        // duplicate so startup does not send four requests at once.
        sample_tick.tick().await;
        heartbeat_tick.tick().await;
        flush_tick.tick().await;
        config_tick.tick().await;

        loop {
            tokio::select! {
                _ = shutdown.changed() => {
                    if *shutdown.borrow() {
                        break;
                    }
                }
                _ = sample_tick.tick() => self.sample(),
                _ = heartbeat_tick.tick() => {
                    if let Err(error) = self.heartbeat().await {
                        if error.is_terminal() {
                            return self.handle_terminal(error).await;
                        }
                    }
                }
                _ = flush_tick.tick() => {
                    if let Err(error) = self.flush().await {
                        if error.is_terminal() {
                            return self.handle_terminal(error).await;
                        }
                    }
                }
                _ = config_tick.tick() => {
                    let _ = self.refresh_config().await;
                }
            }
        }

        self.shutdown().await;
        Ok(())
    }

    /// Observes the machine and folds the result into the state machine and
    /// sessionizer, queueing whatever spans they complete.
    fn sample(&mut self) {
        let now = Utc::now();
        let observation = wp_win::observe(self.config.track_applications, self.config.track_window_titles);

        if let Some(span) = self.state.observe(wp_core::Sample {
            at: now,
            idle_seconds: observation.idle_seconds,
            locked: observation.locked,
        }) {
            self.enqueue(TelemetryEvent::Inactivity {
                event_id: wp_core::new_event_id("inactivity"),
                kind: span.kind,
                started_at: span.started_at,
                ended_at: span.ended_at,
                duration_sec: span.duration_sec,
            });
        }

        // A locked or idle machine is not "using" the focused application, so
        // the open session is closed rather than left accruing time.
        let window = if matches!(self.state.state(), wp_core::PresenceState::Active) {
            observation.window
        } else {
            None
        };

        if let Some(event) = self.sessionizer.observe(window, now) {
            self.enqueue(event);
        }

        self.publish_status(None);
    }

    async fn heartbeat(&mut self) -> Result<(), ClientError> {
        let request = HeartbeatRequest {
            status: self.state.state().reported(),
            idle_seconds: wp_win::idle_seconds(),
            current_application: self
                .sessionizer
                .current()
                .map(|window| window.app_name.clone()),
            agent_version: AGENT_VERSION.to_string(),
            queue_depth: self.queue.len().ok().map(|n| n as u32),
            sent_at: Utc::now(),
        };

        match self.client.heartbeat(&request).await {
            Ok(response) => {
                self.backoff.reset();
                self.publish_status(Some(true));

                // A version mismatch means an admin changed policy; picking it
                // up here propagates a change within one heartbeat.
                if response.config_version != self.config.config_version {
                    tracing::info!(
                        from = self.config.config_version,
                        to = response.config_version,
                        "policy changed"
                    );
                    let _ = self.refresh_config().await;
                }
                Ok(())
            }
            Err(error) => {
                tracing::warn!(%error, "heartbeat failed");
                self.publish_status(Some(false));
                Err(error)
            }
        }
    }

    /// Drains the queue in batches. Events are removed only after the server
    /// acknowledges them, so an interruption replays rather than loses.
    async fn flush(&mut self) -> Result<(), ClientError> {
        loop {
            let batch = match self.queue.peek(TELEMETRY_MAX_BATCH) {
                Ok(batch) => batch,
                Err(error) => {
                    tracing::error!(%error, "reading the queue failed");
                    return Ok(());
                }
            };

            if batch.is_empty() {
                return Ok(());
            }

            let keys: Vec<u64> = batch.iter().map(|(key, _)| *key).collect();
            let events: Vec<TelemetryEvent> = batch.into_iter().map(|(_, event)| event).collect();
            let count = events.len();

            match self.client.send_telemetry(events).await {
                Ok(response) => {
                    // Rejected events are permanently unacceptable (bad clock,
                    // malformed span). Dropping them with the batch is right:
                    // retrying would loop forever on the same rejection.
                    if !response.rejected.is_empty() {
                        tracing::warn!(count = response.rejected.len(), "server rejected events");
                    }

                    if let Err(error) = self.queue.remove(&keys) {
                        tracing::error!(%error, "failed to clear sent events");
                        return Ok(());
                    }

                    self.backoff.reset();
                    self.publish_status(Some(true));

                    // A partial batch means the queue is drained.
                    if count < TELEMETRY_MAX_BATCH {
                        return Ok(());
                    }
                }
                Err(error) => {
                    tracing::warn!(%error, "telemetry upload failed; keeping events queued");
                    self.publish_status(Some(false));
                    return Err(error);
                }
            }
        }
    }

    async fn refresh_config(&mut self) -> Result<(), ClientError> {
        let response = self.client.fetch_config().await?;
        let config = response.config;

        if config == self.config {
            return Ok(());
        }

        tracing::info!(version = config.config_version, "applying new policy");

        // Policy changes take effect immediately rather than at next restart.
        self.state.set_idle_threshold(config.idle_threshold_sec);
        self.sessionizer.set_track_window_titles(config.track_window_titles);

        // Turning application tracking off must end the open session rather
        // than leaving it to be reported later.
        if !config.track_applications {
            if let Some(event) = self.sessionizer.close(Utc::now()) {
                self.enqueue(event);
            }
        }

        self.config = config;
        Ok(())
    }

    /// The server says this device is revoked or unknown. Stop, wipe the
    /// identity, and let the operator re-enroll — retrying cannot help.
    async fn handle_terminal(mut self, error: ClientError) -> Result<()> {
        tracing::error!(%error, "terminal error; clearing device identity");

        if let Some(span) = self.state.finish(Utc::now()) {
            let _ = span;
        }

        self.identity_store
            .clear()
            .context("clearing device identity after revocation")?;

        self.publish_status(Some(false));
        Err(anyhow::anyhow!("device is no longer authorized: {error}"))
    }

    /// Closes open spans and makes a final delivery attempt so the last few
    /// minutes of the day are not lost to a clean shutdown.
    async fn shutdown(&mut self) {
        let now = Utc::now();

        if let Some(span) = self.state.finish(now) {
            self.enqueue(TelemetryEvent::Inactivity {
                event_id: wp_core::new_event_id("inactivity"),
                kind: span.kind,
                started_at: span.started_at,
                ended_at: span.ended_at,
                duration_sec: span.duration_sec,
            });
        }

        if let Some(event) = self.sessionizer.close(now) {
            self.enqueue(event);
        }

        self.enqueue_log(LogLevel::Info, "Agent stopping");
        let _ = self.flush().await;
    }

    fn enqueue(&self, event: TelemetryEvent) {
        if let Err(error) = self.queue.push(&event) {
            tracing::error!(%error, "failed to queue event");
        }
    }

    fn enqueue_log(&self, level: LogLevel, message: &str) {
        self.enqueue(TelemetryEvent::AgentLog {
            event_id: wp_core::new_event_id("log"),
            level,
            message: message.to_string(),
            occurred_at: Utc::now(),
        });
    }

    fn publish_status(&self, connected: Option<bool>) {
        let previous = self.status_tx.borrow().clone();

        let _ = self.status_tx.send(AgentStatus {
            presence: match self.state.state().reported() {
                ReportedPresence::Active => "ACTIVE",
                ReportedPresence::Idle => "IDLE",
                ReportedPresence::Locked => "LOCKED",
            },
            current_application: self.sessionizer.current().map(|w| w.app_name.clone()),
            queue_depth: self.queue.len().unwrap_or(0),
            connected: connected.unwrap_or(previous.connected),
            last_error: previous.last_error,
        });
    }
}
