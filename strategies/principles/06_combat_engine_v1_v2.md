# Principle 06: Combat Engine Architecture (Battle Systems V1 & V2)

## 1. Executive Overview

Granblue Fantasy features two fundamentally distinct battle engines:
1. **Battle System 1.0 (V1)**: The traditional turn-based combat system used in 90% of game content (Story, Magna, Events, Classic Raids).
2. **Battle System 2.0 (V2)**: The modern tactical system utilized in high-difficulty raids (Revans, Subaha, Dark Rapture Zero, Super Ultimate Bahamut, Six Dragon Raids), featuring **Omens**, **Guard Commands**, and **Fatal Chains**.

Understanding the nuances between V1 and V2 is critical when designing combat automation and remote decision systems.

---

## 2. Battle System 1.0 (Classic Engine)

```
+-----------------------------------------------------------------------------------------+
|                                    V1 Combat Turn Cycle                                 |
+-----------------------------------------------------------------------------------------+

 [TURN_START]
      |
      | 1. Evaluate Abilities (Manual or Full Auto Queue)
      v
 [CAST_ABILITIES]
      | - Dispatch skill calls to /rest/multiraid/ability_result.json
      | - Await animation and buff/debuff resolution
      v
 [CALL_SUMMONS] (Optional)
      | - Dispatch summon invocation to /rest/multiraid/summon_result.json
      | - Apply summon auras / combo summon effects
      v
 [ATTACK_PHASE]
      | 2. Toggle Charge Attack (Ougi: ON/OFF)
      | 3. Click Attack (.btn-attack) -> POST /rest/multiraid/normal_attack_result.json
      v
 [TURN_RESOLUTION]
      | 4. Player party attacks (Normal hits + Ougi chain bursts)
      | 5. Enemy boss reacts (Normal attacks or Triggered Special Attacks based on Diamond/HP)
      v
 [TURN_END] -> Transition to Next Turn
```

### 2.1 The Full Auto (FA) Execution Algorithm
Full Auto is natively processed by the GBF client. When `.btn-auto` is clicked, the client iterates over the frontline party (Slots 1 to 4) and casts eligible skills according to a strict **Color Priority Hierarchy**:

```
+-------------------------------------------------------------------------+
|                      Full Auto Skill Color Hierarchy                    |
+-------------------------------------------------------------------------+
| Priority 1: Field Effects       | Purple borders (Field abilities)      |
| Priority 2: Buff Abilities       | Yellow borders (Party enhancements)   |
| Priority 3: Debuff Abilities     | Blue borders (Enemy stat reductions)  |
| Priority 4: Damaging Abilities   | Red borders (Direct damage skills)    |
| Priority 5: Healing Abilities    | Green borders (HP recovery / clarity) |
+-------------------------------------------------------------------------+
```

#### Full Auto Exclusions & Constraints:
* **Targeted Skills**: Skills requiring the player to select a specific party member (e.g. single-target heals, character target buffs) are **skipped** by Full Auto.
* **Per-Skill Toggles**: In modern GBF, players can manually toggle specific character skills ON or OFF for Full Auto inside the party/character menu. The automation controller should respect these in-game settings rather than trying to micromanage skills externally.
* **Summon Invocation in FA**: The game provides an in-game option to designate **Quick Summons** (e.g. Belial, Bubs, Triple Zero, Lucifer) to be called automatically at the start of the turn.

---

## 3. Battle System 2.0 (High-Difficulty Tactical Engine)

In Battle System 2.0, combat is centered around boss **Omens** and reactive damage mitigation.

```
+-----------------------------------------------------------------------------------------+
|                                    V2 Combat Engine                                     |
+-----------------------------------------------------------------------------------------+
| Key Differences from V1:                                                                |
| 1. Guard Button (.btn-guard) available for each character slot.                         |
| 2. Enemy Special Attacks display an "Omen" popup with explicit cancel requirements.     |
| 3. Fatal Chain (FC) Gauge accumulates (0% - 100%) through Ougi activations.             |
+-----------------------------------------------------------------------------------------+
```

```
+-----------------------------------------------------------------------------------------+
|                                   V2 Turn Execution Flow                                |
+-----------------------------------------------------------------------------------------+

 [INSPECT_OMEN]
       |
       +---> [No Omen Active] -> Normal Full Auto / Attack Cycle
       |
       +---> [Omen Triggered (.prt-boss-action)]
             |
             v
       [EVALUATE_CANCEL_CONDITION]
             |
             +---> Condition Met (e.g. 30 hits dealt, 10m skill damage, 4 debuffs)?
             |        |
             |        v
             |     [OMEN_CANCELLED] -> Boss trigger aborted -> Attack safely
             |
             +---> Condition Unmet?
                      |
                      v
                   [ENGAGE_GUARD]
                      - Click Guard buttons for vulnerable frontline members:
                        `.btn-guard[data-pos="1"]`, `.btn-guard[data-pos="2"]`
                      - Guard grants massive 90% damage mitigation for that turn
                      - Click Attack
```

### 3.1 Omen Cancel Conditions Reference
1. **Hit Count**: Deal $N$ hits in a single turn (handled via multi-hit red skills or double strike).
2. **Damage Threshold**: Deal $X$ million damage in a single turn.
3. **Debuff Count**: Land $N$ debuffs in a single turn.
4. **Fatal Chain**: Consume the 100% Fatal Chain gauge by clicking the FC button (`.btn-fatal-chain`).
5. **Elemental Damage**: Deal $X$ damage of a specific element.

---

## 4. DOM Selectors for Combat Interactivity

```
+-------------------------------------------------------------------------+
|                               Combat DOM Map                            |
+-------------------------------------------------------------------------+
| Element Description              | DOM Selector                         |
+----------------------------------+--------------------------------------+
| Main Attack Button               | `.btn-attack`                        |
| Full Auto Toggle                 | `.btn-auto`, `.btn-ability-auto`     |
| Semi Auto Toggle                 | `.btn-semi-auto`                     |
| Charge Attack Toggle (Ougi Lock) | `.btn-lock`                          |
| Boss HP Display                  | `.prt-enemy-percent`, `.txt-enemy-hp`|
| Character Guard Buttons (V2)     | `.btn-guard` (data-pos="1" to "4")   |
| Fatal Chain Button (V2)          | `.btn-fatal-chain`                   |
| Boss Omen Container (V2)         | `.prt-boss-action`, `.txt-boss-action|
| Skill Cards                      | `.lis-ability`                       |
| Summon Deck Toggle               | `.btn-summon-tab`                    |
+----------------------------------+--------------------------------------+
```

---

## 5. Combat Automation Recommendations

1. **For 99% of Farming (Dailies, Event Raids, Magna II/III, Revans leeching)**:
   - Always rely on **Native Full Auto (FA)**.
   - Simply navigate to the raid, select supporter summon, enter combat, and click `.btn-auto`.
   - The native client handles animations, skill execution, turn transitions, and damage calculations flawlessly without external script interference.
2. **For V2 / Endgame Manual Raids**:
   - Do **not** attempt fully autonomous play.
   - Use the **Remote Companion UI** to allow the human player to trigger Guard or cancel skills remotely from their phone while monitoring boss HP and Omens via live WebP screencast.
