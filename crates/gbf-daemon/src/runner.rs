use gbf_core::launcher;
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

pub const COMMAND_WHITELIST: &[&str] = &[
    "status",
    "siete",
    "ennead",
    "six_dragons",
    "revans",
    "custom_raid",
    "daily",
    "magna",
    "guild_wars",
    "dread_barrage",
    "records_of_the_ten",
    "tales_of_arcarum",
    "proving_grounds",
    "exo_crucible",
    "hl_ql",
    "pbhl",
    "ubhl",
    "akasha",
    "grand_order",
    "huanglong_qilin",
    "event_raid",
    "faa_hl",
    "bubs",
    "belial",
    "hexa",
    "faa_zero",
    "sandbox",
    "slime",
    "angel_halo",
];

const MAX_RING_LOGS: usize = 50;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RunnerStatus {
    pub is_running: bool,
    pub current_task: Option<String>,
    pub pid: Option<u32>,
    pub started_at_ms: u64,
    pub cdp_port: u16,
}

struct InnerState {
    current_task: Option<String>,
    child: Option<Child>,
    started_at_ms: u64,
    logs: VecDeque<String>,
    log_file_path: String,
    cdp_port: u16,
}

#[derive(Clone)]
pub struct ProcessOrchestrator {
    state: Arc<Mutex<InnerState>>,
}

/// Validates whether a preset name is on the strict `COMMAND_WHITELIST`.
pub fn is_whitelisted_command(preset: &str) -> bool {
    let normalized = preset.trim().to_ascii_lowercase();
    COMMAND_WHITELIST.contains(&normalized.as_str())
}

/// Sanitizes a CLI argument, rejecting shell metacharacters or excessively long strings.
pub fn sanitize_arg(arg: &str) -> Result<String, &'static str> {
    let trimmed = arg.trim();
    if trimmed.is_empty() {
        return Err("Empty argument is not allowed");
    }
    if trimmed.len() > 64 {
        return Err("Argument exceeds 64-character safety limit");
    }
    for ch in trimmed.chars() {
        if matches!(
            ch,
            ';' | '|' | '&' | '`' | '$' | '>' | '<' | '\n' | '\r' | '\0' | '"' | '\''
        ) {
            return Err("Argument contains forbidden shell metacharacter");
        }
    }
    Ok(trimmed.to_string())
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl ProcessOrchestrator {
    pub fn new(log_file_path: impl Into<String>, cdp_port: u16) -> Self {
        let path_str = log_file_path.into();
        if let Some(parent) = Path::new(&path_str).parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self {
            state: Arc::new(Mutex::new(InnerState {
                current_task: None,
                child: None,
                started_at_ms: 0,
                logs: VecDeque::with_capacity(MAX_RING_LOGS),
                log_file_path: path_str,
                cdp_port,
            })),
        }
    }

    pub fn append_log(&self, line: impl AsRef<str>) {
        let text = line.as_ref().trim_end().to_string();
        if text.is_empty() {
            return;
        }
        if let Ok(mut guard) = self.state.lock() {
            if guard.logs.len() >= MAX_RING_LOGS {
                guard.logs.pop_front();
            }
            guard.logs.push_back(text.clone());

            if !guard.log_file_path.is_empty() {
                if let Ok(mut file) = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&guard.log_file_path)
                {
                    let _ = writeln!(file, "{text}");
                }
            }
        }
    }

    pub fn recent_logs(&self, count: usize) -> Vec<String> {
        let Ok(guard) = self.state.lock() else {
            return Vec::new();
        };
        let take_n = count.clamp(1, MAX_RING_LOGS);
        let skip_n = guard.logs.len().saturating_sub(take_n);
        guard.logs.iter().skip(skip_n).cloned().collect()
    }

    pub fn status(&self) -> RunnerStatus {
        let Ok(mut guard) = self.state.lock() else {
            return RunnerStatus {
                is_running: false,
                current_task: None,
                pid: None,
                started_at_ms: 0,
                cdp_port: 9222,
            };
        };

        // Reap finished child if exited
        if let Some(child) = guard.child.as_mut() {
            if let Ok(Some(_)) = child.try_wait() {
                guard.child = None;
                guard.current_task = None;
                guard.started_at_ms = 0;
            }
        }

        let pid = guard.child.as_ref().map(|c| c.id());
        RunnerStatus {
            is_running: guard.current_task.is_some(),
            current_task: guard.current_task.clone(),
            pid,
            started_at_ms: guard.started_at_ms,
            cdp_port: guard.cdp_port,
        }
    }

    /// Stops any active automation worker and returns Chrome to 0%-CPU `about:blank` standby.
    pub fn stop_current_task(&self) -> bool {
        let (had_task, port) = {
            let Ok(mut guard) = self.state.lock() else {
                return false;
            };
            let port = guard.cdp_port;
            let had = guard.current_task.is_some() || guard.child.is_some();
            if let Some(mut child) = guard.child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            guard.current_task = None;
            guard.started_at_ms = 0;
            (had, port)
        };

        let _ = launcher::put_port_on_standby_http(port, true);
        if had_task {
            self.append_log(format!(
                "[Orchestrator] Stopped active worker and placed port {port} on standby."
            ));
        }
        had_task
    }

    /// Validates, preempts any prior worker, and spawns `bun run src/index.ts <preset> [args...]`.
    pub fn start_preset(&self, preset: &str, raw_args: &[String]) -> Result<u32, String> {
        let clean_preset = preset.trim().to_ascii_lowercase();
        if !is_whitelisted_command(&clean_preset) {
            return Err(format!(
                "Command '{clean_preset}' is not in COMMAND_WHITELIST"
            ));
        }

        let mut safe_args = Vec::with_capacity(raw_args.len());
        for a in raw_args {
            let sanitized = sanitize_arg(a).map_err(|e| e.to_string())?;
            safe_args.push(sanitized);
        }

        // Preemptively stop any active task first
        self.stop_current_task();

        let mut cmd = Command::new("bun");
        cmd.arg("run")
            .arg("src/index.ts")
            .arg(&clean_preset)
            .args(&safe_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn bun worker: {e}"))?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        {
            let Ok(mut guard) = self.state.lock() else {
                return Err("Orchestrator mutex poisoned".to_string());
            };
            guard.current_task = Some(clean_preset.clone());
            guard.started_at_ms = now_unix_ms();
            guard.child = Some(child);
        }

        self.append_log(format!(
            "[Orchestrator] Started task '{clean_preset}' (PID: {pid})"
        ));

        if let Some(out) = stdout {
            let orch = self.clone();
            thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines().map_while(Result::ok) {
                    orch.append_log(line);
                }
            });
        }

        if let Some(err) = stderr {
            let orch = self.clone();
            thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().map_while(Result::ok) {
                    orch.append_log(format!("[ERR] {line}"));
                }
            });
        }

        Ok(pid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_command_whitelist_and_sanitizer() {
        assert!(is_whitelisted_command("siete"));
        assert!(is_whitelisted_command("REVANS"));
        assert!(is_whitelisted_command("guild_wars"));
        assert!(!is_whitelisted_command("rm -rf /"));
        assert!(!is_whitelisted_command("eval"));

        assert_eq!(sanitize_arg("--runs=10").unwrap(), "--runs=10");
        assert!(sanitize_arg("10; whoami").is_err());
        assert!(sanitize_arg("$(id)").is_err());
        assert!(sanitize_arg("a|b").is_err());
    }

    #[test]
    fn test_ring_buffer_rotation() {
        let tmp_log = std::env::temp_dir().join("gbf_daemon_runner_test.log");
        let _ = fs::remove_file(&tmp_log);
        let orch = ProcessOrchestrator::new(tmp_log.to_string_lossy().to_string(), 19222);

        for i in 1..=60 {
            orch.append_log(format!("Line {i}"));
        }

        let recent = orch.recent_logs(50);
        assert_eq!(recent.len(), 50);
        assert_eq!(recent.first().unwrap(), "Line 11");
        assert_eq!(recent.last().unwrap(), "Line 60");

        let _ = fs::remove_file(&tmp_log);
    }
}
