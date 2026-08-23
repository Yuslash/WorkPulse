//! Foreground application detection.
//!
//! Reads which application currently has focus, and — only when policy allows
//! — its window title. It never reads window *contents*, never enumerates
//! other processes' memory, and never touches the clipboard.

use wp_core::ForegroundWindow;

#[cfg(windows)]
mod imp {
    use super::*;
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    /// Window titles can contain a document name, a customer name, or a
    /// subject line. Truncated so one pathological title cannot bloat a batch.
    const MAX_TITLE_LEN: usize = 500;

    fn wide_to_string(buffer: &[u16]) -> String {
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        String::from_utf16_lossy(&buffer[..end])
    }

    fn window_title(hwnd: HWND) -> Option<String> {
        let length = unsafe { GetWindowTextLengthW(hwnd) };
        if length <= 0 {
            return None;
        }

        let mut buffer = vec![0u16; length as usize + 1];
        let written = unsafe { GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
        if written <= 0 {
            return None;
        }

        let mut title = wide_to_string(&buffer);
        if title.len() > MAX_TITLE_LEN {
            title.truncate(MAX_TITLE_LEN);
        }

        if title.is_empty() {
            None
        } else {
            Some(title)
        }
    }

    /// Full image path of the process owning `hwnd`.
    fn process_path(hwnd: HWND) -> Option<String> {
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        if pid == 0 {
            return None;
        }

        // LIMITED_INFORMATION is the least privilege that still yields the
        // image name; it works without elevation for most processes.
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }

        let mut buffer = vec![0u16; MAX_PATH as usize];
        let mut size = buffer.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size) };
        unsafe { CloseHandle(handle) };

        if ok == 0 {
            return None;
        }

        buffer.truncate(size as usize);
        let path = wide_to_string(&buffer);
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    }

    /// Returns the focused application, or None when nothing is focused
    /// (locked screen, secure desktop, or an inaccessible process).
    pub fn foreground_window(include_title: bool) -> Option<ForegroundWindow> {
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return None;
        }

        let path = process_path(hwnd)?;
        let exe_name = path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or(&path)
            .to_ascii_lowercase();

        if exe_name.is_empty() {
            return None;
        }

        Some(ForegroundWindow {
            app_name: friendly_name(&exe_name),
            exe_name,
            // The title is not even read when the policy is off, rather than
            // read and discarded.
            window_title: if include_title { window_title(hwnd) } else { None },
        })
    }

    /// Maps a handful of common executables to human names for the dashboard.
    /// Anything unmapped falls back to the executable stem, so the list is a
    /// nicety rather than a dependency.
    fn friendly_name(exe_name: &str) -> String {
        match exe_name {
            "code.exe" => "Visual Studio Code",
            "devenv.exe" => "Visual Studio",
            "idea64.exe" => "IntelliJ IDEA",
            "pycharm64.exe" => "PyCharm",
            "chrome.exe" => "Google Chrome",
            "msedge.exe" => "Microsoft Edge",
            "firefox.exe" => "Mozilla Firefox",
            "slack.exe" => "Slack",
            "teams.exe" | "ms-teams.exe" => "Microsoft Teams",
            "outlook.exe" => "Microsoft Outlook",
            "excel.exe" => "Microsoft Excel",
            "winword.exe" => "Microsoft Word",
            "powerpnt.exe" => "Microsoft PowerPoint",
            "explorer.exe" => "File Explorer",
            "windowsterminal.exe" => "Windows Terminal",
            "powershell.exe" | "pwsh.exe" => "PowerShell",
            "cmd.exe" => "Command Prompt",
            "notepad.exe" => "Notepad",
            "spotify.exe" => "Spotify",
            "discord.exe" => "Discord",
            "figma.exe" => "Figma",
            "postman.exe" => "Postman",
            "docker desktop.exe" => "Docker Desktop",
            other => {
                let stem = other.trim_end_matches(".exe");
                let mut chars = stem.chars();
                return match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => stem.to_string(),
                };
            }
        }
        .to_string()
    }

    #[cfg(test)]
    mod name_tests {
        use super::friendly_name;

        #[test]
        fn maps_known_executables() {
            assert_eq!(friendly_name("code.exe"), "Visual Studio Code");
            assert_eq!(friendly_name("chrome.exe"), "Google Chrome");
        }

        #[test]
        fn falls_back_to_a_capitalized_stem() {
            assert_eq!(friendly_name("obscuretool.exe"), "Obscuretool");
        }

        #[test]
        fn handles_an_empty_name() {
            assert_eq!(friendly_name(""), "");
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn foreground_window(_include_title: bool) -> Option<ForegroundWindow> {
        None
    }
}

pub use imp::foreground_window;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn does_not_panic_and_omits_titles_when_disabled() {
        if let Some(window) = foreground_window(false) {
            assert!(!window.exe_name.is_empty());
            assert!(window.exe_name.ends_with(".exe") || !window.exe_name.contains('\\'));
            // Policy off means the title was never read.
            assert!(window.window_title.is_none());
        }
    }

    #[test]
    fn normalizes_the_executable_name_to_lowercase() {
        if let Some(window) = foreground_window(false) {
            assert_eq!(window.exe_name, window.exe_name.to_ascii_lowercase());
            // The server keys categories on the bare executable name.
            assert!(!window.exe_name.contains('\\'));
            assert!(!window.exe_name.contains('/'));
        }
    }
}
