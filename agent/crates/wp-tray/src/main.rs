//! WorkPulse tray application.
//!
//! Gives the employee a visible, always-available window into what the agent
//! is doing. A monitoring agent with no user-facing presence is the thing this
//! product deliberately is not (spec §34, §43).

mod transparency;
#[cfg(windows)]
mod tray;

use anyhow::Result;
use wp_core::{ApiClient, IdentityStore, AGENT_VERSION};
use wp_win::DpapiStore;

const VENDOR_DIR: &str = "WorkPulse";

fn identity_path() -> std::path::PathBuf {
    if let Ok(custom) = std::env::var("WORKPULSE_DATA_DIR") {
        if !custom.is_empty() {
            return std::path::PathBuf::from(custom).join("identity.bin");
        }
    }

    let base = std::env::var("ProgramData")
        .or_else(|_| std::env::var("LOCALAPPDATA"))
        .unwrap_or_else(|_| ".".to_string());

    std::path::PathBuf::from(base).join(VENDOR_DIR).join("identity.bin")
}

/// Fetches the live transparency text, falling back to the offline screen.
async fn status_text() -> String {
    let store = IdentityStore::new(identity_path(), Box::new(DpapiStore));

    let identity = match store.load() {
        Ok(Some(identity)) => identity,
        _ => {
            return format!(
                "WorkPulse\n\nAgent        : {AGENT_VERSION}\nStatus       : not enrolled\n\n\
                 This device has not been enrolled yet. Your IT team will\n\
                 provide a user ID and a one-time password.\n"
            )
        }
    };

    let client = match ApiClient::new(identity.server_url.clone()) {
        Ok(client) => client.with_device(identity.device_id.clone(), identity.device_secret.clone()),
        Err(_) => return transparency::render_offline(AGENT_VERSION),
    };

    match client.fetch_status().await {
        Ok(status) => transparency::render(&status, AGENT_VERSION),
        Err(_) => transparency::render_offline(AGENT_VERSION),
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;

    // `--print` renders the same screen to stdout. It is what the test suite
    // asserts against, and what a support engineer can capture over a call.
    if args.iter().any(|arg| arg == "--print") {
        println!("{}", runtime.block_on(status_text()));
        return Ok(());
    }

    #[cfg(windows)]
    {
        return tray::run(runtime);
    }

    #[cfg(not(windows))]
    {
        println!("{}", runtime.block_on(status_text()));
        Ok(())
    }
}
