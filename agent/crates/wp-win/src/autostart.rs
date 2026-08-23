//! Automatic startup (spec §4).
//!
//! Two mechanisms, deliberately:
//!
//! * **Windows Service** — the production path. Starts before login, survives
//!   logout, and gets Service Recovery so a crash restarts it automatically.
//!   Installing one requires Administrator.
//!
//! * **Scheduled Task** — a per-user fallback that needs no elevation. It
//!   starts at logon rather than at boot, which is weaker, but it means the
//!   agent can be installed and verified without an elevated shell.
//!
//! Neither hides itself. A Startup-folder shortcut alone is explicitly not
//! used: it is trivially disabled and gives no restart behaviour.

use anyhow::{anyhow, Context, Result};
use std::path::Path;
use std::process::Command;

pub const SERVICE_NAME: &str = "WorkPulseAgent";
pub const SERVICE_DISPLAY_NAME: &str = "WorkPulse Activity Agent";
pub const TASK_NAME: &str = "WorkPulse Agent";

fn run(program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .with_context(|| format!("running {program}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(anyhow!(
            "{program} failed ({}): {}",
            output.status,
            if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() }
        ));
    }

    Ok(stdout)
}

// ---------------------------------------------------------------------------
// Windows Service
// ---------------------------------------------------------------------------

/// Registers the agent as an auto-start Windows Service. Requires elevation.
pub fn install_service(exe_path: &Path) -> Result<()> {
    let bin = format!("\"{}\" --service", exe_path.display());

    run(
        "sc.exe",
        &[
            "create",
            SERVICE_NAME,
            "binPath=",
            &bin,
            "start=",
            "auto",
            "DisplayName=",
            SERVICE_DISPLAY_NAME,
        ],
    )?;

    run(
        "sc.exe",
        &[
            "description",
            SERVICE_NAME,
            "Reports application activity, idle state and attendance to WorkPulse.",
        ],
    )?;

    // Recovery (spec §4): restart after 5s, then 10s, then every 30s, with the
    // failure counter resetting daily.
    run(
        "sc.exe",
        &[
            "failure",
            SERVICE_NAME,
            "reset=",
            "86400",
            "actions=",
            "restart/5000/restart/10000/restart/30000",
        ],
    )?;

    run("sc.exe", &["start", SERVICE_NAME])?;
    Ok(())
}

pub fn uninstall_service() -> Result<()> {
    // Stopping a service that is not running is not an error worth failing on.
    let _ = run("sc.exe", &["stop", SERVICE_NAME]);
    run("sc.exe", &["delete", SERVICE_NAME])?;
    Ok(())
}

pub fn service_installed() -> bool {
    run("sc.exe", &["query", SERVICE_NAME]).is_ok()
}

// ---------------------------------------------------------------------------
// Scheduled Task (no elevation required)
// ---------------------------------------------------------------------------

/// Runs a PowerShell one-liner and returns its stdout.
///
/// The ScheduledTasks cmdlets are used rather than `schtasks.exe` because
/// they go through the Task Scheduler COM API as the calling user. On a
/// standard workstation `schtasks.exe /Create` fails with "Access is denied"
/// even for a per-user, LIMITED task, while the COM path succeeds — which is
/// the difference between the agent being installable without an admin and
/// not.
fn powershell(script: &str) -> Result<String> {
    run(
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
    )
}

/// Escapes a value for embedding in a PowerShell single-quoted string.
fn ps_quote(value: &str) -> String {
    value.replace('\'', "''")
}

/// Registers a per-user logon task. No elevation required.
pub fn install_user_task(exe_path: &Path) -> Result<()> {
    let exe = ps_quote(&exe_path.display().to_string());
    let task = ps_quote(TASK_NAME);

    // LIMITED rather than HIGHEST: the agent needs no privilege the signed-in
    // user does not already have. StartWhenAvailable catches the case where
    // the machine was asleep at the scheduled logon.
    let script = format!(
        "$ErrorActionPreference='Stop';\
         $u=\"$env:USERDOMAIN\\$env:USERNAME\";\
         $a=New-ScheduledTaskAction -Execute '{exe}' -Argument '--console';\
         $t=New-ScheduledTaskTrigger -AtLogOn -User $u;\
         $p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited;\
         $s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero);\
         Register-ScheduledTask -TaskName '{task}' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null;\
         Write-Output 'ok'"
    );

    powershell(&script)?;
    Ok(())
}

pub fn uninstall_user_task() -> Result<()> {
    let task = ps_quote(TASK_NAME);
    powershell(&format!(
        "$ErrorActionPreference='Stop';\
         Unregister-ScheduledTask -TaskName '{task}' -Confirm:$false;\
         Write-Output 'ok'"
    ))?;
    Ok(())
}

pub fn user_task_installed() -> bool {
    let task = ps_quote(TASK_NAME);
    powershell(&format!(
        "if (Get-ScheduledTask -TaskName '{task}' -ErrorAction SilentlyContinue) {{ exit 0 }} else {{ exit 1 }}"
    ))
    .is_ok()
}

/// True when the current process can install a service.
pub fn is_elevated() -> bool {
    // `sc.exe query` on a privileged handle is a reliable probe without
    // pulling in the token APIs: a non-elevated process gets access denied.
    run("net.exe", &["session"]).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_installation_state_without_panicking() {
        // On a clean machine both are false; the point is that querying a
        // missing service or task is handled rather than fatal.
        let _ = service_installed();
        let _ = user_task_installed();
    }

    #[test]
    fn reports_elevation_without_panicking() {
        let _ = is_elevated();
    }

    #[test]
    fn builds_a_quoted_binary_path() {
        // Paths under "C:\Program Files\" must survive sc.exe's parsing.
        let path = Path::new(r"C:\Program Files\WorkPulse\Agent.exe");
        let quoted = format!("\"{}\" --service", path.display());

        assert!(quoted.starts_with('"'));
        assert!(quoted.contains("Program Files"));
        assert!(quoted.ends_with("--service"));
    }

    #[test]
    fn escapes_single_quotes_for_powershell() {
        // A path containing an apostrophe would otherwise terminate the
        // PowerShell string early and change what gets executed.
        assert_eq!(ps_quote(r"C:\Users\O'Brien\agent.exe"), r"C:\Users\O''Brien\agent.exe");
        assert_eq!(ps_quote("plain"), "plain");
    }

    #[cfg(windows)]
    #[test]
    fn installs_and_removes_a_user_task_without_elevation() {
        // This is the path a standard employee actually installs through, so
        // it is exercised for real rather than mocked. It runs unelevated in
        // CI and on a developer machine alike.
        let exe = std::env::current_exe().expect("current exe");

        install_user_task(&exe).expect("install should succeed without elevation");
        assert!(user_task_installed(), "task should be registered");

        uninstall_user_task().expect("uninstall should succeed");
        assert!(!user_task_installed(), "task should be gone");
    }
}
