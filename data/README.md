# Granblue Fantasy Technical Knowledge Base & Modular Data Architecture

This directory (`C:\laragon\www\guranburuing\data\`) contains the authoritative, reverse-engineered technical knowledge base and enterprise-grade modular data architecture for Granblue Fantasy (GBF) automation, telemetry, and combat orchestration.

---

## 1. Enterprise Modular Data Directory Layout

Adhering strictly to **Domain-Driven Design (DDD)** and senior gold engineering standards, static and dynamic domain data is partitioned into modular, schema-validated subsystems:

```text
data/
├── README.md                           # Comprehensive architecture and developer guide
├── KMS_GOVERNANCE.md                   # 10 Golden Principles of KMS Governance & Ontology Map
├── index.json                          # Unified master index (backward-compatible aggregation)
├── presence-mode.json                  # Discord RPC activity configuration
├── schemas/                            # 28 JSON Schemas (Draft 2020-12) for validation
│   ├── raid-catalog.schema.json        # Schema: Raids & Stage specifications
│   ├── categories.schema.json          # Schema: Raid categories & min rank
│   ├── drop-tables.schema.json         # Schema: Blue Chest, Gold Brick & Sand math
│   ├── raid-evaluation.schema.json     # Schema: Dynamic Leech vs Race decision engine
│   ├── selectors.schema.json           # Schema: DOM HUD & modal query selectors
│   ├── modals.schema.json              # Schema: Modal dialogs & overlay resolution
│   ├── navigation-routes.schema.json   # Schema: Backbone.js hash router transitions
│   ├── endpoints.schema.json           # Schema: HTTP REST specifications & headers
│   ├── auth-and-login.schema.json      # Schema: Platform gateways & session tokens
│   ├── cdn-assets.schema.json          # Schema: Akamai CDN layout & media templates
│   ├── combat-physics.schema.json      # Schema: Server lockout & damage-to-honors math
│   ├── battle-systems.schema.json      # Schema: Battle System 1.0 vs 2.0 architecture
│   ├── omens-catalog.schema.json       # Schema: V2 omens & cancel taxonomy
│   ├── plain-damage-catalog.schema.json# Schema: Plain damage sources & solver pipeline
│   ├── status-effects-catalog.schema.json # Schema: Boss buffs, party debuffs & safety locks
│   ├── supporter-summons.schema.json   # Schema: Supporter summons & grid selection
│   ├── tactical-action-priority.schema.json # Schema: Lockout-optimized combat action priorities
│   ├── element-catalog.schema.json     # Schema: 7-Element wheel & damage matrix
│   ├── party-selection-rules.schema.json # Schema: Party & grid selection heuristics
│   ├── daily-catalog.schema.json       # Schema: Daily Pro Skips & recurring routines
│   ├── anti-detection.schema.json      # Schema: Human motor distributions & watchdog heuristics
│   ├── recovery-policies.schema.json   # Schema: AP/EP/AAP replenishment & 3-raid unjamming
│   ├── battle-reload-profiles.schema.json # Schema: Combat reload tactics & CreateJS bypass
│   ├── event-automation.schema.json    # Schema: Scenario event story & token drawboxes
│   ├── cooldown-and-pacing.schema.json # Schema: Server cooldowns & rest cycles
│   ├── multi-account-orchestration.schema.json # Schema: CDP port allocation & topologies
│   ├── state-machine-recovery.schema.json # Schema: State machine & error self-healing
│   ├── sentinel-watchdog.schema.json   # Schema: 30+ CAPTCHA selectors & emergency halt
│   ├── events.schema.json              # Schema: Master Events Catalog & Schedules
│   ├── event-detail.schema.json        # Schema: Detailed Collaboration & Scenario Events
│   ├── event-farming-optimizer.schema.json # Schema: Event Farming Decision Trees
│   ├── side-stories.schema.json        # Schema: Permanent Side Story Vault & Spark Calculations
│   └── side-story-optimizer.schema.json # Schema: Side Story Farming Priorities & Pacing
├── raids/                              # Raid Data & Mechanics Subsystem
│   ├── raids.catalog.json              # Complete catalog (Stage IDs, Quest IDs, HP, Blue Chests)
│   ├── categories.json                 # Raid category hierarchy (HL, Magna 3, Six Dragons, etc.)
│   ├── drop-tables.json                # Blue Chest, Gold Brick (1.5%/1.2%), Eternity Sand math
│   └── raid-join-decision.json         # Dynamic Leech vs Racing decision engine & TTD
├── events/                             # Events Subsystem (Master & Detailed Event Catalogs)
│   ├── events.catalog.json             # Master Registry of All Events
│   ├── biography045-gintama.catalog.json # Authoritative Gintama Collaboration Catalog
│   ├── event-farming-optimizer.json    # Algorithmic Event Farming Decision Tree
│   ├── side-stories.catalog.json       # Permanent Side Story Vault (56 Stories, 8 Sagas)
│   └── side-story-optimizer.json       # Side Story Speed-Clearing & Spark Acceleration Tree
├── ui/                                 # UI, DOM & Routing Subsystem
│   ├── selectors.catalog.json          # Exhaustive DOM query selectors by screen & component
│   ├── modals.catalog.json             # Modal definitions, dismiss/confirm buttons, overlays
│   └── navigation-routes.json          # Backbone.js hash router state machine and transitions
├── network/                            # Network, Authentication & Assets Subsystem
│   ├── endpoints.catalog.json          # Complete REST API specifications with schemas
│   ├── auth-and-login.json             # Mobage, DMM, GREE login gateways, cookies, tokens
│   └── cdn-assets.json                 # Akamai CDN layout, asset paths, and caching policies
├── combat/                             # Combat Physics & Battle Systems Subsystem
│   ├── combat-physics.json             # Damage-to-honors, lockout formulas, F5 fast-reload
│   ├── battle-systems.json             # Battle System 1.0 vs 2.0 (Omens, Cancels, Guard, FC)
│   ├── omens.catalog.json              # V2 omens catalog (Magna 3, Six Dragons, Revans, Apex)
│   ├── v2-counter-taxonomy.json        # Algorithmic decision matrix and solver sequences
│   ├── plain-damage.catalog.json       # Plain damage sources (Summons, Characters, MC, Weapons)
│   ├── plain-damage-counter-engine.json# Decision tree & pipeline for solving Plain DMG omens
│   ├── status-effects.catalog.json     # Boss buffs (dispel) & party debuffs (cleanse) taxonomy
│   ├── supporter-summons.catalog.json  # Grid archetypes, attribute tabs (1-7), uncap scoring
│   └── tactical-action-priority.json   # Lockout-optimized combat action priority & safety
├── elements/                           # Elemental Wheel & Party Synergy Subsystem
│   ├── elements.catalog.json           # 6 Elements + Plain, internal IDs, hex colors, summons, skills
│   ├── elemental-matrix.json           # 7x7 Pairwise damage multipliers, crit/seraphic eligibility
│   └── party-selection-rules.json      # Heuristics for automated party, grid, and supporter selection
└── automation/                         # Automation & Operational Resilience Subsystem (9 Catalogs)
    ├── daily-routines.json             # 12 Pro-skips, Daily hosts, Rupie gacha, Missions, Casino
    ├── anti-detection.json             # Human motor distributions, jitter, watchdog heuristics
    ├── recovery-policies.catalog.json  # AP/EP/AAP replenishment, item priorities & 3-raid unjamming
    ├── battle-reload-profiles.catalog.json # Turbo, fast, normal, stealth reload & CreateJS bypass
    ├── event-automation.catalog.json   # Scenario story, token gacha drawbox & Nightmare skip
    ├── cooldown-and-pacing.catalog.json # 180s pub backup cooldown, API rates & rest schedules
    ├── multi-account-orchestration.catalog.json # CDP port allocations, profiles & topologies
    ├── state-machine-recovery.catalog.json # State machine error taxonomy & self-healing action graph
    └── sentinel-watchdog.catalog.json  # 30+ CAPTCHA tripwires, anomaly thresholds & escalation
```

---

## 2. Research & Documentation Volumes

The directory includes fifteen exhaustive technical volumes analyzing the game's internal implementation:

| Volume | File | Core Engineering Topics |
| :--- | :--- | :--- |
| **Vol. 1** | [`01_gbf_core_engine_and_client_internals.md`](file:///c:/laragon/www/gbf/data/01_gbf_core_engine_and_client_internals.md) | Backbone.js MVC, Zepto.js touch/tap events, CreateJS / EaselJS stage loops, DOM vs Canvas layer separation, V8 heap texture cleanup. |
| **Vol. 2** | [`02_network_protocols_and_rest_api_internals.md`](file:///c:/laragon/www/gbf/data/02_network_protocols_and_rest_api_internals.md) | HTTP/2 transport contracts, TLS JA3/JA4 fingerprinting, `X-VERSION` lifecycle, full schemas for `/start.json`, `/normal_attack_result.json`. |
| **Vol. 3** | [`03_combat_mechanics_v1_v2_and_turn_lock_physics.md`](file:///c:/laragon/www/gbf/data/03_combat_mechanics_v1_v2_and_turn_lock_physics.md) | V1 vs V2 combat, Omens, Guard, Fatal Chain, Server Lockout formula ($L_{turn}$), F5 animation skip mechanics, Blue Chest probability curves. |
| **Vol. 4** | [`04_anti_cheat_detection_vectors_and_mitigation.md`](file:///c:/laragon/www/gbf/data/04_anti_cheat_detection_vectors_and_mitigation.md) | Cygames server telemetry, `isTrusted` DOM verification, honey-pots, Gaussian spatial jitter, Log-Normal latency distributions, Bézier splines. |
| **Vol. 5** | [`05_high_performance_farming_blueprints.md`](file:///c:/laragon/www/gbf/data/05_high_performance_farming_blueprints.md) | Gold Bar racing meta (PBHL 1.48M, Akasha 1.56M, GOHL 1.48M), Guild Wars EX+ 0-button meat farming, Replicard Sandbox, Magna I/II Pro Skips. |
| **Vol. 6** | [`06_system_architecture_and_future_improvements.md`](file:///c:/laragon/www/gbf/data/06_system_architecture_and_future_improvements.md) | Architectural audit, 6 high-impact technical upgrades (CDP network fast-path, Chromium GPU/FPS throttling, proactive memory recycling). |
| **Vol. 7** | [`07_architecture_review_and_standards.md`](file:///c:/laragon/www/gbf/data/07_architecture_review_and_standards.md) | Forensic root-cause analysis, dual-mode structured logging (Markdown + JSONL), enterprise directory governance. |
| **Vol. 8** | [`08_elemental_mechanics_and_party_optimization.md`](file:///c:/laragon/www/gbf/data/08_elemental_mechanics_and_party_optimization.md) | 4-Element cycle, Light/Dark polarity, complete damage formula, Critical hit mechanics, Seraphic amplification, Off-element resistance, automated party selection decision trees. |
| **Vol. 9** | [`09_battle_system_2_omens_and_counter_engine.md`](file:///c:/laragon/www/gbf/data/09_battle_system_2_omens_and_counter_engine.md) | V2 telemetry, cancel conditions, Guard physics ($90\%$ mitigation of elemental and plain damage), Fatal Chain gauge mechanics, and automated omen counter decision trees. |
| **Vol. 10** | [`10_plain_damage_mechanics_and_v2_counter_engine.md`](file:///c:/laragon/www/gbf/data/10_plain_damage_mechanics_and_v2_counter_engine.md) | True defense-piercing damage physics, scaling formulas, exhaustive Plain damage catalog (Summons, Characters, MC, Weapons), and V2 plain omen counter pipeline. |
| **Vol. 11** | [`11_status_effects_dispel_cleanse_and_survival_kms.md`](file:///c:/laragon/www/gbf/data/11_status_effects_dispel_cleanse_and_survival_kms.md) | Boss buffs (Repel, 100% Cut, Absorption), party debuffs (Zombified, Paralysis, Skill Seal), Dispel/Cleanse registries, and Zombified Safety Interlock. |
| **Vol. 12** | [`12_supporter_summon_grid_archetypes_and_selection_engine.md`](file:///c:/laragon/www/gbf/data/12_supporter_summon_grid_archetypes_and_selection_engine.md) | Grid archetypes (Magna vs Primal vs Elemental vs Burst vs Farming), 7-tab attribute routing, uncap tier scoring (Lv 250 > 200), and Friend Turn-1 call logic. |
| **Vol. 13** | [`13_raid_evaluation_leech_racing_and_ep_economy_kms.md`](file:///c:/laragon/www/gbf/data/13_raid_evaluation_leech_racing_and_ep_economy_kms.md) | Raid Finder evaluation, Time-to-Death ($TTD$) velocity math, Blue Chest ROI, and policies (`SKIP_DYING`, `RAPID_LEECH`, `BLUE_CHEST_RACE`, `SKIP_STALLED`). |
| **Vol. 14** | [`14_automation_engine_architecture_and_operational_resilience_kms.md`](file:///c:/laragon/www/gbf/data/14_automation_engine_architecture_and_operational_resilience_kms.md) | Automation architecture, AP/EP replenishment economics, CreateJS acceleration, Scenario & drawbox farming, 180s pub cooldown, multi-account CDP topologies, state machine self-healing, and security tripwires. |
| **Vol. 15** | [`15_event_architecture_and_collab_kms.md`](file:///c:/laragon/www/gbf/data/15_event_architecture_and_collab_kms.md) | Event taxonomy, Collaboration (`biography`) vs Scenario (`treasureraid`) architecture, Gintama collab case study, Akamai CDN media paths, zero-waste treasure trade economics, and 0-button burst OTK pipelines. |

---

## 3. Authoritative Game Domain Data

### 3.1 Raid Catalog & Stage Hierarchy

Raids are indexed by both their internal identifier and their authoritative game `questId` and `stageId`:

- **High-Level 6-Star (Gold Bar Tier) (Stage `12061`)**:
  - `pbhl` (**Wings of Terror / Prototype Bahamut HL**): Quest `301061`, 18-man, 2.0B HP, V1, Blue chest: 1.48M honors (148M dmg), Gold Brick drop: **1.5%**.
  - `akasha` (**Omen of the Broken Skies / Akasha HL**): Quest `303251`, 18-man, 1.2B HP, V1 (Turn Acceleration), Blue chest: 1.56M honors, Gold Brick drop: **1.2%**.
  - `gohl` (**The Peacemaker's Wings / Grand Order HL**): Quest `305161`, 18-man, 1.35B HP, V1 (Peacemaker Buff), Blue chest: 1.48M honors, Gold Brick drop: **1.2%**.
  - `lindwurm` (**Empyreal Ascension / Lindwurm HL**): Quest `303141`, 18-man, 800M HP, V1, AP 50.
- **Magna 3 / Omega 3 Series (Stage `12042`)**:
  - `tiamat_aura` (**Tiamat Aura Omega**): Quest `305601`, Chapter `30560`, AP 25, 3/day, V2.
  - `colossus_ira` (**Colossus Ira Omega**): Quest `305611`, Chapter `30561`, AP 25, 3/day, V2.
  - `leviathan_mare` (**Leviathan Mare Omega**): Quest `305631`, Chapter `30563`, AP 25, 3/day, V2.
  - `yggdrasil_arbos` (**Yggdrasil Arbos Omega**): Quest `305641`, Chapter `30564`, AP 25, 3/day, V2.
  - `luminiera_credo` (**Luminiera Credo Omega**): Quest `305591`, Chapter `30559`, AP 25, 3/day, V2.
  - `celeste_ater` (**Celeste Ater Omega**): Quest `305621`, Chapter `30562`, AP 25, 3/day, V2.
- **Six Dragons (Impossible) (Stage `12051`)**:
  - `wilnas` (`305191`), `wamdus` (`305201`), `galleon` (`305211`), `ewiyar` (`305221`), `lu_woh` (`305231`), `fediel` (`305241`).
- **Apex Endgame Raids (Stages `12071`, `12081`, `12091`)**:
  - `subhl` (**Rage of Super Ultimate Bahamut**): Stage `12081`, Quest `305311`, 6-man, 3.0B HP, V2.
  - `dark_rapture_zero` (**Dark Rapture Zero / Faa0**): Stage `12091`, Quest `305581`, 6-man, 3.5B HP, V2.
  - `hexachromatic` (**Hexachromatic Hierarch / Tengen**): Stage `12091`, Quest `305491`, 6-man, 3.2B HP, V2.

### 3.2 UI Elements, Buttons & Modal Lifecycle

Granblue Fantasy operates on a dual-layer interface: an underlying HTML5 canvas for animations, and a floating Zepto.js DOM layer for UI controls.
Crucial selector conventions verified from the live game:

- **Stage Detail Modal**: `.pop-stage-detail.pop-show`, `.pop-usual.pop-show`
  - **Close Button**: `.btn-usual-close` (*Note: `.btn-close` does not exist on stage modals; `.btn-usual-close` is mandatory*).
  - **Quest Banner**: `.prt-stage-quest .prt-quest-banner[data-quest-id='...']`
  - **Play Button**: `.btn-set-quest[data-quest-id='...']`, with remaining daily count in `data-limited_count`.
- **Host Treasure Verification Modal**: `.pop-treasure-raid`
  - **Confirm Offer**: `.btn-offer`
  - **Dismiss / Cancel**: `.btn-usual-cancel`
  - **Alternate Material Toggle**: `.btn-article-image`
- **Combat HUD**: `#cnt-raid`, `#prt-command-top`
  - **Attack**: `.btn-attack-start`
  - **Full Auto Toggle**: `.btn-auto`, `.btn-lock.auto-full`
  - **Guard Toggles (V2)**: `.btn-guard[data-member='...']`, `.btn-guard-all`
  - **Abilities**: `.lis-ability .btn-ability-available[data-ability-id='...']`
  - **Summons**: `.btn-summon-available`, `.quick-summon`
- **Multiplayer Backup Requests (Pub)**:
  - **Assist Modal Trigger**: `.btn-assist`
  - **Scope Checkboxes**: `.btn-all` (Everyone), `.btn-friends` (Friends), `.btn-crew` (Crew)
  - **Confirmation**: `.pop-request-assist .btn-usual-ok`
- **Recovery Modals**: `.pop-usual.pop-show`
  - **Half-Elixir (AP)**: `.btn-use-item[data-item-id='1']` + `.btn-usual-ok`
  - **Soul Berry (EP)**: `.btn-use-item[data-item-id='2']` + `.btn-usual-ok`
  - **Arcarum AAP**: `.btn-use-item[data-item-id='30031']` + `.btn-usual-ok`

### 3.3 Endpoints, Authentication & Login Gateways

- **Game URLs**: `https://game.granbluefantasy.jp`
- **Partner Gateways**:
  - **Mobage**: `https://connect.mobage.jp/login` (Direct OAuth: `https://game.granbluefantasy.jp/#authentication`)
  - **DMM**: `https://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854` (IFrame container: `https://gbf.game.mbga.jp/`)
- **Cookie Authentication Schema**:
  - `user_id`: Numeric Mobage user account identifier.
  - `sub_id`: Device / account session binding token.
  - `user_token`: Encrypted session authentication credential validated per request.
  - `auth_token`: Platform authorization credential for silent re-handshakes.
- **Key REST Endpoints**:
  - `POST /quest/raid_info`: Non-action telemetry polling (boss HP %, player honors, active players).
  - `POST /rest/multiraid/start.json`: Battle scene initialization and party state loading.
  - `POST /rest/multiraid/normal_attack_result.json`: Turn action resolution, damage calculation, scenario animation.
  - `POST /rest/multiraid/ability_result.json`: Individual character ability activation.
  - `POST /rest/multiraid/summon_result.json`: Summon call invocation.
  - `POST /rest/multiraid/guard_setting.json`: V2 Guard toggle dispatch.
  - `POST /rest/multiraid/request_assist.json`: Multiplayer backup request broadcasting.
  - `POST /quest/pro_skip`: Instant daily Pro-Skip quest clearance.
  - `GET /resultmulti/data.json`: Comprehensive post-battle drop results (Blue/Gold/Red chests, honors).

### 3.4 Combat Physics & Fast-Reload Calculations

- **Honors Conversion**:
  $$\text{Honors} = \lfloor \frac{\text{Damage}}{1000} \rfloor$$
- **Attack Lockout Formula**:
  $$T_{\text{lockout}} = 1.0\text{s} + (\text{Total Hits} \times 0.35\text{s}) + P_{\text{ougi}}$$
  - $P_{\text{ougi}} = 0\text{s}$ (0 ougi), $4.0\text{s}$ (1 ougi), $6.5\text{s}$ (2 ougi), $9.0\text{s}$ (3 ougi), $13.0\text{s}$ (4-chain full burst), $16.0\text{s}$ (Overburst).
- **Fast-Path F5 Reloading**:
  Trigger page refresh immediately upon receiving HTTP 200 from `/normal_attack_result.json`, bypassing CreateJS animation playback, and sleep only for the remainder of the calculated server lockout timer before dispatching the next turn command.

### 3.5 Elemental Architecture & Automated Party Selection Rules

- **The 4-Element Intransitive Cycle**:
  $$\text{Fire} \xrightarrow{\times 1.5} \text{Wind} \xrightarrow{\times 1.5} \text{Earth} \xrightarrow{\times 1.5} \text{Water} \xrightarrow{\times 1.5} \text{Fire}$$
  - Superior Element: $+50\%$ damage dealt ($1.50\times$), $25\%$ damage reduction ($0.75\times$), critical hits enabled, Seraphic amplification ($+20\%$ to $+25\%$) active, $+30\%$ debuff accuracy.
  - Inferior Element: $-25\%$ damage dealt ($0.75\times$), $+25\%$ damage taken ($1.25\times$), crits disabled, Seraphic disabled, heavy debuff miss penalty.
- **The Light / Dark Mutual Polarity**:
  $$\text{Light} \xleftrightarrow[\times 1.5]{\times 1.5} \text{Dark}$$
  - Both deal $+50\%$ superior damage to each other while taking standard $1.0\times$ damage.
- **Off-Element Resistance (非有利属性耐性)**:
  - Enforced in Guild Wars (HELL) and high-level endgame raids (Magna 3, Six Dragons, Revans, SUBHL, Hexa, Faa0). Non-superior element attacks suffer $50\%$ to $100\%$ damage reduction and complete debuff failure.
- **Automated Party & Supporter Selection**:
  - `data/elements/party-selection-rules.json` resolves the optimal party element and supporter tab (`data-attribute="1..7"`) deterministically based on target boss element and raid ID.

### 3.6 Battle System 2.0 (V2) Omens & Counter Engine

- **Telegraphed Omens (予兆)**:
  - Yellow Rings (Cancelable): Explicit conditions (hit count, damage threshold, charge attacks, dispels, Fatal Chain).
  - Red Diamonds (Uncancelable): Fixed script triggers requiring All-Guard (`.btn-guard-all`), 100% cut, or sacrificial swap.
- **Guard Physics**:
  - Base damage reduction: **90%** ($0.10\times$ multiplier).
  - Uniquely in V2, Guard mitigates Plain Damage by 90% (e.g. 70% Max HP becomes 7% Max HP).
- **Fatal Chain (FC)**:
  - Special gauge charged via charge attacks ($10\%$ per C.A., $+10\%$ full burst bonus $\implies 50\%$ gain per 4-chain). Discharges $\sim 4.5\text{M}$ plain damage and breaks V2 omens.
- **V2 Catalogs**:
  - `data/combat/omens.catalog.json` & `data/combat/v2-counter-taxonomy.json`.

### 3.7 Plain Damage Architecture & V2 Counter Engine

- **Plain Damage Physics**:
  - True defense-piercing damage that ignores boss defense rating, elemental resistance, and standard damage cuts.
  - Immune to standard damage caps and Seraphic blessings (hard-capped per source).
- **Core Plain Damage Catalogs**:
  - **Summons**: Beelzebub 4★ ($3\text{M}$ fixed on call), Belial ($3\text{M}$ random), Michael ($1.5\text{M}$ HP-based), The Tower ($1\text{M}$ end-of-turn tick).
  - **Characters**: Threo/Sarasa (*Ground Zero*: up to $2.04\text{M}$ consumed-HP nuke), Water Yodarha ($999,999$ on ougi), Gwynne ($1.2\text{M}$ on ougi), Lunalu SSR (*Facsimile II* copies Ground Zero for $4.08\text{M}$ turn combo), Clarisse ($710\text{k}$ + Dispel).
  - **MC Classes & Weapons**: Yamato (*Take the Head* reduces omen requirement by 20-30%, *Seasplitter* instant cancel), Sword Master with Disparia ($30\times-45\times$ current HP).
- **Autonomous Counter Pipeline**:
  - `data/combat/plain-damage-counter-engine.json`: 6-step solver pipeline (Yamato reduction -> Beelzebub call -> Character nukes -> Ougi plain -> Guard fallback).

### 3.8 Event Subsystem & Collaboration Architecture (`data/events/`)

- **Event Models**:
  - `collaboration` (`#event/biography<ID>`): Finite Treasure Trade Shop. Farm Medallions + Character Specials for fixed-stock SSR items (SSR Ticket, Damascus Crystals, Event Weapon/Summon FLBs).
  - `treasureraid` (`#event/treasureraid<ID>`): Infinite Token Drawboxes. Farm Event Tokens for Damascus Crystals (Boxes 5-20) and infinite replenishment pools.
- **Akamai CDN Asset Resolution**:
  - Uniform asset URI structure: `{origin}/assets/img/sp/{category}/{assetId}.{ext}`
  - Pre-cached BGM tracks, character art (`/npc/b/` for full body, `/npc/m/` for thumbnails), and event banners.
- **Authoritative Gintama Collab (`biography045`)**:
  - SSR Fire Shinsengumi (Hijikata & Okita) unlocked via Story Ep 1-3.
  - SSR Light Yorozuya (Gintoki, Shinpachi, Kagura) unlocked via Story Ep 5-3.
  - SSR Light Katana *Wooden Sword Lake Toya* (EX ATK, MC Enmity, Counter + Guts) with 4★ FLB uncap.
  - SSR Wind Summon *Kotaro Katsura & Elizabeth* (All-elemental C.A. boost, Sub Aura Veil + Guaranteed TA for Yorozuya).
  - Dual-Boss Architecture: Neo Armstrong (Wind, Fire Advantage) + Koro (Dark, Light Advantage).
  - 1-Click Nightmare Skip unlocked after 3 manual clears of Lv120 HELL.

### 3.9 Side Story Permanent Vault (`#sidestory`) & Spark Acceleration (Volume 16)

- **Permanent Vault Architecture**:
  - Over 56 side stories documented across 8 thematic sagas (`anniversary`, `collaboration`, `dragon_knights`, `society`, `summer`, `sky_adventures`, `robomi`, `idols`).
  - Total immediate gacha fuel: **168 Premium Draw Tickets** + **15,650 Story Crystals** = **220+ Free Gacha Draws** (over 73% of a full 300-draw spark).
  - Crucial early-game gear: **Bahamut Weapon Nova (Lv100/SL10)** from *WMTSB I*, **Atma Weapon (Lv100/SL10)** from *WMTSB II*, and **Machine Cell Relic Buster CCW** from *Stay Moon*.
  - Roster empowerment: **22 SSR Characters** and **42 SR Characters** covering all 6 elements.
  - Consumable reserves: **5,600+ Half-Elixirs** (+280,000 AP) and **28,000+ Soul Berries** (+140,000 EP).
- **Speed-Clearing Optimization**:
  - 1-Click Story Skip resolves cutscenes in 0 AP, immediately unlocking crystals and character recruitments.
  - 0-button plain damage burst (Sarasa Ground Zero or Disparia) for 3.8s quest clears.
  - Magfest synergy: 50% discount on AP and treasure exchange trade costs.

---

## 4. Strongly-Typed TypeScript Integration

The data architecture is exposed via the **`DataCatalogService`** singleton in [`src/domain/data/`](file:///c:/laragon/www/guranburuing/src/domain/data/):

```typescript
import { DataCatalogService } from '../domain/data/index.js';

const catalog = DataCatalogService.getInstance();

// O(1) Typed Raid Lookup
const pbhl = catalog.getRaidById('pbhl');
console.log(`PBHL Stage: ${pbhl?.stageId}, Blue Chest Honors: ${pbhl?.blueChest?.thresholdHonors}`);

// O(1) Quest ID Resolution
const tiamat = catalog.getRaidByQuestId('305601');
console.log(`Raid Name: ${tiamat?.name}, Daily Limit: ${tiamat?.dailyLimit}`);

// Typed Endpoint & Modal Lookup
const attackEndpoint = catalog.getEndpoint('normalAttack');
const stageModal = catalog.getModal('stage_detail_modal');
console.log(`Close Selector: ${stageModal?.closeButtonSelector}`); // .btn-usual-close
```

---

## 5. Architectural Invariants

1. **Selector Integrity**: Always use `.btn-usual-close` when dismissing stage modals on `#quest/multi/0`.
2. **State Cleanliness**: Always verify that any existing stage modal is completely dismissed (`offsetParent === null`) before clicking a new stage card.
3. **CDP Event Fidelity**: Emulate human touch interactions via Zepto `tap` and `click` events simultaneously to ensure client event-bus handlers execute consistently.
4. **Backward Compatibility**: Any modifications to `data/` must preserve backwards compatibility with `data/index.json` consumers.
