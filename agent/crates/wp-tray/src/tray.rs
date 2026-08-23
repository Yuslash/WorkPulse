//! Windows notification-area icon.
//!
//! Written directly against Shell_NotifyIcon rather than pulling in a tray
//! crate: the alternatives want cgo or a windowing toolkit, and this target
//! (windows-gnu, no C toolchain) has neither. It is about 150 lines of Win32.

use anyhow::{anyhow, Result};
use std::sync::OnceLock;
use tokio::runtime::Runtime;
use windows_sys::core::PCWSTR;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

/// Custom message the shell posts to us for icon interactions.
const WM_TRAY_ICON: u32 = WM_APP + 1;

const ID_SHOW_STATUS: usize = 1001;
const ID_EXIT: usize = 1002;

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Copies a &str into a fixed-size UTF-16 array, truncating safely.
fn fill_wide(target: &mut [u16], value: &str) {
    let encoded: Vec<u16> = value.encode_utf16().take(target.len() - 1).collect();
    target[..encoded.len()].copy_from_slice(&encoded);
    target[encoded.len()] = 0;
}

pub fn run(runtime: Runtime) -> Result<()> {
    RUNTIME
        .set(runtime)
        .map_err(|_| anyhow!("tray runtime already initialized"))?;

    unsafe {
        let instance = GetModuleHandleW(std::ptr::null());
        let class_name = wide("WorkPulseTrayWindow");

        let class = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(window_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: instance,
            hIcon: std::ptr::null_mut(),
            hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };

        if RegisterClassW(&class) == 0 {
            return Err(anyhow!("failed to register the tray window class"));
        }

        // A message-only window: it never becomes visible, it only receives
        // the shell's notifications.
        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            wide("WorkPulse").as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );

        if hwnd.is_null() {
            return Err(anyhow!("failed to create the tray window"));
        }

        let mut data: NOTIFYICONDATAW = std::mem::zeroed();
        data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = hwnd;
        data.uID = 1;
        data.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
        data.uCallbackMessage = WM_TRAY_ICON;
        data.hIcon = LoadIconW(std::ptr::null_mut(), IDI_INFORMATION);
        fill_wide(&mut data.szTip, "WorkPulse — activity agent");

        if Shell_NotifyIconW(NIM_ADD, &mut data) == 0 {
            return Err(anyhow!("failed to add the tray icon"));
        }

        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }

        // Leaving a stale icon behind after exit is a classic tray bug.
        Shell_NotifyIconW(NIM_DELETE, &mut data);
    }

    Ok(())
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_TRAY_ICON => {
            let event = lparam as u32;
            if event == WM_LBUTTONUP || event == WM_LBUTTONDBLCLK {
                show_status();
            } else if event == WM_RBUTTONUP {
                show_menu(hwnd);
            }
            0
        }
        WM_COMMAND => {
            match (wparam & 0xFFFF) as usize {
                ID_SHOW_STATUS => show_status(),
                ID_EXIT => PostQuitMessage(0),
                _ => {}
            }
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}

unsafe fn show_menu(hwnd: HWND) {
    let menu = CreatePopupMenu();
    if menu.is_null() {
        return;
    }

    AppendMenuW(menu, MF_STRING, ID_SHOW_STATUS, wide("What is collected...").as_ptr());
    AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
    AppendMenuW(menu, MF_STRING, ID_EXIT, wide("Close tray icon").as_ptr());

    let mut point = POINT { x: 0, y: 0 };
    GetCursorPos(&mut point);

    // Required so the menu dismisses when the user clicks elsewhere.
    SetForegroundWindow(hwnd);
    TrackPopupMenu(
        menu,
        TPM_RIGHTBUTTON | TPM_BOTTOMALIGN,
        point.x,
        point.y,
        0,
        hwnd,
        std::ptr::null(),
    );
    PostMessageW(hwnd, WM_NULL, 0, 0);
    DestroyMenu(menu);
}

/// Blocks briefly to fetch live status, then shows it in a message box.
/// A dialog rather than a custom window keeps the binary small and the text
/// selectable by the employee.
unsafe fn show_status() {
    let text = match RUNTIME.get() {
        Some(runtime) => runtime.block_on(crate::status_text()),
        None => crate::transparency::render_offline(wp_core::AGENT_VERSION),
    };

    MessageBoxW(
        std::ptr::null_mut(),
        wide(&text).as_ptr() as PCWSTR,
        wide("WorkPulse — what this agent collects").as_ptr() as PCWSTR,
        MB_OK | MB_ICONINFORMATION,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_wide_strings_with_a_terminator() {
        let encoded = wide("hi");
        assert_eq!(encoded, vec![b'h' as u16, b'i' as u16, 0]);
    }

    #[test]
    fn truncates_rather_than_overflowing_a_fixed_buffer() {
        let mut buffer = [0u16; 8];
        fill_wide(&mut buffer, "a very long tooltip that will not fit");

        // Must stay null-terminated inside the array.
        assert_eq!(buffer[7], 0);
        assert_ne!(buffer[0], 0);
    }

    #[test]
    fn fills_a_short_string_completely() {
        let mut buffer = [0u16; 16];
        fill_wide(&mut buffer, "ok");

        assert_eq!(buffer[0], b'o' as u16);
        assert_eq!(buffer[1], b'k' as u16);
        assert_eq!(buffer[2], 0);
    }
}
