# GBF Remote Controller & Automation CLI Reference (`--help`)

Fast, categorized terminal reference for all operational commands, workflows, daemons, and developer utilities.

---

## Quick Navigation

- [0. Global CLI Syntax & Common Flags](#0-global-cli-syntax--common-flags)
- [1. Account Authentication & Session Management](#1-account-authentication--session-management)
- [2. Browser Control & CDP Host](#2-browser-control--cdp-host)
- [3. Daily Maintenance & Pro Skips](#3-daily-maintenance--pro-skips)
- [4. Daily Raid Hosting Suite](#4-daily-raid-hosting-suite)
- [5. Autonomous Daily Reset Scheduler (05:00 JST)](#5-autonomous-daily-reset-scheduler-0500-jst)
- [6. Replicard Sandbox: Zone Mundus (Stage 10) Militis Bosses](#6-replicard-sandbox-zone-mundus-stage-10-militis-bosses)
- [7. Replicard Sandbox: Zone Eletio / Fayum Militis & World](#7-replicard-sandbox-zone-eletio--fayum-militis--world)
- [8. Gold Bar (GB) Hunting & High-Difficulty Raids](#8-gold-bar-gb-hunting--high-difficulty-raids)
- [9. Magna 3 (Omega Rebirth) Fast Leeching](#9-magna-3-omega-rebirth-fast-leeching)
- [10. Guild Wars (Unite & Fight)](#10-guild-wars-unite--fight)
- [11. Story, Scenario & Collaboration Events](#11-story-scenario--collaboration-events)
- [12. Fate Episodes Auto-Farmer](#12-fate-episodes-auto-farmer)
- [13. Rise of the Beasts (ROTB)](#13-rise-of-the-beasts-rotb)
- [14. Interactive Selector & Generic Workflow Runner](#14-interactive-selector--generic-workflow-runner)
- [15. Gateway Server, Web Cockpit & Mobile PWA](#15-gateway-server-web-cockpit--mobile-pwa)
- [16. Discord Remote Controller & Two-Way CAPTCHA Relay](#16-discord-remote-controller--two-way-captcha-relay)
- [17. Discord Rich Presence (RPC)](#17-discord-rich-presence-rpc)
- [18. Quality Assurance, Testing & Pre-Flight Verification](#18-quality-assurance-testing--pre-flight-verification)

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
| `bun run session:export` | `[account]` (default: `acc1`) | Dumps full 30+ cookie platform jar to `data/<acc>-cookies.json` |
| `bun run session:import` | `[account]` (default: `acc1`) | Injects full cookie jar via CDP and verifies player profile |
| `bun run import:clipboard` | `[account]` | Imports cookies directly from clipboard JSON |
| `bun run import:midship` | `[account]` | Quick-imports single `midship` cookie value |
| `bun run session:sync` | `[account]` | Verifies cookie freshness and syncs IndexedDB stores |

---

## 2. Browser Control & CDP Host

Manual Chromium / SRWare Iron launch helpers (optional if `AUTO_LAUNCH_CHROME=true`).

| Command | Mode | Description |
| :--- | :---: | :--- |
| `bun run launch:chrome` | Windowed | Launches browser on port 9222 with visible GUI window |
| `bun run launch:chrome:headless` | Headless | Launches browser in silent background mode (`--headless=new`) |

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

Autonomous daily raid hosting with transient DOM sanitization and material deficit recognition.

| Command | Scope | Description |
| :--- | :---: | :--- |
| `bun run daily:host` | All 16 Raids | Hosts complete daily 16-raid rotation (HL, M3, Six Dragons) |
| `bun run daily:host:hl` | HL Raids | Hosts High Level daily raids (Atum, Osiris, Horus, etc.) |
| `bun run daily:host:m3` | Magna 3 | Hosts all 6 Magna 3 (Omega Rebirth) raids |
| `bun run daily:host:dragons` | Six Dragons | Hosts all 6 Six Dragons daily raids (Wilnas, Ewiyar, etc.) |
| `bun run daily:host:acc1` | Acc 1 | Runs daily raid hosting explicitly on Account 1 |
| `bun run daily:host:acc2` | Acc 2 | Runs daily raid hosting explicitly on Account 2 |
| `bun run daily:host:all` | All Accounts | Runs daily raid hosting across all registered accounts |
| `bun run daily:host:windowed` | Windowed | Visible browser execution for inspecting host transitions |

---

## 5. Autonomous Daily Reset Scheduler (05:00 JST)

24/7 background scheduler aligned to Granblue Fantasy server daily reset (05:00:15 JST / 20:00:15 UTC).

| Command | Mode | Description |
| :--- | :---: | :--- |
| `bun run daily:scheduler` | Daemon | Starts background daemon that triggers routine at 05:00 JST |
| `bun run daily:routine` | Immediate | Executes complete 2-phase pipeline right now (Pro Skips $\rightarrow$ Raids) |
| `bun run daily:routine --windowed` | Windowed | Runs on-demand daily pipeline in visible browser window |
| `bun run daily:routine --no-hosts` | Skips Only | Runs universal Pro Skips only, skipping hosted raids |
| `bun run daily:routine --no-skips` | Raids Only | Runs raid hosting suite only, skipping Pro Skips |

---

## 6. Replicard Sandbox: Zone Mundus (Stage 10) Militis Bosses

Optimized Smart Full Auto and Burst workflows for all major Zone Mundus encounters.

### 🔥 Prometheus Militis (Fire — Div 3 | Quest ID: 819141)
```bash
bun run prometheus:smart              # Smart Full Auto (Headless)
bun run prometheus:smart:windowed     # Smart Full Auto (Windowed)
bun run prometheus                    # Fast Burst Rotation
```

### 🌪️ Morrigna Militis (Wind — Div 15 | Quest ID: 819171)
```bash
bun run morrigna:smart                # Smart Full Auto (Headless)
bun run morrigna:smart:windowed       # Smart Full Auto (Windowed)
bun run morrigna                      # Fast Burst Rotation
```

### 💧 Ca Ong Militis (Water — Div 9 | Quest ID: 819151)
```bash
bun run ca-ong:smart                  # Smart Full Auto (Headless)
bun run ca-ong:smart:windowed         # Smart Full Auto (Windowed)
bun run ca-ong                        # Fast Burst Rotation
```

### ⛰️ Gilgamesh Militis (Earth — Div 8 | Quest ID: 819161)
```bash
bun run gilgamesh:smart               # Smart Full Auto (Headless)
bun run gilgamesh:smart:windowed      # Smart Full Auto (Windowed)
bun run gilgamesh                     # Fast Burst Rotation
```

### 🗺️ Zone Mundus Stage 10 Map Sweeper (Direct `#replicard/stage/10`)
```bash
bun run stage10                       # Auto-targets active Militis/Defender (Headless)
bun run stage10:windowed              # Auto-targets active Militis/Defender (Windowed)
```

---

## 7. Replicard Sandbox: Zone Eletio / Fayum Militis & World

Workflows for Zone Eletio/Fayum defenders and Zone Mundus boss.

| Command | Target | Description |
| :--- | :--- | :--- |
| `bun run athena:smart` | Athena Militis | Smart Full Auto (Zone Eletio) |
| `bun run athena` | Athena Militis | Fast burst rotation |
| `bun run grani:smart` | Grani Militis | Smart Full Auto (Zone Fayum) |
| `bun run grani:fast` | Grani Militis | Fast burst rotation |
| `bun run arcarum-theworld` | The World | Quest 819131 encounter with Plain Damage omen counters |
| `bun run theworld:smart` | The World | Smart Full Auto rotation |

---

## 8. Gold Bar (GB) Hunting & High-Difficulty Raids

Dedicated Blue Chest honor burst workflows (1.4M–1.58M target honors) with drop telemetry.

| Command | Raid | Honors Target | Description |
| :--- | :--- | :---: | :--- |
| `bun run pbhl` | Proto Bahamut HL | 1.50M | Default PBHL burst loop (`gb-pbhl`) |
| `bun run gb-pbhl:windowed` | Proto Bahamut HL | 1.50M | Windowed PBHL burst loop |
| `bun run gb-pbhl:skill` | Proto Bahamut HL | 1.50M | Precise manual skill sequence (C4S3 $\rightarrow$ Call $\rightarrow$ C4S4 $\rightarrow$ C1S3) |
| `bun run gb-pbhl:skill:windowed`| Proto Bahamut HL | 1.50M | Precise manual skill sequence in visible window |
| `bun run gb-pbhl-fast` | Proto Bahamut HL | 1.50M | Ultra-fast 0-button reload burst rotation |
| `bun run gb-akasha` | Akasha HL | 1.43M | Dark/Fire burst loop targeting Gold Bar & Keys |
| `bun run gb-go` | Grand Order HL | 1.58M | Multi-turn burst for Heavenly Horns & Centrums |
| `bun run gb-farm` | Tri-Raid Rotator | Dynamic | Concurrently rotates PBHL $\rightarrow$ Akasha $\rightarrow$ GOHL |
| `bun run goldbar` | Telemetry | — | Tests permanent raid archive URL resolution & drops |
| `bun run gb:report` | Telemetry | — | Generates Gold Bar drop summary & dry-streak analysis |

---

## 9. Magna 3 (Omega Rebirth) Fast Leeching

Late-stage raid entry (HP $\le 20\%$, Players $\ge 3$), 1-turn burst, and immediate room exit.

| Command | Boss | Team Element | Supporter Summon |
| :--- | :--- | :---: | :---: |
| `bun run leech:colossus` | Colossus Ira (Fire) | Water | Varuna |
| `bun run leech:tiamat` | Tiamat Aura (Wind) | Fire | Agni |
| `bun run leech:leviathan` | Leviathan Mare (Water) | Earth | Titan |
| `bun run leech:yggdrasil` | Yggdrasil Arbos (Earth) | Wind | Zephyrus |
| `bun run leech:luminiera` | Luminiera Credo (Light) | Dark | Hades |
| `bun run leech:celeste` | Celeste Ater (Dark) | Light | Zeus |
| `bun run leech` | Dynamic | Dynamic | Multi-element concurrent evaluator loop |

*Append `:windowed` to any command for visual execution (e.g. `bun run leech:colossus:windowed`).*

---

## 10. Guild Wars (Unite & Fight)

| Command | Phase / Mode | Description |
| :--- | :---: | :--- |
| `bun run gw-meat` | EX+ Meat (Windowed) | Sub-7.5s 24M meat farming rotation |
| `bun run gw-meat:headless` | EX+ Meat (Headless) | Background meat farming loop |
| `bun run gw-meat:swarm 100`| EX+ Meat (Swarm) | Parallel multi-account swarm farming (acc1 + acc2) |
| `bun run gw-nm95-light` | NM95 (1-Turn Burst) | Florence + Nehan 1-turn burst farm (14s/clear) |
| `bun run gw-nm95-light:windowed`| NM95 (Windowed) | NM95 burst in visible GUI window |
| `bun run gacha:unf` | Token Drawbox | Bulk "Draw 1 Drawbox" clearer and auto-reset loop |

---

## 11. Story, Scenario & Collaboration Events

| Command | Task | Description |
| :--- | :---: | :--- |
| `bun run event` | Story Chapters | Auto-skips dialogues and Full Auto clears story stages |
| `bun run event:all` | Full Pipeline | Story $\rightarrow$ Challenge $\rightarrow$ Maniac $\rightarrow$ HELL $\rightarrow$ Gacha |
| `bun run event:sweep` | First-Clear | Sweeps solo & raid first-clear crystals |
| `bun run event:maniac` | Daily Maniac | Clears daily 2/2 Maniac solo battles |
| `bun run event:nightmare` | HELL Skip | Instant batch skip for accumulated Nightmare battles |
| `bun run event:challenge` | Challenge Quest | Clears 1-time event challenge battle |
| `bun run event:gacha` | Token Drawbox | Autonomous Draw 1 Drawbox clearer & auto-reset |
| `bun run event:solo` | Solo Farm | Farms event solo quests (e.g. EX) |
| `bun run event:raid` | Raid Burst | Sub-4s raid join and burst farming |

---

## 12. Fate Episodes Auto-Farmer

Automates character Fate Episodes (`#quest/fate`) to unlock skill slots and harvest crystals.

| Command | Episodes | Description |
| :--- | :---: | :--- |
| `bun run fate` | 5 | Fast-skips dialogues and Full Auto clears battles (Default: 5) |
| `bun run fate:10` | 10 | Farms 10 consecutive Fate Episodes |
| `bun run fate:20` | 20 | Farms 20 consecutive Fate Episodes |
| `bun run fate:all` | 100 | Large-batch automated fate story clearance |
| `bun run fate:windowed` | 5 | Visible GUI window for watching fate episodes |

---

## 13. Rise of the Beasts (ROTB)

| Command | Target | Description |
| :--- | :---: | :--- |
| `bun run rotb:baihu` | Baihu (30 runs) | Farms Extreme Baihu solo battle |
| `bun run rotb:earth` | 1 Cycle | Executes 9x Baihu $\rightarrow$ 1x Titan Agon |
| `bun run rotb:earth:loop`| Continuous Loop | Infinite loop: 9x Baihu $\rightarrow$ 1x Titan repeatedly |

---

## 14. Interactive Selector & Generic Workflow Runner

Execute any template dynamically or launch the interactive terminal selector.

| Command | Description |
| :--- | :--- |
| `bun run workflow` | Interactive terminal UI (prompts for Account, Template, Runs) |
| `bun run acc1 <template> [runs]` | Runs specified template on Account 1 |
| `bun run acc2 <template> [runs]` | Runs specified template on Account 2 |
| `bun src/cli/run-workflow.ts <acc> <template> [runs] --windowed` | Direct CLI execution with custom parameters |

---

## 15. Gateway Server, Web Cockpit & Mobile PWA

Run the companion server for phone/tablet remote control, live screencasts, and emergency abort.

| Command | Description |
| :--- | :--- |
| `bun run gateway` *(or `bun run dev`)* | Boots HTTP/WebSocket companion gateway on port 3000/3001 |
| `bun run build` | Compiles TypeScript codebase (`tsc`) to `dist/` |
| `bun run start` | Runs production gateway build |

---

## 16. Discord Remote Controller & Two-Way CAPTCHA Relay

| Command | Description |
| :--- | :--- |
| `bun run discord:controller` | Starts 2-way Discord DM Gateway (remote `/run`, `/stop`, `/status`) |
| `bun run discord:bot` | Alias for Discord Remote Controller & CAPTCHA Relay |
| `bun run solve-captcha [answer]` | Injects CAPTCHA solution directly into game DOM from terminal |
| `bun run test:discord` | Tests Discord webhook and DM relay connection |

---

## 17. Discord Rich Presence (RPC)

Synchronizes farming telemetry or productivity presets with Discord desktop status.

| Command | Preset | Description |
| :--- | :---: | :--- |
| `bun run presence:gbf` | GBF Gaming | Live raid drops, honors, and farming activity |
| `bun run presence:work` | Work / Focus | Deep work status for project tracking |
| `bun run presence:trade` | Trading | Trading quotes and risk management status |
| `bun run presence:bg` | Background | Detaches silent background daemon for presence |
| `bun run presence:clear` | Stop / Wipe | Terminates background daemon and wipes Discord status |

---

## 18. Quality Assurance, Testing & Pre-Flight Verification

Mandatory quality gates executed locally and in CI.

| Command | Gate / Test | Description |
| :--- | :---: | :--- |
| `bun run verify` | Full Pre-Flight | Runs Hygiene + DSL Validation + `tsc` Build + 33/33 Tests |
| `bun run test` | Unified Runner | Executes all 33 test suites (`tests/run-all.ts`) |
| `bun run hygiene` | Security Gate | Audits git index for secret leaks, personal paths, or credentials |
| `bun run workflow:validate` | Schema Gate | Validates all workflow templates against Zod AST schemas |
| `bun run typecheck` | Type Safety | Executes TypeScript static type-checking (`tsc --noEmit`) |
| `bun run test:engine` | Unit Tests | Tests Universal Workflow Engine state machines and retries |
| `bun run test:daily` | Unit Tests | Tests Daily Routine Pro Skip and modal reconciliation |
| `bun run test:evaluator` | Unit Tests | Tests Magna 3 concurrent evaluator and LRU cache |
