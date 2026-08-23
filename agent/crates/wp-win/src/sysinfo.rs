//! Device inventory reported at enrollment (spec §6).
//!
//! Hardware and OS facts only. Nothing here identifies a person; the link
//! between a machine and an employee is made server-side from the credentials
//! used to enroll.

use wp_core::protocol::DeviceInfo;

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::System::SystemInformation::{
        GetSystemInfo, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO,
    };

    pub fn hostname() -> String {
        std::env::var("COMPUTERNAME")
            .ok()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "unknown-host".to_string())
    }

    pub fn cpu_cores() -> Option<u32> {
        let mut info: SYSTEM_INFO = unsafe { std::mem::zeroed() };
        unsafe { GetSystemInfo(&mut info) };

        match info.dwNumberOfProcessors {
            0 => None,
            count => Some(count),
        }
    }

    pub fn ram_mb() -> Option<u64> {
        let mut status: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;

        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return None;
        }

        Some(status.ullTotalPhys / (1024 * 1024))
    }

    pub fn arch() -> String {
        std::env::var("PROCESSOR_ARCHITECTURE")
            .unwrap_or_else(|_| std::env::consts::ARCH.to_string())
    }

    pub fn cpu_name() -> Option<String> {
        std::env::var("PROCESSOR_IDENTIFIER").ok().filter(|v| !v.is_empty())
    }

    /// The real OS version, read from the registry.
    ///
    /// `GetVersion`/`GetVersionEx` are subject to Windows' compatibility
    /// shim: an executable without an explicit `supportedOS` manifest entry
    /// is told it is running on 6.2 (Windows 8), so a Windows 10 machine
    /// reports "6.2.9200". The registry is not shimmed, and it is also the
    /// only place the UBR/build number is available.
    pub fn os_version() -> String {
        const KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";

        let major = read_registry_u32(KEY, "CurrentMajorVersionNumber");
        let minor = read_registry_u32(KEY, "CurrentMinorVersionNumber");
        let build = read_registry_string(KEY, "CurrentBuildNumber");

        match (major, build) {
            // Windows 10 and 11 publish the numeric major/minor values.
            (Some(major), Some(build)) => format!("{major}.{}.{build}", minor.unwrap_or(0)),
            // Windows 8.1 and earlier only have the "6.3" style string.
            (None, Some(build)) => {
                let legacy = read_registry_string(KEY, "CurrentVersion").unwrap_or_default();
                if legacy.is_empty() {
                    build
                } else {
                    format!("{legacy}.{build}")
                }
            }
            _ => "unknown".to_string(),
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn read_registry_u32(subkey: &str, name: &str) -> Option<u32> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};

        let mut value: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;

        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                wide(subkey).as_ptr(),
                wide(name).as_ptr(),
                RRF_RT_REG_DWORD,
                std::ptr::null_mut(),
                &mut value as *mut u32 as *mut std::ffi::c_void,
                &mut size,
            )
        };

        if status == ERROR_SUCCESS {
            Some(value)
        } else {
            None
        }
    }

    fn read_registry_string(subkey: &str, name: &str) -> Option<String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

        let mut buffer = vec![0u16; 128];
        let mut size = (buffer.len() * std::mem::size_of::<u16>()) as u32;

        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                wide(subkey).as_ptr(),
                wide(name).as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr() as *mut std::ffi::c_void,
                &mut size,
            )
        };

        if status != ERROR_SUCCESS {
            return None;
        }

        let chars = (size as usize / std::mem::size_of::<u16>()).min(buffer.len());
        let end = buffer[..chars].iter().position(|&c| c == 0).unwrap_or(chars);
        let text = String::from_utf16_lossy(&buffer[..end]);

        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn hostname() -> String {
        std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown-host".to_string())
    }

    pub fn cpu_cores() -> Option<u32> {
        std::thread::available_parallelism().ok().map(|n| n.get() as u32)
    }

    pub fn ram_mb() -> Option<u64> {
        None
    }

    pub fn arch() -> String {
        std::env::consts::ARCH.to_string()
    }

    pub fn cpu_name() -> Option<String> {
        None
    }

    pub fn os_version() -> String {
        "0.0.0".to_string()
    }
}

/// Assembles the enrollment payload.
pub fn device_info(agent_version: &str) -> DeviceInfo {
    DeviceInfo {
        hostname: imp::hostname(),
        os: if cfg!(windows) { "Windows" } else { std::env::consts::OS }.to_string(),
        os_version: imp::os_version(),
        arch: imp::arch(),
        cpu: imp::cpu_name(),
        cpu_cores: imp::cpu_cores(),
        ram_mb: imp::ram_mb(),
        agent_version: agent_version.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_a_payload_the_server_will_accept() {
        let info = device_info("1.0.0");

        // The server's Zod schema requires all of these non-empty.
        assert!(!info.hostname.is_empty());
        assert!(!info.os.is_empty());
        assert!(!info.os_version.is_empty());
        assert!(!info.arch.is_empty());
        assert_eq!(info.agent_version, "1.0.0");
    }

    #[test]
    fn reports_plausible_hardware() {
        let info = device_info("1.0.0");

        if let Some(cores) = info.cpu_cores {
            assert!(cores > 0 && cores <= 1024);
        }
        if let Some(ram) = info.ram_mb {
            assert!(ram > 0);
        }
    }

    #[test]
    fn serializes_to_the_expected_wire_shape() {
        let json = serde_json::to_value(device_info("1.0.0")).unwrap();

        assert!(json.get("hostname").is_some());
        assert!(json.get("osVersion").is_some());
        assert!(json.get("agentVersion").is_some());
    }

    #[cfg(windows)]
    #[test]
    fn reports_the_real_os_version_not_the_compatibility_shim() {
        let info = device_info("1.0.0");

        // GetVersion() reports "6.2.9200" on every modern Windows unless the
        // executable carries a supportedOS manifest. Seeing that value here
        // means we regressed to the shimmed API.
        assert_ne!(
            info.os_version, "6.2.9200",
            "os_version fell back to the compatibility shim"
        );
        assert_ne!(info.os_version, "unknown");

        // Windows 10 and 11 both report major version 10.
        let major: u32 = info
            .os_version
            .split('.')
            .next()
            .and_then(|part| part.parse().ok())
            .unwrap_or(0);
        assert!(major >= 6, "implausible major version in {}", info.os_version);

        // The build number is the part that actually identifies the release.
        let build = info.os_version.rsplit('.').next().unwrap_or("");
        assert!(
            build.parse::<u32>().map(|n| n > 1000).unwrap_or(false),
            "expected a real build number, got {}",
            info.os_version
        );
    }
}
