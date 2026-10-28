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
/// that caps a cgroup at `max_vps_cpu_pct` (1..=100%) across `num_vcpus` cores.
///
/// Example: On a 2-vCPU VPS (`200_000us` total capacity per `100_000us` period),
/// capping total VPS CPU at `35%` produces `"70000 100000"` (`70%` of 1 core = `35%` of 2 cores).
pub fn format_cgroup_v2_cpu_max(max_vps_cpu_pct: u32, num_vcpus: u32) -> String {
    let clamped_pct = max_vps_cpu_pct.clamp(5, 95);
    let cores = num_vcpus.clamp(1, 64);
    let period_us: u64 = 100_000;
    let total_capacity_us = period_us * (cores as u64);
    let quota_us = (total_capacity_us * (clamped_pct as u64)) / 100;
    format!("{quota_us} {period_us}")
}

/// Computes Split Cgroup Quotas `(renderer_cpu_max, gpu_cpu_max)` for a `num_vcpus` VPS:
/// Isolating `--type=gpu-process` into its own tight cgroup (`7%` of total VPS CPU = `14000 100000` on 2 vCPUs)
/// prevents multi-threaded SwiftShader rasterization from stealing CFS quota from the single-threaded
/// V8 `--type=renderer` main thread during combat skill casting.
pub fn format_split_chrome_cgroup_quotas(
    max_total_vps_cpu_pct: u32,
    num_vcpus: u32,
) -> (String, String) {
    let total_pct = max_total_vps_cpu_pct.clamp(15, 90);
    let gpu_pct = (total_pct / 5).clamp(5, 10); // 5%..10% of total VPS CPU for gpu-process
    let renderer_pct = total_pct.saturating_sub(gpu_pct).max(10);
    (
        format_cgroup_v2_cpu_max(renderer_pct, num_vcpus),
        format_cgroup_v2_cpu_max(gpu_pct, num_vcpus),
    )
}

/// Computes the `systemd` `CPUQuota=` percentage string (where `100%` = 1 core, `200%` = 2 cores).
pub fn format_systemd_cpu_quota(max_vps_cpu_pct: u32, num_vcpus: u32) -> String {
    let clamped_pct = max_vps_cpu_pct.clamp(10, 95);
    let cores = num_vcpus.clamp(1, 64);
    let systemd_pct = clamped_pct * cores;
    format!("{systemd_pct}%")
}

/// Returns the recommended CDP `Emulation.setCPUThrottlingRate` multiplier for a given automation phase.
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

/// Applies split OS-level CPU governance on Linux for the Chromium process tree on `cdp_port`:
/// 1. Places `--type=gpu-process` into `/sys/fs/cgroup/gbf-chrome-gpu` with a strict `5–8%` VPS CPU cap
///    (`renice +19`) so software shader threads never starve V8.
/// 2. Places `--type=renderer`, browser, and network processes into `/sys/fs/cgroup/gbf-chrome`
///    with the remaining budget (`renice +5`), ensuring snappy `<200ms` skill execution.
pub fn apply_linux_chrome_cpu_governor(
    cdp_port: u16,
    max_vps_cpu_pct: u32,
    num_vcpus: u32,
) -> usize {
    if !cfg!(target_os = "linux") {
        return 0;
    }

    let port_flag = format!("--remote-debugging-port={cdp_port}");
    let mut renderer_pids: Vec<u32> = Vec::new();
    let mut gpu_pids: Vec<u32> = Vec::new();

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
                if !cmdline.contains("chrome") || cmdline.contains("chrome_crashpad") {
                    continue;
                }
                if cmdline.contains("--type=gpu-process") {
                    gpu_pids.push(pid);
                } else if cmdline.contains(&port_flag)
                    || cmdline.contains("--type=renderer")
                    || cmdline.contains("--type=utility")
                    || cmdline.contains("/data/accounts/")
                    || cmdline.contains("gbf-chrome-profile")
                {
                    renderer_pids.push(pid);
                }
            }
        }
    }

    let total_matched = renderer_pids.len() + gpu_pids.len();
    if total_matched == 0 {
        return 0;
    }

    // 1. Renice GPU process to +19 (lowest priority) and renderer/browser to +5
    for &pid in &gpu_pids {
        let _ = Command::new("renice")
            .args(["-n", "19", "-p", &pid.to_string()])
            .output();
    }
    for &pid in &renderer_pids {
        let _ = Command::new("renice")
            .args(["-n", "5", "-p", &pid.to_string()])
            .output();
    }

    // 2. Apply split cgroup v2 bandwidth caps so gpu-process can never starve renderer V8
    if Path::new("/sys/fs/cgroup/cgroup.controllers").exists() {
        let (renderer_max, gpu_max) =
            format_split_chrome_cgroup_quotas(max_vps_cpu_pct, num_vcpus);

        let renderer_cg = Path::new("/sys/fs/cgroup/gbf-chrome");
        let _ = fs::create_dir_all(renderer_cg);
        if fs::write(renderer_cg.join("cpu.max"), format!("{renderer_max}\n")).is_ok() {
            for &pid in &renderer_pids {
                let _ = fs::write(renderer_cg.join("cgroup.procs"), format!("{pid}\n"));
            }
        }

        let gpu_cg = Path::new("/sys/fs/cgroup/gbf-chrome-gpu");
        let _ = fs::create_dir_all(gpu_cg);
        if fs::write(gpu_cg.join("cpu.max"), format!("{gpu_max}\n")).is_ok() {
            for &pid in &gpu_pids {
                let _ = fs::write(gpu_cg.join("cgroup.procs"), format!("{pid}\n"));
            }
        }
    }

    total_matched
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cgroup_v2_and_systemd_quota_math() {
        // 35% of a 2-vCPU VPS = 70,000us per 100,000us period (70% of 1 core)
        assert_eq!(format_cgroup_v2_cpu_max(35, 2), "70000 100000");
        assert_eq!(format_systemd_cpu_quota(35, 2), "70%");

        // Split 38% across 2 vCPUs -> gpu gets 7% (14000 100000), renderer gets 31% (62000 100000)
        let (ren_q, gpu_q) = format_split_chrome_cgroup_quotas(38, 2);
        assert_eq!(ren_q, "62000 100000");
        assert_eq!(gpu_q, "14000 100000");

        let cmd = build_cpu_throttle_cdp_command(7, AutomationPhase::StandbyIdle);
        assert_eq!(cmd["method"], "Emulation.setCPUThrottlingRate");
        assert_eq!(cmd["params"]["rate"], 4);
    }
}
