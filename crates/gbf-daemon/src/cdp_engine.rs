use crate::cdp_mux::AUDIO_DIET_BLOCKED_URLS;
use crate::cpu_governor::{
    apply_linux_chrome_cpu_governor, build_cpu_throttle_cdp_command, AutomationPhase,
};
use gbf_core::cdp_ws::CdpWsClient;
use gbf_core::motor;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

/// Layer 2 Persistent Headless CPU Diet & Sprite Sheet Interceptor script.
/// Installed via `Page.addScriptToEvaluateOnNewDocument` on the persistent page session so it
/// survives every `F5` combat reload (`Step 2/35: reload`, etc.):
/// 1. Replaces heavy CreateJS battle sprite sheet PNGs (`/cjs/`, `/effect/`, `/bg/`, `/motion/`)
///    with an in-memory 43-byte 1x1 transparent GIF so `PreloadJS` fires `onload` in `<0.01ms`
///    with zero `libpng` decompression CPU and zero 16MB RGBA bitmap allocations.
/// 2. Decouples `window.requestAnimationFrame` onto a 15 FPS (`66ms`) `setTimeout` passing `performance.now()`
///    so Blink never wakes `--type=gpu-process` (`viz::DisplayScheduler`) at 60 Hz.
/// 3. Gates Canvas 2D & WebGL draw calls to a `35ms` window once every `1,000ms` (~1 FPS).
/// 4. Enforces Mobage Session Immunity & Stealth (`navigator.webdriver = false`, `visibilityState = 'visible'`).
pub const LAYER2_HEADLESS_CPU_DIET_JS: &str = r#"
(function() {
  try {
    localStorage.setItem('sound_bgm_volume', '0');
    localStorage.setItem('sound_se_volume', '0');
    localStorage.setItem('sound_voice_volume', '0');
    localStorage.setItem('setting_bgm_mute', '1');
    localStorage.setItem('setting_se_mute', '1');
    localStorage.setItem('setting_voice_mute', '1');
    localStorage.setItem('quality', '1');
    localStorage.setItem('game_quality', '1');
  } catch (_) {}

  if (!window.__gbfSessionImmunityInstalled) {
    window.__gbfSessionImmunityInstalled = true;
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    } catch (_) {}
  }

  if (!window.__gbfLayer2SpriteDietInstalled) {
    window.__gbfLayer2SpriteDietInstalled = true;
    const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const isHeavyBattleSprite = (url) => {
      if (typeof url !== 'string' || url.length < 8 || url.startsWith('data:')) return false;
      const lower = url.toLowerCase();
      if (lower.includes('captcha') || lower.includes('challenge') || lower.includes('/lobby/')) return false;
      return (
        lower.includes('/cjs/') ||
        lower.includes('/sp/cjs/') ||
        lower.includes('/effect/') ||
        lower.includes('/motion/') ||
        lower.includes('/assets/battle/') ||
        lower.includes('/quest/scene/') ||
        (lower.includes('/bg/') && (lower.endsWith('.jpg') || lower.endsWith('.png')))
      );
    };

    try {
      const imgProto = window.HTMLImageElement && window.HTMLImageElement.prototype;
      if (imgProto) {
        const desc = Object.getOwnPropertyDescriptor(imgProto, 'src');
        if (desc && desc.set && desc.get) {
          Object.defineProperty(imgProto, 'src', {
            configurable: true,
            enumerable: true,
            get: function() {
              return this.__gbfOrigSrc || desc.get.call(this);
            },
            set: function(val) {
              this.__gbfOrigSrc = val;
              if (isHeavyBattleSprite(val)) {
                return desc.set.call(this, BLANK_GIF);
              }
              return desc.set.call(this, val);
            }
          });
        }
      }
    } catch (_) {}
  }

  if (!window.__gbfRafThrottled15Fps) {
    window.__gbfRafThrottled15Fps = true;
    window.requestAnimationFrame = function(cb) {
      return window.setTimeout(function() {
        try {
          cb(performance.now());
        } catch (_) {}
      }, 66);
    };
    window.cancelAnimationFrame = function(id) {
      window.clearTimeout(id);
    };

    let lastPaintWindowStart = 0;
    const shouldPaintNow = () => {
      const now = performance.now();
      const elapsed = now - lastPaintWindowStart;
      if (elapsed >= 1000) {
        lastPaintWindowStart = now;
        return true;
      }
      return elapsed <= 35;
    };

    try {
      const ctxProto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
      if (ctxProto && !ctxProto.__gbfDrawGated) {
        ctxProto.__gbfDrawGated = true;
        const origDrawImage = ctxProto.drawImage;
        const origClearRect = ctxProto.clearRect;
        const origFillRect = ctxProto.fillRect;
        ctxProto.drawImage = function() {
          if (shouldPaintNow()) return origDrawImage.apply(this, arguments);
        };
        ctxProto.clearRect = function() {
          if (shouldPaintNow()) return origClearRect.apply(this, arguments);
        };
        ctxProto.fillRect = function() {
          if (shouldPaintNow()) return origFillRect.apply(this, arguments);
        };
      }
    } catch (_) {}

    const gateWebGL = (glProto) => {
      if (!glProto || glProto.__gbfGlGated) return;
      glProto.__gbfGlGated = true;
      const origDrawArrays = glProto.drawArrays;
      const origDrawElements = glProto.drawElements;
      const origClear = glProto.clear;
      if (origDrawArrays) {
        glProto.drawArrays = function() {
          if (shouldPaintNow()) return origDrawArrays.apply(this, arguments);
        };
      }
      if (origDrawElements) {
        glProto.drawElements = function() {
          if (shouldPaintNow()) return origDrawElements.apply(this, arguments);
        };
      }
      if (origClear) {
        glProto.clear = function() {
          if (shouldPaintNow()) return origClear.apply(this, arguments);
        };
      }
    };
    try {
      gateWebGL(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
      gateWebGL(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
    } catch (_) {}
  }

  const applyTickerCap = () => {
    try {
      if (window.Game && window.Game.setting) {
        window.Game.setting.bgm_mute = 1;
        window.Game.setting.se_mute = 1;
        window.Game.setting.voice_mute = 1;
      }
      if (window.createjs && window.createjs.Ticker) {
        if (window.createjs.Ticker.TIMED) {
          window.createjs.Ticker.timingMode = window.createjs.Ticker.TIMED;
        }
        window.createjs.Ticker.framerate = 15;
      }
    } catch (_) {}
  };
  applyTickerCap();
  setInterval(applyTickerCap, 3000);
})();
"#;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WorkflowStepSpec {
    #[serde(default)]
    pub code: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub character: Option<u32>,
    #[serde(default)]
    pub skill: Option<u32>,
    #[serde(default, rename = "targetCharacter")]
    pub target_character: Option<u32>,
    #[serde(default)]
    pub slot: Option<u32>,
    #[serde(default, rename = "summonSlot")]
    pub summon_slot: Option<u32>,
    #[serde(default)]
    pub optional: Option<bool>,
    #[serde(default, rename = "waitForNetwork")]
    pub wait_for_network: Option<String>,
    #[serde(default, rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
    #[serde(default, rename = "targetScore")]
    pub target_score: Option<u64>,
    #[serde(default, rename = "targetHpPct")]
    pub target_hp_pct: Option<f64>,
    #[serde(default)]
    pub ms: Option<u64>,
    #[serde(default, rename = "minMs")]
    pub min_ms: Option<u64>,
    #[serde(default, rename = "maxMs")]
    pub max_ms: Option<u64>,
    #[serde(default, rename = "repeatCount")]
    pub repeat_count: Option<u32>,
    #[serde(default, rename = "subSteps")]
    pub sub_steps: Vec<WorkflowStepSpec>,
}

impl WorkflowStepSpec {
    pub fn effective_op(&self) -> &str {
        if !self.code.is_empty() {
            self.code.as_str()
        } else {
            self.action.as_str()
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FullWorkflowTemplate {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "questUrl")]
    pub quest_url: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default, rename = "targetEnemy")]
    pub target_enemy: String,
    #[serde(default, rename = "targetRaidQuestId")]
    pub target_raid_quest_id: String,
    #[serde(default, rename = "raidSlot")]
    pub raid_slot: Option<u32>,
    #[serde(default, rename = "raidSlots")]
    pub raid_slots: Vec<u32>,
    #[serde(default, rename = "targetScore")]
    pub target_score: Option<u64>,
    #[serde(default, rename = "supporterPriority")]
    pub supporter_priority: Vec<String>,
    #[serde(default, rename = "minHpPct")]
    pub min_hp_pct: Option<f64>,
    #[serde(default, rename = "maxHpPct")]
    pub max_hp_pct: Option<f64>,
    #[serde(default, rename = "minPlayers")]
    pub min_players: Option<u32>,
    #[serde(default, rename = "maxPlayers")]
    pub max_players: Option<u32>,
    #[serde(default, rename = "defaultRuns")]
    pub default_runs: Option<u32>,
    #[serde(default, rename = "autoBerry")]
    pub auto_berry: Option<bool>,
    #[serde(default, rename = "autoElixir")]
    pub auto_elixir: Option<bool>,
    #[serde(default)]
    pub steps: Vec<WorkflowStepSpec>,
}

/// Resolves a preset or template name (e.g. `siete`, `seofon`, `raid-seofon`, `agastia`)
/// to its JSON path inside `templates_dir`.
pub fn resolve_template_path(templates_dir: &str, name_or_preset: &str) -> Option<PathBuf> {
    let clean = name_or_preset
        .trim()
        .to_ascii_lowercase()
        .trim_end_matches(".json")
        .to_string();

    let alias = match clean.as_str() {
        "siete" | "seofon" | "leech:siete" | "leech:seofon" => "raid-seofon",
        "agastia" | "leech:agastia" => "raid-agastia",
        "theworld" => "raid-the-world",
        "slime" | "shiny-slime" => "shiny-slime-search",
        "db:1star" => "dread-barrage-1star-otk",
        "db:2star" => "dread-barrage-2star-otk",
        "db:3star" | "db3" => "dread-barrage-3star-otk",
        "db:4star" => "dread-barrage-4star-fa",
        "db:5star" => "dread-barrage-5star-fa",
        other => other,
    };

    let base = Path::new(templates_dir);
    for candidate in [
        alias.to_string(),
        clean.clone(),
        format!("raid-{clean}"),
        format!("farm-{clean}"),
        format!("leech-{clean}"),
        format!("arcarum-{clean}"),
    ] {
        let p = base.join(format!("{candidate}.json"));
        if p.exists() {
            return Some(p);
        }
    }
    None
}

pub fn load_workflow_template(templates_dir: &str, name_or_preset: &str) -> Result<FullWorkflowTemplate, String> {
    let Some(path) = resolve_template_path(templates_dir, name_or_preset) else {
        return Err(format!(
            "Template '{name_or_preset}' not found in '{templates_dir}/'"
        ));
    };
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read template '{}': {e}", path.display()))?;
    serde_json::from_str::<FullWorkflowTemplate>(&raw)
        .map_err(|e| format!("Failed to parse template '{}': {e}", path.display()))
}

pub struct NativeCdpWorkflowRunner {
    pub ws: CdpWsClient,
    pub port: u16,
    pub template: FullWorkflowTemplate,
    pub current_score: u64,
    pub dead_raid_ids: HashSet<String>,
}

impl NativeCdpWorkflowRunner {
    /// Connects to Chrome on `port`, applies Layer 3 OS CPU governance, and installs Layer 2 Headless CDP Diet.
    pub fn connect_and_init(port: u16, template: FullWorkflowTemplate) -> Result<Self, String> {
        let governed_pids = apply_linux_chrome_cpu_governor(port, 38, 2);
        if governed_pids > 0 {
            println!(
                "[RustCDP] Layer 3 CPU Governor applied to {governed_pids} Chromium process(es) (max 38% of 2 vCPUs)."
            );
        }

        let (ws, target) = CdpWsClient::connect_to_gbf_page(port, 5000)?;
        println!(
            "[RustCDP] Connected to Chrome page target '{}' ({})",
            target.id, target.url
        );

        let mut runner = Self {
            ws,
            port,
            template,
            current_score: 0,
            dead_raid_ids: HashSet::new(),
        };
        runner.install_layer2_headless_diet()?;
        Ok(runner)
    }

    /// Installs Layer 2 Headless CPU Diet:
    /// - Minimal `Network.enable` buffer (`64 KB`)
    /// - `Network.setBlockedURLs` for audio & font bloat
    /// - `Emulation.setDeviceMetricsOverride` (`360x720` mobile touch viewport)
    /// - Persistent `Page.addScriptToEvaluateOnNewDocument` + immediate `Runtime.evaluate`
    pub fn install_layer2_headless_diet(&mut self) -> Result<(), String> {
        let _ = self.ws.call("Page.enable", json!({}), 2000);
        let _ = self.ws.call(
            "Network.enable",
            json!({
                "maxTotalBufferSize": 65536,
                "maxResourceBufferSize": 32768,
                "maxPostDataSize": 4096
            }),
            2000,
        );

        let mut blocked: Vec<&str> = AUDIO_DIET_BLOCKED_URLS.to_vec();
        blocked.extend_from_slice(&["*.woff2", "*.ttf", "*/assets/sound/*"]);
        let _ = self.ws.call(
            "Network.setBlockedURLs",
            json!({ "urls": blocked }),
            2000,
        );

        let _ = self.ws.call(
            "Emulation.setDeviceMetricsOverride",
            json!({
                "width": 360,
                "height": 720,
                "deviceScaleFactor": 1,
                "mobile": true
            }),
            2000,
        );
        let _ = self.ws.call(
            "Emulation.setTouchEmulationEnabled",
            json!({
                "enabled": true,
                "maxTouchPoints": 2
            }),
            2000,
        );
        let _ = self.ws.call(
            "Emulation.setFocusEmulationEnabled",
            json!({ "enabled": true }),
            2000,
        );

        // Register persistent script on the long-lived WebSocket connection (survives all F5 reloads!)
        self.ws.call(
            "Page.addScriptToEvaluateOnNewDocument",
            json!({ "source": LAYER2_HEADLESS_CPU_DIET_JS }),
            3000,
        )?;
        let _ = self.ws.eval_js(LAYER2_HEADLESS_CPU_DIET_JS, 3000);

        println!(
            "[RustCDP] Layer 2 Headless Diet active (1x1 Sprite Interceptor + 15 FPS rAF + 1 FPS Canvas Gate)."
        );
        Ok(())
    }

    pub fn set_cpu_phase(&mut self, phase: AutomationPhase) {
        let id = self.ws.next_id();
        let cmd = build_cpu_throttle_cdp_command(id, phase);
        let _ = self.ws.send_json(&cmd);
    }

    /// Checks whether a CAPTCHA verification modal is visible on screen.
    pub fn check_captcha(&mut self) -> bool {
        let expr = r#"(() => {
          const u = window.location.href.toLowerCase();
          if (u.includes('captcha') || u.includes('challenge')) return true;
          const pop = document.querySelector('.pop-usual.pop-show, .prt-popup-body');
          if (pop && pop.offsetParent !== null) {
            const txt = (pop.innerText || '').toLowerCase();
            if (txt.includes('verification') || txt.includes('認証') || txt.includes('画像')) return true;
          }
          return false;
        })()"#;
        self.ws
            .eval_js(expr, 1500)
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    /// Reads current battle state (`hash`, `isBattleEnded`, `turn`, `honors`, `bossHpPct`) in 1 atomic CDP eval.
    pub fn sync_combat_state(&mut self) -> (String, bool, u64, f64) {
        let expr = r#"(() => {
          const hash = window.location.hash || '';
          const stage = window.stage;
          const gStatus = stage && stage.gGameStatus;
          const pJsn = stage && stage.pJsnData;
          let honors = Number((pJsn && (pJsn.point || pJsn.honor)) || (gStatus && gStatus.point) || 0);
          if (!honors) {
            const ptEl = document.querySelector('.txt-point-value, .prt-point-value, .num-point');
            if (ptEl) {
              const cleaned = (ptEl.textContent || '').replace(/[^0-9]/g, '');
              if (cleaned) honors = parseInt(cleaned, 10) || 0;
            }
          }
          const rawBosses = (gStatus && gStatus.boss && gStatus.boss.param) || (pJsn && pJsn.boss && pJsn.boss.param) || [];
          const bosses = Array.isArray(rawBosses) ? rawBosses : Object.values(rawBosses);
          let hpPct = 100;
          let hasAliveBoss = false;
          if (bosses.length > 0) {
            const b = bosses[0];
            if (b) {
              const hp = Number(b.hp || 0);
              const hpmax = Number(b.hpmax || 1);
              hpPct = Math.max(0, Math.min(100, (hp / hpmax) * 100));
              if (hp > 0) hasAliveBoss = true;
            }
          }
          const hasResultDom = !!document.querySelector('.pop-raid-result, .prt-result-head, .btn-result, .prt-command-end');
          const ended = hash.includes('result') || !!(gStatus && gStatus.win) || !!(pJsn && (pJsn.is_clear || pJsn.finish)) || hasResultDom || (bosses.length > 0 && !hasAliveBoss);
          return { hash, ended, honors, hpPct };
        })()"#;

        if let Ok(val) = self.ws.eval_js(expr, 2500) {
            let hash = val
                .get("hash")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let ended = val.get("ended").and_then(|v| v.as_bool()).unwrap_or(false);
            let honors = val.get("honors").and_then(|v| v.as_u64()).unwrap_or(0);
            let hp_pct = val.get("hpPct").and_then(|v| v.as_f64()).unwrap_or(100.0);
            if honors > self.current_score {
                self.current_score = honors;
            }
            (hash, ended, self.current_score, hp_pct)
        } else {
            (String::new(), false, self.current_score, 100.0)
        }
    }

    /// Joins an Assist raid (`#quest/assist`) or starts a standard quest, selecting supporter summon and confirming deck.
    pub fn navigate_and_enter_combat(&mut self, run_num: u32) -> Result<bool, String> {
        let (init_hash, ended, _, _) = self.sync_combat_state();

        // If already in an active battle that hasn't ended, resume directly
        if (init_hash.starts_with("#raid") || init_hash.starts_with("#battle")) && !ended {
            println!("[Run {run_num}] [RustCDP] Active combat detected ({init_hash}). Entering step pipeline...");
            self.set_cpu_phase(AutomationPhase::ActiveCombat);
            return Ok(true);
        }

        // If lingering on result screen, confirm result first
        if init_hash.contains("result") || ended {
            let _ = self.handle_confirm_result();
        }

        self.set_cpu_phase(AutomationPhase::NavigationAndSearch);

        let is_assist = self.template.quest_url.contains("assist")
            || self.template.mode.eq_ignore_ascii_case("assist");

        if is_assist {
            let joined = self.search_and_join_assist_raid(run_num)?;
            if !joined {
                return Ok(false);
            }
        } else {
            let target_url = &self.template.quest_url;
            let nav_expr = format!("window.location.href = {}; true;", serde_json::to_string(target_url).unwrap());
            let _ = self.ws.eval_js(&nav_expr, 3000);
            thread::sleep(Duration::from_millis(850));
        }

        // Select supporter summon & confirm deck
        if !self.select_supporter_and_confirm()? {
            return Ok(false);
        }

        self.set_cpu_phase(AutomationPhase::ActiveCombat);
        Ok(true)
    }

    fn search_and_join_assist_raid(&mut self, run_num: u32) -> Result<bool, String> {
        let slot = self
            .template
            .raid_slot
            .or_else(|| self.template.raid_slots.first().copied())
            .unwrap_or(1);
        let min_hp = self.template.min_hp_pct.unwrap_or(25.0);
        let max_hp = self.template.max_hp_pct.unwrap_or(100.0);
        let quest_id = self.template.target_raid_quest_id.clone();
        let enemy_kw = self.template.target_enemy.to_ascii_lowercase();

        // Ensure we are on #quest/assist
        let nav_check = r#"(() => {
          const h = window.location.hash || '';
          if (h !== '#quest/assist' && h !== '#quest/assist/index') {
            window.location.href = 'https://game.granbluefantasy.jp/#quest/assist';
            return false;
          }
          return true;
        })()"#;
        let on_assist = self
            .ws
            .eval_js(nav_check, 2500)
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !on_assist {
            thread::sleep(Duration::from_millis(1200));
        }

        // Activate #tab-search and target slot
        let setup_slot_js = format!(
            r#"(() => {{
              const tab = document.querySelector('#tab-search, .btn-tabs#tab-search');
              if (tab && !tab.classList.contains('active')) {{
                const $ = window.$ || window.Zepto;
                if ($) $(tab).trigger('tap');
                tab.click();
              }}
              const slotBtn = document.querySelector('.btn-search-switch.slot{slot}, [data-slot="{slot}"].btn-search-switch');
              if (slotBtn && !slotBtn.classList.contains('active')) {{
                const $ = window.$ || window.Zepto;
                if ($) $(slotBtn).trigger('tap');
                slotBtn.click();
              }}
              return true;
            }})()"#
        );
        let _ = self.ws.eval_js(&setup_slot_js, 2500);
        thread::sleep(Duration::from_millis(550));

        let search_deadline = Instant::now() + Duration::from_secs(35);
        while Instant::now() < search_deadline {
            // Check and clear unclaimed pending battles if modal appears
            let _ = self.claim_unclaimed_if_needed();

            let scan_js = format!(
                r#"(() => {{
                  const cards = Array.from(document.querySelectorAll('#prt-search-list .btn-multi-raid.lis-raid.search, #prt-search-list .btn-multi-raid, .lis-raid.search'));
                  const qid = {qid_json};
                  const kw = {kw_json};
                  const minHp = {min_hp};
                  const maxHp = {max_hp};
                  const out = [];
                  for (let i = 0; i < cards.length; i++) {{
                    const el = cards[i];
                    if (!el || el.offsetParent === null) continue;
                    const titleEl = el.querySelector('.prt-raid-name, .txt-raid-name, .name, [class*="raid-name"]');
                    const title = ((titleEl ? titleEl.innerText : el.innerText) || '').toLowerCase();
                    const imgEl = el.querySelector('img');
                    const imgSrc = (imgEl && imgEl.src) ? imgEl.src : '';
                    if (qid && imgSrc && !imgSrc.includes(qid) && kw && !title.includes(kw)) continue;
                    const gauge = el.querySelector('.prt-raid-gauge-inner');
                    const hpPct = gauge && gauge.style && gauge.style.width ? parseFloat(gauge.style.width) : 100;
                    if (hpPct < minHp || hpPct > maxHp) continue;
                    const pEl = el.querySelector('.prt-flees-in');
                    const m = pEl && pEl.innerText ? pEl.innerText.match(/(\d+)\s*\/\s*(\d+)/) : null;
                    const players = m ? parseInt(m[1], 10) : 1;
                    const maxPlayers = m ? parseInt(m[2], 10) : 30;
                    if (players >= maxPlayers) continue;
                    const raidId = el.getAttribute('data-raid-id') || (el.dataset && el.dataset.raidId) || '';
                    const r = el.getBoundingClientRect();
                    if (r.width > 4 && r.height > 4) {{
                      out.push({{ index: i, raidId, hpPct, players, maxPlayers, x: r.left, y: r.top, w: r.width, h: r.height }});
                    }}
                  }}
                  return out;
                }})()"#,
                qid_json = serde_json::to_string(&quest_id).unwrap(),
                kw_json = serde_json::to_string(&enemy_kw).unwrap(),
                min_hp = min_hp,
                max_hp = max_hp,
            );

            if let Ok(Value::Array(candidates)) = self.ws.eval_js(&scan_js, 2500) {
                if let Some(best) = candidates.into_iter().find(|c| {
                    let rid = c.get("raidId").and_then(|v| v.as_str()).unwrap_or("");
                    rid.is_empty() || !self.dead_raid_ids.contains(rid)
                }) {
                    let raid_id = best
                        .get("raidId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let hp_pct = best.get("hpPct").and_then(|v| v.as_f64()).unwrap_or(100.0);
                    let players = best.get("players").and_then(|v| v.as_u64()).unwrap_or(1);
                    let x = best.get("x").and_then(|v| v.as_f64()).unwrap_or(120.0);
                    let y = best.get("y").and_then(|v| v.as_f64()).unwrap_or(260.0);
                    let w = best.get("w").and_then(|v| v.as_f64()).unwrap_or(100.0);
                    let h = best.get("h").and_then(|v| v.as_f64()).unwrap_or(45.0);

                    println!(
                        "[Run {run_num}] [RustCDP] Joining raid {raid_id} (HP: {hp_pct:.0}%, Players: {players})..."
                    );
                    let _ = self.ws.dispatch_humanized_tap(x, y, w, h);
                    thread::sleep(Duration::from_millis(650));

                    // Check if supporter screen mounted or popup appeared
                    let state_js = r#"(() => {
                      const h = window.location.hash || '';
                      if (h.includes('supporter') || document.querySelector('.btn-supporter, .lis-supporter')) return 'SUPPORTER';
                      if (h.startsWith('#raid') || h.startsWith('#battle')) return 'COMBAT';
                      const pop = document.querySelector('.pop-usual.pop-show, .prt-popup-body');
                      if (pop && pop.offsetParent !== null) {
                        const t = (pop.innerText || '').toLowerCase();
                        if (t.includes('full') || t.includes('ended') || t.includes('上限') || t.includes('終了')) {
                          const ok = pop.querySelector('.btn-usual-ok, .btn-usual-close');
                          if (ok) ok.click();
                          return 'FULL';
                        }
                        if (t.includes('unclaimed') || t.includes('pending') || t.includes('未確認')) {
                          const ok = pop.querySelector('.btn-usual-ok');
                          if (ok) ok.click();
                          return 'PENDING';
                        }
                      }
                      return 'WAIT';
                    })()"#;

                    for _ in 0..10 {
                        let st = self
                            .ws
                            .eval_js(state_js, 1500)
                            .ok()
                            .and_then(|v| v.as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| "WAIT".to_string());
                        match st.as_str() {
                            "SUPPORTER" | "COMBAT" => return Ok(true),
                            "FULL" => {
                                self.dead_raid_ids.insert(raid_id.clone());
                                break;
                            }
                            "PENDING" => {
                                let _ = self.claim_unclaimed_if_needed();
                                break;
                            }
                            _ => thread::sleep(Duration::from_millis(250)),
                        }
                    }
                }
            }

            // Click search refresh button
            let refresh_js = r#"(() => {
              const btn = document.querySelector('.btn-search-refresh, .btn-post-key, .btn-refresh-list');
              if (btn && btn.offsetParent !== null) {
                const $ = window.$ || window.Zepto;
                if ($) $(btn).trigger('tap');
                btn.click();
                return true;
              }
              return false;
            })()"#;
            let _ = self.ws.eval_js(refresh_js, 1500);
            thread::sleep(Duration::from_millis(700));
        }

        Ok(false)
    }

    fn claim_unclaimed_if_needed(&mut self) -> Result<(), String> {
        let check_js = r#"(() => {
          const h = window.location.hash || '';
          if (h.includes('unclaimed')) {
            const raid = document.querySelector('.btn-multi-raid.lis-raid, .lis-raid');
            if (raid && raid.offsetParent !== null) {
              const $ = window.$ || window.Zepto;
              if ($) $(raid).trigger('tap');
              raid.click();
              return 'CLICKED_UNCLAIMED';
            }
          }
          return 'NONE';
        })()"#;
        if let Ok(v) = self.ws.eval_js(check_js, 1500) {
            if v.as_str() == Some("CLICKED_UNCLAIMED") {
                thread::sleep(Duration::from_millis(900));
                let _ = self.handle_confirm_result();
            }
        }
        Ok(())
    }

    fn select_supporter_and_confirm(&mut self) -> Result<bool, String> {
        let priorities_json =
            serde_json::to_string(&self.template.supporter_priority).unwrap_or_else(|_| "[]".to_string());

        let deadline = Instant::now() + Duration::from_secs(12);
        while Instant::now() < deadline {
            let select_js = format!(
                r#"(() => {{
                  const h = window.location.hash || '';
                  if (h.startsWith('#raid') || h.startsWith('#battle')) return 'IN_COMBAT';

                  // Check if deck confirmation OK button is visible
                  const deckOk = document.querySelector('.pop-deck .btn-usual-ok, .prt-deck .btn-usual-ok, .btn-usual-ok.se-quest-start, .se-quest-start');
                  if (deckOk && deckOk.offsetParent !== null) {{
                    const r = deckOk.getBoundingClientRect();
                    const $ = window.$ || window.Zepto;
                    if ($) $(deckOk).trigger('tap');
                    deckOk.click();
                    return {{ state: 'DECK_OK', x: r.left, y: r.top, w: r.width, h: r.height }};
                  }}

                  // Check if supporter cards are visible
                  const cards = Array.from(document.querySelectorAll('.btn-supporter.lis-supporter, .lis-supporter, .btn-supporter')).filter(el => el.offsetParent !== null);
                  if (cards.length > 0) {{
                    const prio = {priorities_json};
                    let chosen = cards[0];
                    for (const p of prio) {{
                      const pLow = p.toLowerCase();
                      const match = cards.find(c => (c.innerText || '').toLowerCase().includes(pLow));
                      if (match) {{
                        chosen = match;
                        break;
                      }}
                    }}
                    const r = chosen.getBoundingClientRect();
                    const $ = window.$ || window.Zepto;
                    if ($) $(chosen).trigger('tap');
                    chosen.click();
                    return {{ state: 'SUPPORTER_CLICKED', x: r.left, y: r.top, w: r.width, h: r.height }};
                  }}

                  return 'WAITING';
                }})()"#
            );

            if let Ok(res) = self.ws.eval_js(&select_js, 2000) {
                if res.as_str() == Some("IN_COMBAT") {
                    return Ok(true);
                }
                if let Some(st) = res.get("state").and_then(|v| v.as_str()) {
                    let x = res.get("x").and_then(|v| v.as_f64()).unwrap_or(160.0);
                    let y = res.get("y").and_then(|v| v.as_f64()).unwrap_or(320.0);
                    let w = res.get("w").and_then(|v| v.as_f64()).unwrap_or(80.0);
                    let h = res.get("h").and_then(|v| v.as_f64()).unwrap_or(40.0);
                    let _ = self.ws.dispatch_humanized_tap(x, y, w.max(10.0), h.max(10.0));
                    if st == "DECK_OK" {
                        // Wait up to 8s for #raid / #battle hash
                        for _ in 0..25 {
                            thread::sleep(Duration::from_millis(300));
                            let (hash, _, _, _) = self.sync_combat_state();
                            if hash.starts_with("#raid") || hash.starts_with("#battle") {
                                return Ok(true);
                            }
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(300));
        }

        let (hash, _, _, _) = self.sync_combat_state();
        Ok(hash.starts_with("#raid") || hash.starts_with("#battle"))
    }

    /// Executes a single declarative `WorkflowStepSpec` in native Rust over CDP.
    /// Returns `Ok(true)` if the combat pipeline should exit early (e.g. `exit_if_score` threshold reached or battle ended).
    pub fn execute_step(
        &mut self,
        step: &WorkflowStepSpec,
        step_idx: usize,
        total_steps: usize,
        run_num: u32,
    ) -> Result<bool, String> {
        let op = step.effective_op().trim().to_ascii_lowercase();
        let label = if step.name.is_empty() {
            op.as_str()
        } else {
            step.name.as_str()
        };

        let (_, ended, honors, _) = self.sync_combat_state();
        if ended && op != "confirm_result" {
            println!(
                "[Run {run_num}] [RustCDP] Battle ended before Step {step_idx}/{total_steps} ({label}). Honors: {honors}"
            );
            return Ok(true);
        }

        println!("[Run {run_num}] [RustCDP] Step {step_idx}/{total_steps}: {op} ({label})");

        match op.as_str() {
            "wait_element" => {
                let selector = step.target.as_deref().unwrap_or(".btn-attack-start");
                let timeout_ms = step.timeout_ms.unwrap_or(8000);
                let deadline = Instant::now() + Duration::from_millis(timeout_ms);
                let sel_json = serde_json::to_string(selector).unwrap();
                let check_js = format!(
                    r#"(() => {{
                      const stage = window.stage;
                      if (stage && stage.gGameStatus) {{
                        stage.gGameStatus.lock = false;
                        stage.gGameStatus.btn_lock = false;
                        stage.gGameStatus.animation = false;
                      }}
                      const el = document.querySelector({sel_json});
                      if (el && el.offsetParent !== null) return true;
                      if (document.querySelector('.pop-raid-result, .prt-result-head, .btn-result')) return true;
                      return false;
                    }})()"#
                );
                while Instant::now() < deadline {
                    if self
                        .ws
                        .eval_js(&check_js, 1500)
                        .ok()
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                    {
                        break;
                    }
                    thread::sleep(Duration::from_millis(180));
                }
                Ok(false)
            }
            "reload" | "f5" => {
                let _ = self.ws.call("Page.reload", json!({ "ignoreCache": false }), 4000);
                thread::sleep(Duration::from_millis(450));
                let _ = self.ws.eval_js(LAYER2_HEADLESS_CPU_DIET_JS, 2000);
                Ok(false)
            }
            "skill" => {
                let c = step.character.unwrap_or(1);
                let s = step.skill.unwrap_or(1);
                let target_char = step.target_character.unwrap_or(1).saturating_sub(1);
                let net_sub = step
                    .wait_for_network
                    .as_deref()
                    .unwrap_or("ability_result.json");

                // Single-roundtrip atomic skill readiness & cast trigger
                let cast_js = format!(
                    r#"(() => {{
                      const cNum = {c};
                      const sNum = {s};
                      const charIdx = cNum - 1;
                      const stage = window.stage;
                      if (stage && stage.gGameStatus) {{
                        stage.gGameStatus.lock = false;
                        stage.gGameStatus.btn_lock = false;
                        stage.gGameStatus.animation = false;
                      }}
                      const pJsn = stage && stage.pJsnData;
                      const abilityMap = (pJsn && pJsn.ability) || {{}};
                      const charObj = abilityMap[String(cNum)] || abilityMap[String(charIdx)];
                      if (charObj && charObj.list) {{
                        const ab = charObj.list[String(sNum)];
                        const data = Array.isArray(ab) ? ab[0] : ab;
                        if (data) {{
                          const recast = String(data['ability-recast'] ?? '');
                          if (recast !== '0' && recast !== '' || data['requirement_result_flag'] === false) {{
                            return {{ status: 'COOLDOWN', recast }};
                          }}
                        }}
                      }}

                      const $ = window.$ || window.Zepto;
                      // Open character drawer if not open
                      const charBtn = document.querySelector(`.lis-character${{charIdx}}.btn-command-character, .lis-character${{charIdx}}, .btn-command-character[pos="${{charIdx}}"]`);
                      if (charBtn && charBtn.offsetParent !== null) {{
                        if ($) $(charBtn).trigger('tap');
                        charBtn.click();
                      }}

                      const sels = [
                        `.ability-character-num-${{cNum}}-${{sNum}} .btn-ability-available`,
                        `.ability-character-num-${{cNum}}-${{sNum}}`,
                        `.prt-command-chara.chara${{cNum}} .prt-ability-list .lis-ability[pos="${{sNum - 1}}"]`,
                        `.prt-command-chara.chara${{cNum}} .prt-ability-list .lis-ability:nth-child(${{sNum}})`
                      ];
                      for (const sel of sels) {{
                        const el = document.querySelector(sel);
                        if (!el) continue;
                        const container = el.closest('.lis-ability') || el;
                        if (container.classList.contains('btn-ability-unavailable') || container.classList.contains('btn-ability-off')) {{
                          return {{ status: 'COOLDOWN', recast: 'dom' }};
                        }}
                        if ($) {{
                          $(container).trigger('tap');
                          $(el).trigger('tap');
                        }}
                        el.click();
                        container.click();

                        const ok = document.querySelector('.btn-usual-ok.btn-ability-use, .btn-usual-ok.se-ability-use');
                        if (ok && ok.offsetParent !== null) {{
                          if ($) $(ok).trigger('tap');
                          ok.click();
                        }}
                        return {{ status: 'CAST' }};
                      }}
                      return {{ status: 'NOT_FOUND' }};
                    }})()"#
                );

                if let Ok(res) = self.ws.eval_js(&cast_js, 3000) {
                    let st = res.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    if st == "CAST" {
                        let _ = self.ws.wait_for_network_substr(net_sub, 2600);
                        // Handle target character popup & fast-tick CreateJS
                        let post_js = format!(
                            r#"(() => {{
                              const pop = document.querySelector('.pop-usual, .prt-popup-body, .pop-target');
                              if (pop && pop.offsetParent !== null) {{
                                const t = pop.querySelector('.lis-character{target_char}, .btn-command-character[pos="{target_char}"]');
                                if (t) {{
                                  const $ = window.$ || window.Zepto;
                                  if ($) $(t).trigger('tap');
                                  t.click();
                                }}
                              }}
                              if (window.createjs && window.createjs.Tween && window.createjs.Tween.tick) {{
                                window.createjs.Tween.tick(2500, false);
                              }}
                              if (window.stage && window.stage.gGameStatus) {{
                                window.stage.gGameStatus.lock = false;
                                window.stage.gGameStatus.btn_lock = false;
                                window.stage.gGameStatus.animation = false;
                              }}
                            }})()"#
                        );
                        let _ = self.ws.eval_js(&post_js, 1500);
                    }
                }
                Ok(false)
            }
            "summon" | "quick_call" => {
                let slot = step.summon_slot.or(step.slot).unwrap_or(1);
                let net_sub = step
                    .wait_for_network
                    .as_deref()
                    .unwrap_or("summon_result.json");

                let summon_js = if op == "quick_call" {
                    r#"(() => {
                      const qs = document.querySelector('.btn-quick-summon:not(.off):not(.unavailable)');
                      if (!qs || qs.offsetParent === null) return false;
                      const $ = window.$ || window.Zepto;
                      if ($) $(qs).trigger('tap');
                      qs.click();
                      return true;
                    })()"#
                        .to_string()
                } else {
                    format!(
                        r#"(() => {{
                          const $ = window.$ || window.Zepto;
                          const trayBtn = document.querySelector('.btn-command-summon');
                          if (trayBtn && trayBtn.offsetParent !== null) {{
                            if ($) $(trayBtn).trigger('tap');
                            trayBtn.click();
                          }}
                          const card = document.querySelector('.lis-summon[pos="{slot}"], .lis-summon:nth-child({slot})');
                          if (!card || card.classList.contains('btn-summon-unavailable') || card.classList.contains('off')) return false;
                          if ($) $(card).trigger('tap');
                          card.click();
                          const ok = document.querySelector('.btn-usual-ok.btn-summon-use, .pop-summon-detail .btn-usual-ok, #pop .btn-usual-ok');
                          if (ok && ok.offsetParent !== null) {{
                            if ($) $(ok).trigger('tap');
                            ok.click();
                          }}
                          return true;
                        }})()"#
                    )
                };

                if self
                    .ws
                    .eval_js(&summon_js, 2500)
                    .ok()
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    let _ = self.ws.wait_for_network_substr(net_sub, 2800);
                }
                Ok(false)
            }
            "attack" => {
                let net_sub = step
                    .wait_for_network
                    .as_deref()
                    .unwrap_or("normal_attack_result.json");
                let atk_js = r#"(() => {
                  const stage = window.stage;
                  if (stage && stage.gGameStatus) {
                    stage.gGameStatus.lock = false;
                    stage.gGameStatus.btn_lock = false;
                    stage.gGameStatus.animation = false;
                  }
                  const btn = document.querySelector('.btn-attack-start.display-on, .btn-attack-start');
                  if (!btn || btn.offsetParent === null) return null;
                  const r = btn.getBoundingClientRect();
                  const $ = window.$ || window.Zepto;
                  if ($) $(btn).trigger('tap');
                  btn.click();
                  return { x: r.left, y: r.top, w: r.width, h: r.height };
                })()"#;

                if let Ok(val) = self.ws.eval_js(atk_js, 2500) {
                    if let (Some(x), Some(y), Some(w), Some(h)) = (
                        val.get("x").and_then(|v| v.as_f64()),
                        val.get("y").and_then(|v| v.as_f64()),
                        val.get("w").and_then(|v| v.as_f64()),
                        val.get("h").and_then(|v| v.as_f64()),
                    ) {
                        if w > 4.0 && h > 4.0 {
                            let _ = self.ws.dispatch_humanized_tap(x, y, w, h);
                        }
                    }
                    let _ = self.ws.wait_for_network_substr(net_sub, 3500);
                }
                Ok(false)
            }
            "exit_if_score" => {
                let threshold = step
                    .target_score
                    .or(self.template.target_score)
                    .unwrap_or(4_000_000);
                let (_, ended, honors, _) = self.sync_combat_state();
                if ended || honors >= threshold {
                    println!(
                        "[Run {run_num}] [RustCDP] Target score reached ({honors} >= {threshold} pt). Exiting combat pipeline early!"
                    );
                    return Ok(true);
                }
                Ok(false)
            }
            "exit_if_dead" | "exit_if_hp" => {
                let target_hp = step.target_hp_pct.unwrap_or(0.0);
                let (_, ended, _, hp_pct) = self.sync_combat_state();
                if ended || hp_pct <= target_hp {
                    println!(
                        "[Run {run_num}] [RustCDP] Boss HP threshold met ({hp_pct:.1}% <= {target_hp:.1}%). Exiting combat early!"
                    );
                    return Ok(true);
                }
                Ok(false)
            }
            "wait" => {
                let ms = step.ms.unwrap_or(500);
                thread::sleep(Duration::from_millis(ms));
                Ok(false)
            }
            "wait_random" => {
                let min_ms = step.min_ms.unwrap_or(300) as u32;
                let max_ms = step.max_ms.unwrap_or(800) as u32;
                let delay = motor::sample_log_normal_delay(
                    ((min_ms + max_ms) / 2) as f64,
                    0.25,
                    1,
                    false,
                )
                .clamp(min_ms, max_ms.max(min_ms));
                thread::sleep(Duration::from_millis(delay as u64));
                Ok(false)
            }
            "repeat" => {
                let count = step.repeat_count.unwrap_or(1);
                for _ in 0..count {
                    for (sub_idx, sub) in step.sub_steps.iter().enumerate() {
                        if self.execute_step(sub, sub_idx + 1, step.sub_steps.len(), run_num)? {
                            return Ok(true);
                        }
                    }
                }
                Ok(false)
            }
            "confirm_result" => {
                let _ = self.handle_confirm_result();
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    pub fn handle_confirm_result(&mut self) -> Result<(), String> {
        let confirm_js = r#"(() => {
          const btns = document.querySelectorAll('.btn-usual-ok, .btn-usual-close, .btn-control, .btn-result');
          let clicked = 0;
          const $ = window.$ || window.Zepto;
          for (const b of btns) {
            if (b.offsetParent !== null) {
              if ($) $(b).trigger('tap');
              b.click();
              clicked++;
            }
          }
          return clicked;
        })()"#;
        let _ = self.ws.eval_js(confirm_js, 2000);
        thread::sleep(Duration::from_millis(450));
        Ok(())
    }

    /// Executes the full multi-run workflow loop (`1..=runs`) in native Rust.
    pub fn run_loop(&mut self, max_runs: u32) -> Result<u32, String> {
        let total_runs = max_runs.max(1);
        let mut completed = 0;

        println!(
            "========================================================================\n\
             [RustCDP] Native Workflow Engine Started: {}\n\
             [RustCDP] Target Runs: {total_runs} | CDP Port: {}\n\
             ========================================================================",
            self.template.name, self.port
        );

        for run_num in 1..=total_runs {
            if self.check_captcha() {
                return Err("CAPTCHA / Verification challenge detected! Halting immediately.".to_string());
            }

            self.current_score = 0;
            let entered = self.navigate_and_enter_combat(run_num)?;
            if !entered {
                println!(
                    "[Run {run_num}] [RustCDP] No eligible raid found in pass; entering brief 5s low-CPU standby..."
                );
                self.set_cpu_phase(AutomationPhase::StandbyIdle);
                thread::sleep(Duration::from_secs(5));
                continue;
            }

            let steps = self.template.steps.clone();
            let total_steps = steps.len();
            for (idx, step) in steps.iter().enumerate() {
                if self.check_captcha() {
                    return Err("CAPTCHA / Verification challenge detected mid-combat!".to_string());
                }
                let early_exit = self.execute_step(step, idx + 1, total_steps, run_num)?;
                if early_exit {
                    break;
                }
            }

            let _ = self.handle_confirm_result();
            completed += 1;
            println!(
                "[Run {run_num}/{total_runs}] [RustCDP] Run completed (Honors: {} pt).",
                self.current_score
            );

            let inter_delay = motor::sample_inter_run_delay(1, false);
            thread::sleep(Duration::from_millis(inter_delay.clamp(250, 1200) as u64));
        }

        self.set_cpu_phase(AutomationPhase::StandbyIdle);
        Ok(completed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_and_load_raid_seofon_template() {
        // Test from workspace root or crate dir
        let templates_dir = if Path::new("templates").exists() {
            "templates"
        } else {
            "../../templates"
        };

        let resolved = resolve_template_path(templates_dir, "siete")
            .expect("Should resolve 'siete' alias to raid-seofon.json");
        assert!(resolved.to_string_lossy().contains("raid-seofon.json"));

        let tmpl = load_workflow_template(templates_dir, "siete")
            .expect("Should parse templates/raid-seofon.json");
        assert_eq!(tmpl.target_raid_quest_id, "305411");
        assert_eq!(tmpl.target_score, Some(4_000_000));
        assert_eq!(tmpl.steps.len(), 35);
        assert_eq!(tmpl.steps[0].effective_op(), "wait_element");
        assert_eq!(tmpl.steps[1].effective_op(), "reload");
        assert_eq!(tmpl.steps[2].effective_op(), "skill");
    }

    #[test]
    fn test_layer2_diet_script_contains_sprite_interceptor_and_raf_decoupler() {
        assert!(LAYER2_HEADLESS_CPU_DIET_JS.contains("__gbfLayer2SpriteDietInstalled"));
        assert!(LAYER2_HEADLESS_CPU_DIET_JS.contains("R0lGODlhAQABAIAAAAAAAP"));
        assert!(LAYER2_HEADLESS_CPU_DIET_JS.contains("__gbfRafThrottled15Fps"));
        assert!(LAYER2_HEADLESS_CPU_DIET_JS.contains("shouldPaintNow"));
    }

    #[test]
    fn test_all_templates_load_and_parse_cleanly() {
        let templates_dir = if Path::new("templates").exists() {
            "templates"
        } else {
            "../../templates"
        };
        for alias in ["siete", "seofon", "agastia", "slime", "db:3star"] {
            let tmpl = load_workflow_template(templates_dir, alias)
                .unwrap_or_else(|e| panic!("Failed to load alias '{alias}': {e}"));
            assert!(!tmpl.steps.is_empty(), "Template '{alias}' should have steps");
        }
    }

    #[test]
    fn test_e2e_native_cdp_workflow_runner_against_mock_chrome() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let server = thread::spawn(move || {
            // Connection 1: HTTP GET /json/list
            let (mut http_stream, _) = listener.accept().unwrap();
            let mut req_buf = [0u8; 1024];
            let _ = http_stream.read(&mut req_buf).unwrap();
            let json_list = format!(
                r#"[{{"id":"gbf1","type":"page","title":"Granblue Fantasy","url":"https://game.granbluefantasy.jp/#raid_multi/42337095880","webSocketDebuggerUrl":"ws://127.0.0.1:{port}/devtools/page/gbf1"}}]"#
            );
            let http_resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                json_list.len(),
                json_list
            );
            http_stream.write_all(http_resp.as_bytes()).unwrap();
            drop(http_stream);

            // Connection 2: RFC 6455 WebSocket session
            let (mut ws_stream, _) = listener.accept().unwrap();
            let _ = ws_stream.read(&mut req_buf).unwrap();
            let ws_handshake = "HTTP/1.1 101 Switching Protocols\r\n\
                                Upgrade: websocket\r\n\
                                Connection: Upgrade\r\n\
                                Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";
            ws_stream.write_all(ws_handshake.as_bytes()).unwrap();

            // Serve incoming JSON-RPC frames until client disconnects
            loop {
                let mut hdr = [0u8; 2];
                if ws_stream.read_exact(&mut hdr).is_err() {
                    break;
                }
                let mut len = (hdr[1] & 0x7F) as usize;
                if len == 126 {
                    let mut ext = [0u8; 2];
                    ws_stream.read_exact(&mut ext).unwrap();
                    len = u16::from_be_bytes(ext) as usize;
                } else if len == 127 {
                    let mut ext = [0u8; 8];
                    ws_stream.read_exact(&mut ext).unwrap();
                    len = u64::from_be_bytes(ext) as usize;
                }
                let mut mask = [0u8; 4];
                ws_stream.read_exact(&mut mask).unwrap();
                let mut payload = vec![0u8; len];
                ws_stream.read_exact(&mut payload).unwrap();
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= mask[i & 3];
                }

                let Ok(req) = serde_json::from_slice::<Value>(&payload) else {
                    continue;
                };
                let Some(rpc_id) = req.get("id").and_then(|v| v.as_u64()) else {
                    continue;
                };
                let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
                let expr = req
                    .get("params")
                    .and_then(|p| p.get("expression"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                let result_val = if method == "Runtime.evaluate" {
                    if expr.contains("const hash = window.location.hash") {
                        json!({ "result": { "value": { "hash": "#raid_multi/42337095880", "ended": false, "honors": 4_250_000_u64, "hpPct": 55.0 } } })
                    } else if expr.contains("window.location.href.toLowerCase()") {
                        json!({ "result": { "value": false } })
                    } else if expr.contains("status: 'CAST'") {
                        json!({ "result": { "value": { "status": "CAST" } } })
                    } else if expr.contains(".btn-attack-start") && expr.contains("getBoundingClientRect") {
                        json!({ "result": { "value": { "x": 240.0, "y": 420.0, "w": 60.0, "h": 30.0 } } })
                    } else {
                        json!({ "result": { "value": true } })
                    }
                } else {
                    json!({})
                };

                let reply = json!({
                    "id": rpc_id,
                    "result": result_val
                });
                let reply_bytes = serde_json::to_vec(&reply).unwrap();
                let mut frame = vec![0x81];
                if reply_bytes.len() < 126 {
                    frame.push(reply_bytes.len() as u8);
                } else {
                    frame.push(126);
                    frame.extend_from_slice(&(reply_bytes.len() as u16).to_be_bytes());
                }
                frame.extend_from_slice(&reply_bytes);
                let _ = ws_stream.write_all(&frame);

                // Also emit simulated network completion event when skill or attack was cast
                if expr.contains("status: 'CAST'") || expr.contains("getBoundingClientRect") {
                    let net_ev = br#"{"method":"Network.responseReceived","params":{"response":{"url":"https://game.granbluefantasy.jp/rest/multiraid/ability_result.json/normal_attack_result.json"}}}"#;
                    let mut nf = vec![0x81, 126];
                    nf.extend_from_slice(&(net_ev.len() as u16).to_be_bytes());
                    nf.extend_from_slice(net_ev);
                    let _ = ws_stream.write_all(&nf);
                }
            }
        });

        let mock_template = FullWorkflowTemplate {
            name: "Mock Seofon E2E".to_string(),
            description: "E2E test".to_string(),
            quest_url: "https://game.granbluefantasy.jp/#quest/assist".to_string(),
            mode: "assist".to_string(),
            target_enemy: "Seofon".to_string(),
            target_raid_quest_id: "305411".to_string(),
            raid_slot: Some(1),
            raid_slots: vec![1],
            target_score: Some(4_000_000),
            supporter_priority: vec!["Agni".to_string()],
            min_hp_pct: Some(35.0),
            max_hp_pct: Some(100.0),
            min_players: Some(1),
            max_players: Some(6),
            default_runs: Some(1),
            auto_berry: Some(true),
            auto_elixir: Some(false),
            steps: vec![
                WorkflowStepSpec {
                    code: "wait_element".to_string(),
                    action: String::new(),
                    name: "Wait Ready".to_string(),
                    target: Some(".btn-attack-start".to_string()),
                    character: None,
                    skill: None,
                    target_character: None,
                    slot: None,
                    summon_slot: None,
                    optional: None,
                    wait_for_network: None,
                    timeout_ms: Some(1000),
                    target_score: None,
                    target_hp_pct: None,
                    ms: None,
                    min_ms: None,
                    max_ms: None,
                    repeat_count: None,
                    sub_steps: vec![],
                },
                WorkflowStepSpec {
                    code: "skill".to_string(),
                    action: String::new(),
                    name: "C1S2".to_string(),
                    target: None,
                    character: Some(1),
                    skill: Some(2),
                    target_character: None,
                    slot: None,
                    summon_slot: None,
                    optional: Some(true),
                    wait_for_network: Some("ability_result.json".to_string()),
                    timeout_ms: None,
                    target_score: None,
                    target_hp_pct: None,
                    ms: None,
                    min_ms: None,
                    max_ms: None,
                    repeat_count: None,
                    sub_steps: vec![],
                },
                WorkflowStepSpec {
                    code: "exit_if_score".to_string(),
                    action: String::new(),
                    name: "Exit at 4M".to_string(),
                    target: None,
                    character: None,
                    skill: None,
                    target_character: None,
                    slot: None,
                    summon_slot: None,
                    optional: None,
                    wait_for_network: None,
                    timeout_ms: None,
                    target_score: Some(4_000_000),
                    target_hp_pct: None,
                    ms: None,
                    min_ms: None,
                    max_ms: None,
                    repeat_count: None,
                    sub_steps: vec![],
                },
            ],
        };

        let mut runner = NativeCdpWorkflowRunner::connect_and_init(port, mock_template)
            .expect("Should connect and install Layer 2 diet against mock Chrome");
        let completed = runner.run_loop(1).expect("Should execute 1 run cleanly");
        assert_eq!(completed, 1);
        assert_eq!(runner.current_score, 4_250_000);
        drop(runner);
        let _ = server.join();
    }
}
