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
- [7. Replicard Sandbox: Zone Goliath (Stage 3) Bosses & Defenders](#7-replicard-sandbox-zone-goliath-stage-3-bosses--defenders)
- [8. Replicard Sandbox: Zone Eletio / Fayum Militis & World](#8-replicard-sandbox-zone-eletio--fayum-militis--world)
- [9. Gold Bar (GB) Hunting & High-Difficulty Raids](#9-gold-bar-gb-hunting--high-difficulty-raids)
- [10. Magna 3 (Omega Rebirth) Fast Leeching](#10-magna-3-omega-rebirth-fast-leeching)
- [11. Guild Wars (Unite & Fight)](#11-guild-wars-unite--fight)
- [12. Story, Scenario & Collaboration Events](#12-story-scenario--collaboration-events)
- [13. Fate Episodes Auto-Farmer](#13-fate-episodes-auto-farmer)
- [14. Rise of the Beasts (ROTB)](#14-rise-of-the-beasts-rotb)
- [15. Interactive Selector & Generic Workflow Runner](#15-interactive-selector--generic-workflow-runner)
- [16. Gateway Server, Web Cockpit & Mobile PWA](#16-gateway-server-web-cockpit--mobile-pwa)
- [17. Discord Remote Controller & Two-Way CAPTCHA Relay](#17-discord-remote-controller--two-way-captcha-relay)
- [18. Discord Rich Presence (RPC)](#18-discord-rich-presence-rpc)
- [19. Quality Assurance, Testing & Pre-Flight Verification](#19-quality-assurance-testing--pre-flight-verification)

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

> [!TIP]
> **Session Immunity Shield**: All session setups, daily runs, and workflow runners automatically mount the Mobage session immunity shield (`src/auth/session-immunity.ts`), preventing client-side kickouts from `session_state_change_response`. For the complete technical post-mortem on auth failures and solutions, see [Root Cause Analysis: Authentication Failures vs. Success Blueprint](file:///c:/laragon/www/guranburuing/strategies/AUTH_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md) and [Principle 13](file:///c:/laragon/www/guranburuing/strategies/principles/13_authentication_and_session_immunity.md).

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
### 🚀 Unified Arcarum Zone Mundus CLI Controller
```bash
bun run arcarum                       # Interactive Target Selection Menu
bun run arcarum:help                  # Print Complete Target Catalog & Syntax
bun src/cli/run-arcarum.ts acc1 ca-ong 100        # Run 100 battles of Ca Ong Militis
bun src/cli/run-arcarum.ts acc1 steve 200          # Farm 200 runs of Parasite Steve (spawns Ca Ong)
bun src/cli/run-arcarum.ts acc1 theworld 50 -w     # Run 50 battles of The World (Windowed)
bun src/cli/run-arcarum.ts acc1 stage10 500        # Universal Stage 10 Map Scanner
```

### ⚔️ Militis Defenders & Core Bosses (30 AAP)
| Target | Element | Div | Quest ID | Quick CLI Shortcut | Drops |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **Ca Ong Militis** | Water | 10 | `819151` | `bun run ca-ong:smart` | Glacial Rapier Militis, Water Luster, Pillar of Sea |
| **Prometheus Militis** | Fire | 3 | `819141` | `bun run prometheus:smart` | Prominence Militis, Fire Luster, Pillar of Sun |
| **Gilgamesh Militis** | Earth | 7 | `819161` | `bun run gilgamesh:smart` | Heavy Cane Militis, Earth Luster, Pillar of Land |
| **Morrigna Militis** | Wind | 15 | `819171` | `bun run morrigna:smart` | Tempest Militis, Wind Luster, Pillar of Sky |
| **The World** | All | 16 | `819131` | `bun run theworld:smart` | World Idean, Mundus Lusters, New World Quartz |
| **Zone Mundus Map** | All | 10 | — | `bun run stage10` | Universal Map Scanner & Auto-Defender Target |

### 🌾 Primary 5-Gauge Farming Targets (20 AAP — Builds Sephira Boxes & Defender Gauges)
| Target | Element | Div | Quest ID | Quick CLI Shortcut | Purpose |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **Parasite Steve** | Water | 9 | `819071` | `bun run arcarum:steve` | Primary Water farm, builds Ca Ong gauge |
| **Tide Caller** | Water | 10 | `819081` | `bun run arcarum:tide-caller` | Water Sephira Box, Ca Ong gauge |
| **Earth-Shattering Fire Demon** | Fire | 3 | `819021` | `bun run arcarum:fire-demon` | Primary Fire farm, builds Prometheus gauge |
| **Elephant Stomping Ground** | Earth | 7 | `819051` | `bun run arcarum:elephant` | Primary Earth farm, builds Gilgamesh gauge |
| **Princess of the Horde** | Earth | 6 | `819041` | `bun run arcarum:princess` | Earth Sephira Box, Gilgamesh gauge |
| **Dragon in Glittering Green** | Wind | 14 | `819111` | `bun run arcarum:dragon-green` | Primary Wind farm, builds Morrigna gauge |

### ⚡ 3-Gauge Fast Burst & Sephira Heralds (+100% Boost)
| Target | Element | Div | Quest ID | Quick CLI Shortcut | Purpose |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **Herald of Water** | Fire | 9 | `819191` | `bun run arcarum:herald-water` | **+100% Sephira Gauge Boost for 60 Minutes** |
| **Herald of Earth** | Fire | 6 | `819201` | `bun run arcarum:herald-earth` | **+100% Sephira Gauge Boost for 60 Minutes** |
| **Hotheaded Pincers** | Fire | 2 | `819011` | `bun run arcarum:pincers` | 3-bar low HP fast burst farming |
| **Winged Demon Cat** | Wind | 13 | `819101` | `bun run arcarum:winged-cat` | 3-bar low HP fast burst farming |

---

## 7. Replicard Sandbox: Stage 3 (Zone Goliath & Zone Faym) Bosses & Defenders

Optimized Smart Full Auto workflows for all Stage 3 (`#replicard/stage/3`) encounters (Here Be Staves).

### ⚔️ Stage 3 Bosses & Defenders (30 AAP)
| Command | Target | Role / Sector | Drops |
| :--- | :--- | :---: | :--- |
| `bun run redemption` / `arcarum:redemption` | **Lady of Redemption** | Defender (Justice / Stage 7 / Div 7 / Quest 816071) | Joculator materials, Justice Idean, Aquaborne Astra, Justice Veritas, Sephira weapons |
| `bun run cocytus` / `arcarum:cocytus` | **Xeno Cocytus Militis** | Militis Boss (Water / Stage 7 / Div 15 / Quest 816131) | Xeno Cocytus Militis weapons, Water Luster, Veritas, Sephira Box |
| `bun run paragon` / `arcarum:paragon` | **Lilywhite Paragon** | Defender (The Moon / Div 10 / Quest 812111) | **Faym Rib**, Moon Idean, Aquaborne Astra, Moon Veritas, Sephira Emerald weapons |
| `bun run arcarum:triune` | **Goliath Triune** | Zone Boss (Earth) | Tower/Hanged Man/Death Ideans, Earth Astra, Quartz |
| `bun run arcarum:avarice` | **Avatar of Avarice** | Defender (Pink / Hanged Man) | **Goliath Organ**, Earthborne Astra, Hanged Man Idean |
| `bun run arcarum:keeper` | **Goliath Keeper** | Defender (Green / Tower) | **Goliath Rib**, Earthborne Astra, Tower Idean |
| `bun run arcarum:howler` | **Frenzied Howler** | Defender (Yellow / Death) | **Goliath Core**, Darkborne Astra, Death Idean |
| `bun run arcarum:stage3` | **Stage 3 Universal Map** | Universal Map Scanner | Auto-detects and targets active Defenders or quests |
| `bun run arcarum:stage7` | **Stage 7 Universal Map** | Universal Map Scanner | Auto-detects and targets Lady of Redemption or Maiden of the Depths |

### 🌾 5-Gauge Fast Farming & Heralds (20 AAP)
| Command | Target | Element | Purpose |
| :--- | :--- | :---: | :--- |
| `bun run fortress` / `arcarum:fortress` | **Faymian Fortress** | Water | The Moon 5-Gauge, breaks 10-hit Earth Barrier, spawns Lilywhite Paragon |
| `bun run arcarum:maiden` | **Maiden of the Depths** | Water | Arctic Plains 5-Gauge (Stage 7), spawns Lady of Redemption |
| `bun run arcarum:goliath-herald` | **Goliath Heralds** | All | **+100% Sephira Gauge Boost for 60 Minutes** |
| `bun run arcarum:panther` | Earthshaking Panther | Earth | Green 5-Gauge, spawns Goliath Keeper |
| `bun run arcarum:barbarian` | Bloodstained Barbarian | Earth | Pink 5-Gauge, spawns Avatar of Avarice |
| `bun run arcarum:despair` | Writhing Despair | Dark | Yellow 5-Gauge, spawns Frenzied Howler |

---

## 8. Replicard Sandbox: Zone Eletio / Fayum Militis & World

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
| `bun run theworld:raid` / `world:raid` | The World (HL) | — | Finder Tab 1: C4S1 $\rightarrow$ C3S1 $\rightarrow$ C3S2 $\rightarrow$ C2S1 $\rightarrow$ Atk $\rightarrow$ Reload $\rightarrow$ Random Delay $\rightarrow$ Atk $\rightarrow$ Reload |
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

Execute any pre-packaged, modified, or custom workflow template dynamically.

### Quick Workflow Commands

| Command | Arguments / Flags | Description |
| :--- | :--- | :--- |
| `bun run workflow` | — | Interactive terminal menu (arrow-key template picker) |
| `bun run workflow:validate` | — | Validates all templates against strict Zod schema |
| `bun run templates:sync` | — | Scans `templates/` and auto-registers CLI scripts in `package.json` |
| `bun run acc1 <template> [runs]` | `[runs]` `[--windowed]` | Runs specified template on Account 1 |
| `bun run acc2 <template> [runs]` | `[runs]` `[--windowed]` | Runs specified template on Account 2 |
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
You can configure raid candidate filtering boundaries directly in the workflow JSON or Shorthand DSL:

#### 1. In Template JSON (`templates/*.json`):
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
- **`evaluatorStrategy`** (`"honor"` | `"otk_burst"` | `"leech"`): 
  - `"honor"`: Blue chest focus, prioritizes fresh raids with high remaining HP.
  - `"leech"` / `"otk_burst"`: Fast burst focus, prioritizes low HP raids for rapid drop turn-around.
- **`minPlayers`** / **`maxPlayers`** (`number`): Enforces minimum clearing participants (e.g. `minPlayers: 3`) or max capacity ceiling (`maxPlayers: 29`).
- **`minRaidScore`** (`number`): Minimum score needed to accept candidate (default: `0` for custom HP bands, `40` for standard honor raids).

#### 2. In Shorthand DSL (`.dsl`):
```yaml
Name: Custom Raid Leech
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
Raid Slot: 1
Strategy: leech
Min HP: 10
Max HP: 60
Min Players: 3
Max Players: 25
Min Raid Score: 30

# Or using concise range syntax:
HP: 10-60%
```

### How to Create a New Template
1. Create `templates/my-custom-raid.json` (see [Full Guide](./docs/workflows/creating-and-modifying-workflows.md)).
2. Validate with `bun run workflow:validate`.
3. Run immediately via `bun src/cli/run-workflow.ts acc1 my-custom-raid 10 --windowed`.
4. (Optional) Run `bun run templates:sync` to automatically generate `bun run my-custom-raid` and `bun run my-custom-raid:windowed` in `package.json`!

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
| `bun run verify` | Full Pre-Flight | Runs Hygiene + DSL Validation + `tsc` Build + 34/34 Tests |
| `bun run test` | Unified Runner | Executes all 34 test suites (`tests/run-all.ts`) |
| `bun run hygiene` | Security Gate | Audits git index for secret leaks, personal paths, or credentials |
| `bun run workflow:validate` | Schema Gate | Validates all workflow templates against Zod AST schemas |
| `bun run typecheck` | Type Safety | Executes TypeScript static type-checking (`tsc --noEmit`) |
| `bun run test:engine` | Unit Tests | Tests Universal Workflow Engine state machines and retries |
| `bun run test:daily` | Unit Tests | Tests Daily Routine Pro Skip and modal reconciliation |
| `bun run test:evaluator` | Unit Tests | Tests Magna 3 concurrent evaluator and LRU cache |
