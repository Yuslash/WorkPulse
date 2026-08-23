//! WorkPulse Agent.
//!
//! A transparent activity agent: it reports which application has focus, when
//! the machine is idle or locked, and basic device health. It does not record
//! keystrokes, clipboard, screen contents, microphone or webcam.

mod cli;
mod enroll;
mod paths;
mod runner;
mod selftest;
#[cfg(windows)]
mod service;

use anyhow::{Context, Result};
use cli::Command;
use std::sync::Arc;
use tokio::sync::watch;
use tracing_subscriber::EnvFilter;
use wp_core::{AgentConfig, ApiClient, EventQueue, IdentityStore, AGENT_VERSION};
use wp_win::DpapiStore;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = cli::parse(&args);

    // The service is started by Windows, which expects the dispatcher to be
    // entered before anything else happens.
    #[cfg(windows)]
    if command == Command::Service {
        return service::run_as_service();
    }

    init_logging(matches!(command, Command::Console));

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .context("building the async runtime")?;

    runtime.block_on(dispatch(command))
}

async fn dispatch(command: Command) -> Result<()> {
    match command {
        Command::Help => {
            println!("{}", cli::HELP);
            Ok(())
        }
        Command::Version => {
            println!("WorkPulse Agent {AGENT_VERSION}");
            Ok(())
        }
        Command::Enroll {
            server,
            user_id,
            password,
        } => enroll::run(server, user_id, password).await,
        Command::SelfTest {
            server,
            user_id,
            password,
        } => selftest::run(&server, &user_id, &password).await,
        Command::Status => print_status().await,
        Command::InstallService => install_service(),
        Command::InstallUser => install_user_task(),
        Command::Uninstall => uninstall(),
        Command::Console => run_console().await,
        Command::Service => {
            eprintln!("--service is only valid when started by the Windows Service Manager");
            Ok(())
        }
    }
}

/// Loads identity + queue and runs until Ctrl-C.
pub(crate) async fn run_console() -> Result<()> {
    let (identity, queue, config) = load_runtime_state().await?;

    let identity_store = IdentityStore::new(paths::identity_path()?, Box::new(DpapiStore));
    let (runner, mut status) = runner::Runner::new(identity, identity_store, queue, config)?;

    println!("WorkPulse Agent {AGENT_VERSION} running. Press Ctrl-C to stop.\n");

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Surface state changes in the console so a dev run is legible.
    tokio::spawn(async move {
        while status.changed().await.is_ok() {
            let snapshot = status.borrow().clone();
            println!(
                "  [{}] {}  queue={}  {}",
                snapshot.presence,
                snapshot.current_application.as_deref().unwrap_or("-"),
                snapshot.queue_depth,
                if snapshot.connected { "online" } else { "offline" }
            );
        }
    });

    let handle = tokio::spawn(runner.run(shutdown_rx));

    tokio::signal::ctrl_c().await.ok();
    println!("\nStopping...");
    let _ = shutdown_tx.send(true);

    match handle.await {
        Ok(result) => result,
        Err(error) => Err(anyhow::anyhow!("agent task panicked: {error}")),
    }
}

/// Shared bootstrap for console and service modes.
pub(crate) async fn load_runtime_state() -> Result<(wp_core::DeviceIdentity, Arc<EventQueue>, AgentConfig)> {
    let identity_store = IdentityStore::new(paths::identity_path()?, Box::new(DpapiStore));

    let identity = identity_store.load()?.ok_or_else(|| {
        anyhow::anyhow!(
            "this device is not enrolled.\n\nRun:\n  WorkPulseAgent --enroll --server <URL> --user-id <ID> --password <PW>"
        )
    })?;

    // The queue key is derived from the device secret, so a revoked device
    // leaves an unreadable queue behind rather than plaintext telemetry.
    let queue = Arc::new(EventQueue::open(
        &paths::queue_path()?,
        &identity.queue_key(),
        50 * 1024 * 1024,
    )?);

    // Start from the last known policy shape; the first config fetch corrects
    // it. Defaults keep the privacy-sensitive collectors off meanwhile.
    let client = ApiClient::new(identity.server_url.clone())?
        .with_device(identity.device_id.clone(), identity.device_secret.clone());

    let config = match client.fetch_config().await {
        Ok(response) => response.config,
        Err(error) => {
            tracing::warn!(%error, "could not fetch policy; starting with conservative defaults");
            AgentConfig::default()
        }
    };

    Ok((identity, queue, config))
}

async fn print_status() -> Result<()> {
    let identity_store = IdentityStore::new(paths::identity_path()?, Box::new(DpapiStore));

    let Some(identity) = identity_store.load()? else {
        println!("WorkPulse Agent {AGENT_VERSION}\n\nStatus: NOT ENROLLED");
        println!("\nRun: WorkPulseAgent --enroll --server <URL> --user-id <ID> --password <PW>");
        return Ok(());
    };

    println!("WorkPulse Agent {AGENT_VERSION}\n");
    println!("  Employee     : {}", identity.employee_name);
    println!("  Organization : {}", identity.organization_name);
    println!("  Device ID    : {}", identity.device_id);
    println!("  Server       : {}", identity.server_url);

    let queue = EventQueue::open(&paths::queue_path()?, &identity.queue_key(), 50 * 1024 * 1024)?;
    println!("  Queued events: {}", queue.len()?);

    let client = ApiClient::new(identity.server_url.clone())?
        .with_device(identity.device_id.clone(), identity.device_secret.clone());

    match client.fetch_status().await {
        Ok(status) => {
            println!("  Connection   : online\n");
            println!("Currently collected:");
            for item in &status.collected {
                println!("  + {item}");
            }
            println!("\nNot collected:");
            for item in &status.not_collected {
                println!("  - {item}");
            }
        }
        Err(error) => println!("  Connection   : offline ({error})"),
    }

    Ok(())
}

fn install_service() -> Result<()> {
    let exe = paths::current_exe()?;

    if !wp_win::autostart::is_elevated() {
        anyhow::bail!(
            "installing a Windows Service requires Administrator.\n\n\
             Either run this from an elevated terminal, or use:\n  \
             WorkPulseAgent --install-user   (per-user logon task, no elevation)"
        );
    }

    wp_win::autostart::install_service(&exe)?;
    println!("Installed and started the '{}' service.", wp_win::autostart::SERVICE_NAME);
    Ok(())
}

fn install_user_task() -> Result<()> {
    let exe = paths::current_exe()?;
    wp_win::autostart::install_user_task(&exe)?;

    println!("Installed the '{}' logon task.", wp_win::autostart::TASK_NAME);
    println!("The agent will start automatically the next time you sign in.");
    Ok(())
}

fn uninstall() -> Result<()> {
    let mut removed = Vec::new();

    if wp_win::autostart::service_installed() {
        match wp_win::autostart::uninstall_service() {
            Ok(()) => removed.push("Windows Service"),
            Err(error) => eprintln!("Could not remove the service: {error}"),
        }
    }

    if wp_win::autostart::user_task_installed() {
        match wp_win::autostart::uninstall_user_task() {
            Ok(()) => removed.push("logon task"),
            Err(error) => eprintln!("Could not remove the logon task: {error}"),
        }
    }

    if removed.is_empty() {
        println!("Nothing to remove; no auto-start is registered.");
    } else {
        println!("Removed: {}.", removed.join(", "));
    }

    Ok(())
}

/// Console mode logs to stdout; service mode logs to a rolling file, because
/// a service has no console to write to.
fn init_logging(console: bool) {
    let filter = EnvFilter::try_from_env("WORKPULSE_LOG").unwrap_or_else(|_| EnvFilter::new("info"));

    if console {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(false)
            .init();
        return;
    }

    match paths::log_dir() {
        Ok(dir) => {
            let appender = tracing_appender::rolling::daily(dir, "agent.log");
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_writer(appender)
                .with_ansi(false)
                .init();
        }
        Err(_) => {
            tracing_subscriber::fmt().with_env_filter(filter).init();
        }
    }
}
