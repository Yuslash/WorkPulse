//! Idle detection and workstation lock state.
//!
//! Uses `GetLastInputInfo`, which reports the tick of the last keyboard or
//! mouse event. Note what this does NOT do: it never sees *which* keys were
//! pressed. That distinction is the whole difference between activity
//! tracking and keylogging (spec §17).

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::System::SystemInformation::GetTickCount64;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

    /// Seconds since the last user input.
    pub fn idle_seconds() -> u32 {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };

        let ok = unsafe { GetLastInputInfo(&mut info) };
        if ok == 0 {
            // The call fails on a locked session / different desktop. Zero is
            // the conservative answer: it under-reports idle rather than
            // inventing inactivity someone would have to explain.
            return 0;
        }

        let now = unsafe { GetTickCount64() };
        let last = info.dwTime as u64;

        // GetTickCount64 does not wrap, but dwTime is a 32-bit tick that does
        // (every ~49 days of uptime). If last is ahead of now, it wrapped.
        let now_32 = (now & 0xFFFF_FFFF) as u32;
        let last_32 = last as u32;

        let elapsed_ms = if now_32 >= last_32 {
            (now_32 - last_32) as u64
        } else {
            (u32::MAX as u64 - last_32 as u64) + now_32 as u64
        };

        (elapsed_ms / 1000) as u32
    }

    /// True when the workstation is locked or the session is disconnected.
    ///
    /// A locked session has no foreground window we can read, which is the
    /// signal we use: `GetForegroundWindow` returns null on the secure
    /// desktop. `session_locked` is confirmed by the session-notification
    /// hook in `session.rs` when the agent runs as a service.
    pub fn is_locked() -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        unsafe { GetForegroundWindow().is_null() }
    }
}

/// Non-Windows stub so the crate compiles (and the workspace tests run)
/// anywhere. The agent binary only ships for Windows.
#[cfg(not(windows))]
mod imp {
    pub fn idle_seconds() -> u32 {
        0
    }

    pub fn is_locked() -> bool {
        false
    }
}

pub use imp::{idle_seconds, is_locked};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_seconds_is_plausible() {
        let idle = idle_seconds();
        // Anything above a few days of idle means the arithmetic is wrong.
        assert!(idle < 60 * 60 * 24 * 3, "implausible idle: {idle}");
    }

    #[test]
    fn is_locked_does_not_panic() {
        let _ = is_locked();
    }
}
