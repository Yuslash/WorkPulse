//! Command-line surface.
//!
//! Hand-rolled rather than pulling in clap: the agent ships to endpoints and
//! every dependency is binary size the customer pays for.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Run in the foreground. Development, and the Scheduled Task path.
    Console,
    /// Run as a Windows Service (invoked by the SCM, not by a human).
    Service,
    /// Interactive enrollment: exchange credentials for a device identity.
    Enroll {
        server: Option<String>,
        user_id: Option<String>,
        password: Option<String>,
    },
    /// Register the Windows Service. Requires elevation.
    InstallService,
    /// Register a per-user logon task. No elevation needed.
    InstallUser,
    /// Remove whichever auto-start mechanism is present.
    Uninstall,
    /// Print current identity, policy and queue depth.
    Status,
    /// Protocol conformance check against a live API.
    SelfTest {
        server: String,
        user_id: String,
        password: String,
    },
    Version,
    Help,
}

pub fn parse(args: &[String]) -> Command {
    let mut flags = Flags::default();
    let mut command: Option<&str> = None;

    let mut index = 0;
    while index < args.len() {
        let arg = args[index].as_str();

        match arg {
            "--console" | "--service" | "--enroll" | "--install-service" | "--install-user"
            | "--uninstall" | "--status" | "--selftest" | "--version" | "-V" | "--help" | "-h" => {
                command = Some(arg);
            }
            "--server" => {
                flags.server = args.get(index + 1).cloned();
                index += 1;
            }
            "--user-id" => {
                flags.user_id = args.get(index + 1).cloned();
                index += 1;
            }
            "--password" => {
                flags.password = args.get(index + 1).cloned();
                index += 1;
            }
            _ => {}
        }

        index += 1;
    }

    match command {
        Some("--service") => Command::Service,
        Some("--enroll") => Command::Enroll {
            server: flags.server,
            user_id: flags.user_id,
            password: flags.password,
        },
        Some("--install-service") => Command::InstallService,
        Some("--install-user") => Command::InstallUser,
        Some("--uninstall") => Command::Uninstall,
        Some("--status") => Command::Status,
        Some("--selftest") => Command::SelfTest {
            // The self-test is non-interactive by design so CI can gate on it.
            server: flags.server.unwrap_or_else(|| "http://localhost:4000".into()),
            user_id: flags.user_id.unwrap_or_default(),
            password: flags.password.unwrap_or_default(),
        },
        Some("--version") | Some("-V") => Command::Version,
        Some("--help") | Some("-h") => Command::Help,
        _ => Command::Console,
    }
}

#[derive(Default)]
struct Flags {
    server: Option<String>,
    user_id: Option<String>,
    password: Option<String>,
}

pub const HELP: &str = r#"WorkPulse Agent

USAGE:
    WorkPulseAgent [COMMAND] [OPTIONS]

COMMANDS:
    --console            Run in the foreground (default)
    --service            Run as a Windows Service (invoked by Windows)
    --enroll             Enrol this device with an employee login
    --install-service    Install the Windows Service        [requires Administrator]
    --install-user       Install a per-user logon task      [no elevation needed]
    --uninstall          Remove the service or logon task
    --status             Show identity, policy and queue depth
    --selftest           Run a protocol conformance check against a server
    --version            Print the agent version
    --help               Show this message

OPTIONS:
    --server <URL>       API base URL (default http://localhost:4000)
    --user-id <ID>       Employee user ID issued from the admin panel
    --password <PW>      One-time password issued from the admin panel

EXAMPLES:
    WorkPulseAgent --enroll --server https://workpulse.acme.com --user-id EMP-4021
    WorkPulseAgent --console
    WorkPulseAgent --install-user

WHAT THIS AGENT COLLECTS:
    Active / idle state, which application has focus, attendance times and
    device health. It does NOT record keystrokes, clipboard contents,
    passwords, microphone, webcam or personal files.
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_args(args: &[&str]) -> Command {
        parse(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn defaults_to_console() {
        assert_eq!(parse_args(&[]), Command::Console);
    }

    #[test]
    fn parses_each_mode() {
        assert_eq!(parse_args(&["--service"]), Command::Service);
        assert_eq!(parse_args(&["--install-service"]), Command::InstallService);
        assert_eq!(parse_args(&["--install-user"]), Command::InstallUser);
        assert_eq!(parse_args(&["--uninstall"]), Command::Uninstall);
        assert_eq!(parse_args(&["--status"]), Command::Status);
        assert_eq!(parse_args(&["--version"]), Command::Version);
    }

    #[test]
    fn parses_enrollment_flags() {
        let command = parse_args(&[
            "--enroll",
            "--server",
            "https://api.example.com",
            "--user-id",
            "EMP-4021",
            "--password",
            "Xk7f-2Qmb-91Zc",
        ]);

        assert_eq!(
            command,
            Command::Enroll {
                server: Some("https://api.example.com".into()),
                user_id: Some("EMP-4021".into()),
                password: Some("Xk7f-2Qmb-91Zc".into()),
            }
        );
    }

    #[test]
    fn allows_flags_before_the_command() {
        // Order must not matter; the SCM and installers build these lines.
        let command = parse_args(&["--server", "https://api.example.com", "--enroll"]);
        match command {
            Command::Enroll { server, .. } => {
                assert_eq!(server.as_deref(), Some("https://api.example.com"));
            }
            other => panic!("expected enroll, got {other:?}"),
        }
    }

    #[test]
    fn defaults_the_selftest_server() {
        match parse_args(&["--selftest", "--user-id", "EMP-1", "--password", "pw"]) {
            Command::SelfTest { server, user_id, .. } => {
                assert_eq!(server, "http://localhost:4000");
                assert_eq!(user_id, "EMP-1");
            }
            other => panic!("expected selftest, got {other:?}"),
        }
    }

    #[test]
    fn ignores_unknown_flags() {
        assert_eq!(parse_args(&["--console", "--nonsense"]), Command::Console);
    }

    #[test]
    fn handles_a_flag_with_a_missing_value() {
        // `--server` at the end must not panic on the missing argument.
        match parse_args(&["--enroll", "--server"]) {
            Command::Enroll { server, .. } => assert!(server.is_none()),
            other => panic!("expected enroll, got {other:?}"),
        }
    }

    #[test]
    fn help_documents_the_privacy_boundary() {
        // The employee-visible surface has to state what is not collected.
        assert!(HELP.contains("does NOT record keystrokes"));
        assert!(HELP.contains("webcam"));
    }
}
