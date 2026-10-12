# Volume 17: Replicard Sandbox - Zone Mundus, Militis Bosses & Autonomous Farming Architecture KMS

**Version:** 2.0.0  
**Author:** Senior Distributed Systems & Knowledge Architecture Principal  
**Target Repository:** `C:\laragon\www\gbf\data\`  
**Compliance:** JSON Schema Draft 2020-12, Zero Duplication Policy, Domain-Driven Design (DDD)  

---

## 1. Executive Summary & Architectural Overview

The **Replicard Sandbox** (*Here Be Swords* / レプリカルド・サンドボックス) represents Granblue Fantasy's premier solo endgame progression grid and New World Foundation weapon/uncap economy. Within this system, **Zone Mundus (Stage 10)** serves as the apex sector, housing the highest-tier Militis Defenders, 5-gauge standard farming targets, Sephira Heralds, and the sector core boss, **The World**.

Historically, sandbox automation struggled with dynamic map overlays, AAP replenishment popups, division navigation canvas layers, and Defender spawn states. This Volume establishes the definitive, authoritative Single Source of Truth (SSOT) for Zone Mundus, documenting the exact division routing topology, quest identifiers, AAP consumption models, Sephira box mechanics, Militis loot tables, and autonomous Smart Full Auto combat blueprints.

```
                              Zone Mundus (Stage 10) Topology
                                            │
         ┌──────────────────┬───────────────┴───────────────┬──────────────────┐
         ▼                  ▼                               ▼                  ▼
   Serenity Ridge      Great Wastes                  Grotto of Solace    Desolate Ravine
    (Fire Sector)     (Earth Sector)                  (Water Sector)      (Wind Sector)
    - Pincers (Div 2)  - Herald (Div 6)                - Herald (Div 9)    - Demon Cat (Div 13)
    - Fire Demon (3)   - Princess (Div 6)              - Steve (Div 9)     - Green Dragon (14)
    - Prometheus (3)   - Gilgamesh (Div 7)             - Ca Ong (Div 10)   - Morrigna (Div 15)
    - Rock (Div 4)     - Elephant (Div 7)              - Tide Caller (10)  - Wild Hunt (Div 15)
                       - Love Meeee (Div 8)            - Dragon Princess (11)
                                            │
                                            ▼
                                      The New World
                                      (Center Core)
                                   - The World (Div 16)
```

---

## 2. Zone Mundus Complete Division & Quest Topology

Direct live CDP inspection and network analysis of `https://game.granbluefantasy.jp/#replicard/stage/10` yields the authoritative 19-quest topology across all 14 playable divisions:

| Div ID | Division Name | Quest ID | Quest Name | Target Type | Element | AAP | Hell Gauge / Stock | Primary Drops & Utility |
| :---: | :--- | :---: | :--- | :---: | :---: | :---: | :---: | :--- |
| **2** | Serenity Ridge: Foothills | `819011` | Hotheaded Pincers | 3-Gauge Standard | Fire | 20 | Fills Hell 1 (3-bar) | Fast burst kill, Sephira materials |
| **3** | Serenity Ridge: Slopes | `819141` | **Prometheus Militis** | **Defender (Hell)** | Fire | 30 | Stock: 600+ | Prominence Militis, Fire Luster, Pillar of Sun |
| **3** | Serenity Ridge: Slopes | `819021` | Earth-Shattering Fire Demon | 5-Gauge Standard | Fire | 20 | Fills Hell 1 (5-bar) | Primary Fire farm, spawns Prometheus |
| **4** | Serenity Ridge: Peaks | `819031` | High-Voltage Rock | 5-Gauge Standard | Light | 20 | Fills Hell 1 | Light Sephira Box, Fire Defender gauge |
| **6** | Eastern Great Wastes | `819201` | **Herald of Earth** | **Sephira Herald** | Fire | 20 | N/A | **+100% Sephira Gauge Boost (1 hour)** |
| **6** | Eastern Great Wastes | `819041` | Princess of the Horde | 5-Gauge Standard | Earth | 20 | Fills Hell 5 (5-bar) | Earth Sephira Box, spawns Gilgamesh |
| **7** | Southern Great Wastes | `819161` | **Gilgamesh Militis** | **Defender (Hell)** | Earth | 30 | Stock: 600+ | Heavy Cane Militis, Earth Luster, Pillar of Land |
| **7** | Southern Great Wastes | `819051` | Elephant Stomping Ground | 5-Gauge Standard | Earth | 20 | Fills Hell 5 (5-bar) | Primary Earth farm, spawns Gilgamesh |
| **8** | Western Great Wastes | `819061` | Love Meeee | 5-Gauge Standard | Dark | 20 | Fills Hell 5 | Dark Sephira Box, Earth Defender gauge |
| **9** | Grotto of Solace: Entrance | `819191` | **Herald of Water** | **Sephira Herald** | Fire | 20 | N/A | **+100% Sephira Gauge Boost (1 hour)** |
| **9** | Grotto of Solace: Entrance | `819071` | Parasite Steve | 5-Gauge Standard | Water | 20 | Fills Hell 4 (5-bar) | Primary Water farm, spawns Ca Ong |
| **10** | Grotto of Solace: Midpoint | `819151` | **Ca Ong Militis** | **Defender (Hell)** | Water | 30 | Stock: 600+ | Glacial Rapier Militis, Water Luster, Pillar of Sea |
| **10** | Grotto of Solace: Midpoint | `819081` | Tide Caller | 5-Gauge Standard | Water | 20 | Fills Hell 4 (5-bar) | Water Sephira Box, spawns Ca Ong |
| **11** | Grotto of Solace: Depths | `819091` | Proud War Princess of Dragons | 5-Gauge Standard | Dark | 20 | Fills Hell 4 | Dark Sephira Box, Water Defender gauge |
| **13** | Desolate Ravine: The Toes | `819101` | Winged Demon Cat | 3-Gauge Standard | Wind | 20 | Fills Hell 2 (3-bar) | Fast burst kill, Sephira materials |
| **14** | Desolate Ravine: The Belly | `819111` | Dragon in Glittering Green | 5-Gauge Standard | Wind | 20 | Fills Hell 2 (5-bar) | Primary Wind farm, spawns Morrigna |
| **15** | Desolate Ravine: The Crown | `819171` | **Morrigna Militis** | **Defender (Hell)** | Wind | 30 | Stock: 600+ | Tempest Militis, Wind Luster, Pillar of Sky |
| **15** | Desolate Ravine: The Crown | `819121` | Goddess of the Wild Hunt | 5-Gauge Standard | Light | 20 | Fills Hell 2 | Light Sephira Box, Wind Defender gauge |
| **16** | The New World | `819131` | **The World** | **Core Boss** | All | 30 | Sephira Genesis | World Idean, Mundus Lusters, New World Quartz |

---

## 3. Replicard Direct Supporter URL Routing Standard

Granblue Fantasy's client-side Backbone.js router encodes Replicard battle supporter selections with an authoritative 5-to-7 parameter tuple:

```
#replicard/supporter/<stage_id>/<dungeon_id>/<division_id>/<quest_id>/<quest_type>
```

- `stage_id`: `10` (Zone Mundus)
- `dungeon_id`: `10` (Zone Mundus)
- `division_id`: Canonical division integer where the node resides
- `quest_id`: Authoritative quest identifier (e.g. `819151` for Ca Ong Militis)
- `quest_type`: `25` (Standard Replicard quest type)

### 3.1 Direct Router Navigation Efficiency
Navigating directly to `#replicard/supporter/10/10/<divId>/<questId>/25` bypasses all Stage map canvas rendering, division frame overlays, and node selection clicks. The engine lands directly on the Deck Supporter confirmation screen, requiring only a single click on `.btn-usual-ok.se-quest-start` to initiate combat.

---

## 4. Economic Engines: AAP, Sephira Boxes & Defender Spawns

### 4.1 AAP (Arcarum Action Points) Mechanics
- **Base Consumption**: 20 AAP for standard mobs / Heralds; 30 AAP for Defenders and The World.
- **Replenishment Modal**: Triggered when AAP < quest requirement. Handled autonomously by `UniversalWorkflowEngine.handleAapRecoveryModal()`, consuming Half-Elixirs (+100 AAP each) or full Elixirs without halting the automation loop.

### 4.2 Sephira Gauge & Box Velocity
- Defeating a standard 5-gauge monster adds **+20 points** to the corresponding elemental Sephira Box.
- With the **Herald +100% boost active**, each clear yields **+40 points**.
- A standard 100-point Sephira Box is unlocked every **2.5 to 3 runs**, yielding Astras, Ideans, Sephira Stones, New World Quartz, and Verum Proofs at peak velocity.

### 4.3 Defender Spawns & Stock Accumulation
- Each standard 5-gauge monster clear increments the sector Defender gauge (`hell_gauge_count`).
- Upon reaching the gauge limit (6 to 10 clears), a Defender stock (`hell_stock`) is banked.
- Players can farm hundreds of standard runs to stockpile Defender attempts, then batch-run Defender workflows (`arcarum-ca-ong-militis-smart`, etc.) to farm Militis weapons and Lusters continuously.

---

## 5. Autonomous Combat Engine: Smart Full Auto Doctrine

All Zone Mundus workflow templates standardize on the `smart_full_auto` step action pipeline:

```json
{
  "code": "smart_full_auto",
  "delayAfterMs": 350,
  "tacticalSkillsMode": "smart",
  "quickSummon": true
}
```

### 5.1 Tactical Execution Hierarchy:
1. **Omen Interception**: Scans for V2 plain damage omens (e.g. 1M Plain Damage) and immediately dispatches Beelzebub quick summon if available.
2. **Turn 1 Quick Summon**: Fires the configured Quick Summon (e.g. 250% Lucifer / Beelzebub / Triple Zero / Bubz) on turn 1 to break shields and apply massive defense debuffs.
3. **Methodological Skill Priority**: Evaluates frontline skill cooldowns in < 1ms via `stage.pJsnData`:
   - Field (Yellow/Field - Priority 5)
   - Debuff (Blue - Priority 4)
   - Buff (Yellow - Priority 3)
   - Damage Nuke (Red - Priority 1)
   - Conditional Healing (Green - Priority 2, only if party HP < 75%)
4. **Attack & Animation Skip**: Dispatches turn attack, waits exactly 350ms for the turn resolution packet to register on the game server, and executes a lightning reload to bypass battle animation latency.
5. **Auto-Loop to Victory**: Repeats the loop autonomously until the battle concludes, then dispatches `confirm_result` to dismiss loot and return to supporter selection.
