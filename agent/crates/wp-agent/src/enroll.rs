//! Device enrollment (spec §5).
//!
//! The employee types the userId and one-time password issued from the admin
//! panel exactly once. The agent exchanges them for a device secret and then
//! discards the password — it is never written to disk, never logged, and
//! never sent again.

use anyhow::{Context, Result};
use std::io::{self, Write};
use wp_core::{ApiClient, DeviceIdentity, IdentityStore, AGENT_VERSION};
use wp_win::DpapiStore;

use crate::paths;

const DEFAULT_SERVER: &str = "http://localhost:4000";

pub async fn run(
    server: Option<String>,
    user_id: Option<String>,
    password: Option<String>,
) -> Result<()> {
    println!("WorkPulse Agent {AGENT_VERSION} — device enrollment\n");

    let server = match server {
        Some(value) if !value.is_empty() => value,
        _ => prompt(&format!("Server URL [{DEFAULT_SERVER}]"))?
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_SERVER.to_string()),
    };

    let user_id = match user_id {
        Some(value) if !value.is_empty() => value,
        _ => prompt("Employee user ID (e.g. EMP-4021)")?
            .filter(|value| !value.is_empty())
            .context("a user ID is required")?,
    };

    let password = match password {
        Some(value) if !value.is_empty() => value,
        _ => prompt("One-time password")?
            .filter(|value| !value.is_empty())
            .context("a password is required")?,
    };

    let device = wp_win::device_info(AGENT_VERSION);
    println!("\nEnrolling {} ...", device.hostname);

    let client = ApiClient::new(&server).context("building the API client")?;
    let enrolled = client
        .enroll(&user_id, &password, device)
        .await
        .context("enrollment failed")?;

    let identity = DeviceIdentity {
        device_id: enrolled.device_id,
        device_secret: enrolled.device_secret,
        employee_id: enrolled.employee.id,
        employee_name: enrolled.employee.name,
        organization_id: enrolled.employee.organization_id,
        organization_name: enrolled.employee.organization_name,
        server_url: server,
    };

    // Sealed with DPAPI, so the file is useless on another machine or under
    // another Windows account.
    let store = IdentityStore::new(paths::identity_path()?, Box::new(DpapiStore));
    store.save(&identity).context("saving the device identity")?;

    println!("\nEnrolled successfully.\n");
    println!("  Employee     : {}", identity.employee_name);
    println!("  Organization : {}", identity.organization_name);
    println!("  Device ID    : {}", identity.device_id);
    println!("  Identity file: {}", store.path().display());

    println!("\nThis agent collects:");
    println!("  + Active / idle state");
    println!("  + Which application has focus");
    println!("  + Attendance times");
    println!("  + Device health");
    println!("\nIt does NOT collect:");
    println!("  - Keystrokes or clipboard contents");
    println!("  - Passwords");
    println!("  - Microphone or webcam");
    println!("  - Personal files");

    println!("\nNext:");
    println!("  WorkPulseAgent --install-user     start automatically at logon");
    println!("  WorkPulseAgent --console          run now in this window");

    Ok(())
}

/// Reads one line. The password is echoed because a hidden prompt needs a
/// console handle the service context does not always have — and this value
/// is single-use and rotated by the admin anyway.
fn prompt(label: &str) -> Result<Option<String>> {
    print!("{label}: ");
    io::stdout().flush().ok();

    let mut buffer = String::new();
    let read = io::stdin().read_line(&mut buffer).context("reading input")?;

    if read == 0 {
        return Ok(None);
    }

    Ok(Some(buffer.trim().to_string()))
}
