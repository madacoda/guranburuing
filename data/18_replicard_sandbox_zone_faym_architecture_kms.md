# Volume 18: Replicard Sandbox - Zone Faym, Faymian Fortress & Lilywhite Paragon Architecture KMS

**Version:** 1.0.0  
**Author:** Senior Distributed Systems & Knowledge Architecture Principal  
**Target Repository:** `C:\laragon\www\gbf\data\`  
**Compliance:** JSON Schema Draft 2020-12, Zero Duplication Policy, Domain-Driven Design (DDD)  

---

## 1. Executive Summary & Architectural Overview

The **Replicard Sandbox** (*Here Be Staves* / レプリカルド・サンドボックス: 杖鳴らす刻の地) forms the primary foundation for Arcarum Evoker recruitment, Domain of the Evoker unlocks, and New World Foundation weapon unbinding. Within this sector group, **Zone Faym (Stage 3)** is dedicated to **The Moon** (Haaselia / Water) and **Death** (Nier / Dark) progression trees.

Within Division 10 (**Central Wilderness**), two primary encounters drive the progression velocity:
1. **Faymian Fortress** (`812051`): The primary 5-gauge Water mob (Lv90, ~61.65M HP). Clearing it builds the Green Sephira Gauge and increments the Defender attempt stock.
2. **Lilywhite Paragon** (`812111`): The sector Defender (Lv100, ~98.0M HP). Consumes 30 AAP / 1 banked Defender attempt to drop **Faym Rib** (自発素材 / host material for the Area Faym Zone Boss *Faymian Gun*), Moon Veritas, and Leviathan Omega AX weapons.

```
                           Zone Faym (Stage 3) - Central Wilderness (Div 10)
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        ▼                                                 ▼
             Faymian Fortress (812051)                         Lilywhite Paragon (812111)
             - Type: 5-Gauge Standard Mob                      - Type: Sector Defender (The Moon)
             - Level: 90 (~61.65M HP)                          - Level: 100 (~98.0M HP)
             - AAP: 20                                         - AAP: 30 (or 1 Banked Attempt)
             - Drops: Green Sephira Box, Astra, Idean          - Drops: Faym Rib, Moon Veritas, Leviathan AX
             - Function: Spawns / Charges Defender             - Function: Supplies Host Material for Faymian Gun
```

---

## 2. Authoritative Route & Supporter URLs

In accordance with the Granblue Fantasy Backbone.js client router standard:
```
#replicard/supporter/<stage_id>/<dungeon_id>/<division_id>/<quest_id>/<quest_type>
```

| Encounter | Stage ID | Dungeon ID | Div ID | Quest ID | Quest Type | Authoritative Supporter URL |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Faymian Fortress** | `3` | `3` | `10` | `812051` | `25` | `https://game.granbluefantasy.jp/#replicard/supporter/3/3/10/812051/25` |
| **Lilywhite Paragon** | `3` | `3` | `10` | `812111` | `25` | `https://game.granbluefantasy.jp/#replicard/supporter/3/3/10/812111/25` |
| **Stage 3 Universal Hub** | `3` | `3` | `10` | `*` | `*` | `https://game.granbluefantasy.jp/#replicard/stage/3` |

---

## 3. Automation Blueprints & CLI Execution

### 3.1 Template Suite

| Template Name | File | Strategy | Runs |
| :--- | :--- | :--- | :---: |
| **Faymian Fortress (Burst)** | `templates/arcarum-faymian-fortress.json` | Turn 1 Quick Call + Attack + Reload Loop | 500 |
| **Faymian Fortress (Smart)** | `templates/arcarum-faymian-fortress-smart.json` | Tactical Smart Full Auto (Zero-Shift) | 500 |
| **Lilywhite Paragon (Burst)** | `templates/arcarum-lilywhite-paragon.json` | Quick Call + Frontline Nukes + Attack Loop | 100 |
| **Lilywhite Paragon (Smart)** | `templates/arcarum-lilywhite-paragon-smart.json` | Tactical Smart Full Auto (350ms F5 Lockout Skip) | 100 |
| **Zone Faym Stage 3 (Smart)** | `templates/arcarum-stage-3-smart.json` | Stage Map Scanner: Paragon Priority -> Fortress Fallback | 500 |

### 3.2 CLI Commands

```bash
# Farm Faymian Fortress (Smart Full Auto):
bun run fortress
bun run arcarum:fortress
bun src/cli/run-arcarum.ts acc1 faymian-fortress 100

# Farm Lilywhite Paragon Defender (Burn Banked Attempts):
bun run lilywhite
bun run arcarum:lilywhite
bun src/cli/run-arcarum.ts acc1 lilywhite-paragon 94

# Run Stage 3 Universal Controller (Auto-Interleave Defender & Mob):
bun run stage3
bun run arcarum:faym
bun src/cli/run-arcarum.ts acc1 stage3 500
```
