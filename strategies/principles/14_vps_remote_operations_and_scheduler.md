# Principle 14: VPS Remote Operations, ChatOps Gateway & Autonomous Scheduler

## 1. Executive Summary & Production Objectives

Deploying Granblue Fantasy automation to a remote cloud VPS (Virtual Private Server) introduces strict operational requirements:
1. **Unattended Resilience**: The system must run continuously 24/7, automatically reboot on server restart, and self-heal from transient network or Chrome CDP disconnects.
2. **Zero Inbound Attack Surface**: No open HTTP/WebSocket ports should be exposed to the public internet, preventing brute-force unauthorized control of the player's account.
3. **Hardware & Resource Throttling**: The entire runtime must operate reliably within budget VPS tiers (1 vCPU, 1 GB – 2 GB RAM) without triggering Linux Out-Of-Memory (OOM) killer events.
4. **Operator ChatOps Control**: Full remote management (task triggering, job halting, live terminal log streaming, and scheduler toggling) directly from a private mobile or desktop Discord DM session.
5. **JST Reset Alignment**: Daily farming tasks must fire autonomously at the exact Granblue Fantasy server reset boundary (`05:00:15 JST`) with sub-second precision and anti-drift synchronization.

---

## 2. Zero-Inbound-Port Network Topology

Traditional server web dashboards expose ports (e.g. 80, 443, 3000) that demand TLS certificates, reverse proxies, and continuous firewall maintenance. 

Instead, the **Granblue Remote Controller** employs an **Outbound-Only ChatOps Gateway**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Ubuntu VPS Instance                             │
│                                                                             │
│   [Firewall: INBOUND BLOCKED]                                               │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      Unified VPS Daemon Process                     │   │
│   │                                                                     │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │            DiscordCommandGatewayService (Singleton)         │   │   │
│   │   │  • Initiates OUTGOING WebSocket to wss://gateway.discord.gg  │   │   │
│   │   │  • Subscribes strictly to Private DMs from DISCORD_USER_ID   │   │   │
│   │   │  • Discards all non-operator messages or bot echoes          │   │   │
│   │   └──────────────────────────────┬──────────────────────────────┘   │   │
│   │                                  │                                  │   │
│   │                                  ▼                                  │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │             ProcessRunnerService (Concurrency Gate)         │   │   │
│   │   │  • Exclusive Port 9222 Mutex Lock                           │   │   │
│   │   │  • Whitelist Command Spawner (No arbitrary shell injection) │   │   │
│   │   │  • Dual-Stream Logger (logs/automation.log + Memory Buffer) │   │   │
│   │   └──────────────────────────────┬──────────────────────────────┘   │   │
│   │                                  │                                  │   │
│   │                                  ▼                                  │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │             DailyResetScheduler (Autonomous Daemon)         │   │   │
│   │   │  • Mathematical 05:00:15 JST Countdown Loop                 │   │   │
│   │   │  • 5-Minute Advance Discord Warning Alerts                  │   │   │
│   │   │  • Anti-Duplicate Execution Guard (`lastExecutedGbfDay`)    │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Outgoing WSS TLS
                                       ▼
                         ┌───────────────────────────┐
                         │   Discord Gateway Cloud   │
                         └─────────────┬─────────────┘
                                       │ Mobile / Desktop Push
                                       ▼
                         ┌───────────────────────────┐
                         │   Operator Discord DM     │
                         └───────────────────────────┘
```

### Key Security Properties:
- **Zero Open Ports**: The VPS firewall keeps all inbound ports (`22` allowed only for SSH key authentication). No attacker can probe or attack the bot over HTTP/REST.
- **Operator Snowflake Verification**: Every incoming message must have `msg.author.id === config.DISCORD_USER_ID`. Bot messages and third-party users are silently dropped before parsing.
- **Strict Command Whitelist**: Input strings are mapped to predefined `COMMAND_WHITELIST` script presets. Arbitrary shell arguments are strictly disarmed.

---

## 3. Single-Process Concurrency & Mutex Locking

Chrome's Chrome DevTools Protocol (CDP) on port `9222` can only be reliably manipulated by **one automation engine at a time**. Concurrent automation scripts attempting to attach to the same target page cause `Target.attachedToTarget` race conditions, frame detachments, and silent navigation abortion.

To prevent this:
1. `ProcessRunnerService` maintains an atomic mutex state:
   ```ts
   if (this.activeJob) {
     return {
       success: false,
       message: `⚠️ Process Concurrency Lock: Job ${this.activeJob.key} (PID ${this.activeJob.pid}) is currently running.`
     };
   }
   ```
2. Any operator attempt to trigger a second workflow while one is active is immediately rejected with uptime and PID diagnostics.
3. The operator can send `/gbf stop` (or `/halt`) to dispatch `SIGINT` (with a 4-second escalation to `SIGKILL`) to cleanly unjam the process and unlock port `9222`.

---

## 4. Autonomous Daily Reset Scheduler

Granblue Fantasy resets its daily limits, pro skips, and daily raid hosts at **05:00:00 JST (UTC+9)** every morning.

### 4.1 Chronological Drift Compensation
System clocks drift and Cygames backend daily reset batch scripts take between 5 to 15 seconds to fully propagate across all Japanese database shards.

The scheduler computes the exact next reset target using:
```ts
export function getNextDailyResetJst(bufferSeconds = 15, referenceDate: Date = new Date()): { nextResetDate: Date; msRemaining: number } {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const nowJstMs = referenceDate.getTime() + jstOffsetMs;
  const nowJstDate = new Date(nowJstMs);

  let nextResetJstMs = Date.UTC(nowJstDate.getUTCFullYear(), nowJstDate.getUTCMonth(), nowJstDate.getUTCDate(), 5, 0, bufferSeconds);

  if (nowJstMs >= nextResetJstMs) {
    nextResetJstMs = Date.UTC(nowJstDate.getUTCFullYear(), nowJstDate.getUTCMonth(), nowJstDate.getUTCDate() + 1, 5, 0, bufferSeconds);
  }

  const nextResetRealUtcMs = nextResetJstMs - jstOffsetMs;
  return { nextResetDate: new Date(nextResetRealUtcMs), msRemaining: Math.max(0, nextResetRealUtcMs - referenceDate.getTime()) };
}
```

### 4.2 Scheduler Lifecycle States
```
     [Scheduler Initialized]
                │
                ├──► Send Advance Notification (5 mins before 05:00 JST)
                │
                ▼ (At 05:00:15 JST)
     [Acquire Concurrency Lock]
                │
                ├──► 1. Universal Pro Skips (Hard+, Omega, Halo, Primarch)
                ├──► 2. Skyscope Daily Missions & Rupie 100-Gacha
                ├──► 3. Casino Daily Elixir/Berry Recovery Exchange
                ├──► 4. 16-Raid Daily Host Suite (HL, Magna 3, Six Dragons)
                └──► 5. Self-Healing Diagnostic Retry Pass
                │
                ▼
     [Release Lock & Schedule Next Day]
```

### 4.3 On/Off Dynamic Control
Operators can toggle the background scheduler on the fly via Discord:
- `/gbf scheduler:off`: Suspends the timer. The bot will **not** trigger anything at 05:00 JST (useful during scheduled game maintenance or when the player is manually playing).
- `/gbf scheduler:on`: Resumes the countdown immediately and confirms the remaining hours/minutes until the next reset.

---

## 5. Discord Operator Command Reference

| Command | Shorthand | Description |
| :--- | :--- | :--- |
| `/gbf daily` | `/run daily` | Immediately launches the chained daily reset routine (Pro Skips → 16 Hosts → Retry). |
| `/gbf scheduler:off` | `/scheduler off` | Pauses autonomous 05:00 JST execution. |
| `/gbf scheduler:on` | `/scheduler on` | Resumes autonomous 05:00 JST execution. |
| `/gbf status` | `/status` | Returns busy/idle state, active job, uptime, scheduler state, and latest terminal output lines. |
| `/gbf stop` | `/halt` | Gracefully stops the active automation job and unlocks CDP port 9222. |
| `/gbf logs` | `/logs` | Displays the last 15 lines of live terminal output from `logs/automation.log`. |
| `/gbf reset` | `/reset` | Displays the exact countdown remaining until the next 05:00:15 JST reset. |
| `/run <preset>` | — | Runs any whitelisted preset (`gb-pbhl`, `gb-akasha`, `gb-go`, `gb-farm`, `fate`, `leech:colossus`, etc.). |
| `/gbf help` | `/help` | Displays the operator command manual. |

---

## 6. Process Supervision & 24/7 Resilience Runbook

To guarantee 24/7 continuous uptime on a VPS, processes must run under a process manager such as **PM2** or **Systemd**.

### 6.1 Recommended PM2 Setup
```bash
# 1. Install PM2 globally
npm install -g pm2

# 2. Start the unified daemon
pm2 start "bun run vps" --name "gbf-controller"

# 3. Configure auto-restart on system reboot
pm2 save
pm2 startup
```

### 6.2 Monitoring & Log Inspection on VPS
```bash
# View live streaming terminal logs from PM2:
pm2 logs gbf-controller

# Follow persistent automation disk logs:
tail -f logs/automation.log

# Inspect process status:
pm2 status
```

### 6.3 Native Systemd Service Alternative
Create `/etc/systemd/system/gbf-controller.service`:
```ini
[Unit]
Description=Granblue Fantasy Remote Controller Daemon
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/guranburuing
ExecStart=/root/.bun/bin/bun src/cli/run-discord-controller.ts
Restart=always
RestartSec=5
Environment=PATH=/root/.bun/bin:/usr/local/bin:/usr/bin:/bin
Environment=FORCE_COLOR=0

[Install]
WantedBy=multi-user.target
```
Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gbf-controller
sudo systemctl start gbf-controller
```

---

## 7. Dual-Track Telemetry & Disk Logging

Every stdout and stderr line emitted by spawned automation jobs is captured and recorded through two synchronized channels:
1. **Persistent Disk Ledger (`logs/automation.log`)**:
   - Every line is tagged with a human-readable UTC timestamp and the active preset key:
     ```text
     [2026-10-14 15:08:24] [daily] [StageModal] Navigating to Stage 12061 (HL Raids)...
     [2026-10-14 15:08:26] [daily] [DailyHost] Launching Wings of Terror (Impossible)...
     [2026-10-14 15:08:29] [daily] [TacticalCombat] Turn 1: Quick Summon (Lucifer 250)
     [2026-10-14 15:08:31] [daily] [Backup] Backup broadcast sent to Everyone.
     ```
2. **Circular Memory Ring Buffer (Last 50 Lines)**:
   - Preserved in RAM to provide sub-second responses when the operator sends `/gbf status` or `/gbf logs` from Discord without disk I/O thrashing.
3. **Exit Summary Webhook**:
   - When a job terminates (success or failure), an exit notification is dispatched with total duration and the final lines of error output if applicable.
