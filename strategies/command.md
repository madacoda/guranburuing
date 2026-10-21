# GBF Remote Controller & Automation CLI Reference (`--help`)

Fast, categorized terminal reference for all operational commands, workflows, daemons, and developer utilities.

---

## Quick Navigation

- [0. Global CLI Syntax & Common Flags](#0-global-cli-syntax--common-flags)
- [1. Account Authentication & Session Management](#1-account-authentication--session-management)
- [2. Browser Control, CDP Host & Developer Dev Servers](#2-browser-control-cdp-host--developer-dev-servers)
- [3. Daily Maintenance & Pro Skips](#3-daily-maintenance--pro-skips)
- [4. Daily Raid Hosting Suite](#4-daily-raid-hosting-suite)
- [5. Autonomous Peak-Hour Scheduler (21:00 JST / 19:00 WIB)](#5-autonomous-peak-hour-scheduler-2100-jst--1900-wib)
- [6. Human Behavioral Cadence & In-Game Inventory Audit](#6-human-behavioral-cadence--in-game-inventory-audit)
- [7. Replicard Sandbox: Zone Mundus (Stage 10) Militis Bosses & Defenders](#7-replicard-sandbox-zone-mundus-stage-10-militis-bosses--defenders)
- [8. Replicard Sandbox: Stage 3 (Zone Goliath) Bosses & Defenders](#8-replicard-sandbox-stage-3-zone-goliath-bosses--defenders)
- [9. Replicard Sandbox: Stage 7 (Zone Faym & Joculator) Bosses & Defenders](#9-replicard-sandbox-stage-7-zone-faym--joculator-bosses--defenders)
- [10. Replicard Sandbox: Zone Eletio, Zone Kalendae & The World](#10-replicard-sandbox-zone-eletio-zone-kalendae--the-world)
- [11. Gold Bar (GB) Hunting & High-Difficulty Raids](#11-gold-bar-gb-hunting--high-difficulty-raids)
- [12. Magna 3 (Omega Rebirth) Fast Leeching & OTK Burst](#12-magna-3-omega-rebirth-fast-leeching--otk-burst)
- [13. Endgame 6-Man & Six Dragons Assist Raids](#13-endgame-6-man--six-dragons-assist-raids)
- [14. Autonomous Finder Slot & Raid Auto-Setting (`autoSetRaid`)](#14-autonomous-finder-slot--raid-auto-setting-autosetraid)
- [15. Guild Wars (Unite & Fight)](#15-guild-wars-unite--fight)
- [16. Story, Scenario & Collaboration Events](#16-story-scenario--collaboration-events)
- [17. Fate Episodes Auto-Farmer](#17-fate-episodes-auto-farmer)
- [18. Rise of the Beasts (ROTB)](#18-rise-of-the-beasts-rotb)
- [19. Interactive Selector & Generic Workflow Runner](#19-interactive-selector--generic-workflow-runner)
- [20. Complete Synced Workflow Templates Master Catalog (74 Templates)](#20-complete-synced-workflow-templates-master-catalog-74-templates)
- [21. Gateway Server, Web Cockpit & Mobile PWA](#21-gateway-server-web-cockpit--mobile-pwa)
- [22. Discord Remote Controller & Two-Way CAPTCHA Relay](#22-discord-remote-controller--two-way-captcha-relay)
- [23. Discord Rich Presence (RPC)](#23-discord-rich-presence-rpc)
- [24. Quality Assurance, Testing & Pre-Flight Verification](#24-quality-assurance-testing--pre-flight-verification)

---

## 0. Global CLI Syntax & Common Flags

Most combat and farming workflows accept standard flags and positional arguments:

```bash
bun src/cli/run-workflow.ts [account] <template_name> [runs] [flags]
```

### Common Flags

| Flag | Short | Default | Description |
| :--- | :---: | :---: | :--- |
| `--windowed` | `-w` | `false` | Disables headless mode; renders visible browser window for visual debugging |
| `--headless` | `-h` | `true` | Forces silent Chromium background execution (`--headless=new`) |
| `--account <id>` | `-a` | `acc1` | Specifies target account ID configured in `accounts.config.json` |
| `--runs <count>` | `-r` | `1` / template | Overrides loop iteration limit |
| `--speed <mode>` | `-s` | `fast` | Speed profile: `stealth` (860ms), `fast` (150ms), or `turbo` (75ms) |
| `--all-accounts` | — | `false` | Executes workflow sequentially across all enabled accounts |

---

## 1. Account Authentication & Session Management

Zero-cold-login session initialization, full cookie jar export/import across desktop and VPS.

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `bun run account:setup` | `[account]` (default: `acc1`) | Opens windowed browser on port 9222 for 1-time manual login |
| `bun run account:setup acc1 --headless` | `--headless` | Launches remote web cockpit on port 3000 to log in via phone/browser |
| `bun run account:login` | `[account]` | Alias for `account:setup` |
| `bun run session:copy-local` | — | PowerShell script to clone local Chrome session into bot user data directory |
| `bun run session:export` | `[account]` (default: `acc1`) | Dumps full 30+ cookie platform jar to `data/<acc>-cookies.json` |
| `bun run session:import` | `[account]` (default: `acc1`) | Injects full cookie jar via CDP and verifies player profile |
| `bun run import` | `[account]` | Alias for `session:import` |
| `bun run import:clipboard` | `[account]` | Imports cookies directly from clipboard JSON |
| `bun run import:midship` | `[account]` | Quick-imports single `midship` cookie value |
| `bun run session:sync` | `[account]` | Verifies cookie freshness and syncs IndexedDB stores |
| `bun run sync` | `[account]` | Alias for `session:sync` |
| `bun run vps:login` | — | Secure SSH tunnel to remote VPS Chrome mirror on port 9222 |
| `bun run vps:browser` | — | Launches remote VPS browser window mirror |

> [!TIP]
> **Session Immunity Shield**: All session setups, daily runs, and workflow runners automatically mount the Mobage session immunity shield ([src/auth/session-immunity.ts](file:///c:/laragon/www/guranburuing/src/auth/session-immunity.ts)), preventing client-side kickouts from `session_state_change_response`. For the complete technical post-mortem on auth failures and solutions, see [Root Cause Analysis: Authentication Failures vs. Success Blueprint](file:///c:/laragon/www/guranburuing/strategies/AUTH_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md) and [Principle 13](file:///c:/laragon/www/guranburuing/strategies/principles/13_authentication_and_session_immunity.md).

---

## 2. Browser Control, CDP Host & Developer Dev Servers

Manual Chromium / SRWare Iron launch helpers (optional if `AUTO_LAUNCH_CHROME=true`) and development watchers.

| Command | Mode | Description |
| :--- | :---: | :--- |
| `bun run launch:chrome` | Windowed | Launches browser on port 9222 with visible GUI window |
| `bun run launch:chrome:headless` | Headless | Launches browser in silent background mode (`--headless=new`) |
| `bun run dev` | Watcher | Starts gateway server with file watcher (`bun --watch src/index.ts`) |
| `bun run dev:node` | Node/TSX | Starts gateway server using Node.js + tsx watcher (`tsx watch src/index.ts`) |
| `bun run build` | Compiler | Compiles entire TypeScript codebase (`tsc`) to `dist/` |
| `bun run start` | Production | Boots compiled production bundle (`bun dist/index.js`) |
| `bun run gateway` | Bun | Direct boot of gateway without watcher (`bun src/index.ts`) |

---

## 3. Daily Maintenance & Pro Skips

Executes 12 Pro Skips (`#quest/extra`), 100-Draw Free Rupie Gacha (`#gacha/normal`), Skyscope missions, and Casino pots.

| Command | Mode | Description |
| :--- | :---: | :--- |
| `bun run daily` | Headless | Full daily maintenance cycle on active account (`acc1`) |
| `bun run daily:acc1` | Headless | Runs daily maintenance explicitly on Account 1 |
| `bun run daily:acc2` | Headless | Runs daily maintenance explicitly on Account 2 |
| `bun run daily:all` | Swarm | Sequential multi-account daily maintenance across all accounts |
| `bun run daily:windowed` | Windowed | Runs daily maintenance with visible browser window |
| `bun run daily:favorites` | Headless | Quick-clears Pro Skips pinned to in-game Favorites list (`#quest`) |

---

## 4. Daily Raid Hosting Suite

Autonomous daily raid hosting with transient DOM sanitization and material deficit recognition across 16 critical daily raids.

| Command | Scope | Description |
| :--- | :---: | :--- |
| `bun run daily:host` | All 16 Raids | Hosts complete daily 16-raid rotation (HL, M3, Six Dragons) |
| `bun run daily:host:hl` / `daily:hostgb` | HL Raids | Hosts High Level daily raids (PBHL, Akasha, GOHL, Lindwurm) |
| `bun run daily:host:m3` | Magna 3 | Hosts all 6 Magna 3 (Omega Rebirth) raids |
| `bun run daily:host:dragons` | Six Dragons | Hosts all 6 Six Dragons daily raids (Wilnas, Ewiyar, etc.) |
| `bun run daily:host:acc1` | Acc 1 | Runs daily raid hosting explicitly on Account 1 |
| `bun run daily:host:acc2` | Acc 2 | Runs daily raid hosting explicitly on Account 2 |
| `bun run daily:host:all` | All Accounts | Runs daily raid hosting across all registered accounts |
| `bun run daily:host:windowed` | Windowed | Visible browser execution for inspecting host transitions |

---

## 5. Autonomous Peak-Hour Scheduler (21:00 JST / 19:00 WIB)

24/7 background scheduler aligned to Granblue Fantasy peak player Golden Time & Strike Time (21:00:15 JST / 19:00:15 WIB / 12:00:15 UTC) for maximum Raid Finder backup join speed and fastest clears.

| Command | Mode | Description |
| :--- | :---: | :--- |
| `bun run daily:scheduler` | Daemon | Starts background daemon that triggers routine at 21:00:15 JST (19:00:15 WIB) |
| `bun run daily:routine` | Immediate | Executes complete 2-phase pipeline right now (Pro Skips $\rightarrow$ Raids) |
| `bun run daily:routine --windowed` | Windowed | Runs on-demand daily pipeline in visible browser window |
| `bun run daily:routine --no-hosts` | Skips Only | Runs universal Pro Skips only, skipping hosted raids |
| `bun run daily:routine --no-skips` | Raids Only | Runs raid hosting suite only, skipping Pro Skips |

---

## 6. Human Behavioral Cadence & In-Game Inventory Audit

Simulates realistic human farming rhythms with fatigue-mimicking rest intervals, interleaving dying Magna 3 leeches, inventory auditing, and monthly shop resets.

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `bun run farm:human` | `[acc] [--cycles=3] [--gb=18] [--rest=5] [-w]` | Runs realistic human cadence: GB burst $\rightarrow$ Leech $\rightarrow$ Rest $\rightarrow$ Audit |
| `bun run inventory` | `[acc] [--windowed]` | Scrapes live inventory: Half Elixirs, Soul Berries, Gold Bars, Crystals, AAP |
| `bun run inventory:cached` | `[acc] [--offline]` | Displays latest on-disk cached inventory snapshot without launching Chrome |

### Human Cadence Syntax Options
```bash
# Run 5 cycles on acc1 with 25 GB raids per cycle and 8-min rest breaks (visible window):
bun src/cli/run-human-cadence.ts acc1 --cycles=5 --gb=25 --rest=8 --windowed

# Quick check on account 1's elixir and crystal inventory:
bun run inventory acc1
```

---

## 7. Replicard Sandbox: Zone Mundus (Stage 10) Militis Bosses & Defenders

Optimized Smart Full Auto and Burst workflows for all major Zone Mundus encounters.

### 🚀 Unified Arcarum Zone Mundus CLI Controller
```bash
bun run arcarum                                     # Interactive Target Selection Menu
bun run arcarum:help                                # Print Complete Target Catalog & Syntax
bun src/cli/run-arcarum.ts acc1 ca-ong 100          # Run 100 battles of Ca Ong Militis
bun src/cli/run-arcarum.ts acc1 steve 200            # Farm 200 runs of Parasite Steve (spawns Ca Ong)
bun src/cli/run-arcarum.ts acc1 theworld 50 -w       # Run 50 battles of The World (Windowed)
bun src/cli/run-arcarum.ts acc1 stage10 500          # Universal Stage 10 Map Scanner
```

### ⚔️ Militis Defenders & Core Bosses (30 AAP)
| Target | Element | Div | Quest ID | Quick CLI Shortcut | Windowed Shortcut | Drops |
| :--- | :---: | :---: | :---: | :--- | :--- | :--- |
| **Ca Ong Militis** | Water | 10 | `819151` | `bun run ca-ong:smart` / `ca-ong` / `arcarum:ca-ong` / `arcarum:ca-ong:smart` | `bun run ca-ong:windowed` / `ca-ong:smart:windowed` | Glacial Rapier Militis, Water Luster, Pillar of Sea |
| **Prometheus Militis** | Fire | 3 | `819141` | `bun run prometheus:smart` / `prometheus` / `arcarum:prometheus` / `arcarum:prometheus:smart` | `bun run prometheus:windowed` / `prometheus:smart:windowed` | Prominence Militis, Fire Luster, Pillar of Sun |
| **Gilgamesh Militis** | Earth | 7 | `819161` | `bun run gilgamesh:smart` / `gilgamesh` / `arcarum:gilgamesh` / `arcarum:gilgamesh:smart` | `bun run gilgamesh:windowed` / `gilgamesh:smart:windowed` | Heavy Cane Militis, Earth Luster, Pillar of Land |
| **Morrigna Militis** | Wind | 15 | `819171` | `bun run morrigna:smart` / `morrigna` / `arcarum:morrigna` / `arcarum:morrigna:smart` | `bun run morrigna:windowed` / `morrigna:smart:windowed` | Tempest Militis, Wind Luster, Pillar of Sky |
| **The World** | All | 16 | `819131` | `bun run theworld:smart` / `theworld` / `arcarum-theworld` | `bun run arcarum-theworld:windowed` / `theworld-smart:windowed` | World Idean, Mundus Lusters, New World Quartz |
| **The World (Bespoke)**| All | 16 | `819131` | `bun run theworld:bespoke` | `bun run theworld:bespoke --windowed` | Dedicated standalone script runner for The World |
| **Zone Mundus Map** | All | 10 | — | `bun run stage10` / `arcarum:stage10` / `arcarum:mundus` | `bun run stage10:windowed` | Universal Map Scanner & Auto-Defender Target |

### 🌾 Primary 5-Gauge Farming Targets (20 AAP — Builds Sephira Boxes & Defender Gauges)
| Target | Element | Div | Quest ID | Quick CLI Shortcut | Direct Template Script | Purpose |
| :--- | :---: | :---: | :---: | :--- | :--- | :--- |
| **Parasite Steve** | Water | 9 | `819071` | `bun run arcarum:steve` | `bun run arcarum-mundus-parasite-steve-smart` | Primary Water farm, builds Ca Ong gauge |
| **Tide Caller** | Water | 10 | `819081` | `bun run arcarum:tide-caller` | `bun run arcarum-mundus-tide-caller-smart` | Water Sephira Box, Ca Ong gauge |
| **Earth-Shattering Fire Demon** | Fire | 3 | `819021` | `bun run arcarum:fire-demon` | `bun run arcarum-mundus-fire-demon-smart` | Primary Fire farm, builds Prometheus gauge |
| **Elephant Stomping Ground** | Earth | 7 | `819051` | `bun run arcarum:elephant` | `bun run arcarum-mundus-elephant-smart` | Primary Earth farm, builds Gilgamesh gauge |
| **Princess of the Horde** | Earth | 6 | `819041` | `bun run arcarum:princess` | `bun run arcarum-mundus-princess-horde-smart` | Earth Sephira Box, Gilgamesh gauge |
| **Dragon in Glittering Green** | Wind | 14 | `819111` | `bun run arcarum:dragon-green` | `bun run arcarum-mundus-dragon-green-smart` | Primary Wind farm, builds Morrigna gauge |
| **Dragon Princess** | All | — | — | `bun run arcarum-mundus-dragon-princess-smart` | `bun run arcarum-mundus-dragon-princess-smart` | Mundus Dragon Princess smart burst |
| **Wild Hunt** | All | — | — | `bun run arcarum-mundus-wild-hunt-smart` | `bun run arcarum-mundus-wild-hunt-smart` | Mundus Wild Hunt smart burst |
| **Voltage Rock** | Earth | — | — | `bun run arcarum-mundus-voltage-rock-smart` | `bun run arcarum-mundus-voltage-rock-smart` | Mundus Voltage Rock smart burst |
| **Love Meeeee** | Dark | — | — | `bun run arcarum-mundus-love-meeeee-smart` | `bun run arcarum-mundus-love-meeeee-smart` | Mundus Love Meeeee smart burst |

### ⚡ 3-Gauge Fast Burst & Sephira Heralds (+100% Boost)
| Target | Element | Div | Quest ID | Quick CLI Shortcut | Direct Template Script | Purpose |
| :--- | :---: | :---: | :---: | :--- | :--- | :--- |
| **Herald of Water** | Fire | 9 | `819191` | `bun run arcarum:herald-water` | `bun run arcarum-mundus-herald-water-smart` | **+100% Sephira Gauge Boost for 60 Minutes** |
| **Herald of Earth** | Fire | 6 | `819201` | `bun run arcarum:herald-earth` | `bun run arcarum-mundus-herald-earth-smart` | **+100% Sephira Gauge Boost for 60 Minutes** |
| **Hotheaded Pincers** | Fire | 2 | `819011` | `bun run arcarum:pincers` | `bun run arcarum-mundus-pincers-smart` | 3-bar low HP fast burst farming |
| **Winged Demon Cat** | Wind | 13 | `819101` | `bun run arcarum:winged-cat` | `bun run arcarum-mundus-winged-cat-smart` | 3-bar low HP fast burst farming |

---

## 8. Replicard Sandbox: Stage 3 (Zone Goliath) Bosses & Defenders

Optimized Smart Full Auto workflows for all Stage 3 (`#replicard/stage/3`) Zone Goliath encounters (Here Be Staves).

### ⚔️ Stage 3 Bosses & Defenders (30 AAP)
| Command | Windowed Variant | Target | Role | Drops |
| :--- | :--- | :--- | :---: | :--- |
| `bun run triune` / `arcarum:triune` | `bun run triune:windowed` | **Goliath Triune** | Zone Boss (Earth) | Tower/Hanged Man/Death Ideans, Earth Astra, Quartz |
| `bun run avarice` / `arcarum:avarice` | `bun run avarice:windowed` | **Avatar of Avarice** | Defender (Pink / Hanged Man) | **Goliath Organ**, Earthborne Astra, Hanged Man Idean |
| `bun run keeper` / `arcarum:keeper` | `bun run keeper:windowed` | **Goliath Keeper** | Defender (Green / Tower) | **Goliath Rib**, Earthborne Astra, Tower Idean |
| `bun run howler` / `arcarum:howler` | `bun run howler:windowed` | **Frenzied Howler** | Defender (Yellow / Death) | **Goliath Core**, Darkborne Astra, Death Idean |
| `bun run stage3` / `arcarum:stage3` / `arcarum:goliath` | `bun run stage3:windowed` | **Stage 3 Universal Map** | Universal Map Scanner | Auto-detects and targets active Defenders or quests |

### 🌾 Stage 3 5-Gauge Fast Farming & Heralds (20 AAP)
| Command | Windowed Variant | Target | Element | Purpose |
| :--- | :--- | :--- | :---: | :--- |
| `bun run arcarum:panther` | `bun run arcarum-goliath-panther-smart:windowed` | Earthshaking Panther | Earth | Green 5-Gauge, spawns Goliath Keeper |
| `bun run arcarum:barbarian` | `bun run arcarum-goliath-barbarian-smart:windowed` | Bloodstained Barbarian | Earth | Pink 5-Gauge, spawns Avatar of Avarice |
| `bun run arcarum:despair` | `bun run arcarum-goliath-despair-smart:windowed` | Writhing Despair | Dark | Yellow 5-Gauge, spawns Frenzied Howler |
| `bun run arcarum:goliath-herald` | `bun run arcarum-goliath-herald-smart:windowed` | Goliath Heralds | All | **+100% Sephira Gauge Boost for 60 Minutes** |

---

## 9. Replicard Sandbox: Stage 7 (Zone Faym & Joculator) Bosses & Defenders

Workflows for Stage 7 and Stage 6 encounters across Zone Faym, Zone Joculator, and Zone Kalendae.

| Command | Windowed Variant | Target | Div / Quest | Drops |
| :--- | :--- | :--- | :---: | :--- |
| `bun run redemption` / `lady` / `arcarum:redemption` / `arcarum:lady` | `bun run redemption:windowed` / `lady:windowed` | **Lady of Redemption** | Stage 7 / Div 7 / Quest 816071 | Joculator materials, Justice Idean, Aquaborne Astra, Veritas |
| `bun run cocytus` / `xeno-cocytus` / `arcarum:cocytus` / `arcarum:xeno-cocytus` | `bun run cocytus:windowed` / `xeno-cocytus:windowed` | **Xeno Cocytus Militis** | Stage 7 / Div 15 / Quest 816131 | Xeno Cocytus Militis weapons, Water Luster, Veritas, Box |
| `bun run ifrit` / `xeno-ifrit` / `arcarum:ifrit` / `arcarum:xeno-ifrit` | `bun run ifrit:windowed` / `xeno-ifrit:windowed` | **Xeno Ifrit Militis** | Stage 6 / Div 14 / Quest 815131 | Xeno Ifrit Militis weapons, Fire Luster, Veritas, Box |
| `bun run paragon` / `arcarum:paragon` / `arcarum:lilywhite` | `bun run paragon:windowed` | **Lilywhite Paragon** | Div 10 / Quest 812111 | **Faym Rib**, Moon Idean, Aquaborne Astra, Moon Veritas |
| `bun run fortress` / `arcarum:fortress` | `bun run fortress:windowed` | **Faymian Fortress** | Water (5-Gauge) | The Moon 5-Gauge, breaks 10-hit Barrier, spawns Paragon |
| `bun run arcarum:maiden` | `bun run arcarum-maiden-of-the-depths-smart:windowed` | **Maiden of the Depths** | Water (5-Gauge) | Arctic Plains 5-Gauge (Stage 7), spawns Lady of Redemption |
| `bun run stage7` / `arcarum:stage7` | `bun run arcarum-stage-7-smart:windowed` | **Stage 7 Universal Map** | Universal Map Scanner | Auto-detects and targets Lady of Redemption or Maiden |

---

## 10. Replicard Sandbox: Zone Eletio, Zone Kalendae & The World

Workflows for Zone Eletio/Kalendae defenders and Zone Mundus boss.

| Command | Windowed Variant | Target | Description |
| :--- | :--- | :--- | :--- |
| `bun run athena:smart` / `athena` / `arcarum:athena` / `arcarum:athena:smart` | `bun run arcarum-athena-militis:windowed` / `athena:windowed` | Athena Militis | Smart Full Auto / Fast burst rotation (Zone Eletio) |
| `bun run grani:smart` / `grani` / `arcarum:grani` / `arcarum:grani:smart` | `bun run arcarum-grani-militis:windowed` / `grani:windowed` | Grani Militis | Smart Full Auto rotation (Zone Faym) |
| `bun run grani:fast` / `arcarum:grani:fast` | `bun run arcarum-grani-militis-fast:windowed` | Grani Militis | Fast burst 1-turn rotation |
| `bun run theworld` / `arcarum-theworld` / `arcarum:world` | `bun run arcarum-theworld:windowed` | The World | Quest 819131 encounter with Plain Damage omen counters |
| `bun run theworld:smart` / `arcarum:world:smart` | `bun run arcarum-theworld-smart:windowed` | The World | Smart Full Auto rotation |
| `bun run theworld:bespoke` | `bun run theworld:bespoke --windowed` | The World | Dedicated standalone script runner for The World |

---

## 11. Gold Bar (GB) Hunting & High-Difficulty Raids

Dedicated Blue Chest honor burst workflows (1.4M–1.58M target honors) with drop telemetry.

| Command | Windowed Variant | Raid | Target Honors | Description |
| :--- | :--- | :--- | :---: | :--- |
| `bun run pbhl` / `gb-pbhl` / `gb-pbhl-universal` | `bun run pbhl:windowed` / `gb-pbhl:windowed` / `gb-pbhl-universal:windowed` | Proto Bahamut HL | 1.50M | Default PBHL burst loop (`gb-pbhl`) |
| `bun run gb-pbhl:skill` / `gb-pbhl-skill` | `bun run gb-pbhl:skill:windowed` | Proto Bahamut HL | 1.50M | Precise manual skill sequence (C4S3 $\rightarrow$ Call $\rightarrow$ C4S4 $\rightarrow$ C1S3) |
| `bun run gb-pbhl:reload-skills` | `bun run gb-pbhl:reload-skills:windowed` | Proto Bahamut HL | 1.50M | Precise skill sequence with animation cancellation reloads |
| `bun run gb-pbhl-fast` | `bun run gb-pbhl-fast:windowed` | Proto Bahamut HL | 1.50M | Ultra-fast 0-button reload burst rotation |
| `bun run gb-akasha` | `bun run gb-akasha:windowed` | Akasha HL | 1.50M | Standardized 2-turn burst loop targeting Gold Bar & Keys |
| `bun run gb-go` | `bun run gb-go:windowed` | Grand Order HL | 1.50M | Standardized 2-turn burst for Heavenly Horns & Centrums |
| `bun run gb-farm` | `bun run gb-farm:windowed` | Tri-Raid Rotator | Dynamic | Concurrently rotates PBHL $\rightarrow$ Akasha $\rightarrow$ GOHL |
| `bun run theworld:raid` / `world:raid` / `raid:theworld` | `bun run theworld:raid:windowed` | The World (HL) | — | Finder Tab 1 assist raid burst loop |
| `bun run goldbar` / `notify:gold-bar` | — | Telemetry | — | Tests permanent raid archive URL resolution & drops |
| `bun run gb:report` / `gb:summary` | — | Telemetry | — | Generates Gold Bar drop summary & dry-streak analysis |

---

## 12. Magna 3 (Omega Rebirth) Fast Leeching & OTK Burst

Late-stage raid entry (HP $\le 20\%$, Players $\ge 3$), 1-turn burst, and immediate room exit. All Magna 3 Tab 1 workflows feature autonomous Finder Slot 1 reconfiguration (`autoSetRaid: true`) with 0ms pre-check.

| Command | Windowed Variant | Boss | Team Element | Supporter Summon |
| :--- | :--- | :--- | :---: | :---: |
| `bun run leech:colossus` / `otkraid:colossus` | `bun run leech:colossus:windowed` / `otkraid:colossus:windowed` | Colossus Ira (Fire) | Water | Varuna |
| `bun run leech:tiamat` / `otkraid:tiamat` | `bun run leech:tiamat:windowed` / `otkraid:tiamat:windowed` | Tiamat Aura (Wind) | Fire | Agni |
| `bun run leech:leviathan` / `farm:leviathan` / `farm:levi` | `bun run leech:leviathan:windowed` / `farm:leviathan:windowed` / `farm:levi:windowed` | Leviathan Mare (Water) | Earth | Titan |
| `bun run leech:yggdrasil` | `bun run leech:yggdrasil:windowed` | Yggdrasil Arbos (Earth) | Wind | Zephyrus |
| `bun run leech:luminiera` | `bun run leech:luminiera:windowed` | Luminiera Credo (Light) | Dark | Hades |
| `bun run leech:celeste` | `bun run leech:celeste:windowed` | Celeste Ater (Dark) | Light | Zeus |
| `bun run leech` / `otkraid` / `farm` | `bun run leech:windowed` / `otkraid:windowed` / `farm:windowed` | Dynamic Multi-Element | Dynamic | Multi-element concurrent evaluator loop |

---

## 13. Endgame 6-Man & Six Dragons Assist Raids

Fast assist farming and leeching for foundational endgame 6-man and Six Dragons raids on Finder Tab 1 (`#quest/assist`). All workflows have autonomous Finder slot reconfiguration (`autoSetRaid: true`) enabled with 0ms pre-check.

| Command | Windowed Variant | Raid | Target Enemy | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `bun run bubz` / `beelzebub` / `long-live-the-king` | `bun run bubz:windowed` / `beelzebub:windowed` / `long-live-the-king:windowed` | Beelzebub (HL) | Long Live the King | 8-step burst, `autoSetRaid: true` enabled |
| `bun run leech:bubz` | `bun run leech:bubz:windowed` | Beelzebub (HL) | Long Live the King | Fast leeching on dying raids (`autoSetRaid: true`) |
| `bun run faahl` / `dark-rapture-hard` | `bun run faahl:windowed` / `dark-rapture-hard:windowed` | Lucilius (Hard) | Dark Rapture (Hard) | 8-step burst with attack cancel (`autoSetRaid: true`) |
| `bun run leech:faahl` | `bun run leech:faahl:windowed` | Lucilius (Hard) | Dark Rapture (Hard) | Fast leeching on low HP raids (`autoSetRaid: true`) |
| `bun run belial` / `cunning` | `bun run belial:windowed` / `cunning:windowed` | Belial (HL) | The Fallen Angel of Cunning | 8-step burst for Chains of Temptation (`autoSetRaid: true`) |
| `bun run leech:belial` | `bun run leech:belial:windowed` | Belial (HL) | The Fallen Angel of Cunning | Fast leeching on low HP raids (`autoSetRaid: true`) |
| `bun run fediel` | `bun run fediel:windowed` | Fediel (Impossible) | Fediel | Six Dragons dark uncap materials (`autoSetRaid: true`) |
| `bun run leech:fediel` | `bun run leech:fediel:windowed` | Fediel (Impossible) | Fediel | Fast leeching on low HP Fediel raids (`autoSetRaid: true`) |
| `bun run wilnas` | `bun run wilnas:windowed` | Wilnas (Impossible) | Wilnas | Six Dragons fire uncap materials (`autoSetRaid: true`) |
| `bun run leech:wilnas` | `bun run leech:wilnas:windowed` | Wilnas (Impossible) | Wilnas | Fast leeching on low HP Wilnas raids (`autoSetRaid: true`) |

---

## 14. Autonomous Finder Slot & Raid Auto-Setting (`autoSetRaid`)

Eliminates the requirement for manual in-game raid selection on Finder Tab 1 (Slot 1). All Tab 1 assist workflows automatically reconfigure Finder Slot 1 to the required raid whenever needed.

### How It Works
When running an assist raid workflow with `autoSetRaid: true`:
1. **Zero-Overhead Fast Pre-Check**: The engine inspects the current lobby thumbnail icon (`.prt-search-switch-display.slot1 .img-quest`). If Slot 1 already matches the target encounter (e.g. Beelzebub `305181`), it proceeds immediately with **0ms modal overhead**.
2. **Autonomous Reconfiguration**: If a different raid is configured (for example, Slot 1 was left on Leviathan Mare `305631` from previous farming), the engine:
   - Clicks the Set Filters button (`.btn-search-setting`).
   - Selects Slot 1 (`.btn-select-search-slot[data-slot="1"]`).
   - Switches to the raid's category tab (`.btn-stage-type`) and opens the stage (`.btn-search-stage`).
   - Selects the target raid card (`.btn-select-quest`), confirms (`.btn-usual-ok`), and closes settings.
   - Activates the slot button (`.btn-search-switch.slot1`) and begins farming!

### Template Configuration (`templates/*.json`)
```json
{
  "name": "Raid - Long Live the King",
  "questUrl": "https://game.granbluefantasy.jp/#quest/assist",
  "mode": "assist",
  "targetEnemy": "Long Live the King",
  "raidSlot": 1,
  "autoSetRaid": true
}
```

### DSL Configuration
```yaml
Name: Raid - Long Live the King
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
Slot: 1
Auto Set Raid: true
Target Enemy: Long Live the King
---
wait_element .btn-attack-start
reload
c4s1
c3s1
c3s2
c2s1
attack
confirm_result
```

### Parameter Reference
| Parameter | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `autoSetRaid` | `boolean` | `false` | Enables automatic slot reconfiguration in Set Filters modal |
| `autoSetRaidSlot` | `number` | `raidSlot \|\| 1` | Specifies which Finder slot (1–4) to configure (defaults to `1`) |
| `targetRaidQuestId` | `string \| number` | auto-resolved | Explicit quest ID override (e.g. `"305181"` for Bubz, `"305631"` for Leviathan Mare) |

---

## 15. Guild Wars (Unite & Fight)

High-speed meat harvesting, NM95 burst sequences, multi-account swarm farming, and token box clearing.

| Command | Arguments / Flags | Phase / Mode | Description |
| :--- | :--- | :---: | :--- |
| `bun run gw-meat` / `gw-meat-light` | `[runs] [-w]` | EX+ Meat (Windowed) | Sub-7.5s 24M meat farming rotation |
| `bun run gw-meat:headless` / `gw-meat-light:headless` | `[runs]` | EX+ Meat (Headless) | Background meat farming loop |
| `bun run gw-meat:swarm` / `gw-meat-swarm` | `[runs]` (e.g. `100`) | EX+ Meat (Swarm) | Parallel multi-account swarm farming (acc1 + acc2 concurrently) |
| `bun run gw-nm95` / `gw-nm95-light` | `[runs] [-w]` | NM95 (1-Turn Burst) | Florence + Nehan 1-turn burst farm (14s/clear) |
| `bun run gw-nm95:acc1` / `gw-nm95-light:acc1` | `[runs]` | NM95 Acc 1 | Runs NM95 explicitly on Account 1 |
| `bun run gw-nm95:acc2` / `gw-nm95-light:acc2` | `[runs]` | NM95 Acc 2 | Runs NM95 explicitly on Account 2 |
| `bun run gw-nm95-light:windowed` | `[runs]` | NM95 (Windowed) | NM95 burst in visible GUI window |
| `bun run gacha:unf` | — | Token Drawbox | Bulk "Draw 1 Drawbox" clearer and auto-reset loop |

---

## 16. Story, Scenario & Collaboration Events

Automated story cutscene skip, trophy crystal harvesting, daily Maniac, Nightmare HELL skip, and token drawboxes.

| Command | Windowed Variant | Task | Description |
| :--- | :--- | :---: | :--- |
| `bun run event` / `event:story` | `bun run event:windowed` | Story Chapters | Auto-skips dialogues and Full Auto clears story stages |
| `bun run event:all` | — | Full Pipeline | Story $\rightarrow$ Challenge $\rightarrow$ Maniac $\rightarrow$ HELL $\rightarrow$ Gacha |
| `bun run event:sweep` / `event:quests` | — | First-Clear | Sweeps solo & raid first-clear crystals |
| `bun run event:maniac` | — | Daily Maniac | Clears daily 2/2 Maniac solo battles |
| `bun run event:nightmare` / `event:nightmare:skip` / `event:hell` / `nightmare` / `hell` | — | HELL Skip | Instant batch skip for accumulated Nightmare battles |
| `bun run event:challenge` | — | Challenge Quest | Clears 1-time event challenge battle |
| `bun run event:missions` | — | Skyscope | Clears daily event event-specific missions |
| `bun run event:gacha` / `event:token` / `event:tokens` / `gacha:event` | — | Token Drawbox | Autonomous Draw 1 Drawbox clearer & auto-reset |
| `bun run event:solo` / `event:collab:solo` | — | Solo Farm | Farms event solo quests (e.g. EX) |
| `bun run event:raid` / `event:raid:ex` / `event:collab:raid` | `bun run event:raid:windowed` | Raid Burst EX | Sub-4s raid join and burst farming (Extreme) |
| `bun run event:raid:vh` | — | Raid Burst VH | Sub-4s raid join and burst farming (Very Hard) |
| `bun run event:raid:hl` | — | Raid Burst HL | Sub-4s raid join and burst farming (High Level) |
| `bun run event:workflow` | — | Generic Event | Direct runner for `templates/event-story.json` |

---

## 17. Fate Episodes Auto-Farmer

Automates character Fate Episodes (`#quest/fate`) to unlock character skill slots and harvest crystals.

| Command | Windowed Variant | Episodes | Description |
| :--- | :--- | :---: | :--- |
| `bun run fate` / `fate:headless` | `bun run fate:windowed` | 5 | Fast-skips dialogues and Full Auto clears battles (Default: 5) |
| `bun run fate:5` | — | 5 | Farms 5 consecutive Fate Episodes |
| `bun run fate:10` | — | 10 | Farms 10 consecutive Fate Episodes |
| `bun run fate:20` | — | 20 | Farms 20 consecutive Fate Episodes |
| `bun run fate:all` | — | 100 | Large-batch automated fate story clearance |
| `bun run fate:cli` | `bun run fate:cli:windowed` | Custom | Direct CLI fate episode engine (`bun src/cli/run-fate.ts acc1 [count]`) |

---

## 18. Rise of the Beasts (ROTB)

Four Beasts farming, Baihu Extreme loops, and Titan Agon uncap summon routines.

| Command | Target | Description |
| :--- | :---: | :--- |
| `bun run rotb` | ROTB Menu | Main ROTB selector interactive menu |
| `bun run rotb:baihu` | Baihu (30 runs) | Farms Extreme Baihu solo battle (30 battles) |
| `bun run rotb:earth` | 1 Cycle | Executes 9x Baihu $\rightarrow$ 1x Titan Agon |
| `bun run rotb:earth:loop` | Continuous Loop | Infinite loop: 9x Baihu $\rightarrow$ 1x Titan repeatedly until stopped |

---

## 19. Interactive Selector & Generic Workflow Runner

Execute any pre-packaged, modified, or custom workflow template dynamically.

### Quick Workflow Commands

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `bun run workflow` / `run-workflow` | — | Interactive terminal menu (arrow-key template picker) |
| `bun run workflow:validate` | — | Validates all 74 templates against strict Zod schema |
| `bun run templates:sync` | — | Scans `templates/` and auto-registers CLI scripts in `package.json` |
| `bun run acc1 <template> [runs]` | `[runs]` `[--windowed]` | Runs specified template on Account 1 |
| `bun run acc1:windowed <template> [runs]` | `[runs]` | Runs specified template on Account 1 in visible window |
| `bun run acc2 <template> [runs]` | `[runs]` `[--windowed]` | Runs specified template on Account 2 |
| `bun run acc2:windowed <template> [runs]` | `[runs]` | Runs specified template on Account 2 in visible window |
| `bun src/cli/run-workflow.ts <acc> <template> [runs]` | `[--windowed]` `[--headless]` | Direct CLI invocation with complete parameter control |

### How to Modify a Template (e.g. `templates/gb-pbhl.json`)
1. **Edit `templates/gb-pbhl.json`**:
   - Change turn order, add skills (`{ "code": "skill", "character": 4, "skill": 3 }`), call summons (`{ "code": "summon", "slot": 2 }`), or adjust target honors (`"targetScore": 1500000`).
2. **Validate Your Changes**:
   ```bash
   bun run workflow:validate
   ```
3. **Execute the Modified Template**:
   ```bash
   # Test in visible window:
   bun run gb-pbhl:windowed

   # Or specify custom run count on acc1:
   bun src/cli/run-workflow.ts acc1 gb-pbhl 20 --windowed

   # Or run in silent background mode:
   bun run gb-pbhl
   ```

### How to Customize Minimum and Maximum HP Targets (Raid & Leech)
Configure raid candidate filtering boundaries directly in the workflow JSON (`templates/*.json`):

```json
{
  "name": "Raid - The World (HL)",
  "questUrl": "https://game.granbluefantasy.jp/#quest/assist",
  "raidSlot": 1,
  "evaluatorStrategy": "leech",
  "minHpPct": 1,
  "maxHpPct": 100,
  "minPlayers": 1,
  "maxPlayers": 29,
  "minRaidScore": 0,
  "steps": [ ... ]
}
```

- **`minHpPct`** (`number`): Hard lower HP% bound (e.g. `1` for dying/leech, `50` for fresh raids). Raids below this HP are disqualified (`HP_BELOW_MIN`).
- **`maxHpPct`** (`number`): Hard upper HP% bound (e.g. `20` for Magna 3 fast leech, `80` to avoid 100% full-health raids). Raids above this HP are disqualified (`HP_ABOVE_MAX`).
- **`evaluatorStrategy`** (`"honor"` | `"otk_burst"` | `"leech"` | `"farm"`): 
  - `"honor"`: Blue chest focus, prioritizes fresh raids with high remaining HP.
  - `"leech"` / `"otk_burst"`: Fast burst focus, prioritizes low HP raids for rapid drop turn-around.
  - `"farm"`: Adaptive, evaluates damage output, most joined raid & lowest HP.
- **`minPlayers`** / **`maxPlayers`** (`number`): Enforces minimum clearing participants (e.g. `minPlayers: 3`) or max capacity ceiling (`maxPlayers: 29`).
- **`minRaidScore`** (`number`): Minimum score needed to accept candidate (default: `0` for custom HP bands, `40` for standard honor raids).

---

## 20. Complete Synced Workflow Templates Master Catalog (74 Templates)

Every JSON template in `templates/` is auto-synced into `package.json` with both headless and `:windowed` scripts.

| Category | Template Name | Headless Script | Windowed Script |
| :--- | :--- | :--- | :--- |
| **Arcarum Mundus Core** | `arcarum-stage-10-smart` | `bun run arcarum-stage-10-smart` | `bun run arcarum-stage-10-smart:windowed` |
| | `arcarum-theworld` | `bun run arcarum-theworld` | `bun run arcarum-theworld:windowed` |
| | `arcarum-theworld-smart` | `bun run arcarum-theworld-smart` | `bun run arcarum-theworld-smart:windowed` |
| | `arcarum-ca-ong-militis` | `bun run arcarum-ca-ong-militis` | `bun run arcarum-ca-ong-militis:windowed` |
| | `arcarum-ca-ong-militis-smart` | `bun run arcarum-ca-ong-militis-smart` | `bun run arcarum-ca-ong-militis-smart:windowed` |
| | `arcarum-prometheus-militis` | `bun run arcarum-prometheus-militis` | `bun run arcarum-prometheus-militis:windowed` |
| | `arcarum-prometheus-militis-smart` | `bun run arcarum-prometheus-militis-smart` | `bun run arcarum-prometheus-militis-smart:windowed` |
| | `arcarum-gilgamesh-militis` | `bun run arcarum-gilgamesh-militis` | `bun run arcarum-gilgamesh-militis:windowed` |
| | `arcarum-gilgamesh-militis-smart` | `bun run arcarum-gilgamesh-militis-smart` | `bun run arcarum-gilgamesh-militis-smart:windowed` |
| | `arcarum-morrigna-militis` | `bun run arcarum-morrigna-militis` | `bun run arcarum-morrigna-militis:windowed` |
| | `arcarum-morrigna-militis-smart` | `bun run arcarum-morrigna-militis-smart` | `bun run arcarum-morrigna-militis-smart:windowed` |
| **Arcarum Mundus Targets** | `arcarum-mundus-parasite-steve-smart` | `bun run arcarum-mundus-parasite-steve-smart` | `bun run arcarum-mundus-parasite-steve-smart:windowed` |
| | `arcarum-mundus-tide-caller-smart` | `bun run arcarum-mundus-tide-caller-smart` | `bun run arcarum-mundus-tide-caller-smart:windowed` |
| | `arcarum-mundus-fire-demon-smart` | `bun run arcarum-mundus-fire-demon-smart` | `bun run arcarum-mundus-fire-demon-smart:windowed` |
| | `arcarum-mundus-elephant-smart` | `bun run arcarum-mundus-elephant-smart` | `bun run arcarum-mundus-elephant-smart:windowed` |
| | `arcarum-mundus-princess-horde-smart` | `bun run arcarum-mundus-princess-horde-smart` | `bun run arcarum-mundus-princess-horde-smart:windowed` |
| | `arcarum-mundus-dragon-green-smart` | `bun run arcarum-mundus-dragon-green-smart` | `bun run arcarum-mundus-dragon-green-smart:windowed` |
| | `arcarum-mundus-dragon-princess-smart`| `bun run arcarum-mundus-dragon-princess-smart`| `bun run arcarum-mundus-dragon-princess-smart:windowed`|
| | `arcarum-mundus-herald-water-smart` | `bun run arcarum-mundus-herald-water-smart` | `bun run arcarum-mundus-herald-water-smart:windowed` |
| | `arcarum-mundus-herald-earth-smart` | `bun run arcarum-mundus-herald-earth-smart` | `bun run arcarum-mundus-herald-earth-smart:windowed` |
| | `arcarum-mundus-pincers-smart` | `bun run arcarum-mundus-pincers-smart` | `bun run arcarum-mundus-pincers-smart:windowed` |
| | `arcarum-mundus-winged-cat-smart` | `bun run arcarum-mundus-winged-cat-smart` | `bun run arcarum-mundus-winged-cat-smart:windowed` |
| | `arcarum-mundus-voltage-rock-smart` | `bun run arcarum-mundus-voltage-rock-smart` | `bun run arcarum-mundus-voltage-rock-smart:windowed` |
| | `arcarum-mundus-love-meeeee-smart` | `bun run arcarum-mundus-love-meeeee-smart` | `bun run arcarum-mundus-love-meeeee-smart:windowed` |
| | `arcarum-mundus-wild-hunt-smart` | `bun run arcarum-mundus-wild-hunt-smart` | `bun run arcarum-mundus-wild-hunt-smart:windowed` |
| **Arcarum Stage 3 (Goliath)**| `arcarum-stage-3-smart` | `bun run arcarum-stage-3-smart` | `bun run arcarum-stage-3-smart:windowed` |
| | `arcarum-goliath-triune-smart` | `bun run arcarum-goliath-triune-smart` | `bun run arcarum-goliath-triune-smart:windowed` |
| | `arcarum-goliath-keeper-smart` | `bun run arcarum-goliath-keeper-smart` | `bun run arcarum-goliath-keeper-smart:windowed` |
| | `arcarum-avatar-of-avarice-smart` | `bun run arcarum-avatar-of-avarice-smart` | `bun run arcarum-avatar-of-avarice-smart:windowed` |
| | `arcarum-frenzied-howler-smart` | `bun run arcarum-frenzied-howler-smart` | `bun run arcarum-frenzied-howler-smart:windowed` |
| | `arcarum-goliath-panther-smart` | `bun run arcarum-goliath-panther-smart` | `bun run arcarum-goliath-panther-smart:windowed` |
| | `arcarum-goliath-barbarian-smart` | `bun run arcarum-goliath-barbarian-smart` | `bun run arcarum-goliath-barbarian-smart:windowed` |
| | `arcarum-goliath-despair-smart` | `bun run arcarum-goliath-despair-smart` | `bun run arcarum-goliath-despair-smart:windowed` |
| | `arcarum-goliath-herald-smart` | `bun run arcarum-goliath-herald-smart` | `bun run arcarum-goliath-herald-smart:windowed` |
| **Arcarum Stage 7 & Staves** | `arcarum-stage-7-smart` | `bun run arcarum-stage-7-smart` | `bun run arcarum-stage-7-smart:windowed` |
| | `arcarum-lady-of-redemption-smart` | `bun run arcarum-lady-of-redemption-smart` | `bun run arcarum-lady-of-redemption-smart:windowed` |
| | `arcarum-maiden-of-the-depths-smart`| `bun run arcarum-maiden-of-the-depths-smart`| `bun run arcarum-maiden-of-the-depths-smart:windowed`|
| | `arcarum-lilywhite-paragon` | `bun run arcarum-lilywhite-paragon` | `bun run arcarum-lilywhite-paragon:windowed` |
| | `arcarum-lilywhite-paragon-smart` | `bun run arcarum-lilywhite-paragon-smart` | `bun run arcarum-lilywhite-paragon-smart:windowed` |
| | `arcarum-faymian-fortress` | `bun run arcarum-faymian-fortress` | `bun run arcarum-faymian-fortress:windowed` |
| | `arcarum-xeno-cocytus-militis` | `bun run arcarum-xeno-cocytus-militis` | `bun run arcarum-xeno-cocytus-militis:windowed` |
| | `arcarum-xeno-ifrit-militis` | `bun run arcarum-xeno-ifrit-militis` | `bun run arcarum-xeno-ifrit-militis:windowed` |
| **Arcarum Eletio & Faym** | `arcarum-athena-militis` | `bun run arcarum-athena-militis` | `bun run arcarum-athena-militis:windowed` |
| | `arcarum-athena-militis-smart` | `bun run arcarum-athena-militis-smart` | `bun run arcarum-athena-militis-smart:windowed` |
| | `arcarum-grani-militis` | `bun run arcarum-grani-militis` | `bun run arcarum-grani-militis:windowed` |
| | `arcarum-grani-militis-smart` | `bun run arcarum-grani-militis-smart` | `bun run arcarum-grani-militis-smart:windowed` |
| | `arcarum-grani-militis-fast` | `bun run arcarum-grani-militis-fast` | `bun run arcarum-grani-militis-fast:windowed` |
| **Gold Bar Raids** | `gb-pbhl` | `bun run gb-pbhl` | `bun run gb-pbhl:windowed` |
| | `gb-pbhl-fast` | `bun run gb-pbhl-fast` | `bun run gb-pbhl-fast:windowed` |
| | `gb-pbhl-skill` | `bun run gb-pbhl-skill` | `bun run gb-pbhl-skill:windowed` |
| | `gb-pbhl-reload-skills` | `bun run gb-pbhl-reload-skills` | `bun run gb-pbhl-reload-skills:windowed` |
| | `gb-akasha` | `bun run gb-akasha` | `bun run gb-akasha:windowed` |
| | `gb-go` | `bun run gb-go` | `bun run gb-go:windowed` |
| | `gb-farm` | `bun run gb-farm` | `bun run gb-farm:windowed` |
| **Magna 3 (Omega Rebirth)** | `leech-colossus-ira` | `bun run leech-colossus-ira` | `bun run leech-colossus-ira:windowed` |
| | `leech-tiamat-aura` | `bun run leech-tiamat-aura` | `bun run leech-tiamat-aura:windowed` |
| | `leech-leviathan-mare` | `bun run leech-leviathan-mare` | `bun run leech-leviathan-mare:windowed` |
| | `farm-leviathan-mare` | `bun run farm-leviathan-mare` | `bun run farm-leviathan-mare:windowed` |
| | `leech-yggdrasil-arbos` | `bun run leech-yggdrasil-arbos` | `bun run leech-yggdrasil-arbos:windowed` |
| | `leech-luminiera-credo` | `bun run leech-luminiera-credo` | `bun run leech-luminiera-credo:windowed` |
| | `leech-celeste-ater` | `bun run leech-celeste-ater` | `bun run leech-celeste-ater:windowed` |
| **Endgame & Dragons Raids** | `raid-long-live-the-king` | `bun run raid-long-live-the-king` | `bun run raid-long-live-the-king:windowed` |
| | `raid-dark-rapture-hard` | `bun run raid-dark-rapture-hard` | `bun run raid-dark-rapture-hard:windowed` |
| | `raid-the-fallen-angel-of-cunning` | `bun run raid-the-fallen-angel-of-cunning` | `bun run raid-the-fallen-angel-of-cunning:windowed` |
| | `raid-the-world` | `bun run raid-the-world` | `bun run raid-the-world:windowed` |
| | `raid-fediel` | `bun run raid-fediel` | `bun run raid-fediel:windowed` |
| | `raid-wilnas` | `bun run raid-wilnas` | `bun run raid-wilnas:windowed` |
| **Guild Wars** | `gw-meat-light` | `bun run gw-meat-light` | `bun run gw-meat-light:windowed` |
| | `gw-nm95-light` | `bun run gw-nm95-light` | `bun run gw-nm95-light:windowed` |
| **Dailies, Events & Fates** | `daily-favorites` | `bun run daily-favorites` | `bun run daily-favorites:windowed` |
| | `daily-universal` | `bun run daily-universal` | `bun run daily-universal:windowed` |
| | `event-story` | `bun run event-story` | `bun run event-story:windowed` |
| | `event-raid` | `bun run event-raid` | `bun run event-raid:windowed` |
| | `fate-stories` | `bun run fate-stories` | `bun run fate-stories:windowed` |

---

## 21. Gateway Server, Web Cockpit & Mobile PWA

Run the companion server for phone/tablet remote control, live screencasts, and emergency abort.

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `bun run gateway` *(or `bun run dev`)* | — | Boots HTTP/WebSocket companion gateway on port 3000/3001 |
| `bun run dev:node` | — | Starts gateway using Node.js + tsx file watcher |
| `bun run build` | — | Compiles TypeScript codebase (`tsc`) to `dist/` |
| `bun run start` | — | Runs production gateway build |
| `bun run pm2:start` | — | Starts and detaches gateway server via PM2 (`ecosystem.config.cjs`) |
| `bun run pm2:stop` | — | Stops active PM2 `gbf-controller` process |
| `bun run pm2:restart` | — | Gracefully restarts PM2 `gbf-controller` process |
| `bun run pm2:logs` | — | Streams live consolidated PM2 log tail |
| `bun run pm2:status` | — | Displays PM2 uptime, memory footprint, and process health |

---

## 22. Discord Remote Controller & Two-Way CAPTCHA Relay

Autonomous bidirectional Discord bot bridge for mobile monitoring, on-demand preset execution, and zero-latency CAPTCHA solving.

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `bun run discord:controller` / `controller` / `vps` | — | Starts 2-way Discord DM Gateway (remote `/gbf`, `/stop`, `/status`) |
| `bun run solve-captcha` / `captcha` | `[solution]` | Injects CAPTCHA solution directly into game DOM from terminal |
| `bun run test:discord` | — | Tests Discord webhook, DM relay connection, and command parsing |

### Discord Operator Slash Commands (`/gbf <command>`)
- `/gbf <preset> [args]`: Executes whitelisted preset or template (e.g. `/gbf daily`, `/gbf daily:host`, `/gbf gb-akasha 100`, `/gbf bubz 50`, `/gbf leech:leviathan`).
- **Preemptive Task Switching**: If a task is executing and you issue another command, the controller **automatically terminates the running task and launches the new task immediately** without requiring a manual `/gbf stop`.
- `/gbf stop` (or `/gbf halt`): Gracefully terminates active running job and releases CDP port 9222.
- `/gbf status`: Displays active job, PID, uptime, scheduler state, and latest terminal output snippet.
- `/gbf scheduler:off` / `/gbf scheduler:on`: Pauses or resumes autonomous 21:00 JST (19:00 WIB) Peak-Hour daily scheduler.
- `/gbf logs`: Displays last 15 lines of live terminal output.
- `/gbf help`: Displays the operator command reference.

---

## 23. Discord Rich Presence (RPC)

Synchronizes farming telemetry or productivity presets with Discord desktop status.

| Command | Arguments / Flags | Preset | Description |
| :--- | :--- | :---: | :--- |
| `bun run presence:gbf` | — | GBF Gaming | Live raid drops, honors, and farming activity |
| `bun run presence:work` | — | Work / Focus | Deep work status for project tracking |
| `bun run presence:trade` | — | Trading | Trading quotes and risk management status |
| `bun run presence` | `[mode]` | Custom | Sets presence directly to `gbf`, `work`, or `trade` |
| `bun run presence:bg` | — | Background | Detaches silent background daemon for presence |
| `bun run presence:bg:gbf` | — | Background | Detaches background daemon configured for GBF status |
| `bun run presence:bg:trade` | — | Background | Detaches background daemon configured for trading status |
| `bun run presence:clear` / `presence:stop` | — | Stop / Wipe | Terminates background daemon and wipes Discord status |
| `bun run presence:test` | — | Diagnostics | Tests Discord RPC local IPC socket communication |
| `bun run presence:watch` | — | Watcher | Monitors active tasks and dynamically updates presence |

---

## 24. Quality Assurance, Testing & Pre-Flight Verification

Mandatory quality gates executed locally and in CI.

| Command | Scope | Description |
| :--- | :---: | :--- |
| `bun run verify` | Full Pre-Flight | Runs Hygiene + Schema Validation + `tsc` Build + All 52 Test Suites |
| `bun run test` / `test:all` | Unified Runner | Executes all 52 test suites in parallel (`tests/run-all.ts`) |
| `bun run test:node` | Node/TSX | Runs all 52 test suites under Node.js runtime via tsx |
| `bun run hygiene` / `audit:secrets` | Security Gate | Audits git index for secret leaks, personal paths, or credentials |
| `bun run workflow:validate` | Schema Gate | Validates all 74 workflow templates against Zod AST schemas |
| `bun run typecheck` / `build` | Type Safety | Executes TypeScript static type-checking (`tsc --noEmit` / `tsc`) |
| `bun tests/test-finder-slot-configurator.ts` | Unit Tests | Tests Search Raid Catalog, query resolver, and slot configurator |
| `bun run test:engine` | Unit Tests | Tests Universal Workflow Engine state machines and retries |
| `bun run test:daily` | Unit Tests | Tests Daily Routine Pro Skip and modal reconciliation |
| `bun run test:evaluator` | Unit Tests | Tests Magna 3 concurrent evaluator and LRU cache |
| `bun run test:templates` | Unit Tests | Tests all workflow JSON templates for schema compliance |
| `bun run test:parser` | Unit Tests | Tests advanced DSL compiler and round-trip serializer |

---

### Pre-Flight Quality Scorecard (52 / 52 Test Suites)

```
========================================================================
                       Test Execution Scorecard                         
========================================================================
  [1]  ✅ PASS | Workflow Template Schema & Boundary Tests
  [2]  ✅ PASS | Advanced DSL Compiler & Round-Trip Serializer
  [3]  ✅ PASS | Universal Engine Unit & Telemetry Mock Tests
  [4]  ✅ PASS | Human Motor Biomechanical Math & Jitter Tests
  [5]  ✅ PASS | ProSkip Daily Engine State Logic Tests
  [6]  ✅ PASS | Raid Engine State Machine & Recovery Tests
  [7]  ✅ PASS | Template Parser Backwards Compatibility Tests
  [8]  ✅ PASS | Daily Universal Routine & Reconnect Logic Tests
  [9]  ✅ PASS | Rupie Gacha Automation Logic Unit Tests
  [10] ✅ PASS | 3-Raid Backup Limit Detection & Recovery Tests
  [11] ✅ PASS | Event Engine & Scenario Story Unit Tests
  [12] ✅ PASS | Gold Bar Tracker & Battle URL Integration Tests
  [13] ✅ PASS | CAPTCHA Detection & Safety Sentinel Tests
  [14] ✅ PASS | Notification Deduplication & Anti-Spam Tests
  [15] ✅ PASS | Raid Evaluator & Score-Based Decision Tests
  [16] ✅ PASS | Session & Cookie Synchronization Tests
  [17] ✅ PASS | Discord Presence Multi-Template Tests
  [18] ✅ PASS | Arcarum: The World Template & AAP Engine Tests
  [19] ✅ PASS | Granblue Fantasy Methodological Tactical Skills Tests
  [20] ✅ PASS | Proto Bahamut HL Universal Workflow & Shorthand DSL Tests
  [21] ✅ PASS | Magna 3 Leech & Fast Burst 6-Element Evaluator Unit Tests
  [22] ✅ PASS | Leviathan Mare Farm Evaluator & Adaptive Strategy Test Suite
  [23] ✅ PASS | Raid Evaluator Parallel Multi-Condition & High-Performance Tests
  [24] ✅ PASS | Daily Host Engine & 16-Raid Catalog Unit Tests
  [25] ✅ PASS | Senior Gold Industry Standard Data Architecture & Catalog Tests
  [26] ✅ PASS | Backup Broadcast Scope Verification & 3-Min Cooldown Unit Tests
  [27] ✅ PASS | Dual-Track Assist Interleaving & Background Host Recheck Tests
  [28] ✅ PASS | Failure Diagnostic Classifier & Critical Analysis Tests
  [29] ✅ PASS | Daily Reset Scheduler Daemon & JST Math Tests
  [30] ✅ PASS | Discord Remote Controller Security & Whitelist Tests
  [31] ✅ PASS | PBHL 0-Honors Bug Critical Verification & Regression Tests
  [32] ✅ PASS | Two-Way Discord CAPTCHA Relay & Anti-Deadlock Resolution Tests
  [33] ✅ PASS | Proto Bahamut HL Precise Manual Skill Flow Tests
  [34] ✅ PASS | Arcarum Zone Mundus (Stage 10) Militis Bosses & Map Tests
  [35] ✅ PASS | Arcarum Zone Goliath (Stage 3) Bosses & Workflows Tests
  [36] ✅ PASS | Fate Stories Engine & Routine Unit Tests
  [37] ✅ PASS | Production vs Local Environment & Performance Architecture Tests
  [38] ✅ PASS | Mobage OAuth Redirect & Cookie Replacement Tests
  [39] ✅ PASS | Suspended Quest & Combat Resume Engine Tests
  [40] ✅ PASS | Arcarum Zone Joculator (Stage 7) Lady of Redemption Tests
  [41] ✅ PASS | Duplicate Workflow Prevention & Canonical Alias Tests
  [42] ✅ PASS | Raid: The World (HL) Multi-Battle Template & DSL Tests
  [43] ✅ PASS | Raid: Dark Rapture (Hard) Multi-Battle Template & DSL Tests
  [44] ✅ PASS | Raid: The Fallen Angel of Cunning (HL) Multi-Battle Template & DSL Tests
  [45] ✅ PASS | Raid: Long Live the King (HL) Multi-Battle Template & DSL Tests
  [46] ✅ PASS | Finder Slot Configurator & Auto Set Raid Tests
  [47] ✅ PASS | Raid: Fediel (Impossible) Multi-Battle Template & DSL Tests
  [48] ✅ PASS | Raid: Wilnas (Impossible) Multi-Battle Template & DSL Tests
  [49] ✅ PASS | Arcarum Stage 7 (Xeno Cocytus Militis) Template & DSL Tests
  [50] ✅ PASS | Arcarum Stage 6 (Xeno Ifrit Militis) Template & Screen Guard Tests
  [51] ✅ PASS | Human Behavioral Mimicry & Account Cadence Tests
  [52] ✅ PASS | Standardized Gold Bar Rotations & 1.5M Honor Verification Tests
------------------------------------------------------------------------
Total Suites: 52 | Passed: 52 | Failed: 0 (100% GOLD INDUSTRY STANDARD)
========================================================================
```
