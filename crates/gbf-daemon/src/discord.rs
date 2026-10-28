use crate::runner::{is_whitelisted_command, RunnerStatus, COMMAND_WHITELIST};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscordAction {
    Status,
    Stop,
    Standby,
    Logs { lines: usize },
    Help,
    RunPreset { preset: String, args: Vec<String> },
    Rejected { reason: String },
}

/// Strictly validates that `user_id` matches the configured `DISCORD_ALLOWED_USER_ID`.
pub fn is_authorized_user(user_id: &str, allowed_user_id: &str) -> bool {
    let uid = user_id.trim();
    let allowed = allowed_user_id.trim();
    !uid.is_empty() && !allowed.is_empty() && uid == allowed
}

/// Parses a Discord slash command or prefix command (`/gbf ...` or `!gbf ...`) into a `DiscordAction`.
pub fn parse_discord_command(raw_input: &str) -> Option<DiscordAction> {
    let trimmed = raw_input.trim();
    let body = if let Some(rest) = trimmed.strip_prefix("/gbf") {
        rest.trim()
    } else if let Some(rest) = trimmed.strip_prefix("!gbf") {
        rest.trim()
    } else {
        return None;
    };

    if body.is_empty() || body.eq_ignore_ascii_case("status") {
        return Some(DiscordAction::Status);
    }
    if body.eq_ignore_ascii_case("stop") || body.eq_ignore_ascii_case("kill") {
        return Some(DiscordAction::Stop);
    }
    if body.eq_ignore_ascii_case("standby") || body.eq_ignore_ascii_case("sleep") {
        return Some(DiscordAction::Standby);
    }
    if body.eq_ignore_ascii_case("help") {
        return Some(DiscordAction::Help);
    }

    let mut parts = body.split_whitespace();
    let first = parts.next()?.to_ascii_lowercase();

    if first == "logs" || first == "log" {
        let lines = parts
            .next()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(20)
            .clamp(1, 50);
        return Some(DiscordAction::Logs { lines });
    }

    let preset = if first == "run" || first == "start" {
        match parts.next() {
            Some(p) => p.to_ascii_lowercase(),
            None => {
                return Some(DiscordAction::Rejected {
                    reason: "Missing preset name after `run`".to_string(),
                })
            }
        }
    } else {
        first
    };

    if !is_whitelisted_command(&preset) {
        return Some(DiscordAction::Rejected {
            reason: format!("Preset `{preset}` is not in COMMAND_WHITELIST"),
        });
    }

    let args: Vec<String> = parts.map(|s| s.to_string()).collect();
    Some(DiscordAction::RunPreset { preset, args })
}

pub fn build_status_embed(status: &RunnerStatus, cdp_reachable: bool) -> Value {
    let color = if status.is_running { 0x2ecc71 } else { 0x3498db };
    let task_label = status.current_task.as_deref().unwrap_or("Idle (Standby)");
    let pid_label = status
        .pid
        .map(|p| p.to_string())
        .unwrap_or_else(|| "-".to_string());

    json!({
        "title": "GBF Native Rust Control Plane Status",
        "color": color,
        "fields": [
            { "name": "Active Task", "value": task_label, "inline": true },
            { "name": "Worker PID", "value": pid_label, "inline": true },
            { "name": "CDP Port", "value": format!("{} ({})", status.cdp_port, if cdp_reachable { "Online" } else { "Standby/Closed" }), "inline": true }
        ]
    })
}

pub fn build_logs_embed(lines: &[String]) -> Value {
    let joined = if lines.is_empty() {
        "No recent logs recorded.".to_string()
    } else {
        let raw = lines.join("\n");
        if raw.len() > 3800 {
            raw[raw.len() - 3800..].to_string()
        } else {
            raw
        }
    };

    json!({
        "title": "Recent Automation Telemetry Logs",
        "color": 0x95a5a6,
        "description": format!("```text\n{joined}\n```")
    })
}

pub fn build_help_embed() -> Value {
    let presets = COMMAND_WHITELIST.join(", ");
    json!({
        "title": "GBF Automation Command Reference",
        "color": 0xf1c40f,
        "description": format!("**Commands:** `/gbf status`, `/gbf stop`, `/gbf standby`, `/gbf logs [n]`, `/gbf <preset>`\n**Whitelisted Presets:** `{presets}`")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discord_auth_and_routing() {
        assert!(is_authorized_user("123456789", "123456789"));
        assert!(!is_authorized_user("999999999", "123456789"));
        assert!(!is_authorized_user("", "123456789"));

        assert_eq!(
            parse_discord_command("/gbf status"),
            Some(DiscordAction::Status)
        );
        assert_eq!(
            parse_discord_command("!gbf stop"),
            Some(DiscordAction::Stop)
        );
        assert_eq!(
            parse_discord_command("/gbf logs 15"),
            Some(DiscordAction::Logs { lines: 15 })
        );
        assert_eq!(
            parse_discord_command("/gbf siete --runs=5"),
            Some(DiscordAction::RunPreset {
                preset: "siete".to_string(),
                args: vec!["--runs=5".to_string()]
            })
        );
        assert!(matches!(
            parse_discord_command("/gbf invalid_cmd"),
            Some(DiscordAction::Rejected { .. })
        ));
    }
}
