# Multi-Account Architecture & Swarm Farming Strategy

Comprehensive operational guide and architecture documentation for managing multiple Granblue Fantasy accounts with isolated profiles, lazy on-demand authentication, and parallel headless swarm farming.

---

## 1. Architecture Overview

Running multiple accounts concurrently or interchangeably requires absolute isolation to prevent cross-contamination of sessions, cookie leaks, and account linking by Cygames:

```mermaid
flowchart TD
    subgraph Config["Account Registry (accounts.config.json)"]
        A1[Account 1: Main - Port 9222]
        A2[Account 2: Alt 1 - Port 9223]
        A3[Account 3: Alt 2 - Port 9224]
    end

    subgraph AuthLayer["Lazy / On-Demand Auth Guard"]
        B1{0ms Session Check}
        B1 -- Active (In-Game/Cookies) --> D1[Proceed to Engine Directly]
        B1 -- Inactive / Expired --> C1[Automated or Assisted Login]
        C1 --> D1
    end

    subgraph Workers["Parallel Swarm Workers (Headless)"]
        D1 --> W1[Worker 1: Main<br/>Port 9222 / Profile 1]
        D1 --> W2[Worker 2: Alt 1<br/>Port 9223 / Profile 2]
        D1 --> W3[Worker 3: Alt 2<br/>Port 9224 / Profile 3]
    end

    subgraph FarmLoop["Speedrunner GW Meat Engine"]
        W1 --> F1[Sub-7.5s EX+ Loop]
        W2 --> F2[Sub-7.5s EX+ Loop]
        W3 --> F3[Sub-7.5s EX+ Loop]
    end

    subgraph Summary["Swarm Aggregator"]
        F1 --> S[Real-Time Progress & Aggregated Swarm Summary]
        F2 --> S
        F3 --> S
    end
```

### Core Architecture Pillars

1. **Profile Directory Isolation (`--user-data-dir`)**:
   - Each account operates within its own completely distinct Chromium user data directory (`~/.gbf-profiles/acc1`, `~/.gbf-profiles/acc2`, etc.).
   - Cookies, IndexedDB caches, local storage, and service workers are 100% physically isolated on disk.
   - **Why separate `--user-data-dir` is required instead of Chrome's `--profile-directory`**:
     Chromium (Chrome and SRWare Iron) enforces a **Process Singleton** lock (`SingletonLock`) per user data directory. If multiple instances attempt to share the same user data directory with different `--profile-directory` switches and different `--remote-debugging-port`s, Chromium routes command-line arguments to the already-running process and exits immediately without opening the secondary CDP port.
     Using distinct `--user-data-dir` paths guarantees 100% independent processes, active CDP listeners on all ports, and zero database lock conflicts (`EBUSY`).
2. **Dedicated CDP Debugging Ports**:
   - Every active browser runs on its own DevTools port (`9222`, `9223`, `9224`, etc.).
   - The automation connects via independent Puppeteer/CDP instances without process collisions.
3. **Full SRWare Iron & Google Chrome Compatibility**:
   - Both browsers run on the Chromium engine and accept identical command-line flags (`--headless=new`, `--remote-debugging-port`, `--user-data-dir`).
   - Swarming works seamlessly on both SRWare Iron and Google Chrome.
4. **Lazy / On-Demand Authentication**:
   - **Zero cold logins**: The engine verifies the session in **0ms** using in-game URL hash states (`#mypage`, `#quest`, `#raid`) and existing cookies (`midship`, `access_gbtk`, `t`).
   - Credentials in `accounts.config.json` are **only** used if the session is genuinely expired or unauthenticated.
5. **Staggered Swarm Coordination**:
   - Swarm workers launch with randomized 5–8s staggered offsets to prevent simultaneous burst spikes and anti-cheat correlation.
   - Independent error recovery: If one account encounters a network timeout, other workers continue unaffected.

---

## 2. Configuration (`accounts.config.json`)

The multi-account system is governed by `accounts.config.json` located in the project root.

> [!IMPORTANT]
> `accounts.config.json` is strictly listed in `.gitignore` to prevent committing account credentials, emails, or private proxy addresses. An example template is provided in `accounts.config.example.json`.

### Configuration Schema

```json
[
  {
    "id": "acc1",
    "name": "acc1",
    "enabled": true,
    "service": "mobage",
    "cdpPort": 9222,
    "profileDir": "C:/Users/YOUR_USER/.gbf-profiles/acc1",
    "credentials": {
      "email": "your_main_email@example.com",
      "password": "your_password"
    },
    "proxy": null
  },
  {
    "id": "acc2",
    "name": "acc2",
    "enabled": false,
    "service": "mobage",
    "cdpPort": 9223,
    "profileDir": "C:/Users/YOUR_USER/.gbf-profiles/acc2",
    "credentials": {
      "email": "your_alt1_email@example.com",
      "password": "your_alt1_password"
    },
    "proxy": "http://user:pass@proxy-ip:port"
  }
]
```

### Property Reference

| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique alphanumeric identifier for CLI targeting (e.g. `main`, `alt1`, `alt2`). |
| `name` | `string` | Descriptive display name used in console logs and summaries. |
| `enabled` | `boolean` | Whether this account is active during swarm runs (`npm run gw-meat:swarm`). |
| `port` | `number` | CDP remote debugging port (must be unique per account, e.g. `9222`, `9223`). |
| `profileDir` | `string` | Absolute path to Chromium user data directory for session persistence. |
| `service` | `enum` | Login service: `"mobage"` \| `"dmm"` \| `"gree"` \| `"yahoo"`. |
| `credentials` | `object` | Optional credentials (`email`, `password`) used *only* when session expires. |
| `proxy` | `string \| null` | Optional HTTP/SOCKS5 proxy (`http://user:pass@host:port`) for IP masking. |
| `meatQuota` | `number` | Optional target meat count; stops account once quota is reached. |
| `autoElixirs` | `boolean` | Automatically consume Half-Elixirs upon AP exhaustion (`true` by default). |

---

## 3. Account Setup & 1-Time Assisted Login

Before running an account headlessly for the first time, its Chromium profile must have an initial authenticated session.

### Running the Setup Helper

Use the interactive setup tool to launch the browser in **Windowed (GUI)** mode:

```bash
# Setup main account (port 9222)
npm run account:setup main

# Setup secondary account (port 9223)
npm run account:login alt1
```

### What Happens During Setup:
1. The script boots Chromium in a visible desktop window using the account's specified `profileDir` and `port`.
2. If `credentials` are provided in `accounts.config.json`, it attempts to fill and submit the login form automatically.
3. If 2FA, CAPTCHA, or email verification is challenged by Mobage/DMM, the terminal issues an audible chime (`\x07`) and pauses execution.
4. You complete the challenge directly inside the browser window.
5. As soon as `#mypage` is reached, the script detects successful authentication, saves the profile, and exits cleanly.
6. **The session is now permanently cached.** All future runs can be 100% headless.

---

## 4. Execution Commands

### Mode A: Single Account Headless Execution

Run the Guild War Meat Farm engine on a specific account:

```bash
# Run 100 runs on Main account (headless)
npm run gw-meat-light:headless 100

# Run 50 runs on Alt 1 explicitly
npm run gw-meat-light:headless -- --account alt1 50

# Run 30 runs in visible windowed mode for debugging
npm run gw-meat-light -- --account alt1 30
```

### Mode B: Multi-Account Swarm Mode (`gw-meat:swarm`)

Run all enabled accounts simultaneously in parallel headless instances:

```bash
# Run all enabled accounts for 100 runs each
npm run gw-meat:swarm 100

# Alternative script alias
npm run gw-meat-swarm 50
```

#### Swarm Execution Flow:
1. **Account Discovery**: Reads `accounts.config.json` and collects all entries with `"enabled": true`.
2. **Staggered Launch**: Launches Worker 1 immediately, Worker 2 after 6 seconds, Worker 3 after 12 seconds, etc.
3. **Isolated Automation**: Each worker connects to its designated CDP port and user profile.
4. **0ms Lazy Auth**: Each worker verifies existing cookies in 0ms; skips login screens instantly.
5. **Real-Time Reporting**: Individual runs report per-account clear speeds, supporter summon chosen, and meat accumulated.
6. **Aggregated Swarm Summary**: When all workers finish, a consolidated scoreboard displays total meat farmed across all accounts.

---

## 5. Anti-Detection & Ban Prevention Strategy

Cygames employs automated telemetry to detect botting and multi-accounting. The multi-account engine mitigates detection through strict defenses:

### 1. Zero Cold Logins
- Logging in with credentials on every automated session is an immediate red flag.
- The engine uses **lazy session verification**; as long as session cookies (`midship`, `access_gbtk`, `t`) remain valid in the profile directory, zero login requests are dispatched.

### 2. Physical Profile & Cache Segregation
- Each account has its own SQLite cookie jar, CacheStorage, and IndexedDB instance.
- No shared cache or storage identifiers can link Account A to Account B.

### 3. IP Masking via Dedicated Proxies
- Configure a residential or private datacenter proxy in `accounts.config.json` per account:
  ```json
  "proxy": "http://username:password@proxy.example.com:8080"
  ```
- The launcher starts Chrome with `--proxy-server=...`, routing all HTTP, WebSocket, and game asset traffic through the designated proxy.

### 4. Asynchronous Human Motor Model
- Every worker instance uses an independent `HumanMotor` with randomized Gaussian jitter:
  - Ready Screen tap coordinates: $(240 \pm 12, 370 \pm 14)$ with random sub-pixel micro-jitter.
  - Action delays: Log-normal reaction distributions (averaging 150ms with 40–350ms variance).
  - Workers do not click at identical timestamps due to staggered starts and variable server response times.

### 5. Sentinel CAPTCHA Watchdog
- If an image CAPTCHA or verification modal appears on any worker:
  - That specific worker immediately pauses and freezes all inputs.
  - An emergency alert chime sounds, and if configured, a push alert is sent.
  - Other unaffected workers continue farming normally.

---

## 6. Troubleshooting & Diagnostics

### Q1: Worker says `Account session is NOT authenticated`
- **Cause**: Profile cookies have expired, or `profileDir` is pointing to an empty path.
- **Fix**: Run `npm run account:setup <account_id>` in windowed mode to establish a valid session on `#mypage`.

### Q2: Port collision `Could not attach to Chrome on port 922x`
- **Cause**: Two accounts share the same port in `accounts.config.json`, or a previous process did not release the port.
- **Fix**: Ensure each account in `accounts.config.json` has a unique port (`9222`, `9223`, `9224`). Check active listeners with:
  ```powershell
  Get-NetTCPConnection -LocalPort 9222,9223 -ErrorAction SilentlyContinue
  ```

### Q3: How to run one account on my main screen and another in headless background?
- Launch Account 1 normally via `npm run gw-meat-light -- --account main 50`.
- In a second terminal, launch Account 2 in headless mode: `npm run gw-meat-light:headless -- --account alt1 50`.
- Both accounts will run concurrently without interference.
