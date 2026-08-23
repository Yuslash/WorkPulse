//! Turns a stream of foreground-window observations into completed
//! application sessions.
//!
//! Sessionizing on the endpoint rather than the server means one document per
//! span instead of one per sample, which is the difference between a few
//! hundred writes a day and a few hundred thousand.

use crate::protocol::TelemetryEvent;
use chrono::{DateTime, Utc};

/// What the foreground window is right now. `None` means nothing is focused
/// (the desktop, a lock screen, or a failed query).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForegroundWindow {
    pub app_name: String,
    pub exe_name: String,
    pub window_title: Option<String>,
}

#[derive(Debug, Clone)]
struct OpenSession {
    window: ForegroundWindow,
    started_at: DateTime<Utc>,
    last_seen_at: DateTime<Utc>,
}

/// Sessions shorter than this are dropped. Alt-tabbing through five windows
/// should not produce five rows on the timeline.
pub const MIN_SESSION_SEC: i64 = 3;

/// If observations stop for longer than this (sleep, hibernate, agent
/// restart), the open session ends at the last observation rather than
/// stretching across the gap and inventing hours of work.
pub const MAX_SAMPLE_GAP_SEC: i64 = 120;

pub struct Sessionizer {
    open: Option<OpenSession>,
    track_window_titles: bool,
}

impl Sessionizer {
    pub fn new(track_window_titles: bool) -> Self {
        Self {
            open: None,
            track_window_titles,
        }
    }

    pub fn set_track_window_titles(&mut self, enabled: bool) {
        self.track_window_titles = enabled;
    }

    pub fn current(&self) -> Option<&ForegroundWindow> {
        self.open.as_ref().map(|session| &session.window)
    }

    /// Feeds one observation in; returns a completed session when the
    /// foreground application changes.
    pub fn observe(
        &mut self,
        window: Option<ForegroundWindow>,
        at: DateTime<Utc>,
    ) -> Option<TelemetryEvent> {
        let Some(window) = window else {
            return self.close(at);
        };

        let same_app = self
            .open
            .as_ref()
            .is_some_and(|open| open.window.exe_name == window.exe_name);

        let gapped = self
            .open
            .as_ref()
            .is_some_and(|open| (at - open.last_seen_at).num_seconds() > MAX_SAMPLE_GAP_SEC);

        // Same application and no gap: keep the session open. The title may
        // change (a new file, a new tab) without starting a new session.
        if same_app && !gapped {
            if let Some(open) = self.open.as_mut() {
                if self.track_window_titles {
                    open.window.window_title = window.window_title;
                }
                open.last_seen_at = at;
            }
            return None;
        }

        // Otherwise the previous session ends. `close` clamps the end time to
        // the last real observation, so a sleep gap is never billed — to the
        // old application OR to whatever happens to be focused on wake.
        let finished = self.close(at);
        self.open = Some(OpenSession {
            window,
            started_at: at,
            last_seen_at: at,
        });
        finished
    }

    /// Ends any open session — called at shutdown and when the machine locks.
    ///
    /// The end time is clamped to the last observation plus one sampling
    /// window. Without that, a laptop closed at 17:00 and opened at 09:00
    /// would report sixteen hours of work.
    pub fn close(&mut self, at: DateTime<Utc>) -> Option<TelemetryEvent> {
        let open = self.open.take()?;

        let ended_at = if (at - open.last_seen_at).num_seconds() > MAX_SAMPLE_GAP_SEC {
            open.last_seen_at
        } else {
            at
        };

        Self::build_event(&open, ended_at, self.track_window_titles)
    }

    fn build_event(
        open: &OpenSession,
        ended_at: DateTime<Utc>,
        track_window_titles: bool,
    ) -> Option<TelemetryEvent> {
        let duration = (ended_at - open.started_at).num_seconds();
        if duration < MIN_SESSION_SEC {
            return None;
        }

        Some(TelemetryEvent::AppSession {
            event_id: crate::new_event_id("app"),
            app_name: open.window.app_name.clone(),
            exe_name: open.window.exe_name.clone(),
            // Belt and braces: the collector should not have captured a title
            // when the policy is off, and it is dropped again here.
            window_title: if track_window_titles {
                open.window.window_title.clone()
            } else {
                None
            },
            started_at: open.started_at,
            ended_at,
            duration_sec: duration as u32,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(seconds: i64) -> DateTime<Utc> {
        DateTime::from_timestamp(1_755_000_000 + seconds, 0).unwrap()
    }

    fn window(exe: &str, title: Option<&str>) -> ForegroundWindow {
        ForegroundWindow {
            app_name: exe.trim_end_matches(".exe").to_string(),
            exe_name: exe.to_string(),
            window_title: title.map(str::to_string),
        }
    }

    fn duration_of(event: &TelemetryEvent) -> u32 {
        match event {
            TelemetryEvent::AppSession { duration_sec, .. } => *duration_sec,
            _ => panic!("expected an app session"),
        }
    }

    fn exe_of(event: &TelemetryEvent) -> String {
        match event {
            TelemetryEvent::AppSession { exe_name, .. } => exe_name.clone(),
            _ => panic!("expected an app session"),
        }
    }

    /// Feeds observations at the agent's real 5s cadence from `from` to `to`.
    ///
    /// Tests must sample the way the agent does: jumping straight from t=0 to
    /// t=600 looks exactly like a sleep gap, and the sessionizer is right to
    /// treat it as one.
    fn feed(
        sessionizer: &mut Sessionizer,
        window: Option<ForegroundWindow>,
        from: i64,
        to: i64,
    ) -> Vec<TelemetryEvent> {
        let mut events = Vec::new();
        let mut t = from;

        while t <= to {
            if let Some(event) = sessionizer.observe(window.clone(), at(t)) {
                events.push(event);
            }
            t += 5;
        }
        events
    }

    #[test]
    fn emits_nothing_for_the_first_observation() {
        let mut sessionizer = Sessionizer::new(false);
        assert!(sessionizer.observe(Some(window("code.exe", None)), at(0)).is_none());
    }

    #[test]
    fn emits_a_session_when_the_application_changes() {
        let mut sessionizer = Sessionizer::new(false);
        feed(&mut sessionizer, Some(window("code.exe", None)), 0, 595);

        let event = sessionizer
            .observe(Some(window("chrome.exe", None)), at(600))
            .expect("session");

        assert_eq!(exe_of(&event), "code.exe");
        assert_eq!(duration_of(&event), 600);
    }

    #[test]
    fn does_not_split_a_session_when_only_the_title_changes() {
        let mut sessionizer = Sessionizer::new(true);

        // Half an hour in VS Code, switching files partway through.
        let first = feed(&mut sessionizer, Some(window("code.exe", Some("main.rs"))), 0, 295);
        let second = feed(&mut sessionizer, Some(window("code.exe", Some("lib.rs"))), 300, 595);

        assert!(first.is_empty(), "a title change must not end the session");
        assert!(second.is_empty(), "a title change must not end the session");

        let event = sessionizer
            .observe(Some(window("chrome.exe", None)), at(600))
            .expect("session");

        assert_eq!(duration_of(&event), 600);

        // The most recent title wins, rather than the one the session opened with.
        match event {
            TelemetryEvent::AppSession { window_title, .. } => {
                assert_eq!(window_title.as_deref(), Some("lib.rs"));
            }
            _ => panic!("expected an app session"),
        }
    }

    #[test]
    fn drops_sessions_shorter_than_the_minimum() {
        let mut sessionizer = Sessionizer::new(false);
        sessionizer.observe(Some(window("code.exe", None)), at(0));

        // Alt-tabbing through windows must not litter the timeline.
        assert!(sessionizer.observe(Some(window("chrome.exe", None)), at(1)).is_none());
        assert!(sessionizer.observe(Some(window("slack.exe", None)), at(2)).is_none());
    }

    #[test]
    fn keeps_a_session_open_across_normal_sampling() {
        let mut sessionizer = Sessionizer::new(false);

        // Two hours of steady 5s samples must produce exactly one session.
        let events = feed(&mut sessionizer, Some(window("code.exe", None)), 0, 7200);
        assert!(events.is_empty());

        let event = sessionizer.close(at(7200)).expect("session");
        assert_eq!(duration_of(&event), 7200);
    }

    #[test]
    fn omits_window_titles_when_the_policy_is_off() {
        let mut sessionizer = Sessionizer::new(false);
        feed(
            &mut sessionizer,
            Some(window("code.exe", Some("secret-project.rs"))),
            0,
            595,
        );

        let event = sessionizer
            .observe(Some(window("chrome.exe", None)), at(600))
            .expect("session");

        match event {
            TelemetryEvent::AppSession { window_title, .. } => assert!(window_title.is_none()),
            _ => panic!("expected an app session"),
        }
    }

    #[test]
    fn includes_window_titles_when_the_policy_is_on() {
        let mut sessionizer = Sessionizer::new(true);
        feed(&mut sessionizer, Some(window("code.exe", Some("main.rs"))), 0, 595);

        let event = sessionizer
            .observe(Some(window("chrome.exe", None)), at(600))
            .expect("session");

        match event {
            TelemetryEvent::AppSession { window_title, .. } => {
                assert_eq!(window_title.as_deref(), Some("main.rs"));
            }
            _ => panic!("expected an app session"),
        }
    }

    #[test]
    fn closes_the_session_when_focus_is_lost() {
        let mut sessionizer = Sessionizer::new(false);
        feed(&mut sessionizer, Some(window("code.exe", None)), 0, 295);

        // The machine locks; the desktop has no foreground application.
        let event = sessionizer.observe(None, at(300)).expect("session");
        assert_eq!(duration_of(&event), 300);
        assert!(sessionizer.current().is_none());
    }

    #[test]
    fn does_not_bill_a_sleep_gap_to_the_same_application() {
        let mut sessionizer = Sessionizer::new(false);
        feed(&mut sessionizer, Some(window("code.exe", None)), 0, 60);

        // The laptop sleeps for four hours with VS Code still focused.
        let event = sessionizer
            .observe(Some(window("code.exe", None)), at(60 + 14_400))
            .expect("session");

        // The session ends at the last real observation, not four hours later.
        assert_eq!(duration_of(&event), 60);
    }

    #[test]
    fn does_not_bill_a_sleep_gap_to_a_different_application() {
        let mut sessionizer = Sessionizer::new(false);
        feed(&mut sessionizer, Some(window("code.exe", None)), 0, 60);

        // Sleeps overnight, wakes up in a browser. The sixteen hours belong
        // to neither application.
        let event = sessionizer
            .observe(Some(window("chrome.exe", None)), at(60 + 57_600))
            .expect("session");

        assert_eq!(exe_of(&event), "code.exe");
        assert_eq!(duration_of(&event), 60);
    }

    #[test]
    fn close_ends_the_open_session_at_shutdown() {
        let mut sessionizer = Sessionizer::new(false);
        feed(&mut sessionizer, Some(window("code.exe", None)), 0, 450);

        let event = sessionizer.close(at(450)).expect("session");
        assert_eq!(duration_of(&event), 450);
        assert!(sessionizer.close(at(500)).is_none());
    }

    #[test]
    fn assigns_a_unique_event_id_to_every_session() {
        let mut sessionizer = Sessionizer::new(false);

        feed(&mut sessionizer, Some(window("a.exe", None)), 0, 95);
        let first = sessionizer.observe(Some(window("b.exe", None)), at(100)).unwrap();
        feed(&mut sessionizer, Some(window("b.exe", None)), 105, 195);
        let second = sessionizer.observe(Some(window("c.exe", None)), at(200)).unwrap();

        // Ingest is idempotent on eventId, so collisions would silently drop data.
        assert_ne!(first.event_id(), second.event_id());
    }

    #[test]
    fn tracks_a_sequence_of_applications() {
        let mut sessionizer = Sessionizer::new(false);
        let mut events = Vec::new();

        // A realistic morning: VS Code, a browser detour, back to VS Code,
        // then Slack — sampled the way the agent actually samples.
        events.extend(feed(&mut sessionizer, Some(window("code.exe", None)), 0, 595));
        events.extend(feed(&mut sessionizer, Some(window("chrome.exe", None)), 600, 895));
        events.extend(feed(&mut sessionizer, Some(window("code.exe", None)), 900, 1795));
        events.extend(feed(&mut sessionizer, Some(window("slack.exe", None)), 1800, 1800));

        assert_eq!(events.len(), 3);
        assert_eq!(exe_of(&events[0]), "code.exe");
        assert_eq!(duration_of(&events[0]), 600);
        assert_eq!(exe_of(&events[1]), "chrome.exe");
        assert_eq!(duration_of(&events[1]), 300);
        assert_eq!(exe_of(&events[2]), "code.exe");
        assert_eq!(duration_of(&events[2]), 900);
    }
}
