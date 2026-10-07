# Granblue Fantasy Remote Controller & Automation Command Guide

Comprehensive operational guide detailing installation, configuration, launch commands, daily automation routines, Guild War & Nightmare (NM) combat, Gold Bar hunting, daemon deployment, and troubleshooting.

---

## 1. Prerequisites & System Requirements

- **Operating System**: Windows 10/11 (x64)
- **Primary Runtime**: [Bun](https://bun.sh/) (v1.1+ / v1.3+) strictly enforced across all CLI commands and test suites
- **Fallback Runtime**: [Node.js](https://nodejs.org/) (v20+)
- **Browser**: [SRWare Iron (64-Bit)](https://www.srware.net/iron/) or Google Chrome installed in standard paths
- **Shell**: PowerShell 5.1+ or PowerShell 7+
- **Process Manager** *(Optional, for background daemon)*: `pm2`

---

## 2. Environment Configuration (`.env`)

Create or update your `.env` file in the project root:

```ini
# Gateway Server Settings
PORT=3001
HOST=0.0.0.0
AUTH_TOKEN=gbf_secure_remote_token_2026_x89a1

# Chrome DevTools Protocol (CDP)
CDP_PORT=9222

# Browser Mode: true for silent background, false for visible desktop window
HEADLESS=true

# Speed Profile: stealth (860ms) | fast (150ms) | turbo (75ms)
SPEED_PROFILE=fast

# Execution Mode: hybrid (sub-second in-page API) | dom (mouse emulation)
EXECUTION_MODE=hybrid

# Raid Combat: skip turn animations via quick reload
COMBAT_AUTO_REFRESH=true

# Auto-launch Chrome/Iron if port 9222 is inactive
AUTO_LAUNCH_CHROME=true

# Push Notifications (Optional Sentinel CAPTCHA Alerts)
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
# DISCORD_WEBHOOK_URL=
```

---

## 3. Initial Setup & Authentication

### Step 1: Install Dependencies
```bash
bun install
```

### Step 2A: First-Time Account Setup on Local Desktop (Windows / macOS)
The bot prioritizes your dedicated **SRWare Iron** browser (`C:\Program Files\SRWare Iron (64-Bit)\iron.exe`) or Chrome, operating 100% independently from your daily browser profiles.

```bash
# Setup / login primary account (acc1):
bun run account:setup acc1

# Setup / login secondary account (acc2):
bun run account:setup acc2
```

1. This opens the browser in **Windowed (Headful)** mode on port 9222 with the account's isolated profile (`~/.gbf-profiles/acc1`).
2. Log into your Granblue Fantasy account once (Mobage, Google, etc.) and navigate to `#mypage`.
3. Once verified, session cookies (`data/acc1-cookies.json`) and local storage remain permanently stored. You can run completely **headless** for all future sessions without Chrome collision or file locks.

---

### Step 2B: First-Time Account Setup on a Headless / Low-Resource VPS (Ubuntu / Debian)

On a remote VPS (e.g. 1 vCPU, 1 GB RAM), there is **no physical monitor** and running `--windowed` without an X server fails (`cannot open display: :0`). Furthermore, installing heavy desktop environments (GNOME/XFCE) consumes 400MB–800MB RAM, causing Out-Of-Memory (OOM) crashes.

Choose one of these **4 low-resource VPS authentication methods**:

#### Method 1: Full Cookie Jar Sync from Local PC (⭐ Recommended — 0 Extra RAM)
> [!IMPORTANT]
> **Why `midship` alone NEVER works**: Granblue Fantasy is a Mobage/DMM-backed platform game. It does **not** authenticate on the `midship` cookie alone. The game client checks for Mobage platform authentication tokens (`connect.mobage.jp`, `sp.mbga.jp`, `.mobage.jp`, `_mobage_...`) and the anti-CSRF token `access_gbtk`. If only `midship` is provided on a fresh browser profile, Cygames' server immediately rejects the session and redirects to the login screen.
> 
> To authenticate without GUI, you must export the **complete cookie jar** (~25–35 cookies covering all auth domains):

1. **Export full session on your local PC (Windows)**:
   ```bash
   bun scripts/export-session.ts acc1
   # Or: powershell -ExecutionPolicy Bypass -File .\scripts\export-session-windows.ps1 -Account acc1
   ```
   *This extracts all cookies across `game.granbluefantasy.jp`, `mobage.jp`, `mbga.jp`, and `dmm.com` into `data/acc1-cookies.json`.*

2. **Copy to your VPS and import**:
   ```powershell
   # From your local machine:
   scp ./data/acc1-cookies.json root@<VPS_IP>:/var/www/guranburuing/data/
   ```
   ```bash
   # On your VPS:
   bun run session:import acc1
   ```
   *The importer injects all 30+ cookies via Chrome DevTools Protocol, verifies against `#profile`, and outputs your verified player name and rank.*

#### Method 2: Remote Interactive Web Cockpit (Headless Screencast — ~200MB RAM)
Log in natively on the VPS IP address through your phone or desktop browser with zero VNC:
```bash
# Run on your VPS SSH:
bun run account:setup acc1 --headless
```
1. The helper starts headless Chrome and boots the interactive Gateway server on port `3000` (or configured `PORT`).
2. Open in your local browser or phone:
   ```text
   http://<VPS_IP>:3000/?token=<AUTH_TOKEN>
   ```
3. *(If firewalled, create an SSH tunnel from your PC: `ssh -L 3000:localhost:3000 root@<VPS_IP>` and visit `http://localhost:3000/?token=<AUTH_TOKEN>`)*.
4. With the adaptive screencast fix, you will see the live browser screen immediately. Click Mobage, enter your credentials/OTP in the remote input bar, and once `#mypage` loads, the helper automatically exports cookies and completes setup!

#### Method 4: Virtual Framebuffer via Xvfb (If you specifically need `--windowed` on Linux)
If you require windowed mode execution on headless Linux without installing a heavy desktop environment:
```bash
# 1. Install lightweight Xvfb virtual display (only ~15MB RAM):
sudo apt-get update && sudo apt-get install -y xvfb

# 2. Run account setup wrapped in a virtual frame buffer:
xvfb-run -a bun run account:setup acc1 --windowed
```
*(The updated `scripts/launch-gbf-chrome.sh` automatically detects if `$DISPLAY` is missing and wraps with `xvfb-run` or falls back to headless mode so it never crashes!)*

---

### Step 2C: Crucial VPS Memory Tuning for 1 GB RAM Instances

On cheap 1 vCPU / 1 GB RAM VPS tiers, cloud providers default to **0 MB Swap space**. When Chrome bursts to 700MB+ RAM during page load, the Linux kernel Out-Of-Memory (OOM) killer will terminate Chrome or Bun.

**Always configure a 2 GB Swapfile on your VPS**:
```bash
# Create and activate a 2 GB swapfile:
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make permanent across reboots:
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify swap status:
free -h
```

**Built-In Low-Memory Flags Active in `scripts/launch-gbf-chrome.sh`**:
- `--js-flags=--max-old-space-size=384` (Caps V8 heap to 384 MB)
- `--renderer-process-limit=1` (Prevents Chrome from spawning dozens of sub-processes)
- `--disable-dev-shm-usage` (Prevents `/dev/shm` shared memory crashes on containers)
- `--disable-gpu` & `--mute-audio` (Disables hardware acceleration and audio daemon overhead)
- `--disk-cache-size=104857600` (Caps browser disk cache to 100 MB)

---

## 4. Launching Browser (CDP Host)

| Command | Description |
| :--- | :--- |
| `bun run launch:chrome` | Launches browser with visible GUI window on port 9222 |
| `bun run launch:chrome:headless` | Launches browser in **New Headless mode** (`--headless=new`) with GPU acceleration & audio muting |
| `powershell -ExecutionPolicy Bypass -File ./scripts/launch-gbf-chrome.ps1` | Direct PowerShell launcher (reads `HEADLESS` from `.env`) |
| `powershell -ExecutionPolicy Bypass -File ./scripts/launch-gbf-chrome.ps1 -Headless` | Explicitly forces headless mode |

> [!TIP]
> If `AUTO_LAUNCH_CHROME=true` in `.env`, you do **not** need to launch the browser manually. Running any CLI command or daemon will automatically boot SRWare Iron / Chrome if port 9222 is inactive.

---

## 5. Universal Daily Automation (`daily`)

The daily automation system runs on the **Universal Workflow Engine**, executing the complete roster of 12 Pro Skips, Free Rupie Gacha, Skyscope Mission Claims, and Casino Recovery Exchanges.

### Standard Daily Commands
```bash
# Run daily routine on the default active account
bun run daily

# Run daily routine on explicit account (acc1)
bun run daily:acc1

# Run daily routine on secondary account (acc2)
bun run daily:acc2

# Run sequential daily routines across ALL authenticated accounts
bun run daily:all

# Run daily routine in a visible GUI browser window
bun run daily:windowed

# Quick-clear Pro Skips pinned to your in-game Favorites list (#quest)
bun run daily:favorites
```

### Automated Sectors & Tasks
The routine executes sequentially with strict verification (`do_until_finish` verifying `0/N` attempts remaining):

1. **Extra Quests: 12 Daily Pro Skips** (`#quest/extra`):
   - **Hard+ Pro** (`daily_hard_pro`): 6 Island Hard+ battles (180 AP)
   - **Omega Pro** (`daily_magna_pro`): 6 Extreme Omega battles (360 AP)
   - **Omega (Impossible) Pro** (`daily_manacura_pro`): 6 Magna HL battles (360 AP)
   - **Primal Legends Pro** (`daily_primal_pro`): 6 Tier 1 Showdowns (*Athena Showdown, Grani, Baal, Garuda, Odin, Lich*) (360 AP)
   - **Regalia Pro** (`daily_regalia_pro`): 6 Magna 2 battles (*Shiva, Europa, Alexiel, Grimnir, Metatron, Avatar*) (540 AP)
   - **Angel Halo Pro** (`daily_halo_pro`): Dimensional Halo & relic uncap materials (150 AP)
   - **Primarch Trials Pro** (`daily_primarch_pro`): 4 Primarch trials (*Michael, Gabriel, Uriel, Raphael*) (160 AP)
   - **Showdown Pro** (`daily_showdown_pro`): 6 Normal Showdowns (*Ifrit, Cocytus, Vohu Manah, Sagittarius, Corow, Diablo*) (180 AP)
   - **Clash Pro** (`daily_clash_pro`): 6 Xeno Showdowns (360 AP)
   - **Six-Dragon Advent Pro** (`daily_dragon_pro`): 6 Six-Dragon solo encounters (960 AP)
   - **Eternals Unlock Treasure Pro** (`daily_eternals_pro`): Dimensional uncap materials (360 AP)
   - **Ennead Pro** (`daily_ennead_pro`): 6 Ennead series battles (*Atum, Tefnut, Bennu, Ra, Osiris, Horus*) (360 AP)
2. **Free 100-Draw Rupie Gacha** (`#gacha/normal`):
   - Executes 100-draw Rupie summon via `.btn-lupi.multi`, collecting weapon plus marks and daily fodder (`daily_rupie`).
3. **Skyscope Daily Missions** (`#mission`):
   - Claims all cleared daily mission rewards in one click (`daily_skyscope`).
4. **Casino Daily Exchange** (`#casino/exchange`):
   - Purchases daily limit of Half-Elixirs and Soul Berries (`daily_casino`).

- Template: [`templates/daily-universal.json`](file:///c:/laragon/www/guranburuing/templates/daily-universal.json)
- Execution Log: [`logs/workflow-acc1-daily-universal.md`](file:///c:/laragon/www/guranburuing/logs/workflow-acc1-daily-universal.md)

---

## 6. Guild War (Unite and Fight) & Nightmare (NM) Automation

Automates all phases of Guild War (Unite & Fight) with high-efficiency burst rotations, auto-supporter selection, Gaussian human motor jitter, and Sentinel CAPTCHA freeze protection.

```
       ┌─────────────────────────────────────────────────────────────┐
       │              Guild War Combat Flow Architecture             │
       └─────────────────────────────────────────────────────────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
      【EX+ Meat Farming】                           【Nightmare (NM) Raids】
   (#quest/supporter/947551/1/0)                  (#quest/supporter/947581/1/0/...)
               │                                             │
      ┌────────┴────────┐                           ┌────────┴────────┐
      ▼                 ▼                           ▼                 ▼
0-Button / 1-Summon   Swarm Mode               NM95 (1-Turn Burst)  NM100/150/200
  (~6.7s/clear)     (Parallel accs)            (Florence + Nehan)   (Full Auto / Sub)
```

---

### Nightmare 95 (NM95) Light Farm (`gw-nm95`, `gw-nm95-light`)

Automates the Guild War NM95 boss battle (`#quest/supporter/947551...`) with a precision 1-Turn burst rotation powered by Florence and Nehan.

#### Quick CLI Commands
```bash
# 1. Run with Custom Run Count (runs on acc1 by default):
bun run gw-nm95-light 20
bun run gw-nm95 10

# 2. Run on Specific Account with Custom Run Count:
bun run gw-nm95-light acc2 30
bun run gw-nm95:acc2 25
bun run gw-nm95:acc1 50

# 3. Via Account Shortcut:
bun run acc1 gw-nm95-light 25
bun run acc2 gw-nm95-light 50

# 4. Via Explicit CLI Flags:
bun run gw-nm95-light --account acc2 --runs 30

# 5. Farm NM95 in a Visible GUI Window (for inspecting rotation timing):
bun run gw-nm95-light:windowed 10
bun run gw-nm95-light acc1 10 --windowed
```

#### NM95 Rotation Pipeline (`gw-nm95-light`)
| Step | Action | Description / Target | Network Sync |
| :---: | :--- | :--- | :--- |
| **1** | `quick_call` | Triggers Quick Summon (Artemis / Yatima / The Star) | `summon_result.json` |
| **2** | `summon(2)` | Summons sub-aura damage amplifier (slot 2) | `summon_result.json` |
| **3** | `skill(4, 1)` | Character 4 (e.g. Mugen / Song) Skill 1 | `ability_result.json` |
| **4** | `skill(3, 1..3)`| Character 3 (Nehan) Skill 1 $\rightarrow$ Skill 2 $\rightarrow$ Skill 3 | `ability_result.json` |
| **5** | `skill(2, 1, tgt=1)` | Character 2 (Florence) Skill 1 targeted on MC | `ability_result.json` |
| **6** | `skill(2, 2)` | Character 2 (Florence) Skill 2 | `ability_result.json` |
| **7** | `skill(1, 1)` | MC (Relic Buster) Skill 1 | `ability_result.json` |
| **8** | `skill(1, 2) x3` | MC Blitz Raid burst 3 consecutive times | `ability_result.json` |
| **9** | `wait_random` | Biomechanical human motor pause (250ms–500ms) | — |
| **10**| `attack` | Normal attack execution | `normal_attack_result.json` |
| **11**| `reload` | Fast F5 page reload (skips lengthy turn animations) | — |
| **12**| `confirm_result` | Dismisses battle results, collects tokens/honors, loops | — |

- Template: [`templates/gw-nm95-light.json`](file:///c:/laragon/www/gbf/templates/gw-nm95-light.json)
- Rotation speed: $\approx 14\text{s} - 18\text{s}$ per NM95 clear.

---

### Guild War EX+ Meat Farming (`gw-meat`, `gw-meat-light`)

Automates Extreme+ 24M Meat Farming (`#quest/supporter/947551/1/0`):

```bash
# Farm meat in Windowed mode (Ctrl+C to stop)
bun run gw-meat

# Farm meat in silent HEADLESS mode (Recommended for background farming)
bun run gw-meat:headless
bun run gw-meat-light:headless

# Farm specific number of meat runs (e.g. 100 runs)
bun run gw-meat-light 100 --headless

# Parallel Multi-Account Swarm (runs acc1 and acc2 simultaneously):
bun run gw-meat:swarm 100
```
- Template: [`templates/gw-meat-light.json`](file:///c:/laragon/www/gbf/templates/gw-meat-light.json)
- Combat Rotation: `Quick Call -> F5 -> Attack -> F5 -> Confirm Result` ($\approx 6.7\text{s} - 7.4\text{s}$ per clear).
- Meat farming log: [`logs/gw-meat-acc1.md`](file:///c:/laragon/www/gbf/logs/gw-meat-acc1.md)

---

### Running Higher Nightmare Tiers (NM100, NM150, NM200)

To create or run workflows for other Nightmare tiers, create a JSON template in `templates/`:

```json
// templates/gw-nm150-light.json
{
  "name": "GW NM150 - Light Farm",
  "questUrl": "https://game.granbluefantasy.jp/#quest/supporter/947591/1/0/10116",
  "speedProfile": "fast",
  "defaultRuns": 30,
  "autoElixir": true,
  "humanMotor": true,
  "stopOnCaptcha": true,
  "supporterPriority": ["Zeus", "Lucifer"],
  "steps": [
    { "code": "quick_call" },
    { "code": "skill", "character": 1, "skill": 1 },
    { "code": "skill", "character": 2, "skill": 1 },
    { "code": "full_auto" },
    { "code": "confirm_result" }
  ]
}
```

Run your custom NM workflow:
```bash
# Compile and validate
bun run workflow:validate

# Execute for account acc1
bun run src/cli/run-workflow.ts acc1 gw-nm150-light 30
```

---

### Guild War Token Drawbox Clearer (`gacha:unf`)

Automates pulling and resetting Guild Wars (Unite & Fight) event token drawboxes (`#event/teamraid<ID>/gacha/index`):

- **Bulk Draw**: Clicks `.btn-bulk-play-box` ("Draw 1 Drawbox", 2,000 tokens per draw).
- **Fast Skip**: Taps screen to skip crystal animation and reloads to bypass slow loot animations.
- **Drawbox Reset**: Automatically scrolls to `.btn-reset`, taps it via hardware touchscreen coordinates, confirms the reset modal, and loads the next box.
- **Rules & Boundary Handling**: Stops gracefully when tokens deplete or when Box #60 item change is required by game rules.

```bash
# Clear drawboxes on default account (Windowed mode for visual progress)
bun run gacha:unf

# Run for a specific account (e.g. acc1 or acc2)
bun run gacha:unf acc1

# Clear a specific number of boxes (e.g. 10 or 30 boxes)
bun run gacha:unf --max-boxes 30

# Run in silent headless background mode
bun run gacha:unf --headless

# Target a specific Guild War event ID
bun run gacha:unf --event teamraid084
```
- Engine: [`src/engines/unf-gacha.engine.ts`](file:///c:/laragon/www/guranburuing/src/engines/unf-gacha.engine.ts)
- CLI Runner: [`src/cli/clear-unf-token.ts`](file:///c:/laragon/www/guranburuing/src/cli/clear-unf-token.ts)

---

## 7. Fate Stories Auto-Farmer (`fate`)

Automates Granblue Fantasy Fate Episodes (`#quest/fate`) to farm Crystals and uncap character skill slots autonomously:

- **Navigation**: Directly navigates to `#quest/fate` and locates uncleared episode cards.
- **Fast Dialog Skip**: Bypasses dialogues, awakens HUD canvas, clicks `.btn-scene-skip`, and confirms skip dialogs.
- **Battle Resolution**: Automatically triggers Full Auto (`mode: full`) if the episode contains battle stages.
- **Reward Sweep**: Dismisses rewards, exp gains, crystal unlocks, and loops until the target count is satisfied.

```bash
# Run default batch (5 episodes)
bun run fate

# Run in silent headless background mode
bun run fate:headless

# Farm custom number of episodes (e.g. 10 or 25 episodes)
bun run fate:10
bun run src/cli/run-workflow.ts fate-stories 25
```
- Template: [`templates/fate-stories.json`](file:///c:/laragon/www/guranburuing/templates/fate-stories.json)

---

## 8. Autonomous Scenario Event Engine (`event`, `clear-event`)

Automates Granblue Fantasy monthly story events (`#event/treasureraid<ID>`, e.g., "Farewell, Cold Heart" `#event/treasureraid177`):

### Capabilities:
- **Main Story Auto-Clear (`event:story`)**: Navigates to event home, tracks the active `.ico-current` episode card, fast-skips cutscenes (`.btn-skip` -> `.btn-scene-skip`), engages story battles with Full Auto, dismisses reward modals, and loops through all 6 chapters & ending.
- **1-Time Challenge Quest (`event:challenge`)**: Clears the event Challenge Quest with the fixed story party for Blue Sky Crystals & event trophy.
- **Daily Maniac Solo (`event:maniac`)**: Clears the daily 2/2 Maniac solo quests with Full Auto for maximum daily tokens and guaranteed Nightmare procs.
- **Nightmare (HELL) Skip (`event:nightmare`)**: Detects Nightmare procs and executes 1-click instant Nightmare Skips (or battles with Full Auto).
- **Token Gacha Drawbox (`event:gacha`)**: Pulls event tokens and automatically resets Boxes 1-4 when the target SSR item is drawn.
- **Full Event Pipeline (`event:all`)**: Executes the entire sequence: Story -> Challenge Quest -> Daily Maniac -> Nightmare -> Daily Missions -> Token Gacha!

```bash
# Clear all unread story episodes (Farewell, Cold Heart default)
bun run event
# or
bun run event:story

# Run for a specific event ID (e.g. treasureraid177)
bun src/cli/run-clear-event.ts story 177

# Run in visible windowed mode for visual inspection
bun run event:windowed

# Run full end-to-end event pipeline (Story + Challenge + Maniac + HELL + Gacha)
bun run event:all

# Run specific event tasks
bun run event:challenge
bun run event:maniac
bun run event:nightmare
bun run event:gacha

# 0-Button Event Raid Auto-Farmer (Extreme by default, sub-4s cycle)
bun run event:raid

# Run specific difficulties and counts:
bun run event:raid:ex 50    # Extreme (947431)
bun run event:raid:vh 30    # Very Hard (947421) - meat/core farming
bun run event:raid:hl 20    # Impossible / HL (947441)
bun run event:raid:windowed # Windowed browser mode

# Declarative workflow engine alternative:
bun run event:workflow
```
- Architectural Guide: [`docs/events/scenario-event-architecture.md`](file:///c:/laragon/www/gbf/docs/events/scenario-event-architecture.md)
- Event Constants & Registry: [`src/events/event.constants.ts`](file:///c:/laragon/www/gbf/src/events/event.constants.ts)
- Raid Runner: [`src/cli/run-event-raid.ts`](file:///c:/laragon/www/gbf/src/cli/run-event-raid.ts)
- Engine: [`src/engines/event.engine.ts`](file:///c:/laragon/www/gbf/src/engines/event.engine.ts)
- Story Runner: [`src/cli/run-clear-event.ts`](file:///c:/laragon/www/gbf/src/cli/run-clear-event.ts)
- Raid Template: [`templates/event-raid.json`](file:///c:/laragon/www/guranburuing/templates/event-raid.json)
- Story Template: [`templates/event-story.json`](file:///c:/laragon/www/guranburuing/templates/event-story.json)

---

## 9. Gold Bar Hunters & High-Level Raids

Automates high-level Gold Bar farming raids with intelligent room finding, priority supporter selection, Ereshkigal burst rotations, and automatic pending battle recovery:

### Proto Bahamut HL (`pbhl`, `gb-pbhl`)
```bash
# Continuous PBHL farm loop (Ctrl+C to stop)
bun run pbhl
# or
bun run gb-pbhl

# Run specific number of raids (e.g. 10 raids)
bun run src/cli/run-workflow.ts gb-pbhl 10

# 0-Button PBHL Fast burst:
bun run src/cli/run-workflow.ts gb-pbhl-fast 20
```
- Template: [`templates/gb-pbhl.json`](file:///c:/laragon/www/gbf/templates/gb-pbhl.json)
- Documentation: [`strategies/workflows/pbhl.md`](file:///c:/laragon/www/gbf/strategies/workflows/pbhl.md)
- Drop Log: [`logs/gb-pbhl.md`](file:///c:/laragon/www/gbf/logs/gb-pbhl.md)

### Akasha HL (`gb-akasha`)
```bash
# Continuous Akasha loop
bun run gb-akasha

# Run specific number of raids
bun run src/cli/run-workflow.ts gb-akasha 10
```
- Template: [`templates/gb-akasha.json`](file:///c:/laragon/www/gbf/templates/gb-akasha.json)
- Documentation: [`strategies/workflows/akasha.md`](file:///c:/laragon/www/gbf/strategies/workflows/akasha.md)

### Grand Order HL (`gb-go`)
```bash
# Continuous Grand Order HL loop
bun run gb-go
```
- Template: [`templates/gb-go.json`](file:///c:/laragon/www/gbf/templates/gb-go.json)
- Documentation: [`strategies/workflows/go.md`](file:///c:/laragon/www/gbf/strategies/workflows/go.md)

### Gold Bar Multi-Raid Rotator (`gb-farm`)
Master rotator that monitors PBHL (Slot 4), Akasha (Slot 3), and Grand Order (Slot 2) concurrently:
```bash
bun run gb-farm
```
- Template: [`templates/gb-farm.json`](file:///c:/laragon/www/gbf/templates/gb-farm.json)
- Documentation: [`strategies/workflows/farm.md`](file:///c:/laragon/www/gbf/strategies/workflows/farm.md)

---

## 10. OTK Raid Bursting & Leeching (`otkraid`)

Engineered for ultra-fast raid participation and leeching where loot is awarded based on joining rather than blue-chest/honor score thresholds (e.g. Colossus Ira anima & materials).

### Core Optimization Mechanics:
- **Burst Filter Criteria**:
  - **Boss HP**: `HP <= 20%` (strictly ignores high-health or fresh raids to avoid stall).
  - **Player Count**: `Joined Players >= 3` (ensures sufficient player swarm to finish the raid within seconds).
  - **Tie-Breaking**: Prioritizes lowest HP first and highest player count first.
- **Combat Rotation**:
  - Sub-second pipeline: Quick Summon (Varuna / Yatima) $\rightarrow$ Skill 1 $\rightarrow$ Attack $\rightarrow$ Immediate reload.
  - Leaves the room instantly after applying burst to re-enter `#quest/assist` without lingering.
- **3-Battle Pending Limit Self-Healing**:
  - When reaching the 3/3 active battle limit, switches to active assist mode.
  - Automatically navigates to `#quest/assist` pending list, re-enters unresolved battles, broadcasts in-game backup requests, and taps attack to help resolve lingering battles and unblock room slots.

```bash
# Continuous Colossus Ira fast burst loop on default account (acc1):
bun run otkraid
# or
bun run otkraid:colossus

# Run in visible GUI browser window:
bun run otkraid:colossus:windowed

# Run specific number of raids (e.g., 50 raids on acc2):
bun run otkraid acc2 otkraid-colossus-ira 50

# Run with custom account flag:
bun run otkraid --account acc1 --runs 30
```

- Template: [`templates/otkraid-colossus-ira.json`](file:///c:/laragon/www/guranburuing/templates/otkraid-colossus-ira.json)
- Evaluator Engine: [`src/engines/raid-evaluator.ts`](file:///c:/laragon/www/guranburuing/src/engines/raid-evaluator.ts)
- Runner CLI: [`src/cli/run-otkraid.ts`](file:///c:/laragon/www/guranburuing/src/cli/run-otkraid.ts)

---

## 11. Special Encounters & Farming

### Rise of the Beasts (`rotb`)
```bash
# Farm Baihu continuously (default: 30 runs)
bun run rotb:baihu

# Run 1 full Earth cycle (9x Baihu -> 1x Titan)
bun run rotb:earth

# Continuous Earth loop (9x Baihu -> 1x Titan repeatedly)
bun run rotb:earth:loop
```
- Documentation: [`strategies/workflows/rotb.md`](file:///c:/laragon/www/gbf/strategies/workflows/rotb.md)

### Arcarum Zone Mundus: The World (`arcarum-theworld`)
Automates Arcarum Zone Mundus / Quest 819131: The World encounter with Plain Damage Omen countering (Beelzebub summon), Full Auto, F5 animation skipping, and AAP recovery:
```bash
bun run arcarum-theworld
```
- Documentation: [`strategies/workflows/theworld.md`](file:///c:/laragon/www/gbf/strategies/workflows/theworld.md)

---

## 12. Universal Template CLI & Multi-Account Operations

Execute any template for any account dynamically:

```bash
# Launch interactive terminal selector (prompts for Account, Template, and Runs)
bun run workflow

# Run specific account and template:
bun run acc1 gw-meat-light 50
bun run acc1 gw-nm95-light 25
bun run acc2 daily-universal 1

# Run in windowed mode:
bun run acc1:windowed gw-meat-light 20

# Validate all templates against JSON schema:
bun run workflow:validate
```

---

## 13. Remote Controller Daemon & Mobile Companion PWA

Run the long-lived HTTP and WebSocket daemon to control the game and monitor live screencasts from your mobile phone or browser:

### Development Mode (Live Watch)
```bash
bun run dev
```

### Production Mode
```bash
bun run build
bun run start
```

### Accessing the Mobile Companion PWA
Open the companion URL in your mobile phone or desktop browser:
```text
http://<YOUR-IP>:3001/?token=gbf_secure_remote_token_2026_x89a1
```

- **Live Viewport Stream**: 2–3 FPS adaptive JPEG screencast (works even when Chrome is 100% headless).
- **1-Tap Macro Buttons**: Trigger Daily Pro Skips, Rupie draws, or specific workflows remotely.
- **Raid Joiner**: Paste 8-character backup codes to join raids and auto-combat on the go.
- **Emergency Abort**: Instantly breaks action loops and navigates to `#mypage`.
- **Sentinel CAPTCHA Alert**: Full-screen audio/visual alarm if visual verification triggers.

---

## 14. Discord Rich Presence Integration (`presence`)

Synchronize real-time activity status with Discord via local IPC / Bot Gateway. Supports 3 operational modes: `work` (deep focus / project tracking), `trade` (trading & risk quotes), and `gbf` (live raid drops & honors telemetry).

### Work Presence Commands

| Action | Command | Description |
| :--- | :--- | :--- |
| **Foreground (Default)** | `bun run presence:work` | Launches active session with default project (`Every Hero`) |
| **Custom Project & Task** | `bun run presence work "Project Name" "Task details"` | Customizes status name and detail subtitle |
| **One-Shot Config Update** | `bun run presence work "Project" "Task" --once` | Saves to `.env` & config without holding terminal open |
| **Background Daemon** | `bun run presence:bg` | Starts detached silent background daemon (no open window) |
| **Custom Background** | `powershell -ExecutionPolicy Bypass -File ./scripts/start-presence-daemon.ps1 -Mode work -Project "MyProject" -Task "Deep Work"` | Starts daemon with custom project & task |
| **Stop / Clear** | `bun run presence:stop` *(or `bun run presence:clear`)* | Terminates background daemon and wipes Discord status |

### Status & Other Templates

```bash
# Check current active template and activity preview:
bun run presence status

# Trading discipline quotes:
bun run presence:trade
bun run presence trade "Cut your losses quickly, let your winners run."
bun run presence:bg:trade

# GBF Live battle & raid drop telemetry (watches Akasha, PBHL, GO logs):
bun run presence:watch
bun run presence:gbf
bun run presence:bg:gbf
```

---

## 15. Diagnostics & Testing Utilities

Run the unified test runner or target specific modules:

| Test Command | Purpose |
| :--- | :--- |
| `bun run test` | Unified test runner executing all 22 test suites |
| `bun run test:templates` | Validates all workflow template schemas and boundaries |
| `bun run test:parser` | Tests template parser, serialization, and round-trip conversion |
| `bun run test:engine` | Unit and telemetry mock tests for UniversalWorkflowEngine |
| `bun run test:evaluator` | Parallel condition checks, multi-slot concurrency & LRU cache tests |
| `bun run test:daily` | Daily routine reconnect, loop, and Pro Skip verification |
| `bun run workflow:validate` | Validates all 22 templates in `templates/` against gold standard |

---

## 16. Common Troubleshooting & FAQs

### Q1: Chrome connection fails with "Could not attach to Chrome on port 9222"
- **Cause**: Chrome/Iron is not running or port 9222 is occupied.
- **Fix**: Launch the browser via `bun run launch:chrome` or check port status:
  ```powershell
  Test-NetConnection -ComputerName 127.0.0.1 -Port 9222
  ```

### Q2: Browser redirects to `https://game.granbluefantasy.jp/#authentication`
- **Cause**: Session cookies expired or account has not been initialized for that profile.
- **Fix**: Run `bun run account:setup acc1` to open the windowed browser, log in manually once, and navigate to `#mypage`.

### Q3: What happens if an image CAPTCHA appears in headless mode?
- The **Sentinel Watchdog** immediately hard-freezes all browser input to protect your account.
- **Two-Way Discord DM Relay**:
  1. The bot messages your private Discord DM with the CAPTCHA screenshot and challenge crop.
  2. Reply to the bot directly in DM with the text code or tile numbers (e.g., `8392` or `3 1 4`).
  3. The runner injects your answer into the game DOM, clicks verify, confirms `✅ Verified!`, and automatically resumes farming!
- **Testing the Relay**:
  ```bash
  bun run test:discord
  ```
- **Manual CLI Fallback**:
  ```bash
  bun run solve-captcha [optional_code]
  ```
