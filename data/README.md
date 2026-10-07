# Granblue Fantasy Technical Knowledge Base & Modular Data Architecture

This directory (`C:\laragon\www\guranburuing\data\`) contains the authoritative, reverse-engineered technical knowledge base and enterprise-grade modular data architecture for Granblue Fantasy (GBF) automation, telemetry, and combat orchestration.

---

## 1. Enterprise Modular Data Directory Layout

Adhering strictly to **Domain-Driven Design (DDD)** and senior gold engineering standards, static and dynamic domain data is partitioned into modular, schema-validated subsystems:

```text
data/
├── README.md                           # Comprehensive architecture and developer guide
├── index.json                          # Unified master index (backward-compatible aggregation)
├── presence-mode.json                  # Discord RPC activity configuration
├── schemas/                            # JSON Schemas (Draft 2020-12) for validation
│   ├── raid-catalog.schema.json        # Schema for raid and category catalogs
│   ├── endpoints.schema.json           # Schema for REST endpoints and network specifications
│   ├── selectors.schema.json           # Schema for DOM elements, modals, and routes
│   └── daily-catalog.schema.json       # Schema for daily routines and tasks
├── raids/                              # Raid Data & Mechanics Subsystem
│   ├── raids.catalog.json              # Complete catalog (Stage IDs, Quest IDs, HP, Blue Chests)
│   ├── categories.json                 # Raid category hierarchy (HL, Magna 3, Six Dragons, etc.)
│   └── drop-tables.json                # Blue Chest, Gold Brick (1.5%/1.2%), Eternity Sand math
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
│   └── battle-systems.json             # Battle System 1.0 vs 2.0 (Omens, Cancels, Guard, FC)
└── automation/                         # Automation & Anti-Detection Subsystem
    ├── daily-routines.json             # 12 Pro-skips, Daily hosts, Rupie gacha, Missions, Casino
    └── anti-detection.json             # Human motor distributions, jitter, watchdog heuristics
```

---

## 2. Research & Documentation Volumes

The directory includes seven exhaustive technical volumes analyzing the game's internal implementation:

| Volume | File | Core Engineering Topics |
| :--- | :--- | :--- |
| **Vol. 1** | [`01_gbf_core_engine_and_client_internals.md`](file:///c:/laragon/www/guranburuing/data/01_gbf_core_engine_and_client_internals.md) | Backbone.js MVC, Zepto.js touch/tap events, CreateJS / EaselJS stage loops, DOM vs Canvas layer separation, V8 heap texture cleanup. |
| **Vol. 2** | [`02_network_protocols_and_rest_api_internals.md`](file:///c:/laragon/www/guranburuing/data/02_network_protocols_and_rest_api_internals.md) | HTTP/2 transport contracts, TLS JA3/JA4 fingerprinting, `X-VERSION` lifecycle, full schemas for `/start.json`, `/normal_attack_result.json`. |
| **Vol. 3** | [`03_combat_mechanics_v1_v2_and_turn_lock_physics.md`](file:///c:/laragon/www/guranburuing/data/03_combat_mechanics_v1_v2_and_turn_lock_physics.md) | V1 vs V2 combat, Omens, Guard, Fatal Chain, Server Lockout formula ($L_{turn}$), F5 animation skip mechanics, Blue Chest probability curves. |
| **Vol. 4** | [`04_anti_cheat_detection_vectors_and_mitigation.md`](file:///c:/laragon/www/guranburuing/data/04_anti_cheat_detection_vectors_and_mitigation.md) | Cygames server telemetry, `isTrusted` DOM verification, honey-pots, Gaussian spatial jitter, Log-Normal latency distributions, Bézier splines. |
| **Vol. 5** | [`05_high_performance_farming_blueprints.md`](file:///c:/laragon/www/guranburuing/data/05_high_performance_farming_blueprints.md) | Gold Bar racing meta (PBHL 1.48M, Akasha 1.56M, GOHL 1.48M), Guild Wars EX+ 0-button meat farming, Replicard Sandbox, Magna I/II Pro Skips. |
| **Vol. 6** | [`06_system_architecture_and_future_improvements.md`](file:///c:/laragon/www/guranburuing/data/06_system_architecture_and_future_improvements.md) | Architectural audit, 6 high-impact technical upgrades (CDP network fast-path, Chromium GPU/FPS throttling, proactive memory recycling). |
| **Vol. 7** | [`07_architecture_review_and_standards.md`](file:///c:/laragon/www/guranburuing/data/07_architecture_review_and_standards.md) | Forensic root-cause analysis, dual-mode structured logging (Markdown + JSONL), enterprise directory governance. |

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
