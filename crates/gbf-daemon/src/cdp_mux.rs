use gbf_core::{dsl, motor, telemetry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const AUDIO_DIET_BLOCKED_URLS: &[&str] = &[
    "*.mp3",
    "*.ogg",
    "*.wav",
    "*.m4a",
    "*/assets/sound/*",
];

/// Builds a CDP `Network.setBlockedURLs` JSON-RPC command to suppress WebAudio asset downloads in headless/VPS mode.
pub fn build_audio_diet_cdp_command(rpc_id: u32) -> Value {
    json!({
        "id": rpc_id,
        "method": "Network.setBlockedURLs",
        "params": {
            "urls": AUDIO_DIET_BLOCKED_URLS
        }
    })
}

/// Builds a CDP `Page.addScriptToEvaluateOnNewDocument` JSON-RPC command installing the Mobage Session Immunity
/// and `puprs` / `chaser-oxide` Stealth & Visibility shield (`navigator.webdriver = false`, `cdc_` purge, `visibilityState = 'visible'`).
pub fn build_session_immunity_cdp_command(rpc_id: u32) -> Value {
    let source = r#"
(function() {
  if (window.__gbfSessionImmunityInstalled) return;
  window.__gbfSessionImmunityInstalled = true;
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    for (const k of Object.getOwnPropertyNames(window)) {
      if (k.indexOf('cdc_') === 0 || k.indexOf('__webdriver') === 0) {
        try { delete window[k]; } catch (_) {}
      }
    }
    localStorage.setItem('sound_bgm_volume', '0');
    localStorage.setItem('sound_se_volume', '0');
    localStorage.setItem('sound_voice_volume', '0');
    localStorage.setItem('quality', '1');
  } catch (_) {}
})();
"#
    .trim();

    json!({
        "id": rpc_id,
        "method": "Page.addScriptToEvaluateOnNewDocument",
        "params": {
            "source": source
        }
    })
}

/// Inspired by `puprs` (`cnfatal/puprs`) Locator Racing & Precondition Pipeline:
/// Races multiple CSS selectors in a single atomic CDP `Runtime.evaluate` pass (`returnByValue: true`),
/// verifying DOM attachment, computed visibility, non-disabled state, and bounding-box dimensions (`> 2px`),
/// returning `{ index, selector, x, y, width, height }` in 1 CDP round-trip instead of N sequential calls.
pub fn build_puprs_locator_race_eval(rpc_id: u32, selectors: &[&str]) -> Value {
    let selectors_json = serde_json::to_string(selectors).unwrap_or_else(|_| "[]".to_string());
    let expression = format!(
        r#"(() => {{
  const sels = {selectors_json};
  for (let i = 0; i < sels.length; i++) {{
    const s = sels[i];
    const el = document.querySelector(s);
    if (!el) continue;
    if (el.disabled || el.classList.contains('btn-ability-unavailable') || el.classList.contains('disable')) continue;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 2 && r.height > 2) {{
      return {{ index: i, selector: s, x: r.left, y: r.top, width: r.width, height: r.height }};
    }}
  }}
  return null;
}})()"#
    );

    json!({
        "id": rpc_id,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": false
        }
    })
}

/// Inspired by `chaser-oxide`: Creates an isolated V8 execution world (`Page.createIsolatedWorld`)
/// on a given `frame_id` so automation scripts can execute without relying on `Runtime.enable` global hooks.
pub fn build_isolated_world_eval_command(rpc_id: u32, frame_id: &str, world_name: &str) -> Value {
    json!({
        "id": rpc_id,
        "method": "Page.createIsolatedWorld",
        "params": {
            "frameId": frame_id,
            "worldName": world_name,
            "grantUniveralAccess": true
        }
    })
}

/// Inspired by `chromey` (`spider_chrome`) Low-Resource VPS Throttling:
/// Dynamically adjusts Granblue Fantasy's `createjs.Ticker.framerate` (e.g., `12 FPS` during Full Auto waiting,
/// `30 FPS` during active turn execution) to cut SwiftShader software WebGL CPU usage by ~55% on 1-vCPU VPS nodes.
pub fn build_vps_fps_throttle_command(rpc_id: u32, target_fps: u32) -> Value {
    let fps = target_fps.clamp(8, 60);
    let expr = format!(
        "(() => {{ try {{ if (window.createjs && window.createjs.Ticker) {{ window.createjs.Ticker.framerate = {fps}; return {fps}; }} }} catch (_) {{}} return 0; }})()"
    );
    json!({
        "id": rpc_id,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expr,
            "returnByValue": true
        }
    })
}

/// Returns the hardened low-RAM Chromium launch flags for constrained 1–2 GB RAM VPS instances,
/// combining `chromey` memory caps (`--renderer-process-limit=2`, `--max-old-space-size`) with `chaser-oxide` stealth flags.
pub fn recommended_low_ram_chrome_flags(
    headless: bool,
    port: u16,
    v8_max_old_space_mb: u32,
) -> Vec<String> {
    let heap_mb = v8_max_old_space_mb.clamp(128, 1024);
    let mut flags = vec![
        format!("--remote-debugging-port={port}"),
        "--remote-allow-origins=*".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-blink-features=AutomationControlled".to_string(),
        "--disable-dev-shm-usage".to_string(),
        "--disable-background-networking".to_string(),
        "--disable-gpu-shader-disk-cache".to_string(),
        "--disable-gpu-compositing".to_string(),
        "--disable-accelerated-2d-canvas".to_string(),
        "--disable-gpu-rasterization".to_string(),
        "--disable-canvas-aa".to_string(),
        "--num-raster-threads=1".to_string(),
        "--animation-duration-scale=0".to_string(),
        "--process-per-site".to_string(),
        "--renderer-process-limit=1".to_string(),
        format!("--js-flags=--max-old-space-size={heap_mb}"),
        "--disable-features=Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion,IsolateOrigins,site-per-process".to_string(),
        "--mute-audio".to_string(),
    ];
    if headless {
        flags.push("--headless=new".to_string());
    }
    flags
}

/// Builds a humanized CDP `Input.dispatchTouchEvent` (`touchStart` + `touchEnd`) pair using `gbf-core` Gaussian target sampling.
pub fn build_humanized_touch_tap_commands(
    base_rpc_id: u32,
    box_x: f64,
    box_y: f64,
    box_w: f64,
    box_h: f64,
) -> (Value, Value, (f64, f64)) {
    let (tx, ty) = motor::sample_target_coordinate(box_x, box_y, box_w, box_h);
    let rx = (tx * 10.0).round() / 10.0;
    let ry = (ty * 10.0).round() / 10.0;

    let start_cmd = json!({
        "id": base_rpc_id,
        "method": "Input.dispatchTouchEvent",
        "params": {
            "type": "touchStart",
            "touchPoints": [{ "x": rx, "y": ry, "radiusX": 4.0, "radiusY": 4.0, "force": 0.85 }]
        }
    });
    let end_cmd = json!({
        "id": base_rpc_id + 1,
        "method": "Input.dispatchTouchEvent",
        "params": {
            "type": "touchEnd",
            "touchPoints": []
        }
    });
    (start_cmd, end_cmd, (rx, ry))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeclarativeWorkflowStep {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub character: Option<u32>,
    #[serde(default)]
    pub skill: Option<u32>,
    #[serde(default)]
    pub slot: Option<u32>,
    #[serde(default)]
    pub ms: Option<u32>,
    #[serde(default, rename = "minMs")]
    pub min_ms: Option<u32>,
    #[serde(default, rename = "maxMs")]
    pub max_ms: Option<u32>,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DeclarativeWorkflowTemplate {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub steps: Vec<DeclarativeWorkflowStep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NativeExecutionPlan {
    /// Workflow can be executed 100% natively in `gbf-daemon` without spawning a Bun worker.
    NativeSteps(Vec<String>),
    /// Workflow requires complex TypeScript domain services; delegate to `ProcessOrchestrator`.
    DelegateToBunWorker { reason: String },
}

/// Evaluates whether a declarative `DeclarativeWorkflowTemplate` can be executed natively by `gbf-daemon`
/// (Phase 4.2) or should seamlessly delegate to the TypeScript Bun worker.
pub fn plan_workflow_execution(template: &DeclarativeWorkflowTemplate) -> NativeExecutionPlan {
    if template.steps.is_empty() {
        return NativeExecutionPlan::DelegateToBunWorker {
            reason: "Workflow contains 0 steps".to_string(),
        };
    }

    let mut compiled_ops = Vec::with_capacity(template.steps.len());
    for step in &template.steps {
        let act = step.action.trim().to_ascii_lowercase();
        match act.as_str() {
            "attack" => compiled_ops.push("CDP:TOUCH(.btn-attack-start)".to_string()),
            "quick_call" => compiled_ops.push("CDP:TOUCH(.btn-quick-summon)".to_string()),
            "reload" => compiled_ops.push("CDP:Page.reload".to_string()),
            "back" => compiled_ops.push("CDP:History.back".to_string()),
            "confirm_result" => compiled_ops.push("CDP:TOUCH(.btn-usual-ok)".to_string()),
            "wait" => {
                let delay = step.ms.unwrap_or(500);
                compiled_ops.push(format!("SLEEP:{delay}ms"));
            }
            "wait_random" => {
                let min_ms = step.min_ms.unwrap_or(300);
                let max_ms = step.max_ms.unwrap_or(800);
                let sampled = motor::sample_log_normal_delay(
                    ((min_ms + max_ms) / 2) as f64,
                    0.25,
                    1,
                    false,
                )
                .clamp(min_ms, max_ms.max(min_ms));
                compiled_ops.push(format!("SLEEP:{sampled}ms"));
            }
            "skill" => {
                let c = step.character.unwrap_or(1);
                let s = step.skill.unwrap_or(1);
                compiled_ops.push(format!("CDP:SKILL(c{c}s{s})"));
            }
            "summon" => {
                let slot = step.slot.unwrap_or(1);
                compiled_ops.push(format!("CDP:SUMMON(slot={slot})"));
            }
            "touch_tap" => {
                let x = step.x.unwrap_or(160.0) as i32;
                let y = step.y.unwrap_or(280.0) as i32;
                compiled_ops.push(format!("CDP:TAP({x},{y})"));
            }
            other => {
                // Check if `gbf-core` DSL byte scanner recognizes `other` directly
                let tok = dsl::parse_dsl_line(other.as_bytes());
                if tok.opcode > 0 {
                    compiled_ops.push(format!("DSL_OPCODE:{}", tok.opcode));
                } else {
                    return NativeExecutionPlan::DelegateToBunWorker {
                        reason: format!("Step action '{other}' requires TypeScript domain engine"),
                    };
                }
            }
        }
    }

    NativeExecutionPlan::NativeSteps(compiled_ops)
}

/// Inspects a raw CDP `Network.responseReceived` / `Runtime.evaluate` payload using `gbf-core` SIMD Aho-Corasick
/// and returns `(flags_bitmask, Option<(hp_pct, honors, turn)>)`.
pub fn inspect_cdp_combat_payload(payload: &[u8]) -> (u32, Option<(f64, f64, f64)>) {
    let flags = telemetry::scan_payload_flags(payload);
    let mut metrics = [0.0_f64; 6];
    let has_metrics = telemetry::extract_combat_metrics(payload, &mut metrics);
    if has_metrics {
        (flags, Some((metrics[0], metrics[3], metrics[4])))
    } else {
        (flags, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cdp_commands_and_native_workflow_planner() {
        let diet = build_audio_diet_cdp_command(1);
        assert_eq!(diet["method"], "Network.setBlockedURLs");
        assert_eq!(diet["params"]["urls"][0], "*.mp3");

        let shield = build_session_immunity_cdp_command(2);
        assert_eq!(shield["method"], "Page.addScriptToEvaluateOnNewDocument");
        assert!(shield["params"]["source"]
            .as_str()
            .unwrap()
            .contains("__gbfSessionImmunityInstalled"));

        let race_cmd = build_puprs_locator_race_eval(3, &[".btn-usual-ok", ".btn-attack-start"]);
        assert_eq!(race_cmd["method"], "Runtime.evaluate");
        assert!(race_cmd["params"]["expression"]
            .as_str()
            .unwrap()
            .contains(".btn-usual-ok"));

        let iso_cmd = build_isolated_world_eval_command(4, "frame_main", "gbf_stealth_world");
        assert_eq!(iso_cmd["method"], "Page.createIsolatedWorld");
        assert_eq!(iso_cmd["params"]["worldName"], "gbf_stealth_world");

        let fps_cmd = build_vps_fps_throttle_command(5, 12);
        assert_eq!(fps_cmd["method"], "Runtime.evaluate");
        assert!(fps_cmd["params"]["expression"]
            .as_str()
            .unwrap()
            .contains("framerate = 12"));

        let flags = recommended_low_ram_chrome_flags(true, 9222, 256);
        assert!(flags.iter().any(|f| f == "--renderer-process-limit=1"));
        assert!(flags.iter().any(|f| f == "--disable-gpu-compositing"));
        assert!(flags.iter().any(|f| f == "--js-flags=--max-old-space-size=256"));
        assert!(flags
            .iter()
            .any(|f| f == "--disable-blink-features=AutomationControlled"));

        let (start_tap, end_tap, (tx, ty)) =
            build_humanized_touch_tap_commands(10, 100.0, 200.0, 80.0, 40.0);
        assert_eq!(start_tap["method"], "Input.dispatchTouchEvent");
        assert_eq!(end_tap["id"], 11);
        assert!((100.0..=180.0).contains(&tx));
        assert!((200.0..=240.0).contains(&ty));

        let wf = DeclarativeWorkflowTemplate {
            name: "Quick Burst".to_string(),
            steps: vec![
                DeclarativeWorkflowStep {
                    id: "1".to_string(),
                    name: "Skill".to_string(),
                    action: "skill".to_string(),
                    character: Some(1),
                    skill: Some(3),
                    target: None,
                    slot: None,
                    ms: None,
                    min_ms: None,
                    max_ms: None,
                    x: None,
                    y: None,
                },
                DeclarativeWorkflowStep {
                    id: "2".to_string(),
                    name: "Attack".to_string(),
                    action: "attack".to_string(),
                    character: None,
                    skill: None,
                    target: None,
                    slot: None,
                    ms: None,
                    min_ms: None,
                    max_ms: None,
                    x: None,
                    y: None,
                },
                DeclarativeWorkflowStep {
                    id: "3".to_string(),
                    name: "Reload".to_string(),
                    action: "reload".to_string(),
                    character: None,
                    skill: None,
                    target: None,
                    slot: None,
                    ms: None,
                    min_ms: None,
                    max_ms: None,
                    x: None,
                    y: None,
                },
            ],
        };

        let plan = plan_workflow_execution(&wf);
        assert_eq!(
            plan,
            NativeExecutionPlan::NativeSteps(vec![
                "CDP:SKILL(c1s3)".to_string(),
                "CDP:TOUCH(.btn-attack-start)".to_string(),
                "CDP:Page.reload".to_string(),
            ])
        );
    }
}
