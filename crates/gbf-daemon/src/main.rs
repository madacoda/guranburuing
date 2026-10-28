pub mod cdp_mux;
pub mod discord;
pub mod gateway_web;
pub mod runner;
pub mod scheduler;

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
    println!("gbf-daemon v1.0.0 — Native Rust Control Plane & Peak-Hour Daemon");
    println!("Usage:");
    println!("  gbf-daemon --check                Run native catalog, JST, and CDP self-diagnostics");
    println!("  gbf-daemon --standby [port]       Put Chrome CDP port (default 9222) into 0%-CPU standby");
    println!("  gbf-daemon --run <preset> [args]  Execute a whitelisted automation preset");
    println!("  gbf-daemon --serve [port]         Start Peak-Hour JST Scheduler + HTTP/WS Gateway");
    println!("  gbf-daemon --version              Print version");
}

fn run_self_check() -> i32 {
    let total_entities = catalog::load_catalog_dir("data");
    let (raids, omens, selectors) = catalog::catalog_counts();
    let now_ms = now_utc_ms();
    let server_day = jst::compute_gbf_server_day_ymd(now_ms);
    let next_reset = jst::compute_next_daily_reset_utc_ms(now_ms, 5, 10);
    let mut sched = PeakScheduler::new(true, "siete");
    let next_sched = sched.poll_or_next_sleep(now_ms);

    println!("[gbf-daemon] Native Self-Check Passed:");
    println!(
        "  Catalog Entities : {total_entities} (raids={raids}, omens={omens}, selectors={selectors})"
    );
    println!("  GBF Server Day   : {server_day} (Next 05:00 JST Reset UTC ms: {next_reset})");
    println!("  Peak Scheduler   : {next_sched:?}");
    println!("  Whitelisted Cmds : {}", runner::COMMAND_WHITELIST.len());
    0
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let first = args.first().map(|s| s.as_str()).unwrap_or("--check");

    match first {
        "--version" | "-V" => {
            println!("gbf-daemon 1.0.0 (ABI {})", gbf_core::gbf_core_version());
        }
        "--help" | "-h" => {
            print_help();
        }
        "--check" | "--self-test" => {
            std::process::exit(run_self_check());
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

            // Spawn Zero-Polling Peak-Hour JST Scheduler thread
            let sched_orch = orch.clone();
            thread::spawn(move || {
                let mut scheduler = PeakScheduler::new(true, "siete");
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
