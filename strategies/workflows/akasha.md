# Akasha HL (崩壊：降臨) Gold Bar Hunter (`gb-akasha`)

## 1. Executive Summary & Objective

**Akasha HL** (*崩壊：降臨* / *Akasha*) is one of the premier Gold Bar (*ヒヒイロカネ*) farming raids alongside Proto Bahamut HL and Grand Order HL.

The **Blue Chest** (*青箱*) contains an un-capped Gold Bar drop, reaching maximum drop probability at **~1,560,000 pt** (~156,000,000 total damage dealt). The `gb-akasha` engine automates the entire end-to-end farming cycle:
1. **Intelligent Finder Scanning**: Constantly monitors `#quest/assist` (Finder tab, **3rd slot** / Akasha) for healthy, low-participant raids.
2. **Priority Supporter Selection**: Selects optimal Dark supporters (Lvl 250 Hades / Bahamut).
3. **Ultra-Fast Ereshkigal Rotation**:
   - **Quick Summon Call** -> instant F5 reload
   - **4th Char (Nier) Skill 1** -> close drawer
   - **Death Summon (one-click)** -> instant F5 reload
   - **2nd Char (Yukata Ilsa) Skill 1** -> close drawer
   - **Attack loop with F5 refresh** until honor > **1,560,000 pt**
4. **Resilient Cleared Recovery**: If a raid finishes prematurely at any stage, the engine automatically verifies pending battles, claims rewards, inspects for Gold Bars, and returns to the Finder without crashing.
5. **Human Motor Simulation**: Natural multi-clicking, Gaussian spatial jitter, log-normal delays, and behavioral variations prevent heuristic bot detection.
6. **Sentinel Watchdog**: Pauses immediately upon detecting visual verification challenges (CAPTCHA), bringing the browser to the foreground and sounding an audible alarm.

---

## 2. Recommended Party & Setup

The combat engine is optimized for the standard dark **Ereshkigal burst setup**:

| Slot | Character / Summon | Role & Key Actions |
| :---: | :--- | :--- |
| **MC** | Viking / Berserker | Equipped with Ereshkigal for unconditional team Triple Attack + Bonus Dark DMG |
| **Char #2** | **Yukata Ilsa** | Main damage dealer. Casts Skill 1 (*Midnight Ray*) |
| **Char #3** | **Seox (Six)** | Eternal DPS. High raw multi-attack and counter damage |
| **Char #4** | **Nier** | Casts Skill 1 (*World of Death and Love*), then sacrificed by Death |
| **Sub 1** | **Bowman** | Automatically swaps in upon Nier's sacrifice; auto-attacks at end of turn |
| **Summon #3** | **The Death** | Positioned in Summon Slot #3; called on Turn 1 to sacrifice Nier and swap in Bowman |
| **Quick Call** | **Belial / Baha / Nyarlathotep** | Bound to in-game Quick Summon (`.btn-quick-summon`) for instant activation |

---

## 3. Quick Start & CLI Execution

Run the Akasha hunting loop from PowerShell:

```bash
# Continuous farming loop (runs indefinitely until stopped with Ctrl+C)
npm run gb-akasha

# Run a specific number of raids (e.g. 5 raids)
npm run gb-akasha 5

# Custom target honor threshold (e.g. 1,560,000 pt)
npm run gb-akasha 10 1560000
```

### CLI Parameters
```bash
npm run gb-akasha [runs] [targetScore]
```
- `runs`: Number of successful raids to complete (default: `Infinity` / continuous).
- `targetScore`: Target honors before stopping attack phase (default: `1560000`).

---

## 4. Raid Finder Strategy & Prioritization Rules

The bot navigates to `https://game.granbluefantasy.jp/#quest/assist`, activates the **Finder** tab (`#tab-search`), and selects the **3rd Slot** (Akasha filter):

### Candidate Filtering Heuristics
```
+---------------------------------------------------------------------------------+
|                               Akasha Candidate Filter                           |
+--------------------------+------------------------------+-----------------------+
| Priority Tier            | Boss Remaining HP            | Current Players       |
+--------------------------+------------------------------+-----------------------+
| Priority 1 (Ideal)       | HP > 70%                     | <= 3 / 30 players     |
| Priority 2 (Acceptable)  | HP >= 50%                    | <= 4 / 30 players     |
+--------------------------+------------------------------+-----------------------+
```

### Refresh Cadence
- If no raid meets Priority 1 or 2, the bot waits a **randomized 3s – 15s window**:
  $$T_{\text{wait}} = 3000\text{ms} + \lfloor \mathcal{U}(0, 1) \times 12001 \rfloor\text{ms}$$
- Clicks the search refresh button (`.btn-search-refresh`).
- Falls back to `location.reload()` if the button is temporarily unresponsive.

### 10-Minute Timeout Rule
If no eligible Akasha raid appears within **10 continuous minutes**, the engine gracefully concludes and outputs:
```text
========================================================================
⚠️ [AkashaEngine] No eligible Akasha raid found within 10 minutes.
⚠️ Currently Akasha is not optimal for raid gold bar.
========================================================================
```

---

## 5. Supporter Summon Selection Hierarchy

On the supporter selection screen (`#quest/supporter_raid/.../303251/...`), the engine switches to the **Dark Element tab** (`data-element="6"`) and evaluates candidates using the following priority:

1. **Priority 1**: `Lvl 250 Hades` (Optimal Dark Primal aura)
2. **Priority 2**: `Lvl 250 Bahamut` (Optimal Dark Omega / Elemental aura)
3. **Priority 3**: `Lvl <= 250 Hades` (Any uncapped Hades: 210, 220, 230, 240)
4. **Fallback**: First visible Dark supporter on screen

---

## 6. Combat Rotation & Fast Animation Skipping

Once the combat HUD is confirmed active, the engine executes the strict sequence:

```
[Start Combat]
      |
      v
[Action 1] Quick Summon Call (.btn-quick-summon) -> Instant F5 Reload
      |    (Skips Quick Summon animation; enters fresh combat HUD in ~1.5s)
      v
[Action 2] Char #4 (Nier) -> Skill 1 (World of Death and Love) -> Close Drawer
      |
      v
[Action 3] Summon Menu -> Select #3 (The Death) -> One-Click Call -> Instant F5 Reload
      |    (Skips 3.5s sacrifice animation; Bowman swaps in immediately upon reload)
      v
[Action 4] Char #2 (Yukata Ilsa) -> Skill 1 (Midnight Ray) -> Close Drawer
      |    (Exposes Attack button immediately)
      v
[Action 5] Attack Loop:
      +---> Verify combat input ready (auto-closes drawers if open)
      |     Click Attack (.btn-attack-start)
      |     Wait for server attack resolution (normal_attack_result.json)
      |     Quick-refresh (F5) to skip combat animations
      |     Sync ground-truth server honors from start.json / stage.pJsnData
      |     Verify score >= 1,560,000 pt or raid cleared
      +--- (Repeat if needed)
```

### Key Performance Optimizations
- **Double F5 Animation Skips**: Both Quick Summon and Death Summon are immediately skipped via `location.reload()`, saving ~8-10 seconds of unskippable summon and character-swap animations.
- **Immediate Drawer Closing**: After casting Nier S1 and Yukata Ilsa S1, the ability tray is closed via `.btn-command-back.display-on`, exposing `.btn-attack-start` immediately without latency.
- **Biomechanical Motor Simulation**: Human reaction delays (220ms–300ms), 2D Gaussian click bounding, and rapid multi-clicking (multi-tap chance 40–50%) mimic genuine human motor activity.

---

## 7. Dual-Track Real-Time Honor & Damage Synchronization

Akasha blue chest threshold is **~1,560,000 honors (~156 Million damage)**.

To prevent over-attacking, the engine operates a **dual-track real-time synchronization system**:
1. **Track 1: Deep Recursive Scenario Traversal (`normal_attack_result.json`)**:
   - Multi-attacks, double strike hits, echoes (追撃), supplemental damage, chain bursts, and end-of-turn auto-cast nukes are parsed via recursive tree traversal of `data.scenario`.
   - Converted to estimated honors at Akasha's 1:100 ratio (`damage / 100`).
2. **Track 2: Ground-Truth Server Honor Sync (`start.json` & `stage.pJsnData.user_point`)**:
   - After each turn, the combat view quick-refreshes (`location.reload()`), receiving `/rest/multiraid/start.json`.
   - The engine directly reads the server's authoritative personal honors from `stage.pJsnData.user_point` and `/start.json`, instantly overriding any scenario estimations.
   - If the user's honors meet or exceed 1,560,000 pt, the engine immediately terminates the combat phase (`TARGET_SCORE_REACHED`) and proceeds to the claim cycle.

---

## 8. Premature Raid Cleared Recovery & Stalled Loop Prevention

In Akasha, burst players can push the boss through triggers rapidly. The engine guards against raid endings and HUD stalls at **every stage**:
- **Before Combat / Supporter Screen**: If a "battle has ended" modal appears, dismisses it immediately.
- **Mid-Rotation**: If an ability panel fails to open because the raid concluded, the engine detects the modal, safely aborts rotation, and skips to claim.
- **Comprehensive Ended Detection (`checkIfRaidEnded`)**:
  - Checks URL & Hash for `#result`, `#result_multi`, or `empty`.
  - Checks `stage.gGameStatus` (`finish`, `raid_finish`, `win`, `lose`, `boss.param[0].hp <= 0`).
  - Checks `stage.pJsnData` (`finish`, `raid_finish`, `is_finish`, `result`, `is_clear`, `boss.param[0].hp <= 0`).
  - Guards against false positives by verifying `activeHp <= 0` before checking DOM gauges.
  - Scans full page text and active modals across 16 English & Japanese victory/concluded phrases.
  - Automatically clicks OK on the modal to return to quest list.
- **Stalled HUD Breakout (`executeAttackUntilScore`)**:
  - If combat HUD remains unresponsive for >3.5s, fast F5 reload is triggered to unfreeze or sync to result screen.
  - If HUD remains inactive for 2 consecutive cycles, the engine gracefully concludes the raid with `SUCCESS` and proceeds to pending battle claim, completely eliminating infinite waiting loops.

---

## 9. Pending Battles Claim Flow (Randomized 3–5 Raid Batches)

Granblue Fantasy permits a maximum of 5 unclaimed pending battles before blocking new quest entries (`PENDING_LIMIT`).
To maximize speed and eliminate 60–80% of unnecessary page navigations:
1. **Dynamic Batch Threshold**: The engine rolls a randomized batch threshold between 3 and 5 raids (`Math.floor(Math.random() * 3) + 3`), strictly capping below GBF's 5-battle limit.
2. **Intermediate Raids**: If the batch threshold has not been reached, the engine skips the pending check, immediately returning to `#quest/assist` to join the next raid.
3. **Batch Threshold Reached or Limit Modal Detected**:
   - Navigates to `https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0`.
   - Loops through all pending battles and claims rewards until `There aren't any pending battles now` is confirmed.
   - **Gold Bar Drop Inspection**:
     - Inspects both the result DOM (`item_id 20004` / `Gold Bar` / `ヒヒイロカネ`) and the intercepted `/reward.json` network payload.
     - If a Gold Bar is found:
       - Emits an audible alarm (`\x07\x07\x07`).
       - Appends an entry to [`logs/gb-akasha.md`](file:///c:/laragon/www/gbf/logs/gb-akasha.md).
   - Re-rolls the next batch threshold (3–5 raids) and returns cleanly to `#quest/assist`.
4. **Session Exit**: Claims any remaining pending battles if `joinedInCurrentBatch > 0` before returning to `#mypage`.