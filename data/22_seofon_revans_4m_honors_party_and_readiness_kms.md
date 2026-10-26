# Volume 22: Seofon (Impossible) 4M Honors Party Composition Research, Schema & Readiness Auto-Checker

**Document Version:** `2.0.0`  
**Subsystem:** Combat Mechanics, Revans Raid Optimization, & Roster Readiness Verification  
**Authoritative Schema:** `data/schemas/siete-party-comp.schema.json` & `data/schemas/siete-roster.schema.json`  
**Authoritative Catalog:** `data/combat/siete-party-compositions.catalog.json`

---

## 1. Executive Summary & Raid Mathematics

**Seofon (Impossible)** (`siete` / `revans_seofon`, Quest ID `305411` Join / `305401` Host, Stage ID `12072`) is a 6-Player Wind V2 raid in the **Revans Impossible Series** and the primary farming source for **Sette di Spade** (*Siete Swords*) and **Eternity Sands**.

### 1.1 Blue Chest & 4M Honors Mathematical Threshold
| Metric | Value | Operational Meaning |
| :--- | :--- | :--- |
| **Boss Total HP** | `2,500,000,000` (2.5B) | 6-player raid; fast rooms clear in 90–150 seconds |
| **Base Defense** | `20.0` | High base defense; makes flat supplemental damage and high-cap nukes/Ougis mandatory |
| **Blue Chest Guarantee** | **`4,000,000` Honors** | ~100% Blue Chest proc rate at 4.0M Honors (scales linearly from ~1.5M to 4.0M) |
| **Equivalent Total Damage** | **`400,000,000` Damage** | At standard `0.01` honor-per-damage ratio (`10,000` honors per `1,000,000` damage), plus ~20k–40k bonus honors from debuffs/buffs/omen cancels |
| **Signature Omen Cancel** | **`77,777,777` Damage** | Single-turn damage requirement to cancel *Emblema*, *Cien Mil Espadas*, *Infinito Creare*, and *Cinco Mil Espadas* |

---

## 2. Entry Triggers & Battle System V2 Physics

Unlike standard V2 raids, Seofon enforces three lethal entry and turn-cycle constraints that invalidate conventional Fire burst setups if not engineered around:

1. **Non-Fire Execution Protocol (Entry Trigger)**:
   - Upon entering battle (or bringing a sub-ally to the frontline), Seofon immediately deals **999,999 plain damage** to any non-Fire character.
   - **Rule**: All 5 party slots (MC + 3 Frontline + 2 Backline) MUST be 100% Fire element. Off-element sacrifices (e.g., Dark Death fodder) cannot be used to trigger Evoker switch-ins; instead, Fire **Ragazzo** (`3040446000`) is used for Turn-3/4 self-sacrifice into **Alanaan (FLB)** or **Fraux (FLB)**.
2. **99-Turn Summon Cooldown Lock (Entry Trigger)**:
   - On battle entry, Seofon inflicts a **99-turn cooldown lock** on all player summons (including Quick Summon).
   - **Rule**: Turn-1 `quick_call` (such as Turn-1 Sun or Bubs call) is completely disabled. Party compositions must achieve **77,777,777+ single-turn damage** and **400,000,000 cumulative damage** relying strictly on **Main/Supporter Passive Auras** (`Agni`, `Colossus Ira Omega`, `Lucifer Lv250`, `Beelzebub`) and **Passive Sub-Auras** (`Michael`, `The Sun`, `Belial`, `Wilnas`, `The Devil`, `Triple Zero`).
3. **Enemy Fated Chain (FC) Gauge & *Cien Mil Espadas***:
   - Seofon builds his own FC gauge every turn and upon charge attacks. At 100% Enemy FC, he readies **Cien Mil Espadas** (`Cancel: Fatal Chain OR 77,777,777 damage`).
   - Uncanceled omens grant Seofon **Espada (Spirit Sword)** stacks (`1` to `5`), progressively increasing his ATK, multiattack, elemental damage cut, and uplift.

---

## 3. Omen & HP Phase Matrix

| Omen Name | Trigger | Cancel Condition | Uncanceled Penalty | Optimal Counter Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Emblema** (`エンブレマ`) | Charge Diamond Max (`100%–50%`) | **`77,777,777` Damage** in 1 turn | Massive Wind multi-hit + gains Espada stack + fills enemy FC | Trigger `Percival (Grand)` Sk3 (*Schlacht*) or `Alanaan (FLB)` Sk4 + `Zeta (Grand)` / `Wilnas` full turn burst; or guard if racing solely for 4M honors |
| **Cien Mil Espadas** (`シエン・ミル・エスパーダ`) | Enemy FC Gauge 100% | **Fatal Chain (FC)** OR **`77,777,777` Damage** | Massive AoE Wind damage + `2,000` Burn (3T) + Skill Seal + Espada stack | Hold player Fatal Chain for instant 1-click cancel, or burst `77,777,777` damage |
| **Infinito Creare** (`インフィニート・クレアーレ`) | **80% / 50% / 20% HP** | **`77,777,777` Damage** in 1 turn | Summons 7 Sword Emblems + high teamwide Wind nuke + buff strip | Save `Percival` Sk3, `Wilnas` double Ougi, or 5–6 chain Ougi turn when crossing 80%, 50%, or 20% |
| **Cinco Mil Espadas** (`シンコ・ミル・エスパーダ`) | Charge Diamond Max (`50%–10%`) | **`77,777,777` Damage** in 1 turn | Heavy multi-hit Wind damage + ATK Down + Charge Bar -100% + Espada stack | Cancel with `77.77M` burst turn or guard + `Satyr` auto-cleanse |
| **Cuatro Mil Espadas / Siete Espadas** | **10% HP** | **Uncancelable Red Omen** (or 77 hits / 77.77M variant) | **77,777 Fixed Wind Damage** to all allies (lethal without 100% cut / Undying) | Do not push 10% during 4M honors pub farming unless executing (`Percival` Sk3) or shielded by `Paladin` Sk1 (`100% Elemental Cut`) / `Yuel` Fire Switch |

---

## 4. Top 5 Researched Party Archetypes for 4M Honors (400M Damage)

All 5 archetypes are codified in `data/combat/siete-party-compositions.catalog.json` with full slot requirements, substitute chains, grid blueprints, and turn-by-turn rotations:

### Archetype 1: `siete_fire_manadiver_burst_2t` — Manadiver / Relic Buster 2–3 Turn Burst (Tier SS)
- **Target Mode**: `blue_chest_burst_2t_3t` (2–3 Turns, ~35–45 seconds)
- **MC Class**: `Manadiver` (with Leviathan Mino / Agni Manatura + *Overtrance* + *Wild Magica*) or `Relic Buster` (*Blitz Raid*)
- **Frontline**: `Percival (Grand)` + `Zeta (Grand)` + `Alanaan (FLB)` (or `Wilnas (Grand)` / `Michael (Grand)`)
- **Backline**: `Michael (Grand)` + `Tien (Transcendence 130-150)`
- **Turn-by-Turn Output**:
  - **Turn 1**: Apply DEF down (`Michael` Sk3 / `Zeta` Sk2), activate `Alanaan (FLB)` Sk4 field + Sk1/Sk2 (`100% Crit + 50% Echo + Cap Up`), cast `Manadiver` *Overtrance* + *Wild Magica*, and normal attack (`~135M–165M` damage).
  - **Turn 2**: Cast `Percival (Grand)` Sk3 (*Schlacht* — teamwide Tri-Strike + Fire Amplification) and attack (`~220M–270M` damage, instantly clearing any `77,777,777` *Emblema* / *Infinito Creare* omen and crossing **400M total damage / 4.0M Honors**).

### Archetype 2: `siete_fire_berserker_fa_burst_4t` — Berserker / Sumaibito 4-Turn Full-Auto Burst (Tier SS)
- **Target Mode**: `full_auto_4m_4t_5t` (3–5 Turns, ~55–75 seconds, 100% hands-free Full Auto)
- **MC Class**: `Berserker` (*Beast Fang* + *Ullikummi* / *Rage IV*) or `Sumaibito`
- **Frontline**: `Percival (Grand)` + `Wilnas (Grand)` + `Michael (Grand)` (or `Zeta (Grand)`)
- **Backline**: `Alanaan (FLB)` + `Satyr (Fire)`
- **Mechanics**: Combines `Berserker` Turn-1 200% bar double Ougi with `Wilnas (Grand)`'s massive 6M+ auto-nukes and double Ougi, plus `Percival (Grand)` Sk3 on Turn 1. Averages **95M–115M damage per turn**, reaching **4.0M Honors by Turn 4** on Full Auto.

### Archetype 3: `siete_fire_kengo_ougi_loop` — Kengo Kaneshige Ougi & Fatal Chain Loop (Tier S)
- **Target Mode**: `ougi_loop_5t_6t` (4–6 Turns, ~75–95 seconds, F2P/Magna friendly)
- **MC Class**: `Kengo` with Fire `Unsigned Kaneshige` (Devilry Emblem)
- **Frontline**: `Wilnas (Grand)` + `Silva (Yukata)` + `Satyr (Fire)` (or `Michael (Grand)` / `Mirin (Yukata)`)
- **Backline**: `Michael (Grand)` + `Fraux (FLB)`
- **Mechanics**: Generates **5 to 7 Charge Attacks every single turn**, filling the player's **Fatal Chain (FC) gauge every 1–2 turns** to Effortlessly cancel *Cien Mil Espadas* while `Wilnas` + `Silva (Yukata)` pump `75M–95M` CA + end-of-turn skill damage per turn (reaching **4.0M Honors in 5 turns** even on Magna Colossus grids).

### Archetype 4: `siete_fire_monk_lumberjack_fa_sustain` — Monk / Lumberjack Ragazzo -> Evoker Swap Sustain (Tier S)
- **Target Mode**: `full_auto_sustain_6t_8t` (5–7 Turns, ~85–110 seconds)
- **MC Class**: `Monk` (or `Lumberjack` / `Iatromantis`) with `Fenie (Grand)`'s *Torch of Eternal Flames* or *Ultima Staff*
- **Frontline**: `Percival (Grand)` + `Satyr (Fire)` + `Ragazzo` (or `Fenie (Grand)` / `Fraux (FLB)`)
- **Backline**: `Fraux (FLB)` + `Michael (Grand)`
- **Mechanics**: `Ragazzo` deals massive Turn 1–3 skill damage and self-sacrifices via *Crimson Martyrdom*, cleanly bringing out `Fraux (FLB)` with her upright domain passive (double-casting healing + multi-hit Dispels/Delays every turn). Together with `Satyr`, the team is virtually immortal while averaging `70M+` damage per turn.

### Archetype 5: `siete_fire_paladin_yamato_host_solver` — Paladin / Yamato Full-Raid Host & Omen Solver (Tier A)
- **Target Mode**: `host_omen_solver_full_clear` (6–10 Turns, full 100%–0% solo/host carry)
- **MC Class**: `Paladin` (*Sacred Protection* + *Noblesse Oblige* + *Elemental Phalanx*) or `Yamato` (*Totsuka-no-Tsurugi*)
- **Frontline**: `Percival (Grand)` + `Satyr (Fire)` + `Fenie (Grand)` (or `Anderson` / `Athena` / `Yuel`)
- **Backline**: `Fraux (FLB)` + `Michael (Grand)`
- **Mechanics**: Built for hosts or slow rooms that must survive the **10% HP 77,777 fixed Wind damage trigger (*Cuatro Mil Espadas*)** via `Paladin` Sk1 (`100% Wind Cut` / `10,000 Max Damage Shield`) and `Fenie (Grand)`'s automatic party revival + Undying.

---

## 5. Weapon Grid Requirements & Resonator/Pact Synergies

| Tier | Grid Blueprint | Core Weapons | Estimated HP | 77.77M Omen Capable? | Avg Turns to 4M Honors |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Primal Agni** | `fire_primal_agni_lord_of_flames_burst` | `3x Lord of Flames` (15 Weapon Types), `2x Crimson Scale` (50k Pact Supplemental + 14% Cap), `2x Overrider`, `1x Dark Opus Lv230-250`, `1x Ultima`, `1x Sword of Michael` | `75,000–95,000 HP` | Yes (140M–250M Peak Turn) | **2–3 Turns** |
| **Magna M3** | `fire_magna_m3_ira_blade_burst` | `3x–4x Ira Volcanic Blade` (Colossus M3 Exalto), `2x Lord of Flames` (or `Scythe of Repentance`), `1x Crimson Scale`, `1x Dark Opus`, `1x Ultima`, `1x Sword of Michael` | `65,000–85,000 HP` | Yes (95M–160M Peak Turn) | **3–4 Turns** |
| **Magna M2/F2P** | `fire_magna_kengo_kaneshige_f2p` | `1x Unsigned Kaneshige (Fire)`, `2x–3x Nilakantha (Shiva Staff)`, `2x Al-Abad (Atum Spear)`, `2x Ira Volcanic Blade / Ancient Ecke Sachs`, `1x Dark Opus`, `1x Sword of Michael` | `55,000–75,000 HP` | Yes via FC or 6-CA Chain (`78M–95M`) | **5–6 Turns** |

---

## 6. Siete Readiness Auto-Checker Architecture (`SieteReadinessCheckerService`)

To automatically verify whether an account's characters, weapons, summons, and MC classes meet the requirements for 4M Honors in Seofon (Impossible), the system provides:

1. **Domain Layer (`src/domain/siete/siete-readiness.types.ts`) & Data Catalog (`DataCatalogService`)**:
   - Exposes O(1) indexed lookups for all Siete characters, weapons, summons, raid specifications, and party archetypes from `data/combat/siete-party-compositions.catalog.json`.
2. **Service Layer (`src/services/combat/siete-readiness-checker.service.ts`)**:
   - **Hard Gate Validator**: Verifies 4 mandatory Seofon readiness gates:
     1. `gate_100_percent_fire_allies` (No off-element allies that die to Seofon's 999,999 entry plain damage).
     2. `gate_turn1_summon_lock_compliance` (Validates passive Main/Supporter Auras and Sub-Auras under the 99-turn summon lock).
     3. `gate_minimum_hp_threshold` (Projects party HP >= `50,000` to survive *Emblema* / *Infinito Creare* transitions).
     4. `gate_77m_omen_and_4m_honors_pace` (Projects Peak Single-Turn Damage vs `77,777,777` *Emblema* threshold and Estimated Turns to `4,000,000` Honors).
   - **Slot & Substitute Resolver**: Evaluates the player's owned roster against all 5 Siete Party Archetypes, checking FLB/Lv100/4th-skill conditions (e.g., `Alanaan` Sk4, `Fraux` domain), Resonator weapon counts (`Lord of Flames`), and ranked substitutes (`Tier_0_Sidegrade`, `Tier_1_Minor_Loss`, `Tier_2_Budget_F2P`).
   - **Optimal Party Synthesizer & Upgrade Roadmap**: Automatically constructs the highest-scoring Fire party and weapon grid from the player's owned inventory and outputs prioritized, actionable farming/sparking upgrades.
   - **Dual Ingestion Modes**:
     - **Offline / Config JSON Mode**: Evaluates any roster file matching `data/schemas/siete-roster.schema.json` (including `data/combat/siete-roster.example.json` or cached snapshots).
     - **Live CDP Scraper Mode**: Connects to the running Chrome CDP instance, inspects `#party/index` (`window.Game?.view?.deck_model` + DOM selectors), and audits the active party and owned inventory.
3. **CLI & Workflow Integration (`src/cli/run-siete-check.ts` & `templates/raid-seofon.json`)**:
   - Run `bun run siete:check` (live CDP) or `bun run siete:check:offline` / `bun run siete:check -- --roster data/combat/siete-roster.example.json` (offline) to generate console, Markdown (`logs/siete-readiness-report.md`), and JSON (`logs/siete-readiness-snapshot.json`) readiness reports.
   - Run `bun run siete` (`templates/raid-seofon.json`) to execute automated Seofon 4M Honors farming (`targetScore: 4000000`, `element: "Fire"`, no Turn-1 `quick_call`).
