//! The employee-facing transparency screen (spec §43).
//!
//! This is the single most important piece of UI in the product. An activity
//! agent the employee cannot inspect is surveillance; one that states plainly
//! what it does and does not collect is a tool. The content is fetched from
//! the server so it always reflects the live policy rather than a promise
//! baked into the binary at build time.

use wp_core::protocol::AgentStatusResponse;

/// Renders the screen as plain text, shared by the dialog and `--status`.
pub fn render(status: &AgentStatusResponse, agent_version: &str) -> String {
    let mut out = String::new();

    out.push_str("WorkPulse\n\n");
    out.push_str(&format!("Organization : {}\n", status.organization.name));
    out.push_str(&format!("Employee     : {}\n", status.employee.name));
    out.push_str(&format!("Device       : {}\n", status.device.hostname));
    out.push_str(&format!("Device ID    : {}\n", status.device.id));
    out.push_str(&format!("Agent        : {agent_version}\n"));
    out.push_str(&format!(
        "Enrolled     : {}\n",
        status.device.enrolled_at.format("%Y-%m-%d %H:%M UTC")
    ));

    out.push_str("\nMonitoring status: Active\n");

    out.push_str("\nCurrently collected:\n");
    for item in &status.collected {
        out.push_str(&format!("   Y  {item}\n"));
    }

    out.push_str("\nNot collected:\n");
    for item in &status.not_collected {
        out.push_str(&format!("   N  {item}\n"));
    }

    out.push_str("\nQuestions about this software should go to your IT or HR team.\n");
    out
}

/// Shown when the agent cannot reach the server. It deliberately does not
/// guess at the policy: claiming something is not collected when we cannot
/// verify it would be worse than saying so.
pub fn render_offline(agent_version: &str) -> String {
    format!(
        "WorkPulse\n\n\
         Agent        : {agent_version}\n\
         Connection   : offline\n\n\
         The agent cannot reach the server right now, so the current\n\
         collection policy cannot be shown. Activity is being recorded\n\
         locally and will be sent when the connection is restored.\n\n\
         Regardless of policy, this agent never records:\n\
         \x20  N  Keystrokes or clipboard contents\n\
         \x20  N  Passwords\n\
         \x20  N  Microphone or webcam\n\
         \x20  N  Personal files\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use wp_core::protocol::{StatusDevice, StatusEmployee, StatusOrganization};

    fn status() -> AgentStatusResponse {
        AgentStatusResponse {
            employee: StatusEmployee {
                id: "emp_1".into(),
                name: "John Doe".into(),
            },
            organization: StatusOrganization {
                id: "org_1".into(),
                name: "Acme Corporation".into(),
            },
            device: StatusDevice {
                id: "dev_9812".into(),
                hostname: "JOHN-PC".into(),
                status: "ACTIVE".into(),
                enrolled_at: Utc::now(),
            },
            collected: vec!["Active / idle state".into(), "Application activity".into()],
            not_collected: vec![
                "Keyboard input".into(),
                "Webcam".into(),
                "Passwords".into(),
            ],
            server_time: Utc::now(),
        }
    }

    #[test]
    fn names_the_employee_organization_and_device() {
        let text = render(&status(), "1.0.0");

        assert!(text.contains("John Doe"));
        assert!(text.contains("Acme Corporation"));
        assert!(text.contains("JOHN-PC"));
        assert!(text.contains("dev_9812"));
    }

    #[test]
    fn lists_both_what_is_and_is_not_collected() {
        let text = render(&status(), "1.0.0");

        assert!(text.contains("Currently collected"));
        assert!(text.contains("Application activity"));
        assert!(text.contains("Not collected"));
        assert!(text.contains("Keyboard input"));
        assert!(text.contains("Webcam"));
    }

    #[test]
    fn reflects_the_server_policy_rather_than_a_fixed_list() {
        let mut narrowed = status();
        narrowed.collected = vec!["Active / idle state".into()];

        let text = render(&narrowed, "1.0.0");

        // With application tracking disabled server-side, the screen must not
        // still claim it is being collected.
        assert!(!text.contains("Application activity"));
        assert!(text.contains("Active / idle state"));
    }

    #[test]
    fn the_offline_screen_still_states_the_hard_guarantees() {
        let text = render_offline("1.0.0");

        assert!(text.contains("offline"));
        // These hold regardless of policy, so they can be stated without a
        // server round trip.
        assert!(text.contains("Keystrokes"));
        assert!(text.contains("Microphone or webcam"));
    }

    #[test]
    fn the_offline_screen_does_not_guess_at_policy() {
        let text = render_offline("1.0.0");
        assert!(!text.contains("Currently collected"));
    }

    #[test]
    fn includes_the_agent_version() {
        assert!(render(&status(), "1.2.3").contains("1.2.3"));
    }
}
