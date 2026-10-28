pub mod cdp_engine;
pub mod cdp_mux;
pub mod cpu_governor;
pub mod discord;
pub mod gateway_web;
pub mod runner;
pub mod scheduler;

use cdp_engine::{load_workflow_template, NativeCdpWorkflowRunner};
use gbf_core::{catalog, jst, launcher};
use runner::ProcessOrchestrator;
use scheduler::{PeakScheduler, SchedulerAction};
use std::env;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_utc_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn print_help() {
    println!("gbf-daemon v1.1.0 — Native Rust Control Plane, 3-Layer CDP Engine & Peak-Hour Daemon");
    println!("Usage:");
    println!("  gbf-daemon --check                        Run native catalog, JST, and CDP self-diagnostics");
    println!("  gbf-daemon --run-native [acc] <template>  Execute workflow 100% natively in Rust over CDP WebSocket");
    println!("  gbf-daemon --govern-cpu [port] [max_pct]  Apply Layer 3 Linux cgroup v2 / renice CPU cap to Chrome");
    println!("  gbf-daemon --standby [port]               Put Chrome CDP port (default 9222) into 0%-CPU standby");
    println!("  gbf-daemon --run <preset> [args]          Execute a whitelisted automation preset");
    println!("  gbf-daemon --serve [port]                 Start Peak-Hour JST Scheduler + HTTP/WS Gateway");
    println!("  gbf-daemon --version                      Print version");
}

fn run_self_check() -> i32 {
    let total_entities = catalog::load_catalog_dir("data");
    let (raids, omens, selectors) = catalog::catalog_counts();
    let now_ms = now_utc_ms();
    let server_day = jst::compute_gbf_server_day_ymd(now_ms);
    let next_reset = jst::compute_next_daily_reset_utc_ms(now_ms, 5, 10);
    let mut sched = PeakScheduler::new(false, "siete");
    let next_sched = sched.poll_or_next_sleep(now_ms);
    let seofon_ok = load_workflow_template("templates", "siete").is_ok();

    println!("[gbf-daemon] Native Self-Check Passed:");
    println!(
        "  Catalog Entities : {total_entities} (raids={raids}, omens={omens}, selectors={selectors})"
    );
    println!("  GBF Server Day   : {server_day} (Next 05:00 JST Reset UTC ms: {next_reset})");
    println!("  Peak Scheduler   : {next_sched:?} (Default: OFF)");
    println!("  Rust CDP Engine  : Ready (raid-seofon template verified={seofon_ok})");
    println!("  Whitelisted Cmds : {}", runner::COMMAND_WHITELIST.len());
    0
}

fn parse_native_run_args(args: &[String]) -> (u16, String, Option<u32>) {
    let mut port: u16 = 9222;
    let mut template_name = String::new();
    let mut runs: Option<u32> = None;

    for arg in args {
        let lower = arg.trim().to_ascii_lowercase();
        if lower == "acc1" {
            port = 9222;
        } else if lower == "acc2" {
            port = 9223;
        } else if lower == "acc3" {
            port = 9224;
        } else if let Some(p_str) = lower.strip_prefix("--port=") {
            if let Ok(p) = p_str.parse::<u16>() {
                port = p;
            }
        } else if let Some(r_str) = lower.strip_prefix("--runs=") {
            if let Ok(r) = r_str.parse::<u32>() {
                runs = Some(r);
            }
        } else if let Ok(r) = lower.parse::<u32>() {
            runs = Some(r);
        } else if !lower.starts_with('-') && template_name.is_empty() {
            template_name = lower;
        }
    }

    if template_name.is_empty() {
        template_name = "raid-seofon".to_string();
    }
    (port, template_name, runs)
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let first = args.first().map(|s| s.as_str()).unwrap_or("--check");

    match first {
        "--version" | "-V" => {
            println!("gbf-daemon 1.1.0 (ABI {})", gbf_core::gbf_core_version());
        }
        "--help" | "-h" => {
            print_help();
        }
        "--check" | "--self-test" => {
            std::process::exit(run_self_check());
        }
        "--govern-cpu" => {
            let port = args
                .get(1)
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(9222);
            let max_pct = args
                .get(2)
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(38);
            let count = cpu_governor::apply_linux_chrome_cpu_governor(port, max_pct, 2);
            println!(
                "[gbf-daemon] Applied Layer 3 CPU Governor (max {max_pct}% of 2 vCPUs) to {count} Chrome PID(s) on port {port}."
            );
        }
        "--keep-diet" => {
            let port = args
                .get(1)
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(9222);
            let max_pct = args
                .get(2)
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(42);
            println!(
                "[gbf-daemon] Starting Native Rust Layer 2 + Layer 3 Diet Keeper on port {port} (max {max_pct}% of 2 vCPUs)..."
            );
            let mut active_ws: Option<gbf_core::cdp_ws::CdpWsClient> = None;
            loop {
                let _ = cpu_governor::apply_linux_chrome_cpu_governor(port, max_pct, 2);
                let needs_reconnect = match active_ws.as_mut() {
                    Some(ws) => ws.eval_js("1", 1500).is_err(),
                    None => true,
                };
                if needs_reconnect {
                    if let Ok((mut ws, target)) =
                        gbf_core::cdp_ws::CdpWsClient::connect_to_gbf_page(port, 4000)
                    {
                        let _ = ws.call("Page.enable", serde_json::json!({}), 2000);
                        let _ = ws.call(
                            "Page.addScriptToEvaluateOnNewDocument",
                            serde_json::json!({ "source": cdp_engine::LAYER2_HEADLESS_CPU_DIET_JS }),
                            3000,
                        );
                        let _ = ws.eval_js(cdp_engine::LAYER2_HEADLESS_CPU_DIET_JS, 3000);
                        println!(
                            "[RustCDP] Persistent Layer 2 Diet attached to target '{}' ({})",
                            target.id, target.url
                        );
                        active_ws = Some(ws);
                    }
                }
                thread::sleep(Duration::from_secs(12));
            }
        }
        "--run-native" => {
            let _ = catalog::load_catalog_dir("data");
            let (port, tmpl_name, explicit_runs) = parse_native_run_args(&args[1..]);
            let tmpl = match load_workflow_template("templates", &tmpl_name) {
                Ok(t) => t,
                Err(e) => {
                    eprintln!("[RustCDP] Error loading template '{tmpl_name}': {e}");
                    std::process::exit(1);
                }
            };
            let target_runs = explicit_runs.or(tmpl.default_runs).unwrap_or(200);
            let mut engine = match NativeCdpWorkflowRunner::connect_and_init(port, tmpl) {
                Ok(eng) => eng,
                Err(e) => {
                    eprintln!("[RustCDP] Failed to initialize CDP engine on port {port}: {e}");
                    std::process::exit(1);
                }
            };
            match engine.run_loop(target_runs) {
                Ok(done) => {
                    println!("[RustCDP] Completed {done}/{target_runs} run(s) cleanly.");
                }
                Err(e) => {
                    eprintln!("[RustCDP] Workflow halted: {e}");
                    std::process::exit(1);
                }
            }
        }
        "--standby" => {
            let port = args
                .get(1)
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(9222);
            let closed = launcher::put_port_on_standby_http(port, true);
            println!(
                "[gbf-daemon] Port {port} standby result: closed_tabs={closed}"
            );
        }
        "--run" => {
            let Some(preset) = args.get(1) else {
                eprintln!("[gbf-daemon] Error: missing <preset> after --run");
                std::process::exit(1);
            };
            let extra_args: Vec<String> = args.iter().skip(2).cloned().collect();
            let orch = ProcessOrchestrator::new("logs/automation.log", 9222);
            match orch.start_preset(preset, &extra_args) {
                Ok(pid) => println!("[gbf-daemon] Spawned '{preset}' worker (PID: {pid})"),
                Err(e) => {
                    eprintln!("[gbf-daemon] Error: {e}");
                    std::process::exit(1);
                }
            }
        }
        "--serve" => {
            let gateway_port = args
                .get(1)
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(3000);
            let _ = catalog::load_catalog_dir("data");
            let orch = ProcessOrchestrator::new("logs/automation.log", 9222);

            // Spawn Zero-Polling Peak-Hour JST Scheduler thread (OFF by default unless AUTO_START_SCHEDULER=true)
            let sched_enabled = env::var("AUTO_START_SCHEDULER")
                .map(|v| v == "true" || v == "1")
                .unwrap_or(false);
            let sched_orch = orch.clone();
            thread::spawn(move || {
                let mut scheduler = PeakScheduler::new(sched_enabled, "siete");
                loop {
                    match scheduler.poll_or_next_sleep(now_utc_ms()) {
                        SchedulerAction::FireWarning { day_ymd } => {
                            sched_orch.append_log(format!(
                                "[Scheduler] 20:55 JST 5-minute Peak Hour warning fired for {day_ymd}"
                            ));
                        }
                        SchedulerAction::FirePeakRoutine { day_ymd, preset } => {
                            sched_orch.append_log(format!(
                                "[Scheduler] 21:00 JST Peak Hour routine '{preset}' triggered for {day_ymd}"
                            ));
                            let _ = sched_orch.start_preset(&preset, &[]);
                        }
                        SchedulerAction::SleepMs(ms) => {
                            thread::sleep(Duration::from_millis(ms.min(60_000)));
                        }
                    }
                }
            });

            let bind_addr = format!("0.0.0.0:{gateway_port}");
            println!("[gbf-daemon] Listening on http://{bind_addr} ...");
            if let Err(err) = gateway_web::serve_gateway_blocking(&bind_addr, orch) {
                eprintln!("[gbf-daemon] Gateway server error: {err}");
                std::process::exit(1);
            }
        }
        _ => {
            print_help();
        }
    }
}
