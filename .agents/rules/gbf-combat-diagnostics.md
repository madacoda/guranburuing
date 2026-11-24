# GBF Live Combat DOM & Forensic Diagnostics

Always verify behavior against live Granblue Fantasy DOM, XHR payloads, and runtime state rather than guesses or fake mock DOMs. Deep reference: [`strategies/principles/16_gbf_live_combat_dom_and_diagnostics.md`](../../strategies/principles/16_gbf_live_combat_dom_and_diagnostics.md).

## 1. Live Battle DOM Truths
- **Shared Back Button**: `.btn-command-back.display-on` turns ON for BOTH open character ability drawers (`.prt-command-chara.chara1..4`) and the open summon tray (`.prt-command-summon`).
- **Summon Tray Opening**: `.lis-summon` keeps `offsetWidth > 0` even when closed. Open deterministically with `Back OFF -> Tap .btn-command-summon -> Wait for Back ON / .summon-on`. Always dismiss `.btn-command-back.display-on` after non-reload summons.
- **Summon Confirm Modal**: Confirm summon cast via `.btn-usual-ok.btn-summon-use` inside `.pop-summon-detail` (never bare `.btn-summon-use`, which matches tray cards).
- **Quick Summon**: Before tapping `.btn-quick-summon` / `#js-btn-quick-summon`, wait until `.btn-command-back.display-on` is OFF (exposes HUD after skill steps). Dispatch ONE Zepto `tap` on attempt 1 (`humanizedClick` fallback on retries); never fire both in the same attempt.
- **0-Based vs 1-Based Indexing**:
  - Skill slots in `.prt-ability-list .lis-ability[pos]` are **0-indexed** (`pos="0".."3"`), whereas class `.ability-character-num-<c>-<s>` is **1-indexed**.
  - Summon cards in `.prt-summon-list .lis-summon[pos]` are **1-indexed** (`pos="1".."5"`), with Slot 6 = `.lis-summon.supporter`.

## 2. Runtime State & Server Confirmation
- **`pJsnData` vs `gGameStatus`**: `stage.pJsnData` is the page-load snapshot (becomes stale after mid-turn swaps like Death -> Nier). `stage.gGameStatus` tracks live runtime flags (`lock`, `btn_lock`, `attacking`, `ability_turn`, `summon_enable`, `turn`, `win`).
- **Authoritative Server Confirmation**: Requires matching XHR (`ability_result.json`, `summon_result.json`, `normal_attack_result.json`) with `Array.isArray(json.scenario) && json.scenario.length > 0 && !json.popup`.
- **Server Lockout Rejection**: HTTP 200 `{ popup, scenario: [] }` is a **rejection/lockout** (NEVER a successful cast). Dismiss lockout popup and retry.
- **Pre-Reload Fast-Confirm**: When the very next step is `reload`/`f5` and server confirmed `summon_result.json` (or `normal_attack_result.json`), skip post-animation DOM settling so F5 cancels the animation immediately.

## 3. GBF Combat Mechanics & Cascade Signatures
- **Death / Backline Swap Cascades**: Calling Death KOs C4, swaps in backline Nier (4 skills), and triggers ally-KO cooldown resets. If downstream C4S1/C4S3 skip with pre-swap skill names, C4S4 times out (pre-swap slot lacks a 4th skill), or C2S1/C2S2 stay on cooldown, the root cause is the **upstream swap summon / Quick Call or missing post-swap `reload`**, never the downstream skill.
- **Lockout & Reload (`リロ殴り`)**: Attack/CA lockout (~1.01s base + normal/CA chain duration) is **account-wide on Cygames servers**. F5 reload cancels client animations and fetches fresh `start.json` (syncing swapped characters), after which `handleReload` must await `waitForCombatInputReady`.
- **No Same-Battle 2-Tab Ping-Pong**: Tab 2 holds stale `stage.pJsnData` until reloaded after Tab 1 acts and hits the same account-wide server lockout — causes desync popups (`Waiting for last turn`) with 0ms gain.
- **Guild War Rules**: Unclaimed battles (`未確認バトル`) block the next quest at 1 pending battle (`confirm_result` cannot be skipped between GW runs). All `ensureCast: true` steps in GW are strictly FATAL.

## 4. 1-Pass Forensic Debugging SOP
1. Inspect `data/step-audit-ledger.json` or run `bun run step:audit <workflow>` before touching code.
2. Fix the **earliest** failing, no-op, or skipped step first (trace downstream cascades upstream).
3. Probe the **live Chrome CDP DOM/XHR** when selectors or flags are unclear — never guess selectors or create per-template mock-DOM tests (`tests/test-<template>.ts`).
4. Verify with **`--runs 2`** consecutive fresh 100% HP live runs + `bun run step:audit` before claiming `"all fixed"` (resumed Run 1 can skip Turn-1 summon checks and mask fresh Run 2 failures).

## 5. False Positive / False Negative Guardrails
- **False Positives (Do NOT Misdiagnose):**
  - `Recast: 0->0` + `noopMutationCount: 1` on `CONFIRMED_NETWORK` buff skills is normal (`pJsnData` stays stale until reload).
  - `RETRY_HEAVY` (1–3 retries) strictly on the first skill after `Attack -> Reload` is account-wide server attack lockout, not a broken skill selector (post-Summon reload confirms Attempt 1).
  - Downstream `C4S4` `FAILED_TIMEOUT` or `C2/C4` cooldown skips indicate an upstream swap-summon/Quick-Call/reload failure (`RC-2`), not broken C4S4 code.
- **False Negatives (Never Trust as "Working"):**
  - `.lis-summon` `offsetParent !== null && offsetWidth > 0` while tray is closed -> must check `.btn-command-back.display-on` / `.summon-on`.
  - HTTP 200 `{ popup, scenario: [] }` -> lockout rejection, NEVER confirmed.
  - Passing mock-DOM tests, `typecheck`, `--dry-run`, or a single resumed Run 1 -> never proof of live stability.
- **Full Evidence Ledger:** [`strategies/COMBAT_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md`](../../strategies/COMBAT_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md).
