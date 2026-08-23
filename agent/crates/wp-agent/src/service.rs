//! Windows Service host (spec §4).
//!
//! Windows starts the process with `--service`, expects the dispatcher to be
//! entered promptly, and then drives the lifecycle through control events.
//! Service Recovery (configured at install time) restarts the process if it
//! dies, so a crash costs a few seconds of telemetry rather than a day's.

use anyhow::Result;
use std::ffi::OsString;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::watch;
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::{define_windows_service, service_dispatcher};

use crate::{paths, runner};
use wp_core::{IdentityStore, AGENT_VERSION};
use wp_win::DpapiStore;

const SERVICE_NAME: &str = "WorkPulseAgent";
const SERVICE_TYPE: ServiceType = ServiceType::OWN_PROCESS;

define_windows_service!(ffi_service_main, service_main);

/// Entry point for `--service`. Blocks until the service stops.
pub fn run_as_service() -> Result<()> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
    Ok(())
}

fn service_main(_args: Vec<OsString>) {
    if let Err(error) = service_body() {
        tracing::error!(%error, "service exited with an error");
    }
}

fn service_body() -> Result<()> {
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // The handler runs on an SCM thread, so it must do nothing slow — it only
    // flips the shutdown flag and returns.
    let handler_tx = shutdown_tx.clone();
    let status_handle = service_control_handler::register(SERVICE_NAME, move |control| {
        match control {
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = handler_tx.send(true);
                ServiceControlHandlerResult::NoError
            }
            // Session change tells us about lock/unlock; the sampler already
            // detects it, so we simply acknowledge.
            ServiceControl::SessionChange(_) => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    })?;

    let running = ServiceStatus {
        service_type: SERVICE_TYPE,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP
            | ServiceControlAccept::SHUTDOWN
            | ServiceControlAccept::SESSION_CHANGE,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    };
    status_handle.set_service_status(running.clone())?;

    tracing::info!(version = AGENT_VERSION, "workpulse service starting");

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;

    let outcome = runtime.block_on(async move {
        let (identity, queue, config) = crate::load_runtime_state().await?;
        let identity_store = IdentityStore::new(paths::identity_path()?, Box::new(DpapiStore));

        let (agent, _status) = runner::Runner::new(identity, identity_store, Arc::clone(&queue), config)?;
        agent.run(shutdown_rx).await
    });

    // A terminal auth failure is reported as a service-specific exit code so
    // Service Recovery does not restart-loop against a revoked device.
    let exit_code = match &outcome {
        Ok(()) => ServiceExitCode::Win32(0),
        Err(error) => {
            tracing::error!(%error, "agent stopped with an error");
            ServiceExitCode::ServiceSpecific(1)
        }
    };

    status_handle.set_service_status(ServiceStatus {
        service_type: SERVICE_TYPE,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code,
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    outcome
}
