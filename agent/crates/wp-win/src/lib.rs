//! Windows platform layer for the WorkPulse agent.
//!
//! Every syscall the agent makes lives here, behind a small surface, so that
//! `wp-core` stays testable on any platform and so that the complete list of
//! things this software touches on an employee's machine is short enough to
//! read in one sitting:
//!
//!   GetForegroundWindow / GetWindowTextW   which app has focus
//!   GetWindowThreadProcessId / OpenProcess which executable that is
//!   GetLastInputInfo                       how long since any input
//!   GlobalMemoryStatusEx / GetSystemInfo   device inventory
//!   CryptProtectData                       sealing the device secret
//!   sc.exe / schtasks.exe                  auto-start registration
//!
//! There is no keyboard hook, no clipboard access, no screen capture and no
//! process enumeration beyond the focused window (spec §17).

pub mod autostart;
pub mod dpapi;
pub mod foreground;
pub mod idle;
pub mod sysinfo;

pub use dpapi::DpapiStore;
pub use foreground::foreground_window;
pub use idle::{idle_seconds, is_locked};
pub use sysinfo::device_info;

/// One observation of the machine, assembled from the collectors above.
///
/// `include_title` is threaded through rather than filtered afterwards so a
/// window title is never read when the policy forbids it.
pub struct Observation {
    pub idle_seconds: u32,
    pub locked: bool,
    pub window: Option<wp_core::ForegroundWindow>,
}

pub fn observe(track_applications: bool, track_window_titles: bool) -> Observation {
    let locked = idle::is_locked();

    Observation {
        idle_seconds: idle::idle_seconds(),
        locked,
        // A locked machine has no meaningful foreground app, and a disabled
        // collector does not run at all.
        window: if track_applications && !locked {
            foreground::foreground_window(track_window_titles)
        } else {
            None
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observe_respects_the_application_policy() {
        let observation = observe(false, false);
        // Collection disabled means nothing was collected, not collected-then-dropped.
        assert!(observation.window.is_none());
    }

    #[test]
    fn observe_never_returns_a_title_when_titles_are_disabled() {
        let observation = observe(true, false);
        if let Some(window) = observation.window {
            assert!(window.window_title.is_none());
        }
    }

    #[test]
    fn observe_produces_a_plausible_idle_reading() {
        let observation = observe(true, false);
        assert!(observation.idle_seconds < 60 * 60 * 24 * 3);
    }
}
