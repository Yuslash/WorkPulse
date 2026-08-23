//! The endpoint-side presence state machine (spec §24).
//!
//! Deliberately pure: it takes samples in and produces transitions out, with
//! no clock and no syscalls of its own. That is what makes an eight-hour
//! workday testable in a millisecond.

use crate::protocol::{InactivityKind, ReportedPresence};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresenceState {
    Active,
    Idle,
    Locked,
}

impl PresenceState {
    pub fn reported(self) -> ReportedPresence {
        match self {
            Self::Active => ReportedPresence::Active,
            Self::Idle => ReportedPresence::Idle,
            Self::Locked => ReportedPresence::Locked,
        }
    }

    fn inactivity_kind(self) -> Option<InactivityKind> {
        match self {
            Self::Active => None,
            Self::Idle => Some(InactivityKind::Idle),
            Self::Locked => Some(InactivityKind::Locked),
        }
    }
}

/// One observation of the machine.
#[derive(Debug, Clone, Copy)]
pub struct Sample {
    pub at: DateTime<Utc>,
    /// Seconds since the last keyboard or mouse input.
    pub idle_seconds: u32,
    /// True while the workstation is locked or the session is disconnected.
    pub locked: bool,
}

/// A completed span of not-working, emitted when the state ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InactivitySpan {
    pub kind: InactivityKind,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub duration_sec: u32,
}

/// An idle span this long is reclassified as "away" rather than "idle",
/// which is what separates a coffee break from stepping out for lunch.
pub const AWAY_THRESHOLD_SEC: u32 = 30 * 60;

pub struct StateMachine {
    state: PresenceState,
    state_since: DateTime<Utc>,
    idle_threshold_sec: u32,
}

impl StateMachine {
    pub fn new(now: DateTime<Utc>, idle_threshold_sec: u32) -> Self {
        Self {
            state: PresenceState::Active,
            state_since: now,
            idle_threshold_sec,
        }
    }

    pub fn state(&self) -> PresenceState {
        self.state
    }

    pub fn state_since(&self) -> DateTime<Utc> {
        self.state_since
    }

    /// Policy can change under a running agent; a shorter threshold must take
    /// effect on the next sample rather than after a restart.
    pub fn set_idle_threshold(&mut self, idle_threshold_sec: u32) {
        self.idle_threshold_sec = idle_threshold_sec;
    }

    /// Feeds one observation in. Returns a completed span whenever the state
    /// changes away from a non-active state.
    pub fn observe(&mut self, sample: Sample) -> Option<InactivitySpan> {
        let next = if sample.locked {
            // Locking wins over idle: the screen being locked is a stronger,
            // more accurate statement than an input timer.
            PresenceState::Locked
        } else if sample.idle_seconds >= self.idle_threshold_sec {
            PresenceState::Idle
        } else {
            PresenceState::Active
        };

        if next == self.state {
            return None;
        }

        let finished = self.close_span(sample.at);
        self.state = next;
        self.state_since = sample.at;
        finished
    }

    /// Ends the current span without starting a new one — used at shutdown so
    /// the last period of the day is not lost.
    pub fn finish(&mut self, at: DateTime<Utc>) -> Option<InactivitySpan> {
        let finished = self.close_span(at);
        self.state_since = at;
        finished
    }

    fn close_span(&self, at: DateTime<Utc>) -> Option<InactivitySpan> {
        let kind = self.state.inactivity_kind()?;

        let duration = (at - self.state_since).num_seconds();
        // A non-positive duration means the clock moved backwards; emitting it
        // would have the server reject the batch.
        if duration <= 0 {
            return None;
        }
        let duration_sec = duration as u32;

        // Long idles are recorded as "away" so the dashboard can distinguish
        // a short pause from an absence.
        let kind = if kind == InactivityKind::Idle && duration_sec >= AWAY_THRESHOLD_SEC {
            InactivityKind::Away
        } else {
            kind
        };

        Some(InactivitySpan {
            kind,
            started_at: self.state_since,
            ended_at: at,
            duration_sec,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_755_000_000 + seconds, 0).unwrap()
    }

    fn sample(seconds: i64, idle: u32, locked: bool) -> Sample {
        Sample {
            at: at(seconds),
            idle_seconds: idle,
            locked,
        }
    }

    #[test]
    fn starts_active() {
        let machine = StateMachine::new(at(0), 600);
        assert_eq!(machine.state(), PresenceState::Active);
    }

    #[test]
    fn stays_active_below_the_threshold() {
        let mut machine = StateMachine::new(at(0), 600);
        assert!(machine.observe(sample(60, 300, false)).is_none());
        assert_eq!(machine.state(), PresenceState::Active);
    }

    #[test]
    fn goes_idle_at_the_threshold() {
        let mut machine = StateMachine::new(at(0), 600);
        assert!(machine.observe(sample(600, 600, false)).is_none());
        assert_eq!(machine.state(), PresenceState::Idle);
    }

    #[test]
    fn emits_an_idle_span_when_activity_resumes() {
        let mut machine = StateMachine::new(at(0), 600);
        machine.observe(sample(600, 600, false));

        let span = machine.observe(sample(900, 0, false)).expect("span");
        assert_eq!(span.kind, InactivityKind::Idle);
        assert_eq!(span.started_at, at(600));
        assert_eq!(span.ended_at, at(900));
        assert_eq!(span.duration_sec, 300);
        assert_eq!(machine.state(), PresenceState::Active);
    }

    #[test]
    fn promotes_a_long_idle_to_away() {
        let mut machine = StateMachine::new(at(0), 600);
        machine.observe(sample(600, 600, false));

        // 45 minutes idle is lunch, not a pause.
        let span = machine.observe(sample(600 + 2700, 0, false)).expect("span");
        assert_eq!(span.kind, InactivityKind::Away);
        assert_eq!(span.duration_sec, 2700);
    }

    #[test]
    fn lock_takes_priority_over_idle() {
        let mut machine = StateMachine::new(at(0), 600);
        // Idle timer has not tripped, but the screen is locked.
        machine.observe(sample(10, 0, true));
        assert_eq!(machine.state(), PresenceState::Locked);
    }

    #[test]
    fn emits_a_locked_span_on_unlock() {
        let mut machine = StateMachine::new(at(0), 600);
        machine.observe(sample(100, 0, true));

        let span = machine.observe(sample(400, 0, false)).expect("span");
        assert_eq!(span.kind, InactivityKind::Locked);
        assert_eq!(span.duration_sec, 300);
    }

    #[test]
    fn transitions_directly_from_idle_to_locked() {
        let mut machine = StateMachine::new(at(0), 600);
        machine.observe(sample(600, 600, false));

        let span = machine.observe(sample(900, 900, true)).expect("span");
        assert_eq!(span.kind, InactivityKind::Idle);
        assert_eq!(machine.state(), PresenceState::Locked);
    }

    #[test]
    fn does_not_emit_a_span_for_an_active_period() {
        let mut machine = StateMachine::new(at(0), 600);
        // Active -> Idle produces nothing; only leaving a non-active state does.
        assert!(machine.observe(sample(600, 600, false)).is_none());
    }

    #[test]
    fn ignores_backwards_clock_jumps() {
        let mut machine = StateMachine::new(at(1000), 600);
        machine.observe(sample(1600, 600, false));

        // An NTP correction pulls the clock behind the span start.
        assert!(machine.observe(sample(1500, 0, false)).is_none());
    }

    #[test]
    fn applies_a_policy_change_on_the_next_sample() {
        let mut machine = StateMachine::new(at(0), 600);
        machine.observe(sample(300, 300, false));
        assert_eq!(machine.state(), PresenceState::Active);

        // Admin shortens the idle threshold to 5 minutes.
        machine.set_idle_threshold(300);
        machine.observe(sample(360, 360, false));
        assert_eq!(machine.state(), PresenceState::Idle);
    }

    #[test]
    fn finish_closes_the_open_span_at_shutdown() {
        let mut machine = StateMachine::new(at(0), 600);
        machine.observe(sample(600, 600, false));

        let span = machine.finish(at(800)).expect("span");
        assert_eq!(span.duration_sec, 200);
    }

    #[test]
    fn finish_returns_nothing_while_active() {
        let mut machine = StateMachine::new(at(0), 600);
        assert!(machine.finish(at(100)).is_none());
    }

    #[test]
    fn models_a_realistic_workday() {
        let mut machine = StateMachine::new(at(0), 600);
        let mut spans = Vec::new();

        // Works for an hour.
        machine.observe(sample(3600, 0, false));
        // Idles for 15 minutes.
        if let Some(s) = machine.observe(sample(4200, 600, false)) {
            spans.push(s);
        }
        if let Some(s) = machine.observe(sample(5100, 0, false)) {
            spans.push(s);
        }
        // Locks the screen for lunch.
        if let Some(s) = machine.observe(sample(5200, 0, true)) {
            spans.push(s);
        }
        if let Some(s) = machine.observe(sample(8800, 0, false)) {
            spans.push(s);
        }

        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].kind, InactivityKind::Idle);
        assert_eq!(spans[0].duration_sec, 900);
        assert_eq!(spans[1].kind, InactivityKind::Locked);
        assert_eq!(spans[1].duration_sec, 3600);
    }
}
