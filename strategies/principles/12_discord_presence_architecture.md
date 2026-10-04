# Architectural Principle 12: Real-Time Discord Live Presence & Rich Presence Architecture

This document defines the architectural principles, dual-channel dispatch pipeline, data contracts, and UX standards for broadcasting real-time Granblue Fantasy farming telemetry and Gold Bar audit statistics to Discord.

---

## 1. Architectural Philosophy & Design Tenets

The Discord Presence subsystem in **guranburuing** serves two primary goals:
1. **Remote Telemetry & Status Transparency**: Provide the operator with an instant, glanceable view of automation health, current battle turns, honors, and farming velocity from any device running Discord (desktop or mobile).
2. **Authentic Granblue Presentation**: Emulate genuine gaming activity rather than robotic automation. Use authentic raid nomenclature (`Raid Akasha` rather than `Farming AKASHA` or `GB Farm - Akasha HL`), clean RPG loot notations, and zero redundant text.

### The Five Core Tenets
1. **Dual-Channel Dispatch**: Simultaneously support both **Discord Bot Gateway (WebSocket v10)** for server member lists and **Local Desktop IPC (`discord-ipc-0`)** for user Rich Presence profiles.
2. **Decoupled Observation**: Provide both **In-Engine telemetry** (sub-second turn updates during active combat) and an **Out-of-Process Watcher Daemon** (`bun run presence:watch`) that tails drop log markdown files without attaching to CDP or consuming browser RAM.
3. **Strict Rate Limiting & Debouncing**: Comply with Discord Gateway rate limits (maximum 5 updates per 20 seconds) using fingerprint-based deduplication and 2,500ms trailing debounce windows, with bypass flags for critical events (Gold Bar drops, battle clears).
4. **Resilient Loot Accounting**: Calculate Gold Bar drops across three distinct scopes: **Lifetime**, **Daily (`Today`)** (matching both UTC and local calendar days), and **Session** (increments since current CLI session start).
5. **Human-Friendly RPG Notations**: Keep state lines strictly within Discord's 128-character limit while maximizing information density (e.g. `💎 Blue: 868 (Dry: 255) | 🌟 Today: 0 | 2.12M honors`).

---

## 2. Dual-Channel Network Architecture

```
                       ┌────────────────────────────────────────┐
                       │       Farming Engine / CLI Process     │
                       │   (UniversalWorkflowEngine / Watcher)   │
                       └───────────────────┬────────────────────┘
                                           │ updateStatus()
                                           ▼
                       ┌────────────────────────────────────────┐
                       │     DiscordPresenceManager Singleton   │
                       │     (src/relay/discord-presence.ts)    │
                       └───────────┬────────────────┬───────────┘
                                   │                │
            Channel A: WebSocket   │                │ Channel B: Named Pipe
       (wss://gateway.discord.gg)  │                │ (\\.\pipe\discord-ipc-0)
                                   ▼                ▼
                 ┌───────────────────────┐    ┌───────────────────────┐
                 │  Discord Bot Gateway  │    │  Local Discord Client │
                 │      (Opcode 3)       │    │      (SET_ACTIVITY)   │
                 └───────────┬───────────┘    └───────────┬───────────┘
                             │                            │
                             ▼                            ▼
                 ┌───────────────────────┐    ┌───────────────────────┐
                 │ Server Member List    │    │ Personal User Profile │
                 │ "Playing Raid Akasha  │    │ Full Rich Presence    │
                 │  2269 - 3 GB Drop"    │    │ Card with Tooltips    │
                 └───────────────────────┘    └───────────────────────┘
```

### Channel A: Discord Bot Gateway (WebSocket v10)
- **Target**: Discord Official Gateway (`wss://gateway.discord.gg/?v=10&encoding=json`).
- **Authentication**: `DISCORD_BOT_TOKEN` in `.env`.
- **Intents**: `0` (Non-privileged). No message content or member intents required.
- **Heartbeat**: Opcode 1 heartbeat automatically negotiated from Opcode 10 `HELLO` payload (typically 41,250ms).
- **Presence Dispatch**: Opcode 3 (`PRESENCE_UPDATE`) containing:
  ```json
  {
    "op": 3,
    "d": {
      "since": null,
      "status": "online",
      "afk": false,
      "activities": [
        {
          "name": "Raid Akasha 2269 - 3 GB Drop",
          "type": 0,
          "state": "💎 Blue: 868 (Dry: 255) | 🌟 Today: 0 | 2.12M honors",
          "details": "Raid Akasha"
        }
      ]
    }
  }
  ```
- **Display Characteristic**: In Discord's desktop and mobile clients, Bot activities render primarily as `Playing <name>` in server member lists.

### Channel B: Discord Desktop IPC / Named Pipe (Rich Presence)
- **Target**: Local Windows named pipe `\\.\pipe\discord-ipc-0` (or `$XDG_RUNTIME_DIR/discord-ipc-0` on Linux).
- **Handshake Protocol**: Opcode 0 (`HANDSHAKE`) with `{ "v": 1, "client_id": "<DISCORD_CLIENT_ID>" }`.
- **Ready Event**: Discord responds with Opcode 1 `DISPATCH` event `READY` containing the authenticated local Discord user's metadata (`id`, `username`, `avatar`).
- **Activity Dispatch**: Opcode 1 `FRAME` with `SET_ACTIVITY` command:
  ```json
  {
    "cmd": "SET_ACTIVITY",
    "args": {
      "pid": 12345,
      "activity": {
        "details": "Raid Akasha",
        "state": "💎 Blue: 868 (Dry: 255) | 🌟 Today: 0 | 2.12M honors",
        "timestamps": {
          "start": 1791043858000
        },
        "assets": {
          "large_image": "gbf_main",
          "large_text": "Raid Akasha 2269 - 3 GB Drop",
          "small_image": "blue_chest",
          "small_text": "3 Total Gold Bars (0 Today)"
        }
      }
    },
    "nonce": "1791043858578"
  }
  ```
- **Display Characteristic**: Discord locks the bold game header to the Developer Portal Application Name associated with `client_id` (e.g. `Bae` or `Granblue Fantasy`). Details, state, elapsed timer, and rich tooltips appear directly beneath it on the user's profile card.

---

## 3. Data Representation & Field Specification

### 3.1 Activity Header / Name
- **Template Cleaning**: Raw template names (`GB Farm - Akasha HL`, `gb-akasha`, `Farming AKASHA`) are normalized to standard GBF raid tags:
  - `akasha` ➔ `Akasha`
  - `pbhl` or `proto bahamut` ➔ `PBHL`
  - `go` or `grand order` ➔ `GO`
- **Formula**: `Raid <BossName> <TotalBattles> - <N> GB Drop`
  - *Example 1*: `Raid Akasha 2269 - 3 GB Drop`
  - *Example 2*: `Raid PBHL 450 - 1 GB Drop`
  - *Fallback*: `GBF Automation <RunNumber>`

### 3.2 Details Field (Action / Context)
Reflects what the automation engine is actively performing at that exact moment:

| Engine State | Discord Details Output | Rationale |
| :--- | :--- | :--- |
| **In Combat (Turn N)** | `Combat Turn <N>` | Real-time fight progression indicator |
| **Finder / Joining** | `Searching Raid` | Searching backup requests tab |
| **Claiming Rewards** | `Claiming Pending` | Clearing backlogged rewards |
| **Default / Rest** | `Raid <BossName>` | Normalized boss banner (e.g. `Raid Akasha`) |
| **Finished** | `Finished` | Workflow session concluded |
| **Idle** | `Idle` | System on standby |

### 3.3 State Field (Loot & Honors Telemetry)
The state string combines loot audit metrics and honor score in a single, high-density line:
```text
💎 Blue: <Count> (Dry: <DryCount>) | 🌟 Today: <TodayCount> [(+<Session>s)] | <Honors> honors
```

- **Blue Chest & Dry Streak**:
  - `dryStreakMode === 'blue_chest'`: Formatted as `💎 Blue: 868 (Dry: 255)`. Eliminates duplicate words and shows total blue chests alongside the current blue dry streak.
  - `dryStreakMode === 'min_honor'`: Formatted as `💎 Blue: 868 (Dry: 255 Met)`.
  - `dryStreakMode === 'all_battles'`: Formatted as `💎 Blue: 868 | Dry: 255 Runs`.
- **Today & Session Gold Bars**:
  - If 0 dropped in current session: `🌟 Today: 0`
  - If 1+ dropped in active session: `🌟 Today: 1 (+1s)`
- **Honors Formatting**:
  - Scores $\ge 1,000,000$: Formatted as decimal millions (e.g. `2.12M honors`).
  - Scores $< 1,000,000$: Formatted as thousands (e.g. `850k honors`).

### 3.4 Assets & Tooltips (Rich Presence Badges)
- **Large Image (`large_image`)**: Asset key `gbf_main`.
  - **Large Text Tooltip (`large_text`)**: Full raid title and battle run, e.g. `Raid Akasha 2269 - 3 GB Drop`.
- **Small Image (`small_image`)**:
  - Set to `gold_bar` if lifetime Gold Bars $> 0$, otherwise `blue_chest`.
- **Small Text Tooltip (`small_text`)**:
  - Full audit breakdown: `<TotalGB> Total Gold Bars (<TodayGB> Today)`.

---

## 4. Gold Bar & Dry Streak Accounting Mechanics

### 4.1 Daily Gold Bar Calculation (`goldBarsToday`)
To prevent timezone skew between server time, UTC, and local operator time:
- The system parses each record's ISO timestamp (`YYYY-MM-DD HH:MM:SS`) in the drop log.
- It compares the date prefix against **both** `new Date().toISOString().slice(0, 10)` (UTC date) and the system local date (`new Date().toLocaleDateString('en-CA')`).
- If a Gold Bar row matches either date, it increments `goldBarsToday`.

### 4.2 Blue Chest Dry Streak Mechanics
In Granblue Fantasy end-game gold bar raids (Akasha, PBHL, Grand Order HL):
- Gold Bars from Blue Chests have a flat $\sim 3.0\%$ drop rate per opened Blue Chest.
- Battles where no Blue Chest drops (e.g. joined late or failed honor threshold) do **not** consume or grant an un-capped Gold Bar roll.
- Therefore, the **True Dry Streak** measures **consecutive Blue Chests opened without a Gold Bar**.
  - Battle with Blue Chest + No Gold Bar ➔ Dry streak increments by 1.
  - Battle without Blue Chest ➔ Dry streak remains unchanged.
  - Battle with Blue Chest + Gold Bar ➔ Dry streak resets to 0 immediately.

---

## 5. Watcher Daemon Pattern (`watch-presence.ts`)

While `UniversalWorkflowEngine` updates Discord presence directly during active gameplay, long-running farming operations often run across separate CLI windows, background daemons, or headless processes.

The **Watcher Daemon** provides an independent, zero-footprint observer:
```bash
bun run presence:watch
```

### Operational Behavior:
1. Automatically resolves active drop logs (`logs/gb-akasha.md`, `logs/gb-pbhl.md`, `logs/gb-go.md`).
2. Monitors file size and `mtimeMs` using non-blocking stat polling (every 2.5s).
3. Computes session deltas against starting baseline (`sessionGb = currentGb - initialGb`).
4. Broadcasts updates to both Bot Gateway and Desktop IPC the instant a new battle row is appended to disk.
5. On process termination (`SIGINT` / `SIGTERM`), broadcasts an `Idle` status to gracefully clear presence.

---

## 6. Rate Limiting, Deduplication & Anti-Spam Safety

Discord strictly enforces WebSocket rate limits: exceeding 5 presence updates per 20 seconds can lead to gateway socket termination (Close Code 4008: Rate limited).

To guarantee immunity against rate limiting:
1. **Activity Signature Cache**: Every payload is serialized into a fingerprint:
   $$\text{sig} = \text{name} + "|" + \text{details} + "|" + \text{state}$$
   If $\text{sig} == \text{lastDispatchedActivity}$ and the gateway is ready, the transmission is aborted as a no-op.
2. **Debounce Bucket (2,500ms)**: Consecutive turn changes (e.g. rapid Full Auto skill casts) collapse into a single broadcast at the end of the window.
3. **Immediate Dispatch Bypass (`immediate = true`)**: Critical state transitions—battle start, raid completion, Gold Bar confirmation, and process shutdown—clear the debounce timer and dispatch synchronously.

---

## 7. Configuration Reference (`.env`)

```ini
# Enable Discord Gateway & Desktop IPC Rich Presence
DISCORD_PRESENCE_ENABLED=true

# Discord Bot Token (from Discord Developer Portal -> Bot -> Token)
DISCORD_BOT_TOKEN=MTxxxxxxxxxxxxxxxxxxxx.xxxxxx.xxxxxxxxxxxxxxxxxxxxxxx

# Discord Application Client ID (Defaults to 1554396837127921714)
DISCORD_CLIENT_ID=1554396837127921714
```

---

## 8. Summary Checklist for Presence Compliance

- [x] Activity name uses `Raid <Boss> <Battles> - <N> GB Drop`.
- [x] Details dynamically switch between `Raid <Boss>`, `Combat Turn <N>`, and `Searching Raid`.
- [x] State string uses `💎 Blue: X (Dry: Y) | 🌟 Today: Z | <H> honors` without redundant text.
- [x] Timestamps use start of current session to display live duration timer.
- [x] Dual-channel dispatch handles Bot Gateway and Desktop IPC named pipe in parallel.
- [x] All 15 unified test suites pass without regression (`bun tests/run-all.ts`).
