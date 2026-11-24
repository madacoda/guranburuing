# Principle 16: Live Battle DOM, Server Sync & Forensic Combat Diagnostics

This volume documents the verified live Granblue Fantasy browser DOM, CreateJS/Zepto runtime state, server confirmation semantics, account-wide lockout rules, and step-audit triage playbook learned from production Guild War debugging.

> Always verify assumptions against the live Chrome CDP session and `data/step-audit-ledger.json` rather than mock DOM fixtures.

---

## 1. Live Battle DOM Architecture & Verified Selectors

Granblue Fantasy combat renders inside a Zepto/Backbone SPA layered with CreateJS canvas animations. Many container nodes remain mounted in the DOM with non-zero bounding boxes even when visually collapsed.

### 1.1 Verified Combat DOM Selector Matrix

| UI Region / Action | Verified Live Selector(s) | Critical Gotcha / Rule |
| :--- | :--- | :--- |
| **Attack / Ready Button** | `.btn-attack-start`, `.btn-attack-start.display-on` | Use `.btn-attack-start` (not bare `.btn-attack`). Also toggles auto/attack readiness. |
| **Shared Drawer Back Button** | `.btn-command-back`, `.btn-command-back.display-on` | Turns ON for **both** character ability drawers (`.prt-command-chara.chara1..4`) and the summon tray (`.prt-command-summon`). Must be OFF to know you are on the top Main Command HUD. |
| **Summon Tray Open Button** | `.prt-list-top.btn-command-summon`, `.btn-command-summon` | Gets `.summon-on` when open. Tap only from top-level HUD (after `.btn-command-back.display-on` is OFF). |
| **Summon Tray Container** | `.prt-command-summon` | Opens asynchronously with CreateJS tween; check `summon-on` / `summon-show` / `display-on` or `.btn-command-back.display-on`. |
| **Summon Slot Cards (1–6)** | Slots 1–5: `.prt-summon-list .lis-summon[pos="1".."5"]`<br>Slot 6 (Friend): `.lis-summon.supporter`, `.lis-summon[pos="6"]` | **1-indexed**! `.lis-summon` retains `offsetWidth > 0` even while tray is closed — never use `.lis-summon` visibility alone as proof the tray is open. |
| **Summon Confirm Button** | `.pop-summon-detail .btn-usual-ok.btn-summon-use`, `#pop .btn-usual-ok.btn-summon-use` | **Never** select bare `.btn-summon-use` — it matches the tray card and fails to confirm the detail modal. |
| **Quick Summon Button** | `.btn-quick-summon`, `#js-btn-quick-summon` | Lives on top-level HUD (blocked/hidden behind open character drawers). Wait for `.btn-command-back.display-on` OFF first. Used states: `.btn-summon-unavailable`, `.off`, `.disabled`, `aria-disabled="true"`, `opacity: 0.5`. |
| **Character Portraits** | `.lis-character0`..`3`, `.prt-member .btn-command-character[pos="0".."3"]` | **0-indexed** (`pos = char - 1`). |
| **Skill Slots** | `.ability-character-num-<c>-<s>` (1-indexed)<br>`.prt-command-chara.chara<c> .prt-ability-list .lis-ability[pos="<s-1>"]` (0-indexed) | `.ability-character-num-<c>-<s>` is 1-indexed (`4-1`..`4-4`); `.lis-ability[pos]` is **0-indexed** (`pos="0".."3"`). Unavailable classes: `.btn-ability-unavailable`, `.btn-ability-off`, `.tmp-unusable`. |
| **Target Ally Modal** | `.pop-target-character`, `.prt-target-list` | Triggered by targeted skills (e.g., Nier S3 `C4S3 -> C1`). Target button uses `pos` matching `targetCharacter - 1`. |
| **Full Auto / Semi Auto** | `.btn-auto`, `.btn-ability-auto`, `.btn-semi-auto` | Native FA obeys Purple -> Yellow -> Blue -> Red -> Green priority and skips ally-targeted skills. |
| **V2 Guard & Fatal Chain** | `.btn-guard` (`data-pos`), `.btn-fatal-chain`, `.prt-boss-action` | Guard ignores standard turn lockout in V2 raids. |
| **Lockout & System Popups** | `.pop-usual .btn-usual-ok`, `.pop-usual .btn-usual-cancel`, `.btn-close` | Includes *"Waiting for last turn to be processed"* lockout popups. |

### 1.2 Single Clean Dispatch Rule (Anti-Double-Tap)
Puppeteer's `ElementHandle.click()` computes `clickablePoint()` and throws `Node is either not clickable or not an Element` on Zepto overlays/CreateJS layers. Conversely, calling **both** `humanizedClick()` AND `el.evaluate(tap + click)` on the same attempt fires duplicate taps on `.btn-quick-summon` or summon cards, causing server lockout popups (`{ popup, scenario: [] }`) or closing the detail popup immediately after opening it.

- **Standard pattern**: Dispatch **one** in-page Zepto `tap` (after advancing CreateJS tweens via `createjs.Tween.tick(...)`) on Attempt 1, falling back to `humanizedClick()` only on retry attempts if Attempt 1 did not trigger an XHR.

---

## 2. Runtime State Hierarchy & Authoritative Server Truth

Do not confuse static load data, client runtime state, and server responses:

1. **`window.stage.pJsnData` (Initial Load Snapshot)**:
   - Populated when the battle page loads (`start.json`).
   - Becomes **stale** after mid-turn state changes such as Death KOing C4 and bringing in backline Nier until an F5 reload fetches fresh `start.json`.
   - **Rule**: Never reject a confirmed `summon_result.json` just because `stage.pJsnData` still lists the pre-swap C4 character before an F5 reload!
2. **`window.stage.gGameStatus` (Live Client Runtime Flags)**:
   - Holds real-time flags updated by XHR handlers and CreateJS timelines:
     - `lock`, `btn_lock`, `attacking`, `ability_turn` -> input lock status (`waitForCombatInputReady` checks these).
     - `summon_enable` -> `0` / `false` once a summon is used this turn (except multi-summon effects).
     - `turn`, `win`, `lose`, `boss.param`, `player.param`, `ability_queue`.
3. **Authoritative XHR Responses (`ability_result.json`, `summon_result.json`, `normal_attack_result.json`)**:
   - **Valid Cast**: HTTP 200 where `Array.isArray(json.scenario) && json.scenario.length > 0 && !json.popup`.
   - **Popup Lockout / Rejection (Critical Trap!)**: HTTP 200 containing `{ popup: {...}, scenario: [] }` (or missing/empty `scenario` with a popup payload). **Never** treat a `popup` response as `resolved: true` — treat it as `isPopupLockout: true`, dismiss the popup cleanly, and retry.
4. **Pre-Reload Fast-Confirm Optimization**:
   - When a `summon`, `quick_call`, or `attack` step has `reload` / `f5` as the immediately following step and receives an authoritative server confirmation (`serverConfirmed`), skip post-cast tween polling (`waitForCombatInputReady`) and run `reload` immediately so F5 cancels the long animation cleanly.

---

## 3. High-Impact GBF Combat Mechanics & Cascade Signatures

### 3.1 Death / Evoker Backline Swap & Ally-KO Reset Cascades
In Dark GW burst rotations (e.g., `gw-nm150-dark`), **Death** (`Slot 3` / `quick_call` after `C4S1`) executes two critical mechanics simultaneously:
1. **KOs Character 4** (e.g., Ewiyar / sacrificial starter) -> brings in backline **Nier** (who has **4 skills**, unlocking `C4S4` and resetting her own `C4S1`/`C4S3`).
2. **Triggers Ally-KO Cooldown Resets** on surviving units/weapons/summon passives (e.g., resetting `C2S1`/`C2S2` for Turn 3).

**Cascade Failure Signature (How to Spot in 1 Pass):**
When Step 12 (`Death` summon or `Quick Call`) silently fails, times out, or skips, **all** of these symptoms appear downstream after Step 13 `Reload`:
- Step 14 (`C4S1`) skips on cooldown showing the *pre-swap* character's S1 name & recast (`10->10`).
- Step 15 (`C4S3 -> C1`) skips on cooldown showing the *pre-swap* character's S3 name (`7->7`).
- Step 16 (`C4S4`) fails with `FAILED_TIMEOUT (6000ms)` waiting for `C4S4` because the unswapped unit only has 3 skills (no slot 4).
- Steps 17–18 (`C2S1`, `C2S2`) remain on cooldown instead of resetting.

**Diagnostic Rule**: Always fix the **earliest upstream failure** (the swap summon / Quick Call or missing `reload` immediately after it), never the downstream victim skills.

### 3.2 Post-Attack / Post-Summon F5 Reload (`リロ殴り`) & Input Lock
- Pressing Attack or Summon commits the server state immediately when the XHR finishes; animations are purely client-side.
- Reloading (`F5` / `#raid` navigation) cancels animation timers and fetches `start.json` with fresh party HP, cooldowns, and swapped backline members.
- **Post-Reload Readiness Race**: Immediately after `page.reload()` fires `domcontentloaded`, `stage.gGameStatus.lock` / `btn_lock` / CreateJS initialization may still hold input briefly (~200–600ms). `handleReload` must await `waitForCombatInputReady` before returning so the first skill of the next turn confirms on Attempt 1 instead of spamming retries.

### 3.3 Account-Wide Server Lockout & Why Same-Battle 2-Tab Fails
- **Account-Wide Lockout Timer**: Cygames enforces turn/attack lockout **per account on the server** (~`1.01s` base + per-character Normal Attack / Charge Attack chain weights; Ougi chains add ~3–6s+).
- **Why Same-Battle 2-Tab Ping-Pong Does Not Work**:
  - Tab 2 holds stale `stage.pJsnData` until reloaded *after* Tab 1's `normal_attack_result.json` or `summon_result.json` resolves on the server.
  - Acting in Tab 2 before reloading throws *"Waiting for last turn to be processed"* (`前ターン処理中です`) or forces a full redirect.
  - Reloading Tab 2 after Tab 1 acts takes the exact same reload latency as reloading Tab 1, while Tab 1 burns background CPU/GPU rendering animations — and both tabs hit the exact same account-wide server lockout.
- **Legitimate `2窓` (`複窓`) Usage**: Top racers use 2 windows for **different battles** (e.g., Full-Autoing Raid A while joining/clearing Raid B) or **battle + utility** (token boxes / non-GW supporter staging), NOT alternating turns inside the same fight.

### 3.4 Guild War (Unite & Fight) Strict Rules
1. **Strict 1-Pending-Battle Cap (`未確認バトル`)**: Outside GW, up to 5 unclaimed battle results can be skipped/stacked. **During GW**, even **1** unviewed result blocks starting the next NM/EX+ quest — `confirm_result` (or Pending Battles cleanup) is mandatory between runs.
2. **Mandatory Fatal `ensureCast` Policy**: In Guild War templates (`isGuildWarWorkflowTemplate`), **every** step marked `ensureCast: true` (`summon`, `quick_call`, `skill`, `attack`) is **FATAL** on failure, cooldown skip, or timeout (`UniversalWorkflowEngine` sets `fatalStepAbort = true` and `stopRequested = true`, skipping cleanup attacks).

---

## 4. Real-Time Step Audit Playbook (`step:audit`)

`StepExecutionMonitorService` writes live per-step receipts after every action to `data/step-audit-ledger.json` and runs `diagnoseReceipts()` at run completion.

### 4.1 1-Pass Forensic Triage Workflow
1. **Inspect telemetry first**:
   ```bash
   bun run step:audit <workflow-name>
   ```
   Review Pass%, Retry%, Skip%, AvgMs, and the `Root-Cause & Failure Cascade Diagnostics` block.
2. **Trace upstream**: Find the *first* step that failed, timed out, took `>= 3` retries, or recorded `0->0` / unmutated state on a state-changing step.
3. **Probe live Chrome CDP if ambiguous**: Check actual DOM selectors, `.btn-command-back.display-on`, `stage.gGameStatus`, and `json.scenario` vs `json.popup` on the running browser before editing engine code.
4. **Patch the narrowest responsible layer** and verify via:
   - `bun run typecheck`
   - `bun run workflow:validate`
   - Live run (`--runs 1`) + `bun run step:audit <workflow-name>`
   - **Never** claim `"all fixed"` before live audit receipts show 0 unexpected skips/timeouts.
   - **Never** add per-template mock-DOM test files (`tests/test-<template>.ts`).

### 4.2 Symptom -> Root Cause -> Engine Module Quick Map

| Observed Audit Symptom | Likely Root Cause | Where to Inspect |
| :--- | :--- | :--- |
| `summon` skips in `< 150ms` (`unavailable in tray`) | Checked `.lis-summon` while tray closed or `.btn-command-back.display-on` closed tray instead of opening it | `CombatExecutionService.handleSummon` (`src/engines/universal/combat-execution.service.ts`) |
| `summon` executes in-game, then retries 4–7x & wastes 5–15s | Post-summon check rejected valid `summon_result.json` due to stale `pJsnData`, or omitted `nextIsReload` fast-confirm | `CombatExecutionService.handleSummon` |
| `quick_call` silently skips (`SKIPPED_COOLDOWN`) or false-confirms on timeout | `.btn-quick-summon` covered by open C4 drawer, double-tap lockout, or unconfirmed `ensureCast` returned `true` | `CombatExecutionService.handleQuickCall` |
| Downstream skills (`C4S1`/`C4S3` skipped, `C4S4` timeout) | Upstream Death / swap summon failed, or missing post-swap `reload` step | Earliest `summon`/`quick_call` step + `StepExecutionMonitorService.diagnoseReceipts` |
| First skill after `reload` needs 3–6 enforced retries | `handleReload` returned on `domcontentloaded` before `stage.gGameStatus` / buttons unlocked | `CombatExecutionService.handleReload` + `waitForCombatInputReady` |
| XHR resolves HTTP 200 yet skill/summon didn't fire | Server returned `{ popup, scenario: [] }` lockout message and `waitForNetworkResponseAndPayload` accepted it | `CombatResolutionService.waitForNetworkResponseAndPayload` (`src/engines/universal/combat-resolution.service.ts`) |
| Pipeline keeps attacking for 39% boss HP after mandatory Death fails | `UniversalWorkflowEngine` treated failure as non-fatal `UNACKNOWLEDGED_CONTINUED` instead of GW fatal abort | `UniversalWorkflowEngine` (`src/engines/universal-workflow.engine.ts`) |

---

## 5. Evidence Ledger & False Positive / False Negative Guardrails

For full production incident logs, Success vs. Failure Factors, exact live telemetry (`data/step-audit-ledger.json`), and the **False Positive / False Negative Verification Matrix** (covering `Recast: 0->0` on confirmed buffs, Attack-Reload server lockout retries vs Summon-Reload Attempt 1, `offsetWidth > 0` tray false-negatives, and `--runs 2` fresh-battle verification), read:

- **[Root Cause Analysis: Combat Failures, Success Factors & Verification Guardrails](../COMBAT_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md)**
