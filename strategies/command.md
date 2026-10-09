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

## 8. Event Automation Engine (`event`)

Automates Scenario Events (`#event/treasureraid<ID>`) and Collaboration Events (`#event/biography<ID>` / `#quest/extra/event/<ID>`).

### Quick Reference Commands

| Task | Command | Description |
| :--- | :--- | :--- |
| **All-in-One Pipeline** | `bun run event:all` | Complete pipeline: Story -> Challenge -> Maniac -> HELL -> Missions -> Gacha |
| **Story Auto-Clear** | `bun run event` | Fast-skips cutscenes and Full Auto clears all story chapters & ending |
| **First-Clear Sweep** | `bun run event:sweep` | Sweeps all Solo and Raid first-clear crystals for collab/extra quests |
| **Daily Maniacs** | `bun run event:maniac` | Clears daily 2/2 Maniac solo battles (scenario & collab) |
| **Nightmare (HELL)** | `bun run event:nightmare` | Instant 1-click batch skip for accumulated Nightmare battles |
| **Daily Missions** | `bun run event:missions` | Claims daily 50 crystal mission rewards |
| **Challenge Quest** | `bun run event:challenge` | 1-time clear for Blue Sky Crystals & event trophy |
| **Token Drawbox** | `bun run event:gacha` | Autonomous Draw 1 Drawbox clearer & auto-reset |
| **Solo Quest Farm** | `bun run event:solo ex 10` | Farms collaboration Solo quest (e.g. EX 10 runs) |
| **Raid Host Farm** | `bun run event:collab:raid vh 5` | Hosts collaboration raids (e.g. VH 5 runs) |
| **Raid Leech/Burst** | `bun run event:raid` / `:ex` / `:vh` | 0-Button sub-4s raid farming for scenario events |
| **Windowed Mode** | `bun run event:windowed` | Opens in visible Chrome window for inspection |

### Specific Event Targeting
```bash
# Auto-detects active event by default, or specify target:
bun src/cli/run-clear-event.ts story biography045       # Clear Gintama collab story
bun src/cli/run-clear-event.ts sweep biography045       # First-clear sweep Gintama quests
bun src/cli/run-clear-event.ts solo biography045 ex 20  # Farm Gintama EX 20 times
bun src/cli/run-clear-event.ts story 177                # Clear scenario event 177
```

- Architectural Guide: [`docs/events/scenario-event-architecture.md`](file:///c:/laragon/www/gbf/docs/events/scenario-event-architecture.md)
- Event Constants & Registry: [`src/events/event.constants.ts`](file:///c:/laragon/www/gbf/src/events/event.constants.ts)
- Engine: [`src/engines/event.engine.ts`](file:///c:/laragon/www/gbf/src/engines/event.engine.ts)
- CLI Runner: [`src/cli/run-clear-event.ts`](file:///c:/laragon/www/gbf/src/cli/run-clear-event.ts)
- Raid Runner: [`src/cli/run-event-raid.ts`](file:///c:/laragon/www/gbf/src/cli/run-event-raid.ts)

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

## 10. Leech Raid Fast Burst Automation (`leech`)

Engineered for ultra-fast raid participation and leeching across all 6 Magna 3 (Omega Rebirth) elements where loot is awarded based on joining rather than blue-chest/honor score thresholds (e.g. animas, omega rebirth weapons, and materials).

### Core Optimization Mechanics:
- **Burst Filter Criteria**:
  - **Boss HP**: `HP <= 20%` (strictly ignores high-health or fresh raids to avoid stall).
  - **Player Count**: `Joined Players >= 3` (ensures sufficient player swarm to finish the raid within seconds).
  - **Tie-Breaking**: Prioritizes lowest HP first and highest player count first.
- **Primal Summon Auto-Selection**:
  - Automatically selects matching **Primal Supporter Summons** for each elemental wheel encounter:
    - **Fire Boss (Colossus Ira)**: Water team $\rightarrow$ **Varuna**
    - **Wind Boss (Tiamat Aura)**: Fire team $\rightarrow$ **Agni**
    - **Water Boss (Leviathan Mare)**: Earth team $\rightarrow$ **Titan**
    - **Earth Boss (Yggdrasil Arbos)**: Wind team $\rightarrow$ **Zephyrus**
    - **Light Boss (Luminiera Credo)**: Dark team $\rightarrow$ **Hades**
    - **Dark Boss (Celeste Ater)**: Light team $\rightarrow$ **Zeus**
- **Combat Rotation**:
  - Sub-second pipeline: Quick Summon $\rightarrow$ Skill 1 $\rightarrow$ Attack $\rightarrow$ Immediate reload.
  - Leaves the room instantly after applying burst to re-enter `#quest/assist` without lingering.
- **3-Battle Pending Limit Self-Healing**:
  - When reaching the 3/3 active battle limit, switches to active assist mode.
  - Automatically navigates to `#quest/assist` pending list, re-enters unresolved battles, broadcasts in-game backup requests, and taps attack to help resolve lingering battles and unblock room slots.

```bash
# === Fire (Colossus Ira) ===
bun run leech:colossus
bun run leech:colossus:windowed

# === Wind (Tiamat Aura) ===
bun run leech:tiamat
bun run leech:tiamat:windowed

# === Water (Leviathan Mare) ===
bun run leech:leviathan
bun run leech:leviathan:windowed

# === Earth (Yggdrasil Arbos) ===
bun run leech:yggdrasil
bun run leech:yggdrasil:windowed

# === Light (Luminiera Credo) ===
bun run leech:luminiera
bun run leech:luminiera:windowed

# === Dark (Celeste Ater) ===
bun run leech:celeste
bun run leech:celeste:windowed

# CLI Flexible Invocations:
bun run leech <element_or_template> [account] [runs]
bun run leech colossus acc1 100
bun run leech leviathan acc2 50 --windowed
bun run leech yggdrasil --runs 200
```

- Templates: [`templates/leech-colossus-ira.json`](file:///c:/laragon/www/gbf/templates/leech-colossus-ira.json), [`templates/leech-tiamat-aura.json`](file:///c:/laragon/www/gbf/templates/leech-tiamat-aura.json), [`templates/leech-leviathan-mare.json`](file:///c:/laragon/www/gbf/templates/leech-leviathan-mare.json), [`templates/leech-yggdrasil-arbos.json`](file:///c:/laragon/www/gbf/templates/leech-yggdrasil-arbos.json), [`templates/leech-luminiera-credo.json`](file:///c:/laragon/www/gbf/templates/leech-luminiera-credo.json), [`templates/leech-celeste-ater.json`](file:///c:/laragon/www/gbf/templates/leech-celeste-ater.json)
- Evaluator Engine: [`src/engines/raid-evaluator.ts`](file:///c:/laragon/www/gbf/src/engines/raid-evaluator.ts)
- Runner CLI: [`src/cli/run-leech.ts`](file:///c:/laragon/www/gbf/src/cli/run-leech.ts)

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

---

## 17. Autonomous Daily Reset Scheduler & Self-Healing Hosting

The Daily Reset Scheduler runs continuously in the background, aligning strictly with the Granblue Fantasy server daily reset (**05:00:15 JST** / 20:00:15 UTC / 03:00:15 WIB).

### Complete Daily Pipeline
1. **Phase 1: Universal Pro Skips (`bun run daily`)**
   - Automatically claims and skips all available daily skips: Favorites, Hard+ Pro, Magna Omega Pro, and Angel Halo Pro.
2. **Phase 2: Daily Raid Hosting Suite & Diagnostic Retry Pass (`bun run daily:host`)**
   - Hosts High Level (HL), Magna 3, and Six Dragons raids across elements.
   - **Critical Failure Analysis**: Distinguishes between:
     - **Genuine Material Deficit** (e.g. 0/1 Silver Centrum): **Never retries**, saving AP and preventing loops.
     - **Transient Obstructions** (stage modal blocked, dialog overlays, supporter timeout, network lag): **Autonomously sanitizes DOM and retries hosting** (up to 2 passes).
3. **Phase 3: Executive Digest & Discord Broadcast**
   - Persists a Markdown audit report to `logs/daily-routine/`.
   - Dispatches a formatted summary to your private Discord DM with clearance rates, self-healing recoveries, and execution time.

### Commands
```bash
# Start 24/7 background scheduler daemon (aligns to 05:00:15 JST):
bun run daily:scheduler

# Execute the chained daily routine on-demand right now:
bun run daily:routine

# Execute on-demand in visible GUI window:
bun run daily:routine --windowed

# Execute only pro skips or only raid hosting:
bun run daily:routine --no-hosts   # Pro skips only
bun run daily:routine --no-skips   # Raid hosting only
```

---

## 18. Discord Remote Command Controller & VPS Cockpit

Control your local PC or VPS Granblue Fantasy automation directly from your phone or desktop via private Discord DMs.

### Security Architecture
- **Sender Snowflake Verification**: Strictly restricted to `DISCORD_USER_ID`. Commands from any other account or bot are dropped immediately.
- **Private DM Only**: Only responds in the 1-on-1 DM channel established with the bot.
- **Zero Shell Injection**: Commands are mapped strictly to an internal whitelist of validated scripts. No arbitrary shell commands can be executed.
- **CDP Port 9222 Concurrency Guard**: Enforces single-process exclusivity to prevent browser session corruption.

### Starting the Controller
```bash
# Launch Discord Remote Command Gateway daemon:
bun run discord:controller
```

### Discord DM Chat Commands
Send these commands directly in your private DM with the bot:

| Command | Action |
| :--- | :--- |
| `/run daily` *(or `/run daily:routine`)* | Triggers the complete daily reset routine (Pro Skips -> Hosted Raids) |
| `/run daily:host` | Runs the Daily Raid Hosting Suite (HL, M3, Dragons) |
| `/run daily:skips` | Runs Universal Pro Skips only |
| `/run gb-pbhl` | Starts Proto Bahamut HL Blue Chest Gold Bar Farm (1.5M min honor rotation) |
| `/run gb-akasha` | Starts Akasha HL Blue Chest Gold Bar Farm (1.43M min honor rotation) |
| `/run gb-go` | Starts Grand Order HL Blue Chest Gold Bar Farm (1.58M min honor rotation) |
| `/run gb-farm` | Starts Tri-Raid Blue Chest Gold Bar Rotation (PBHL -> Akasha -> GOHL) |
| `/run leech:colossus` | Starts Colossus Ira Fast Leech (1-turn fast damage, immediate exit to next raid) |
| `/run leech:tiamat` | Starts Tiamat Aura Fast Leech (1-turn fast damage, immediate exit to next raid) |
| `/run leech:leviathan` | Starts Leviathan Mare Fast Leech (1-turn fast damage, immediate exit to next raid) |
| `/run leech:yggdrasil` | Starts Yggdrasil Arbos Fast Leech (1-turn fast damage, immediate exit to next raid) |
| `/run leech:luminiera` | Starts Luminiera Credo Fast Leech (1-turn fast damage, immediate exit to next raid) |
| `/run leech:celeste` | Starts Celeste Ater Fast Leech (1-turn fast damage, immediate exit to next raid) |
| `/status` | View currently running job, PID, uptime, and terminal output |
| `/stop` *(or `/halt`)* | Gracefully terminates the running job and releases port 9222 |
| `/reset` *(or `/next`)* | Shows exact countdown and schedule until next 05:00 JST reset |
| `/help` | Displays the command manual in Discord |

> [!IMPORTANT]
> **Operational Distinction: Gold Bar (GB) Farming vs. Leeching**
> - **Gold Bar (GB) Farming (`gb-*`)**: These are **NOT** leeches. Raids like PBHL, Akasha, and Grand Order HL require hitting strict minimum honor thresholds (1.4M–1.58M) to guarantee Blue Chests (which contain Gold Bar drops). The engine executes a dedicated tactical rotation (skills, attacks, summons, and reload cadence), continuously tracking synced honors via `exit_if_score`, and only exits when the Blue Chest target is confirmed.
> - **Leech (`leech:*`)**: Defined strictly as joining late-stage raids (boss HP ≤ 20%, active room players ≥ 3), dealing fast 1-turn damage (OTK burst / quick summon / attack), and immediately exiting without lingering to scan and jump into the next target raid.


