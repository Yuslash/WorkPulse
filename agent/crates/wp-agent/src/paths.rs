//! Where the agent keeps its files (spec §37).
//!
//! Program files under `%ProgramFiles%`, mutable state under `%ProgramData%`.
//! When running unelevated (the Scheduled Task path, and every dev run) the
//! state directory falls back to `%LOCALAPPDATA%` so the agent works without
//! Administrator.

use anyhow::{Context, Result};
use std::path::PathBuf;

const VENDOR_DIR: &str = "WorkPulse";

/// Root for identity, queue and logs.
pub fn data_dir() -> Result<PathBuf> {
    // An explicit override keeps tests and side-by-side installs isolated.
    if let Ok(custom) = std::env::var("WORKPULSE_DATA_DIR") {
        if !custom.is_empty() {
            return Ok(PathBuf::from(custom));
        }
    }

    let base = std::env::var("ProgramData")
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("LOCALAPPDATA")
                .ok()
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
        .or_else(dirs_fallback)
        .context("could not determine a data directory")?;

    let dir = base.join(VENDOR_DIR);

    // ProgramData is writable by users for subdirectories they create, but a
    // locked-down machine may refuse; fall back rather than failing to start.
    if std::fs::create_dir_all(&dir).is_err() {
        let fallback = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .context("ProgramData is not writable and LOCALAPPDATA is unset")?
            .join(VENDOR_DIR);
        std::fs::create_dir_all(&fallback).context("creating fallback data directory")?;
        return Ok(fallback);
    }

    Ok(dir)
}

fn dirs_fallback() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

pub fn identity_path() -> Result<PathBuf> {
    Ok(data_dir()?.join("identity.bin"))
}

pub fn queue_path() -> Result<PathBuf> {
    Ok(data_dir()?.join("queue.redb"))
}

pub fn log_dir() -> Result<PathBuf> {
    let dir = data_dir()?.join("logs");
    std::fs::create_dir_all(&dir).context("creating log directory")?;
    Ok(dir)
}

/// Path of the running executable, used when registering auto-start.
pub fn current_exe() -> Result<PathBuf> {
    std::env::current_exe().context("resolving the current executable path")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn honours_the_data_dir_override() {
        // Ensures tests and side-by-side installs cannot collide.
        std::env::set_var("WORKPULSE_DATA_DIR", r"C:\Temp\wp-test");
        assert_eq!(data_dir().unwrap(), PathBuf::from(r"C:\Temp\wp-test"));
        std::env::remove_var("WORKPULSE_DATA_DIR");
    }

    #[test]
    fn derives_file_paths_from_the_data_directory() {
        std::env::set_var("WORKPULSE_DATA_DIR", r"C:\Temp\wp-test");

        assert!(identity_path().unwrap().ends_with("identity.bin"));
        assert!(queue_path().unwrap().ends_with("queue.redb"));

        std::env::remove_var("WORKPULSE_DATA_DIR");
    }

    #[test]
    fn resolves_the_current_executable() {
        assert!(current_exe().unwrap().exists());
    }
}
