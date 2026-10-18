---
name: gbf-automation
description: Comprehensive operating guide for the Granblue Fantasy Remote Controller and automation system, enforcing Bun as the primary runtime, CLI workflows, multi-account CDP conventions, and daily routines.
---

# Granblue Fantasy Remote Controller & Automation Guide

This guide establishes the architectural standards, runtime environment, and operational runbooks for the `gbf-remote-controller` codebase.

---

## 1. Runtime Standardization: Bun vs. Node/npm

### Why Bun is Strictly Superior for this Repository:
1. **Startup & Execution Latency**:
   - Automated farming routines, cron schedules, and CLI workflows repeatedly invoke scripts.
   - **Node.js + tsx**: Requires spawning a Node process + an esbuild worker, taking **600ms – 1,200ms** startup overhead per invocation on Windows NTFS.
   - **Bun**: Built-in Zig/C++ TypeScript runtime boots in **30ms – 50ms** (over 15x faster), eliminating CLI lag.
2. **Native TypeScript Execution**:
   - Bun parses, transpiles, and runs `.ts` and `.json` files natively with zero external dependencies.
3. **Memory & Resource Efficiency**:
   - Bun's base runtime consumes ~30MB memory vs ~90MB+ for Node + tsx.
4. **WebSocket & CDP Compatibility**:
   - `puppeteer-core` connects seamlessly via Bun to Chrome/SRWare Iron CDP endpoints (`ws://127.0.0.1:9222`) with full protocol fidelity and zero socket dropped frames.
5. **Fast Package Management**:
   - `bun install` resolves dependencies orders of magnitude faster than `npm install`, maintaining deterministic locks via `bun.lock`.

### Standardized Commands:
| Action | Primary (Bun) | Node Fallback |
| :--- | :--- | :--- |
| **Run Daily Routine** | `bun run daily` | `npm run daily` |
| **Run Daily Host Raids** | `bun run daily:host` | `bun src/cli/run-daily-host.ts` |
| **Daily Host Categories**| `bun run daily:host:hl` / `:m3` / `:dragons` | `bun src/cli/run-daily-host.ts <category>` |
| **Daily Multi-Account**| `bun run daily:all` / `bun run daily:host:all` | `npm run daily:all` |
| **Daily Windowed** | `bun run daily:windowed` / `bun run daily:host:windowed` | `npm run daily:windowed` |
| **Fate Episodes** | `bun run fate` | `npm run fate` |
| **Event Story / Clear** | `bun run event` / `bun run event:all` | `bun src/cli/run-clear-event.ts ...` |
| **Custom Script** | `bun src/cli/run-workflow.ts acc1 <template> <runs>` | `tsx src/cli/run-workflow.ts ...` |
| **Export Cookies (Local)**| `bun run session:export <acc>`| `npx tsx scripts/export-session.ts` |
| **Import Cookies (VPS)**  | `bun run session:import <acc>`| `npx tsx src/cli/import-cookies.ts` |
| **1-Click Sync to VPS**   | `bun run session:sync <acc>`  | `npx tsx scripts/sync-session.ts`   |
| **Interactive VPS Login** | `bun run vps:login`           | `.\scripts\vps-browser.ps1`         |
| **Security Hygiene Gate** | `bun run hygiene`             | `bun scripts/verify-hygiene.ts`     |
| **Run All Tests**         | `bun run test`                | `npm run test:node`                 |
| **Template Validation**   | `bun run workflow:validate`   | `npm run workflow:validate`         |
| **Full Security & Tests** | `bun run verify`              | `npm run verify`                    |
| **Install Packages**      | `bun install`                 | `npm install`                       |
| **Build Types**           | `bun run build`               | `npm run build`                     |

---

## 2. Multi-Account & CDP Architecture

Accounts are registered in [accounts.config.json](file:///c:/laragon/www/guranburuing/accounts.config.json):

```json
[
  {
    "id": "acc1",
    "name": "acc1",
    "enabled": true,
    "service": "mobage",
    "cdpPort": 9222,
    "profileDir": "C:/Users/YOUR_USER/.gbf-profiles/acc1"
  },
  {
    "id": "acc2",
    "name": "acc2",
    "enabled": true,
    "service": "mobage",
    "cdpPort": 9223,
    "profileDir": "C:/Users/YOUR_USER/.gbf-profiles/acc2"
  }
]
```

### Key Principles:
- **Port Isolation**: Each account runs its dedicated CDP port (default `9222` for `acc1`, `9223` for `acc2`).
- **Profile Isolation**: Each account maintains its isolated Chrome profile directory in `~/.gbf-profiles/<account>`, preventing cookie collisions.
- **Third-Party Cookies Mandatory**: GBF runs on `game.granbluefantasy.jp` while session tokens live on `.mbga.jp` (Mobage) or `.dmm.com`. Blocking third-party cookies causes infinite OAuth redirect loops and blank screens. Launchers must supply `--test-third-party-cookie-phaseout=disabled` and browser settings must allow third-party cookies.
- **Headless Execution**: Automation defaults to `--headless=new` (configured via `.env` or `--headless`). To visually inspect or assist, append `--windowed` or run `bun run account:setup <account>`.

---

## 3. In-Game Interaction & Anti-Crash Patterns

### 1. Robust In-Page Dispatch (Never Blind `ElementHandle.click()`):
Granblue Fantasy uses dynamic Zepto/jQuery DOM overlays and mobile viewport canvas layers. Native Puppeteer `ElementHandle.click()` calculates `clickablePoint()`, which throws `Error: Node is either not clickable or not an Element` when elements are animating, off-screen, or have zero bounding box.

**Always use in-page DOM dispatch**:
```ts
await page.evaluate(() => {
  const btn = document.querySelector('#start, .btn-start, [data-location-href="start"]') as HTMLElement;
  if (btn) {
    const $ = (window as any).$ || (window as any).Zepto;
    if ($) $(btn).trigger('tap');
    btn.click();
  }
});
```

### 2. Autonomous Authentication Lifecycle & Session Immunity Shield:
When an account's session is initialized or requires verification:
1. **Mobage Session Immunity Shield (`src/auth/session-immunity.ts`)**:
   - Injected via `Page.addScriptToEvaluateOnNewDocument` before any game or Mobage code executes.
   - Intercepts incoming `window.addEventListener('message', ..., true)` capture phase events and outgoing `window.postMessage` / `MessagePort.postMessage`.
   - Neutralizes false-positive Mobage `session_state_change_response` messages caused by Chromium third-party cookie restrictions (CHIPS) by rewriting `status: "changed"` to `"unchanged"` and calling `event.stopImmediatePropagation()`.
   - Permanently disarms Granblue's `mobageSubscribeLogout` listener, eliminating phantom kickouts to `#authentication`.
2. **Dual-View & Runtime Profile Verification (`AccountAuthManager.getVerifiedProfile`)**:
   - Evaluates `window.Game` singleton state (`userId`, `userName`, `userRank`) first.
   - Evaluates `#mypage` DOM nodes (`.btn-user-name`, `.txt-rank-value`).
   - Evaluates `#profile` DOM nodes (`.prt-user-name`, `.prt-rank-value`, `.prt-user-id`).
   - Employs strict negative guards against `#authentication` and `.btn-auth-platform`.
   - Sends proper Zepto headers (`Accept: application/json, text/javascript, */*; q=0.01`, `X-Requested-With: XMLHttpRequest`) if querying `/user/status`, preventing FuelPHP HTTP 409 Conflict.
3. **Partitioned Multi-Domain Cookie Persistence**:
   - Captures all 14+ cookies across `granbluefantasy.jp`, `mobage.jp`, and `sp.mbga.jp` using CDP `Network.getAllCookies`.
   - Preserves `partitionKey` attributes (`topLevelSite: https://granbluefantasy.jp`) and host-only domain constraints (`game.granbluefantasy.jp` for `midship`).
   - Persists sanitized cookie jar to `data/<account_id>-cookies.json`.
4. **Standard Operating Procedure (SOP)**:
   - Onboard account: `bun run account:setup acc1 --windowed`
   - Headless verification: `bun run daily` or `bun run workflow acc1 <template>`
   - Detailed architectural reference: [`strategies/AUTH_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md`](file:///c:/laragon/www/guranburuing/strategies/AUTH_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md)

### 3. Reconnect Watchdog:
Upon network disconnect or browser restart, `CdpConnectionManager` automatically triggers `reconnect()`. Listeners re-bind the active page reference on `SentinelWatchdog` and `UniversalWorkflowEngine` to eliminate `Execution context was destroyed` or `detached Frame` errors.

---

## 4. Key Workflows

### Universal Daily Routine (`daily-universal`):
Runs all daily chores sequentially with zero user intervention:
- **Pro Skips**: Hard+, Omega, Omega (Impossible), Regalia, Angel Halo, Primarch Trials.
- **Rupie Gacha**: Daily 100-Draw Rupie Gacha (`#gacha/index/rupie`).
- **Skyscope**: Collects daily mission rewards (`#mission`).
- **Casino Exchange**: Exchanges maximum daily capacity for Half-Elixirs & Soul Berries (`#casino/exchange`).

```bash
# Run universal daily for primary account (acc1):
bun run daily

# Run universal daily across all registered accounts sequentially:
bun run daily:all

# Run for specific secondary account:
bun run daily:acc2

# Run in visual windowed mode:
bun run daily:windowed
```

### Daily Host Raids Routine (`daily:host`):
Automates hosting the 16 critical daily raids from `#quest/multi/0` with material checks, automatic public backup broadcasting, and Smart Full Auto:
- **High Level (HL)**: Wings of Terror (PBHL), Omen of the Broken Skies (Akasha), The Peacemaker's Wings (GOHL), Empyreal Ascension (Lindwurm).
- **Magna 3 (Omega 3)**: Tiamat Aura, Colossus Ira, Leviathan Mare, Yggdrasil Arbos, Luminiera Credo, Celeste Ater.
- **Six Dragons (Impossible)**: Wilnas, Wamdus, Galleon, Ewiyar, Lu Woh, Fediel.
- **Execution Rules**:
  - Auto-skips if daily host limit is 0 or if host treasure is insufficient.
  - Automatically sends backup request to **Everyone** (`.btn-assist-all`) on Turn 1.
  - Runs **Smart Full Auto**: Turn 1 Quick Summon, frontline tactical skills (Field -> Debuff -> Buff -> Nuke -> Heal), attack + animation cancel reload (F5).
  - Waits and confirms battle result before moving to the next raid.

```bash
# Host all 16 daily raids sequentially:
bun run daily:host

# Host specific raid categories:
bun run daily:host:hl         # PBHL + Akasha + GOHL + Lindwurm
bun run daily:host:m3         # All 6 Magna 3 raids
bun run daily:host:dragons    # All 6 Six-Dragon raids

# Host in visual windowed mode or multi-account:
bun run daily:host:windowed
bun run daily:host:all
bun run daily:host acc2
```

### Fate Stories Auto-Farmer (`fate-stories`):
Loops through unread character fate episodes, fast-skips dialogues, enables Full Auto on combat, claims crystal rewards, and returns to `#mypage`:

```bash
# Farm unread fate episodes (default 5 episodes):
bun run fate

# Farm specific number of episodes (e.g. 10):
bun run fate:10
```

### Scenario Events Auto-Clear (`clear-event`, `event`):
Automates monthly scenario events (`#event/treasureraid<ID>`, e.g., "Farewell, Cold Heart" `#event/treasureraid177`):
- **Story Auto-Clear**: Automatically locates current `.ico-current` episode card, fast-skips dialogue cutscenes (`.btn-skip` -> `.btn-scene-skip`), engages story combat with Full Auto, dismisses reward modals, and loops through all 6 chapters & ending.
- **Challenge Quest**: 1-time clear of event challenge quest for Blue Sky Crystals and event trophy.
- **Daily Maniac**: Clears daily 2/2 Maniac solo battles for high-yield tokens and guaranteed Nightmare spawns.
- **Nightmare (HELL)**: Instant 1-click skips when skip is unlocked, or Full Auto battle.
- **Token Gacha**: Automated Draw 1 Drawbox clearer (`bun run event:gacha` / `bun run event:token`). Automatically clicks Draw 1 Drawbox (`.btn-bulk-play-box`), taps to skip crystal animation, reloads to bypass loot roll, clicks Reset Drawbox (`.btn-reset`), confirms modal, and loops up to 200 boxes or until tokens are depleted (~9.8s per complete drawbox).

- **Raid Auto-Farming**: Dedicated sub-4s looper for Extreme (`947431`), Very Hard (`947421`), and Impossible (`947441`), with auto Quick Summon instakill, Full Auto fallback, and Half-Elixir AP restoration.
- **Reference Guide**: Full technical specification in [`docs/events/scenario-event-architecture.md`](file:///c:/laragon/www/guranburuing/docs/events/scenario-event-architecture.md).

```bash
# Farm Extreme Raid (0-Button Quick Summon, default 500 runs):
bun run event:raid

# Farm specific difficulties and run counts:
bun run event:raid:ex 50
bun run event:raid:vh 30
bun run event:raid:hl 20

# Run in windowed browser mode:
bun run event:raid:windowed

# Clear all unread story episodes (defaults to active event):
bun run event

# Complete full event pipeline (Story -> Challenge -> Maniac -> HELL -> Gacha):
bun run event:all

# Individual event tasks:
bun run event:challenge
bun run event:maniac             # Clears daily 2/2 Maniacs (supports scenario and collab events)
bun run event:nightmare          # Autonomous 10x Nightmare (HELL) Skip Looper
bun run event:nightmare 177 50   # Skip up to 50 batches (500 battles)
bun run event:sweep              # First-clear sweep of all collaboration event Solo & Raid quests
bun run event:quests             # Alias for event:sweep
bun run event:collab:solo ex 10  # Farm collaboration Solo Extreme quest 10 times
bun run event:collab:raid vh 5   # Host collaboration Raid Very Hard 5 times
bun run event:missions           # Claims daily event crystal missions
bun run event:gacha              # Autonomous Token Drawbox Clearer (all remaining boxes)
bun run event:token              # Alias for event:gacha
bun run event:gacha 177 50       # Clear up to 50 drawboxes for event 177
```

### Daily Host Automation (16-Raid SOLID Industry Architecture):
The Daily Host system (`bun run daily:host`) autonomously hosts and clears all 16 daily HL, Magna 3, and Six Dragons raids sequentially:
- **SOLID Enterprise Architecture**:
  - `src/domain/daily-host/`: Standard domain models, immutable definitions (`DailyRaidHostDefinition`), and segregated interfaces (`daily-host.interfaces.ts`).
  - `src/services/daily-host/`: Dedicated Single-Responsibility services:
    - `ActiveHostedRaidScanner`: Detects and clears any in-progress self-hosted raids before hosting new ones.
    - `StageModalNavigator`: High-level navigation and category modal manipulation.
    - `HostPreconditionValidator`: Checks daily limits, banner masks, and treasure requirements (`.pop-treasure-raid`).
    - `SupporterPartyLauncher`: Supporter summon selection, AP recovery, and Ascendant Prayer handling.
    - `BackupBroadcastService`: Broadcasts backup requests to **ALL 3 SCOPES** (`Everyone`, `Friends`, `Crew`).
    - `HostedCombatRunner`: Tactical Smart Full Auto combat, Turn 1 Quick Summon, frontline skill triage, and fast F5 reload lockout bypass.
    - `DailyHostReporter`: Formatted console and disk audit markdown reports.
  - `src/engines/daily-host.engine.ts`: Clean Orchestrator (`DailyHostOrchestrator`) coordinating the workflow via Dependency Injection (DIP).

```bash
# Run full 16-raid daily host routine:
bun run daily:host

# Run specific raid categories:
bun run daily:host:hl       # 4 High Level Raids (PBHL, Akasha, GOHL, Lindwurm)
bun run daily:host:m3       # 6 Magna 3 Raids (Tiamat, Colossus, Leviathan, Yggdrasil, Luminiera, Celeste)
bun run daily:host:dragons  # 6 Six Dragons Raids (Wilnas, Wamdus, Galleon, Ewiyar, Lu Woh, Fediel)

# Host a specific raid:
bun run daily:host galleon
bun run daily:host pbhl

# Multi-account hosting:
bun run daily:host:all

# Windowed mode:
bun run daily:host:windowed
```

### Raid & Combat Farming:
```bash
# Farm Proto Bahamut HL for blue chests / Gold Bars:
bun run pbhl

# Farm Akasha HL:
bun run gb-akasha

# Farm Grand Order HL:
bun run gb-go

# Multi-Raid Rotator (PBHL + Akasha + GOHL):
bun run gb-farm

# Guild Wars EX+ Meat:
bun run gw-meat-light
```

### OTK Raid Burst & Leech Farming (`otkraid`):
Target dying raids (HP <= 20%, players >= 3) on Raid Finder tab 1 for rapid leech/participation drops and automatic pending assist unjamming:
```bash
# Tiamat Aura (Agni Fire burst):
bun run otkraid:tiamat
bun run otkraid-tiamat-aura
npm run otkraid-tiamat-aura

# Colossus Ira (Varuna Water burst):
bun run otkraid:colossus
bun run otkraid-colossus-ira
npm run otkraid-colossus-ira

# Universal template execution by filename:
bun run workflow <template-filename>
npm run workflow -- <template-filename>

# Auto-sync any newly created template to package.json scripts:
bun run templates:sync
```

---

## 5. VPS Headless Deployment & Cross-Platform Cookie Sync

### 1-Click VPS Provisioning:
On an Ubuntu 22.04/24.04 or Debian VPS instance:
```bash
sudo bash scripts/setup-vps.sh
```
This automatically:
- Creates a 2GB Swapfile (prevents Linux OOM killer on 1GB VPS).
- Installs all headless Chromium system dependencies and Japanese Noto CJK fonts.
- Installs Google Chrome Stable.
- Installs Bun runtime and packages.

### Recommended: Native VPS Remote Login & Interactive Mirror (`bun run vps:login`):
Syncing cookies across machines via files can be brittle due to Mobage IP binding and session token expiration. Generating and maintaining the session **directly inside the remote VPS Chrome instance** under the VPS’s own IP address is the gold standard:

1. **Launch the Remote Mirror**:
   ```powershell
   bun run vps:login
   # or
   .\scripts\vps-browser.ps1
   ```
2. **What this does**:
   - Securely tunnels port `9222` from the VPS directly to your PC via SSH (`ssh -N -L 9222:127.0.0.1:9222`).
   - Automatically opens your local Google Chrome to `chrome://inspect`.
3. **Inspect & Control**:
   - Under **Remote Target**, click **"inspect"** next to **Granblue Fantasy**.
   - An interactive mirror opens. Click buttons with your mouse, type your Mobage credentials on your keyboard, or solve any CAPTCHA challenge.
   - All session state, cookies, and local storage tokens are saved **directly inside the VPS profile directory** (`/var/www/guranburuing/data/accounts/acc1`), registered natively under the VPS's public IP address.

### Low-Spec VPS CDP Connection & Timeout Rules:
- On 1 vCPU / 1 GB RAM low-memory VPS instances using SwiftShader CPU software rendering, target discovery across multiple iframes takes **10–15 seconds**.
- The CDP connection timeout in `src/cdp-connection.ts` is standardized to **25,000ms** (25 seconds).
- If connection stalls due to zombie sockets, the runner automatically re-launches with `--force` / `-Force` to kill stale sockets on port 9222.

### Reliable 1-Click Cookie Sync (Local Windows ➔ VPS):
To synchronize your active local session cookies directly into the remote VPS Chrome instance:
```bash
# Sync acc1 session to VPS via direct SSH/SCP:
bun run session:sync acc1 --ssh
```
This transfers `data/<account>-cookies.json` via SCP and invokes `src/cli/import-cookies.ts` directly on the VPS, injecting standard and CHIPS partitioned cookies, returning to `#mypage`, and validating in-game player identity.

### Non-Logout CAPTCHA Timeout Safety Policy:
- When an in-game CAPTCHA verification challenge times out (10 minutes), the watchdog **MUST NEVER** log out, clear cookies, or navigate to `#authentication`.
- Instead, the browser safely navigates to `#mypage` to preserve the session and prevent backend cookie revocation.
- A Discord DM notification is immediately dispatched informing the operator that the task stopped in progress and why, confirming that the session is preserved.

### Discord Remote Controller ChatOps Standard:
All commands require the `/gbf` prefix:
- `/gbf daily` — **Pro Skips Only** (Hard+, Omega, Omega HL, Regalia, Angel Halo, Primarchs)
- `/gbf daily:host` — **All 16 Daily Raids** (HL + Magna 3 + Six Dragons)
- `/gbf daily:hostgb` — **Gold Bar Daily Raids Only** (PBHL + Akasha + GOHL + Lindwurm)
- `/gbf daily:routine` — **Full Daily Chores** (Pro Skips + Rupie Gacha + Skyscope + Casino)
- `/gbf <preset> [runs]` — Direct raid or leech run (e.g. `/gbf gb-akasha 250`, `/gbf leech:leviathan`)
- `/gbf stop` — Gracefully stops running job and returns to `#mypage`
- `/gbf status` — Displays running job, PID, and terminal snippet
- `/gbf logs` — Fetches last 15 lines of output

---

## 6. Daily Raid Hosting Automation (`bun run daily:host`)

Automates sequential hosting of up to 16 daily raids with strict material checking, backup requests, and tactical Full Auto clearing:

### 16-Raid Comprehensive Catalog:
1. **High-Level Gold Bar / Uncapping Raids (Stage 12061)**:
   - Wings of Terror (Impossible) - PBHL (`12061` / `301061`)
   - Omen of the Broken Skies - Akasha (`12061` / `303251`)
   - The Peacemaker's Wings (Impossible) - GOHL (`12061` / `305161`)
   - Empyreal Ascension (Impossible) - Lindwurm HL (`12061` / `303141`)
2. **Magna 3 / Omega 3 Raids (Stage 12042)**:
   - Tiamat Aura Omega (Impossible) (`12042` / `305601`)
   - Colossus Ira Omega (Impossible) (`12042` / `305611`)
   - Leviathan Mare Omega (Impossible) (`12042` / `305631`)
   - Yggdrasil Arbos Omega (Impossible) (`12042` / `305641`)
   - Luminiera Credo Omega (Impossible) (`12042` / `305591`)
   - Celeste Ater Omega (Impossible) (`12042` / `305621`)
3. **Six Dragons (Impossible) (Stage 12051)**:
   - Wilnas (Impossible) (`12051` / `305191`)
   - Wamdus (Impossible) (`12051` / `305201`)
   - Galleon (Impossible) (`12051` / `305211`)
   - Ewiyar (Impossible) (`12051` / `305221`)
   - Lu Woh (Impossible) (`12051` / `305231`)
   - Fediel (Impossible) (`12051` / `305241`)

### Standard Host Commands:
```bash
# Host all 16 raids sequentially:
bun run daily:host

# Host specific category:
bun run daily:host:hl         # PBHL, Subaha, GOHL, Akasha
bun run daily:host:m3         # 6 Magna 3 raids
bun run daily:host:dragons    # 6 Six Dragons raids

# Multi-account hosting:
bun run daily:host:all
```

---

## 7. Domain-Driven & SOLID Architecture

The codebase adheres strictly to gold industry standard senior software architecture:
- **`src/domain/`**: Enterprise business models, entities, immutable catalogs (`GOLD_BAR_RAID_CATALOG`, `DAILY_HOST_CATALOG`), and interfaces (`IRecoveryModalService`, `IPendingBattleService`, `ICombatActionService`, `ILootTrackerService`, `IGoldBarHunterEngine`).
- **`src/services/`**: Focused application domain services obeying SRP (Single Responsibility Principle) and DIP (Dependency Inversion Principle):
  - `RecoveryModalService`: AP/EP/AAP replenishment modals.
  - `PendingBattleService`: 3-raid/5-battle backup limit resolution and Gold Bar detection.
  - `SupporterSelectionService`: Attribute-aware supporter summon pickers.
  - `CombatActionService`: Skill/summon/attack/backup DOM interactions.
  - `LootTrackerService`: Telemetry, drop parsing, and proof captures.
- **`src/engines/`**: High-level workflow orchestrators obeying LSP (Liskov Substitution Principle) and OCP (Open-Closed Principle):
  - `GoldBarHunterEngine`: Base hunter engine extended by `PbhlEngine`, `GoEngine`, and `AkashaEngine`.
  - `DailyHostEngine`: 16-raid hosting engine.
  - `UniversalWorkflowEngine`: Config-driven workflow engine.

---

## 8. Public Repository Security & Anti-Leak Hygiene Policy

Because this repository is public, strict zero-leak hygiene is mandatory:

### 1. Zero Hardcoded Credentials & Private Data:
- **Never commit real credentials**: Emails, passwords, and user IDs must never exist in tracked files.
- **Never hardcode server IP addresses**: Use dynamic environment variables (`process.env.VPS_HOST` / `process.env.VPS_IP`) with `localhost` fallbacks.
- **Forbidden in git tracked files**:
  - `.env` and `.env.*` (secrets, tokens, webhooks)
  - `accounts.config.json` (live account credentials)
  - `data/*-cookies.json` (exported session cookies)
  - `data/accounts/*` (Chrome user data profiles)
  - `artifacts/*` and `logs/*` (screenshots, CAPTCHA crops, drops)

### 2. Automated Hygiene Gate:
Always run the hygiene audit before pushing:
```bash
bun run hygiene
# or full gate:
bun run verify
```
The hygiene script (`scripts/verify-hygiene.ts`) automatically audits all tracked files in the git index for:
- Exposed real email addresses (requires `@example.com` placeholders)
- Personal Windows file paths (`C:\Users\<username>`)
- Hardcoded public IPv4 server addresses
- Discord webhook URLs with secret tokens
- Telegram bot tokens
- Private cryptographic keys (`.pem`, `.key`)
- `.gitignore` rule completeness

