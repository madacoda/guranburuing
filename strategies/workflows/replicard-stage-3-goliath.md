# Replicard Sandbox: Stage 3 (Zone Goliath & Zone Faym) Comprehensive Farming & Boss Guide

## 1. Executive Summary & Objective

**Stage 3** (*Here Be Staves* / `https://game.granbluefantasy.jp/#replicard/stage/3`) encompasses the primary Replicard Sandbox progression sectors for **Zone Goliath** (Earth / Dark) and **Zone Faym** (Water / Earth). It houses:

### Zone Faym (Water & Earth Progression):
- **Zone Boss**: **Faymian Gun** (Water element, 200M/500M HP)
- **Defenders**:
  - **Lilywhite Paragon** (Green Defender / The Moon / Water, Lv 100, 98M HP, Quest ID: `812111`, `#replicard/supporter/3/3/10/812111/25`)
  - **Justice Defender** (Pink Defender / Justice / Water)
  - **Death Defender** (Yellow Defender / Death / Dark)
- **5-Gauge Intermediate Boss**:
  - **Faymian Fortress** (Water, Lv 90, 61.65M HP, casts *Grand Seism* with 10-Hit Earth Barrier 50% DMG cut)

### Zone Goliath (Earth & Dark Progression):
- **Zone Boss**: **Goliath Triune** (Earth element, 200M/500M HP)
- **Defenders**:
  - **Avatar of Avarice** (Pink Defender / The Hanged Man / Earth)
  - **Goliath Keeper** (Green Defender / The Tower / Earth)
  - **Frenzied Howler** (Yellow Defender / Death / Dark)
- **Sephira Heralds**: Herald of The Hanged Man, Herald of The Tower, Herald of Death (+100% Sephira Gauge Boost)
- **Standard 5-Gauge Mobs**: Bloodstained Barbarian, Earthshaking Panther, Writhing Despair

The automation suite provides high-efficiency, kickout-immune Smart Full Auto workflows for every single raid, defender, and standard farming node in Stage 3.

---

## 2. Complete Stage 3 Encounter Matrix

| Target | Category | Zone / Route | Element | Weakness | Cost | Spawns From / Requires | Primary Loot Drops |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :--- |
| **Lilywhite Paragon** | **Defender** | Faym (The Moon) | Water | Earth | 30 AAP | Green Gauge / Faymian Fortress (`812111`) | **Faym Rib**, Moon Idean, Aquaborne Astra, Moon Veritas, Sephira Emerald Blaster/Harp |
| **Faymian Fortress** | 5-Gauge | Faym (The Moon) | Water | Earth | 20 AAP | Green Sector Node (Div 10) | Spawns Lilywhite Paragon, Water Sephira Box, 10-Hit Barrier Buster |
| **Goliath Triune** | **Zone Boss** | Goliath Core | Earth | Wind | 30 AAP | Goliath Rib ×1, Goliath Organ ×1, Goliath Core ×1 | Tower / Hanged Man / Death Ideans, Earthborne Astra, Quartz |
| **Avatar of Avarice** | **Defender** | Goliath (Hanged Man) | Earth | Wind | 30 AAP | Pink Gauge (Bloodstained Barbarian) | **Goliath Organ**, Earthborne Astra, Hanged Man Idean |
| **Goliath Keeper** | **Defender** | Goliath (Tower) | Earth | Wind | 30 AAP | Green Gauge (Earthshaking Panther) | **Goliath Rib**, Earthborne Astra, Tower Idean |
| **Frenzied Howler** | **Defender** | Goliath (Death) | Dark | Light | 30 AAP | Yellow Gauge (Writhing Despair) | **Goliath Core**, Darkborne Astra, Death Idean |
| **Goliath Heralds** | **Herald** | Goliath | All | Adaptive | 20 AAP | Random map spawn | **+100% Sephira Gauge Boost for 60 Minutes** |
| **Earthshaking Panther** | 5-Gauge | Goliath (Green) | Earth | Wind | 20 AAP | Green Sector Node | Fills Goliath Keeper Defender gauge |
| **Bloodstained Barbarian** | 5-Gauge | Goliath (Pink) | Earth | Wind | 20 AAP | Pink Sector Node | Fills Avatar of Avarice Defender gauge |
| **Writhing Despair** | 5-Gauge | Goliath (Yellow) | Dark | Light | 20 AAP | Yellow Sector Node | Fills Frenzied Howler Defender gauge |

---

## 3. Recommended Party Setups & Tactics

### 3.1 Earth Frontline & Targeted Burst Rotation (Lilywhite Paragon)
- **Enemy Element**: Water | **Player Element**: Earth (98,000,000 HP, Level 100)
- **Main Summon**: Yggdrasil Omega 250% or Titan 250%
- **Quick Summon**: **Beelzebub** / **Uriel** / **Triple Zero**
- **Core Characters**: Caim, Lobelia, Soriz, Satyr, Mahira, Fiorito, Pengy
- **Exact Burst Rotation**:
  1. `C4S1 (make sure clicked or casted)` - Ensured character 4 ability 1 dispatch with verified drawer retry.
  2. `Quick Call` - Quick summon instant nuke + unerasable DEF down.
  3. `Reload (F5)` - Fast animation lockout skip.
  4. `C3S1` - Character 3 Skill 1.
  5. `C2S1` - Character 2 Skill 1.
  6. `C2S2` - Character 2 Skill 2.
  7. `C1S1` - Character 1 (MC) Skill 1.
  8. `C1S3` - Character 1 (MC) Skill 3.
  9. `Attack` - Turn 1 normal attack.
  10. `Reload (F5)` - Fast animation skip.
  11. `Summon #4` - Invoke sub-summon slot 4.
  12. `Attack` - Turn 2 normal attack.
  13. `Reload (F5)` - Fast animation skip.
  14. `Summon #3` - Invoke sub-summon slot 3.
  15. `Attack` - Turn 3 normal attack.
  16. `Rerun` - Confirms victory loot, restores AAP via Half-Elixirs if needed, and repeats next battle loop.
- **Real-Time Enemy HP Telemetry**:
  Automatically extracts and logs live enemy current HP, max HP, remaining %, and delta damage across all turns, reloads, and skills:
  ```text
  [Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 98,000,000 / 98,000,000 (100.0%) [Initial Battle State]
  [Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 72,400,000 / 98,000,000 (73.9%) [-25,600,000 DMG] [Post-Quick-Call]
  [Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 31,100,000 / 98,000,000 (31.7%) [-41,300,000 DMG] [Turn 1 Attack]
  [Combat:Enemy] 👾 Enemy: Lilywhite Paragon | Remaining HP: 0 / 98,000,000 (0.0%) [DEFEATED]
  ```
- **Faymian Fortress Barrier Mechanic**:
  - Casts *Grand Seism* at 75%, 50%, 25%, and on charge attack.
  - Grants the boss **Earth Barrier** (cuts damage taken by 50%; cannot be dispelled).
  - Automatically broken when dealing **10 or more damage hits in a single turn**. Multi-hit skills or high multi-attack easily crack this barrier.

### 3.2 Wind Frontline (for Goliath Triune, Avatar of Avarice, Goliath Keeper)
- **Main Summon**: Zephyrus 250% or Tiamat Aura 250%
- **Quick Summon**: **Beelzebub** or **Triple Zero**
- **Core Characters**: Narmaya (Grand), Charlotta (Grand), Catura, or standard Wind burst attackers

### 3.3 Light Frontline (for Frenzied Howler & Dark Mobs)
- **Main Summon**: Zeus 250% or Luminiera Credo 250%
- **Quick Summon**: **Lucifer 250%** or **Beelzebub**
- **Core Characters**: Nehan, Florence, Mugen (Halloween), or standard Light burst attackers

---

## 4. Operational Commands & CLI Reference

### 4.1 Zone Faym Targets (Lilywhite Paragon & Faymian Fortress)
```bash
# Lilywhite Paragon (Direct Quest 812111, Water Defender, 30 AAP)
bun run paragon
bun run paragon:windowed
bun run arcarum:paragon

# Faymian Fortress (Water 5-Gauge, 10-Hit Barrier, 20 AAP)
bun run fortress
bun run fortress:windowed
bun run arcarum:fortress
```

### 4.2 Universal Stage 3 Map Controller
Navigates to `#replicard/stage/3`, dynamically scans for available Defenders or active quests, and executes combat:
```bash
# Headless run (500 runs default)
bun run arcarum:stage3

# Windowed GUI debugging
bun run stage3:windowed

# Custom run limit
bun src/cli/run-arcarum.ts acc1 stage3 100
```

### 4.3 Zone Boss: Goliath Triune
```bash
# Headless run (consumes 1 Rib, 1 Organ, 1 Core per run)
bun run arcarum:triune
bun run triune:windowed
```

### 4.4 Zone Goliath Defenders
```bash
# Green Defender: Goliath Keeper (Farms Goliath Rib)
bun run arcarum:keeper
bun run keeper:windowed

# Pink Defender: Avatar of Avarice (Farms Goliath Organ)
bun run arcarum:avarice
bun run avarice:windowed

# Yellow Defender: Frenzied Howler (Farms Goliath Core)
bun run arcarum:howler
bun run howler:windowed
```

### 4.5 Sephira Heralds & 5-Gauge Mobs
```bash
# Sephira Heralds (+100% Boost for 60 Minutes)
bun run arcarum:goliath-herald

# Standard 5-Gauge Fast Farm (Sub-8s loops)
bun run arcarum:panther    # Green Sector (Earth)
bun run arcarum:barbarian  # Pink Sector (Earth)
bun run arcarum:despair    # Yellow Sector (Dark)
```

---

## 5. Automation Architecture & Resilience

1. **Auto-AAP Replenishment**:
   `UniversalWorkflowEngine.handleAapRecoveryModal()` intercepts AAP deficiency popups, consuming Half-Elixirs (+100 AAP each) using natural human motor delays.
2. **Animation Skip**:
   All templates execute a **350ms wait & reload** after dispatching the turn attack, bypassing heavy CreateJS combat animation latency.
3. **Session Immunity Shield**:
   `session-immunity.ts` remains active in the page context, preventing Mobage JSSDK cross-domain session kickouts.
4. **Sentinel Watchdog**:
   If an in-game CAPTCHA or admin prompt is detected, automation freezes immediately, pushes an alert, and awaits resolution.
