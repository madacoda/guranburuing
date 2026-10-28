use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutomationPhase {
    /// Active turn execution (skills, summons, attack)
    ActiveCombat,
    /// Raid finder scanning or navigating between pages
    NavigationAndSearch,
    /// Waiting in patience standby or idle between runs
    StandbyIdle,
}

/// Computes a Linux cgroup v2 `cpu.max` bandwidth string (`"{quota_us} {period_us}"`)
/// that caps Chromium at `max_vps_cpu_pct` (1..=100%) across `num_vcpus` cores.
///
/// Example: On a 2-vCPU VPS (`200_000us` total capacity per `100_000us` period),
/// capping total VPS CPU at `35%` produces `"70000 100000"` (`70%` of 1 core = `35%` of 2 cores).
pub fn format_cgroup_v2_cpu_max(max_vps_cpu_pct: u32, num_vcpus: u32) -> String {
    let clamped_pct = max_vps_cpu_pct.clamp(10, 95);
    let cores = num_vcpus.clamp(1, 64);
    let period_us: u64 = 100_000;
    let total_capacity_us = period_us * (cores as u64);
    let quota_us = (total_capacity_us * (clamped_pct as u64)) / 100;
    format!("{quota_us} {period_us}")
}

/// Computes the `systemd` `CPUQuota=` percentage string (where `100%` = 1 core, `200%` = 2 cores).
pub fn format_systemd_cpu_quota(max_vps_cpu_pct: u32, num_vcpus: u32) -> String {
    let clamped_pct = max_vps_cpu_pct.clamp(10, 95);
    let cores = num_vcpus.clamp(1, 64);
    let systemd_pct = clamped_pct * cores;
    format!("{systemd_pct}%")
}

/// Returns the recommended CDP `Emulation.setCPUThrottlingRate` multiplier for a given automation phase.
/// - `ActiveCombat`: `1` (no artificial JS execution slowdown during skill casts, relying on 15 FPS rAF + 1 FPS Canvas gate)
/// - `NavigationAndSearch`: `2` (2x slowdown on background page timers during raid finder scanning)
/// - `StandbyIdle`: `4` (4x slowdown while waiting in patience standby)
pub fn recommended_cdp_cpu_throttle_rate(phase: AutomationPhase) -> u32 {
    match phase {
        AutomationPhase::ActiveCombat => 1,
        AutomationPhase::NavigationAndSearch => 2,
        AutomationPhase::StandbyIdle => 4,
    }
}

/// Builds a CDP `Emulation.setCPUThrottlingRate` JSON-RPC command.
pub fn build_cpu_throttle_cdp_command(rpc_id: u32, phase: AutomationPhase) -> Value {
    let rate = recommended_cdp_cpu_throttle_rate(phase);
    json!({
        "id": rpc_id,
        "method": "Emulation.setCPUThrottlingRate",
        "params": {
            "rate": rate
        }
    })
}

/// Applies OS-level CPU governance on Linux for the Chromium process tree on `cdp_port`:
/// 1. Lowers scheduler priority (`renice +10`) on all Chrome processes for `cdp_port` so they yield immediately to system/daemon threads.
/// 2. If a dedicated cgroup v2 group `/sys/fs/cgroup/gbf-chrome` exists (or can be created by root),
///    writes `cpu.max` (`format_cgroup_v2_cpu_max(max_vps_cpu_pct, num_vcpus)`) and moves Chrome PIDs into `cgroup.procs`.
pub fn apply_linux_chrome_cpu_governor(
    cdp_port: u16,
    max_vps_cpu_pct: u32,
    num_vcpus: u32,
) -> usize {
    if !cfg!(target_os = "linux") {
        return 0;
    }

    let port_flag = format!("--remote-debugging-port={cdp_port}");
    let mut matched_pids: Vec<u32> = Vec::new();

    if let Ok(entries) = fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let Some(pid_str) = file_name.to_str() else {
                continue;
            };
            let Ok(pid) = pid_str.parse::<u32>() else {
                continue;
            };
            let cmdline_path = entry.path().join("cmdline");
            if let Ok(raw) = fs::read(&cmdline_path) {
                let cmdline = String::from_utf8_lossy(&raw);
                if cmdline.contains("chrome")
                    && (cmdline.contains(&port_flag)
                        || cmdline.contains("--type=renderer")
                        || cmdline.contains("--type=gpu-process")
                        || cmdline.contains("gbf-chrome-profile"))
                {
                    matched_pids.push(pid);
                }
            }
        }
    }

    if matched_pids.is_empty() {
        return 0;
    }

    // 1. Renice all matched Chromium PIDs to +10
    for &pid in &matched_pids {
        let _ = Command::new("renice")
            .args(["-n", "10", "-p", &pid.to_string()])
            .output();
    }

    // 2. Apply cgroup v2 bandwidth cap if running as root on a cgroup v2 system
    let cgroup_dir = Path::new("/sys/fs/cgroup/gbf-chrome");
    if Path::new("/sys/fs/cgroup/cgroup.controllers").exists() {
        let _ = fs::create_dir_all(cgroup_dir);
        let cpu_max_path = cgroup_dir.join("cpu.max");
        let procs_path = cgroup_dir.join("cgroup.procs");
        let cpu_max_val = format_cgroup_v2_cpu_max(max_vps_cpu_pct, num_vcpus);
        if fs::write(&cpu_max_path, format!("{cpu_max_val}\n")).is_ok() {
            for &pid in &matched_pids {
                let _ = fs::write(&procs_path, format!("{pid}\n"));
            }
        }
    }

    matched_pids.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cgroup_v2_and_systemd_quota_math() {
        // 35% of a 2-vCPU VPS = 70,000us per 100,000us period (70% of 1 core)
        assert_eq!(format_cgroup_v2_cpu_max(35, 2), "70000 100000");
        assert_eq!(format_systemd_cpu_quota(35, 2), "70%");

        // 40% of a 2-vCPU VPS = 80,000us per 100,000us period (80% of 1 core)
        assert_eq!(format_cgroup_v2_cpu_max(40, 2), "80000 100000");
        assert_eq!(format_systemd_cpu_quota(40, 2), "80%");

        let cmd = build_cpu_throttle_cdp_command(7, AutomationPhase::StandbyIdle);
        assert_eq!(cmd["method"], "Emulation.setCPUThrottlingRate");
        assert_eq!(cmd["params"]["rate"], 4);
    }
}
