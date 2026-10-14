# Volume 18: Replicard Sandbox - Zone Goliath (Stage 3), Triune Boss & Defenders Architecture KMS

**Version:** 2.0.0  
**Author:** Senior Distributed Systems & Knowledge Architecture Principal  
**Target Repository:** `C:\laragon\www\gbf\data\`  
**Compliance:** JSON Schema Draft 2020-12, Zero Duplication Policy, Domain-Driven Design (DDD)  

---

## 1. Executive Summary & Zone Goliath Overview

The **Replicard Sandbox** (*Here Be Staves* / 杖身の階差) represents the first frontier of Arcarum solo progression. Within this foundational tier, **Zone Goliath (Stage 3)** (`https://game.granbluefantasy.jp/#replicard/stage/3`) serves as the premier farming hub for **Earth and Dark** progression, specifically housing the materials required for:
1. **The Hanged Man** (Caim / Earth)
2. **The Tower** (Lobelia / Earth)
3. **Death** (Nier / Dark)
4. The sector apex Zone Boss: **Goliath Triune**

```
                            Zone Goliath (Stage 3) Topology
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         ▼                                 ▼                                 ▼
    Pink Sector                       Green Sector                      Yellow Sector
 (The Hanged Man)                     (The Tower)                          (Death)
 - Avatar of Avarice (Defender)     - Goliath Keeper (Defender)       - Frenzied Howler (Defender)
 - Herald of The Hanged Man         - Herald of The Tower             - Herald of Death
 - Bloodstained Barbarian (5-G)     - Earthshaking Panther (5-G)      - Writhing Despair (5-G)
 - Vestige of Truth (3-G)           - Goliath Vanguard (3-G)          - Temptation's Guide (5-G)
                                                                      - Farseeing Darkmistress (3-G)
                                           │
                                           ▼
                                 Zone Goliath Core
                               - Goliath Triune (Zone Boss)
                           (Requires: Rib x1, Organ x1, Core x1)
```

Historically, automating Here Be Staves suffered from map layer canvas traps, AAP replenishment modal interruptions, Defender spawn state desynchronization, and multi-turn omen wipeouts on Goliath Triune. This Volume establishes the definitive, authoritative Single Source of Truth (SSOT) for Zone Goliath Stage 3, detailing the complete enemy catalog, host material mechanics, omen cancel strategies, and autonomous Smart Full Auto combat blueprints.

---

## 2. Complete Zone Goliath (Stage 3) Enemy & Boss Catalog

Live reverse-engineering of `https://game.granbluefantasy.jp/#replicard/stage/3` yields the authoritative encounter hierarchy across all three sectors and the core zone boss:

| Target Name | Encounter Type | Sector / Path | Element | Weakness | Base HP | AAP | Host Materials / Gauge | Primary Drops & Utility |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Goliath Triune (P-Type)** | **Zone Boss** | Core | Earth | Wind | 200,000,000 | 30 | Rib ×1, Organ ×1, Core ×1 | Earthborne Astra, Tower/Hanged Man/Death Ideans, Quartz |
| **Goliath Triune (Normal)** | **Zone Boss** | Core | Earth | Wind | 500,000,000 | 30 | Rib ×1, Organ ×1, Core ×1 | Scaled daily boss; Ax-Skill Sephira Emerald weapons |
| **Avatar of Avarice** | **Defender** | Pink (Hanged Man) | Earth | Wind | 19,750,000+ | 30 | Spawns from Pink Gauge | **Goliath Organ** (Host mat), Earthborne Astra, Hanged Man Idean |
| **Goliath Keeper** | **Defender** | Green (Tower) | Earth | Wind | 19,750,000+ | 30 | Spawns from Green Gauge | **Goliath Rib** (Host mat), Earthborne Astra, Tower Idean |
| **Frenzied Howler** | **Defender** | Yellow (Death) | Dark | Light | 19,750,000+ | 30 | Spawns from Yellow Gauge | **Goliath Core** (Host mat), Darkborne Astra, Death Idean |
| **Herald of The Hanged Man**| **Sephira Herald**| Pink Sector | Earth | Wind | ~15,000,000 | 20 | Random spawn | **+100% Sephira Gauge Boost for 60m**, Aquila Fragments |
| **Herald of The Tower** | **Sephira Herald**| Green Sector | Earth | Wind | ~15,000,000 | 20 | Random spawn | **+100% Sephira Gauge Boost for 60m**, Celsus Fragments |
| **Herald of Death** | **Sephira Herald**| Yellow Sector | Dark | Light | ~15,000,000 | 20 | Random spawn | **+100% Sephira Gauge Boost for 60m**, Bellator Fragments |
| **Bloodstained Barbarian** | 5-Gauge Standard | Pink Sector | Earth | Wind | 21,000,000 | 20 | Fills Pink Defender Gauge | Primary Earth farm, spawns Avatar of Avarice |
| **Vestige of Truth** | 3-Gauge Standard | Pink Sector | Earth | Wind | 16,600,000 | 20 | 3-bar low HP fast burst | Fast burst OTK, Sephira materials, Verum Proofs |
| **Earthshaking Panther** | 5-Gauge Standard | Green Sector | Earth | Wind | 21,000,000 | 20 | Fills Green Defender Gauge | Primary Earth farm, spawns Goliath Keeper |
| **Goliath Vanguard** | 3-Gauge Standard | Green Sector | Earth | Wind | 16,600,000 | 20 | 3-bar low HP fast burst | Fast burst OTK, Sephira materials |
| **Writhing Despair** | 5-Gauge Standard | Yellow Sector | Dark | Light | 21,000,000 | 20 | Fills Yellow Defender Gauge | Primary Dark farm, spawns Frenzied Howler |
| **Temptation's Guide** | 5-Gauge Standard | Yellow Sector | Dark | Light | 21,000,000 | 20 | Fills Yellow Defender Gauge | Secondary Dark farm, Dark Sephira Box |
| **Farseeing Darkmistress** | 3-Gauge Standard | Yellow Sector | Dark | Light | 16,600,000 | 20 | 3-bar low HP fast burst | Fast Dark burst OTK, Darkborne Astra |

---

## 3. Boss Mechanics & Omen Handling: Goliath Triune

**Goliath Triune** is an Earth-element Zone Boss requiring Wind frontline teams. In subsequent daily battles, its HP scales to **500M**, presenting high-threat special triggers:

### 3.1 Triggers & Omen Cancellation
1. **TR 100% (Join): *Sinister Rafaga***
   - Cast immediately upon battle initialization.
   - Deals multiple hits of static Earth damage to random allies and grants the boss undispellable **Debuff Res. Up**.
   - **Tactical Strategy**: Turn 1 Quick Summon (Beelzebub / 250% Lucifer) to strip shields and apply un-erasable DEF down before attacking.
2. **TR 85% & TR 35% (Non-Prototype) / 75% (Prototype): *Demolition***
   - Deals heavy multi-hit Earth damage to random party members and grants the boss offensive ATK and Echo buffs.
   - **Omen Cancellation Requirement**: Deal **3,500,000 skill damage** in a single turn.
   - **Tactical Strategy**: In `smart_full_auto`, frontline red damage abilities and summon calls are held or chained to crack the 3.5M threshold instantly.
3. **TR 65% & TR 20%: *Descorrer***
   - Unleashes massive single-target Earth damage and grants multi-attack buffs to the boss.
   - **Omen Cancellation Requirement**: Inflict **Wind DEF Down** on the boss.
   - **Tactical Strategy**: Handled via Blue/Mist debuff skill priority or summon call (e.g. Tiamat Aura / Freyr call).

---

## 4. Routing Architecture & Automation Blueprint

### 4.1 Map Navigation vs. Direct Supporter Routing
The engine operates across two complementary routing pathways:
1. **Universal Stage 3 Map Controller (`#replicard/stage/3`)**:
   - The engine navigates to `#replicard/stage/3`.
   - `QuestNavigationService` inspects the active map frame:
     - Priority 1: Exact target `questId` match
     - Priority 2: Defender quest (`[data-is-hell="1"]`)
     - Priority 3: First available quest in division frame
   - Automatically handles sector map canvas transitions without fragile manual coordinates.
2. **Direct Deck Supporter Route**:
   - Supporter confirmation screen: `#replicard/supporter/3/3/<divId>/<questId>/25`.
   - The engine clicks `.btn-usual-ok.se-quest-start` once to transition directly into combat.

### 4.2 AAP Replenishment Lifecycle
- Standard monsters cost **20 AAP**; Defenders and Goliath Triune cost **30 AAP**.
- Whenever AAP drops below requirement, Granblue displays the AAP Recovery modal.
- `UniversalWorkflowEngine.handleAapRecoveryModal()` intercepts the popup, consumes Half-Elixirs (+100 AAP each) using human-like motor kinematics, and resumes execution seamlessly.

---

## 5. Standard Operating Procedures (CLI Reference)

### Execute Universal Stage 3 Map Scanner:
```bash
bun run arcarum:stage3
# or windowed:
bun run stage3:windowed
```

### Farm Specific Bosses & Defenders:
```bash
# Zone Boss: Goliath Triune (Earth)
bun run arcarum:triune

# Pink Defender: Avatar of Avarice (The Hanged Man)
bun run arcarum:avarice

# Green Defender: Goliath Keeper (The Tower)
bun run arcarum:keeper

# Yellow Defender: Frenzied Howler (Death)
bun run arcarum:howler

# Sephira Heralds (+100% Boost)
bun run arcarum:goliath-herald
```

### Standard 5-Gauge Fast Mob Grinding:
```bash
bun run arcarum:panther    # Earthshaking Panther (spawns Keeper)
bun run arcarum:barbarian  # Bloodstained Barbarian (spawns Avarice)
bun run arcarum:despair    # Writhing Despair (spawns Howler)
```

---

## 6. Stage 3 Zone Faym: Lilywhite Paragon & Faymian Fortress Architecture

### 6.1 Direct Quest URL Structure
The direct URL `https://game.granbluefantasy.jp/#replicard/supporter/3/3/10/812111/25` breaks down as:
- `3`: Stage ID (Stage 3 Here Be Staves Hub)
- `3`: Dungeon ID
- `10`: Division ID (Sector 10 - The Moon / Green Route)
- `812111`: Quest ID (Authoritative ID for **Lilywhite Paragon**)
- `25`: Quest Type (Arcarum Replicard Solo Combat)

### 6.2 Enemy Profiles & Mechanics
1. **Lilywhite Paragon**:
   - **Level & HP**: Lv 100, 98,000,000 HP, 2 Charge Diamonds, 30 AAP.
   - **Element**: Water (Weak to Earth).
   - **Drops**: **Faym Rib** (Zone Boss *Faymian Gun* host treasure), Moon Idean, Aquaborne Astra, Moon Veritas, Sephira Emerald Blaster/Harp, Leviathan Omega AX weapons.
2. **Faymian Fortress**:
   - **Level & HP**: Lv 90, 61,650,000 HP, 2 Charge Diamonds, 20 AAP.
   - **Element**: Water (Weak to Earth).
   - **Mechanic**: Normal attacks hit all allies. Casts *Grand Seism* (75%, 50%, 25% HP) granting **Earth Barrier** (50% damage cut, un-dispellable, cancelled by taking **10 or more hits in 1 turn**).
   - **Farming Role**: Green 5-Gauge mob that fills the gauge to spawn Lilywhite Paragon.

### 6.3 Authoritative Burst Rotation & Real-Time Enemy HP Telemetry
The production JSON template `templates/arcarum-lilywhite-paragon-smart.json` executes:
```text
C4S1 (ensureCast: true) -> Quick Call -> Reload -> C3S1 -> C2S1 -> C2S2 -> C1S1 -> C1S3 -> Attack (350ms) -> Reload -> Summon #4 -> Attack (350ms) -> Reload -> Summon #3 -> Attack (350ms) -> Rerun (confirm_result)
```
During execution, `CombatResolutionService.getAndLogEnemyHp` continuously reads JS game state (`stage.pJsnData.boss.param` / `stage.gGameStatus.boss.param`) and emits real-time telemetry:
```text
[Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 98,000,000 / 98,000,000 (100.0%) [Initial Battle State]
[Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 72,400,000 / 98,000,000 (73.9%) [-25,600,000 DMG] [Post-Quick-Call]
[Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 31,100,000 / 98,000,000 (31.7%) [-41,300,000 DMG] [Turn 1 Attack]
[Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 0 / 98,000,000 (0.0%) [DEFEATED]
```

### 6.4 Execution Commands
```bash
# Lilywhite Paragon (Direct Quest 812111)
bun run paragon
bun run paragon:windowed
bun run arcarum:paragon

# Faymian Fortress (Spawns Lilywhite Paragon)
bun run fortress
bun run fortress:windowed
bun run arcarum:fortress
```
