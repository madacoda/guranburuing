# Proto Bahamut HL (PBHL) Gold Bar Hunter (`gb-pbhl`)

## 1. Executive Summary & Objective

**Proto Bahamut HL** (*PBHL / Tsuyo Baha / プロトバハムートHL*) is the premier raid in Granblue Fantasy for farming un-capped **Gold Bars** (*ヒヒイロカネ*) via the special **Blue Chest** (*青箱*).

The Blue Chest drop rate scales with individual honors, reaching maximum drop probability at **~1,480,000 pt** (~148,000,000 total damage dealt). The `gb-pbhl` engine automates the entire end-to-end farming cycle:
1. **Intelligent Finder Scanning**: Constantly monitors `#quest/assist` (Finder tab, 4th slot / PBHL) for healthy, low-participant raids.
2. **Priority Supporter Selection**: Selects optimal Dark supporters (Lvl 250 Hades / Bahamut).
3. **Optimized Ereshkigal Rotation**: Executes a high-burst 1-to-2 turn rotation featuring Nier sacrifice into Bowman swap and multi-strike attacks with F5 animation skipping.
4. **Resilient Cleared Recovery**: If a raid finishes prematurely at any stage, the engine automatically verifies pending battles, claims rewards, inspects for Gold Bars, and returns to the Finder without crashing.
5. **Human Motor Simulation**: Natural multi-clicking, Gaussian spatial jitter, log-normal delays, and behavioral variations prevent heuristic bot detection.
6. **Sentinel Watchdog**: Pauses immediately upon detecting visual verification challenges (CAPTCHA), bringing the browser to the foreground and sounding an audible alarm.

---

## 2. Recommended Party & Setup (Fire Agni Burst & Legacy Dark)

### Primary Setup: Fire Agni Burst Setup (`gb-pbhl` / `gb-pbhl-universal`)
The active production universal workflow is configured for the **Fire Agni Burst Setup**:

| Slot | Character / Summon | Role & Key Actions |
| :---: | :--- | :--- |
| **Summon #1 / Friend** | **Agni** | Summoned on turn 1 (`summon agni`) to trigger field/aura buff |
| **Char #4** | **Grand Percival** | Primary buffer & burst enabler; casts Skill 3 (`Königsschlag`) & Skill 4 (`Macht`) |
| **Quick Call** | **Beelzebub / Triple Zero / Sun** | Instant summon call (`quick_call`) followed by animation skip reload |
| **MC (Char #1)** | **Lucha / Berserker / Viking** | Casts Skill 3 (e.g. *Tag Team* / offensive steroid) -> Reload |
| **Char #2** | **Wilnas / Michael / Zeta** | Casts Skill 3 -> Reload |
| **Attack Loop** | **Normal Attack -> Reload** | Executes normal attack and loops until **1,800,000 pt** blue chest threshold is verified |

### Legacy Setup: Dark Ereshkigal Burst Setup
| Slot | Character / Summon | Role & Key Actions |
| :---: | :--- | :--- |
| **MC** | Viking / Berserker | Equipped with Ereshkigal for unconditional team Triple Attack + Bonus Dark DMG |
| **Char #2** | **Yukata Ilsa** | Main damage dealer. Targeted by Nier S2, casts Skill 1 (*Midnight Ray*) |
| **Char #3** | **Seox (Six)** | Eternal DPS. Receives optional Skill 1 cast (*Gate of Demons*) ~35% of runs |
| **Char #4** | **Nier** | Casts Skill 1 (*World of Death and Love*) and Skill 2 on Ilsa, then sacrificed by Death |
| **Sub 1** | **Bowman** | Automatically swaps in upon Nier's sacrifice; auto-attacks at end of turn |
| **Summon #3** | **The Death** | Positioned in Summon Slot #3; called on Turn 1 to sacrifice Nier and swap in Bowman |
| **Quick Call** | **Belial / Baha / Nyarlathotep** | Bound to in-game Quick Summon (`.btn-quick-summon`) for instant activation |

---

## 3. Quick Start & CLI Execution

Run the PBHL hunting loop from PowerShell:

```bash
# Continuous farming loop (runs indefinitely until stopped with Ctrl+C)
npm run gb-pbhl

# Run a specific number of raids (e.g. 5 raids)
npm run gb-pbhl 5

# Custom target honor threshold (e.g. 1,480,000 pt)
npm run gb-pbhl 10 1480000
```

### CLI Parameters
```bash
npm run gb-pbhl [runs] [targetScore]
```
- `runs`: Number of successful raids to complete (default: `Infinity` / continuous).
- `targetScore`: Target honors before stopping attack phase (default: `1480000`).

---

## 4. Raid Finder Strategy & Prioritization Rules

The bot navigates to `https://game.granbluefantasy.jp/#quest/assist`, activates the **Finder** tab (`#tab-search`), and selects the **4th Slot** (PBHL filter):

### Candidate Filtering Heuristics
```
+---------------------------------------------------------------------------------+
|                                PBHL Candidate Filter                            |
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
If no eligible PBHL raid appears within **10 continuous minutes**, the engine gracefully concludes and outputs:
```text
========================================================================
⚠️ [PbhlEngine] No eligible PBHL raid found within 10 minutes.
⚠️ Currently PBHL is not optimal for raid gold bar
========================================================================
```

---

## 5. Supporter Summon Selection Hierarchy

On the supporter selection screen (`#quest/supporter_raid/...`), the engine switches to the **Dark Element tab** (`data-element="6"`) and evaluates candidates using the following priority:

1. **Priority 1**: `Lvl 250 Agni` (Fire Primal aura - Primary for `gb-pbhl`)
2. **Priority 2**: `Lvl 250 Bahamut` (Omega / Elemental aura)
3. **Priority 3**: `Lvl 250 Shiva / Michael` (Fire supplemental / ATK aura)
4. **Priority 4**: `Lvl 250 Hades` (Legacy Dark setup fallback)
5. **Fallback**: First visible Fire or Dark supporter on screen

---

## 6. Combat Rotation & Human Mimicry

### Primary Pipeline: Fire Agni Universal Rotation (`gb-pbhl` / `gb-pbhl-universal`)
```
[Start Combat]
      |
      v
[Step 1] Summon Agni (Dynamic lookup across Main / Friend / Sub summon or Slot 1)
      |
      v
[Step 2] Char #4 (Grand Percival) -> Skill 3 (Königsschlag: 3T Fire Atk Up, 100% TA, 30% Echo)
      |
      v
[Step 3] Quick Call (.btn-quick-summon, e.g. Beelzebub / Triple Zero / Sun)
      |
      v
[Step 4] Instant F5 Reload (Bypasses summon call & skill animations)
      |
      v
[Step 5] Char #4 (Grand Percival) -> Skill 4 (Macht: 1T massive burst)
      |
      v
[Step 6] Char #1 (MC) -> Skill 3 (Tag Team / Burst skill)
      |
      v
[Step 7] Instant F5 Reload
      |
      v
[Step 8] Char #2 (Wilnas / Michael / Zeta) -> Skill 3
      |
      v
[Step 9] Instant F5 Reload
      |
      v
[Step 10] Normal Attack (.btn-attack-start)
      |
      v
[Step 11] Instant F5 Reload
      |
      v
[Step 12] Repeat Loop (Up to 10x):
      +---> Check Honors: if Honors >= 1,800,000 pt -> Exit Repeat Immediately
      |     Execute Normal Attack
      |     Instant F5 Reload
      +--- (Repeat until target score reached or raid concludes)
      |
      v
[Step 13] Confirm Result (Dismiss loot / pending battles)
```

### Legacy Pipeline: Dark Ereshkigal Rotation
```
[Start Combat]
      |
      v
[Action 1] Quick Call (.btn-quick-summon)
      |
      v
[Action 2] Char #4 (Nier) -> Skill 1, Skill 2 (select Char #2 Yukata Ilsa in popup)
      |
      v
[Action 3] Summon Menu -> Select #3 (The Death) -> One-Click Call + Instant F5
           (Skips 3.5s sacrifice animation; Bowman swaps in immediately upon reload)
      |
      v
[Action 4] Char #2 (Yukata Ilsa) -> Skill 1 (Midnight Ray) -> Close Ability Tray
      |
      v
[Action 4b] (Human Variety, ~35% roll) -> Char #3 (Seox) Skill 1 -> Close Ability Tray
      |
      v
[Action 5] Attack Loop:
      +---> Verify combat input ready (auto-closes drawers if open)
      |     Click Attack (.btn-attack-start)
      |     Wait for server attack resolution
      |     Quick-refresh (F5) to skip combat animations
      |     Verify score >= 1,480,000 pt or raid cleared
      +--- (Repeat if needed)
```

### Human Mimicry Details
- **One-Click Summon & Fast F5**: Directly invokes Summon #3 (The Death) in one-click mode (or 300ms brief confirmation if enabled) and immediately issues `location.reload()`, skipping the sacrifice animation and party swap delay entirely.
- **Drawer Closing Before Attack**: Ensures `.btn-command-back.display-on` is closed after casting Yukata Ilsa / Seox skills, exposing `.btn-attack-start` immediately without latency.
- **Multi-Clicking**: Skill buttons, Quick Call, and Attack support rapid double-taps (50ms–120ms inter-tap latency, 2–3px spatial jitter) with 25%–45% probability.
- **2D Gaussian Bounding**: Coordinates are sampled using a bivariate normal distribution centered at the button centroid, clamped with 3px edge padding.
- **Human Behavioral Variation**: With ~35% probability, Char #3 (Seox) Skill 1 is clicked before attacking, varying the exact input fingerprint across runs.

---

## 7. Dual-Track Real-Time Honor & Damage Synchronization

PBHL blue chest threshold is **~1,480,000 honors (~148 Million damage)**. An optimized Dark Ereshkigal burst composition achieves this in 1–2 turns.

To prevent over-attacking (e.g. continuing to Turn 7 when 1.48M was already reached at Turn 2), the engine operates a **dual-track real-time synchronization system**:

1. **Track 1: Deep Recursive Scenario Traversal (`normal_attack_result.json`)**:
   - Multi-attacks, double strike hits, echoes (追撃), supplemental damage, chain bursts, and end-of-turn auto-cast nukes (Yukata Ilsa S1, Seox counter, Bowman passive) are parsed via recursive tree traversal of `data.scenario`.
   - Converted to estimated honors at PBHL's 1:100 ratio (`damage / 100`).
2. **Track 2: Ground-Truth Server Honor Sync (`start.json` & `stage.pJsnData.user_point`)**:
   - After each turn, the combat view quick-refreshes (`location.reload()`), receiving `/rest/multiraid/start.json`.
   - The engine directly reads the server's authoritative personal honors from `stage.pJsnData.user_point` and `/start.json`, instantly overriding any scenario estimations.
   - If the user's honors meet or exceed 1,480,000 pt, the engine immediately terminates the combat phase (`TARGET_SCORE_REACHED`) and proceeds to the claim cycle.

---

## 8. Premature Raid Cleared Recovery & Stalled Loop Prevention

In PBHL, high-rank burst players can kill the boss in seconds. The engine guards against raid endings and HUD stalls at **every stage**:
- **Before Combat / Supporter Screen**: If a "battle has ended" modal appears, dismisses it immediately.
- **Mid-Rotation**: If an ability panel fails to open because the raid concluded, the engine detects the modal, safely aborts rotation, and skips to claim.
- **Comprehensive Ended Detection (`checkIfRaidEnded`)**:
  - Checks URL & Hash for `#result`, `#result_multi`, or `empty`.
  - Checks `stage.gGameStatus` (`finish`, `raid_finish`, `win`, `lose`, `boss.param[0].hp <= 0`).
  - Checks `stage.pJsnData` (`finish`, `raid_finish`, `is_finish`, `result`, `is_clear`, `boss.param[0].hp <= 0`).
  - Inspects DOM `.prt-enemy-percent` for `0%` or `HP 0%`.
  - Scans full page text and active modals across 16 English & Japanese victory/concluded phrases.
  - Automatically clicks OK on the modal to return to quest list.
- **Stalled HUD Breakout (`executeAttackUntilScore`)**:
  - If combat HUD remains unresponsive for >3.5s, fast F5 reload is triggered to unfreeze or sync to result screen.
  - If HUD remains inactive for 2 consecutive cycles (e.g. boss killed by other players before turn input), the engine gracefully concludes the raid with `SUCCESS` and proceeds to pending battle claim, completely eliminating infinite waiting loops.

### Pending Battles Claim Flow (Randomized 3–5 Raid Batches)
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
       - Appends an entry to [`logs/gb-pbhl.md`](file:///c:/laragon/www/gbf/logs/gb-pbhl.md).
   - Re-rolls the next batch threshold (3–5 raids) and returns cleanly to `#quest/assist`.
4. **Session Exit**: Claims any remaining pending battles if `joinedInCurrentBatch > 0` before returning to `#mypage`.

---

## 9. Honest In-Game Turn Progression & Latency Telemetry

Every phase and combat turn outputs ground-truth in-game turns directly from `stage.gGameStatus.turn`, distinguishing between server lock waits and actual turn progression:

```text
[PbhlEngine] Selected raid: ID 46621730172 (HP: 56%, Players: 3/30) [Priority 2 match] (found in 3.1s)
[PbhlEngine] Selected supporter [Lvl 250 Hades] (took 0.9s)
[PbhlEngine] Entering combat stage, waiting for HUD...
[PbhlEngine] Quick Call -> Nier S1, S2 (on Ilsa) -> Death Summon -> Ilsa S1 (took 7.2s)
[PbhlEngine] [In-Game Turn 1] Clicking Attack... (Current Honors: 0 pt)
[PbhlEngine] Attack resolved. Turn Dmg: 78.439.120 (~784.391 pt) | Estimated Total Honors: 784.391 pt
[PbhlEngine] [In-Game Turn 1 -> 2] Resolved in 3.8s (Attack phase: 3.8s) | Honors: 784.391 / 1.480.000 pt (53.0%)
[PbhlEngine] [In-Game Turn 2] Clicking Attack... (Current Honors: 784.391 pt)
[PbhlEngine] Attack resolved. Turn Dmg: 82.110.450 (~821.104 pt) | Estimated Total Honors: 1.605.495 pt
[PbhlEngine] Server honors synced from raid state: 1.605.495 pt
[PbhlEngine] [In-Game Turn 2 -> 3] Resolved in 4.1s (Attack phase: 7.9s) | Honors: 1.605.495 / 1.480.000 pt (108.5%)

🎉 [PbhlEngine] Blue chest target reached! (1.605.495 >= 1.480.000 pt on In-Game Turn 3, attack phase took 8.0s)
[PbhlEngine] Battle completed: TARGET_SCORE_REACHED (1.605.495 pt in 2 attacks, took 8.0s)
[PbhlEngine] Pending battle check skipped (1/4 raids in batch). Returning to Finder...
[PbhlEngine] [Run 1] Iteration concluded in 19.8s total.
```

---

## 10. Biomechanical Motor Kinematics & Delay Specifications

The engine enforces physiological human biomechanics at every interaction stage:

| Action / Transition | Latency Model / Distribution | Human Meaning |
| :--- | :--- | :--- |
| **Cognitive Reaction (`humanReactionDelay`)** | $\text{Log-Normal}(\mu = \ln(280\text{ms} - 380\text{ms}), \sigma = 0.22)$ | Visual-motor perception latency upon button or panel render |
| **Physical Click Actuation** | $\text{Log-Normal}(\mu = \ln(50\text{ms}), \sigma = 0.18) \in [40, 75]\text{ms}$ | Physical microswitch travel, depression, and spring release |
| **Pre-Click Hover Latency** | $40\text{ms} - 75\text{ms}$ | Decelerating cursor settle before depressing mouse switch |
| **Post-Click Release Pause** | $45\text{ms} - 75\text{ms}$ | Neuromuscular recovery latency before initiating next movement |
| **Rapid Double-Tapping** | $65\text{ms} - 120\text{ms}$ inter-tap, $\sigma = 1.5\text{px}$ drift | Natural player burst clicking / mashing (35%–50% chance) |
| **Anticipatory F5 Trigger** | $180\text{ms} - 380\text{ms}$ | Refresh trigger latency after observing attack button depression |
| **Post-Reload Visual Orientation** | $450\text{ms} - 750\text{ms}$ | Player orienting to refreshed battlefield and checking boss HP |
| **Natural Micro-Hesitation** | $350\text{ms} - 800\text{ms}$ (3%–5% probability) | Natural human breathers, glancing at chat or participant count |

---

## 11. Security & CAPTCHA Sentinel

The `SentinelWatchdog` runs continuously:
- If a verification popup appears (`.pop-usual.verification`, `.cnt-verification`, etc.):
  1. The bot **immediately freezes** all synthetic input and timers.
  2. It **never navigates away** from the page or closes the tab.
  3. The browser window is brought to the foreground (`page.bringToFront()`).
  4. An audible terminal alert is sounded.
  5. The bot waits indefinitely for the human operator to solve the puzzle in the browser.
  6. Once solved, automation resumes automatically.
