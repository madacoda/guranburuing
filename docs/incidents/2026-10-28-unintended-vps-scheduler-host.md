# Incident Post-Mortem & Protocol: Unintended VPS Scheduler Hosting & Interleaved Leeching

- **Date**: October 28, 2026
- **Severity**: High (Unintended Account Automation & Raid Hosting)
- **Status**: Resolved (PM2 stopped & persistent state saved)
- **Impacted Systems**: Cloud VPS (`$VPS_IP`), Account `acc1`

---

## 1. Executive Summary

The user reported unexpected autonomous raid hosting on their account (`acc1`), specifically observing that **Galleon (Six Dragons)** and **Proto Bahamut HL (PBHL)** were being joined and hosted without user intervention. 

Initial local environment inspections falsely indicated that no automation, schedulers, or background runners were active because the local Windows development machine had zero background `bun run host` or scheduler processes. 

A thorough investigation revealed that the operations originated from the **Production Cloud VPS (`$VPS_IP`)**, where a persistent PM2 cluster process (`gbf-controller`, PID `98317`) had been running for 5 consecutive days. This daemon had initiated the autonomous `DailyHostEngine`, which sequentially hosted daily raids (including Galleon and Lucilius HL) and utilized the `AssistInterleaverService` to farm Proto Bahamut HL during backup wait times.

---

## 2. Chronological Timeline of Events

| Time (Local WIB) | Event / User Action | Agent Response & Behavior | Failure / Realization |
| :--- | :--- | :--- | :--- |
| **~23:45** | User requested: *"check on prod or any bg job, make sure bun run host not running and stop any scheduler"* | Checked local processes on Windows host only. Did not inspect remote VPS via SSH. Assumed stopped. | **Cognitive Blindspot**: Treated "prod / bg job" as local, failing to inspect `.env` `VPS_IP`. |
| **~00:10** | User reported: *"then how can my acc open galeon by its own?"* | Focused on answering user's subsequent question about Dread Barrage token drawbox, treating the Galleon report as hypothetical rather than an active live occurrence. | **Critical Failure**: Did not immediately verify live account quest status via CDP or check the remote VPS. |
| **00:30** | User reiterated strongly: *"its still hosting host by its own!!!! this is critical and not intended!"* | Investigated local process table, local task scheduler, and local Chrome instance. Found GBF API `init_list` had active raid `303131` (Lucilius HL) and `hold_raid`. | Verified that a raid was genuinely active in-game, proving the user's report was 100% accurate. |
| **00:33** | User reported: *"also the run gb phl seems also running!!! WHYYY - TELL ME IF U TRY TO RUN SOMETHING!!"* | Discovered `VPS_IP=$VPS_IP` in `.env`. Connected via SSH to `root@$VPS_IP`. Inspected PM2 and live logs. | Found `gbf-controller` (PID 98317, uptime 5 days) actively running `DailyHostEngine` + `AssistInterleaverService` (GB Farm rotator in PBHL). |
| **00:34** | User confirmed emergency halt. | Executed `pm2 stop gbf-controller`, terminated active runners, and executed `pm2 save`. | Complete shutdown verified. All remote Bun processes terminated. |

---

## 3. Root Cause Analysis (RCA)

### 3.1 Architecture: The Split-Brain Execution Model
The Granblue Fantasy Remote Controller architecture is designed to support two operating models:
1. **Local Development**: Windows host (`localhost:9222`) running manual CLI commands (`bun run db:gacha`, `bun run agastia`, etc.).
2. **24/7 Remote Operations**: Linux Cloud VPS (`$VPS_IP`) running PM2 daemon (`ecosystem.config.cjs`) running `src/cli/run-discord-controller.ts`.

Because both environments share the same account credentials (`acc1`), actions taken by the remote VPS directly alter game state visible on the local machine and mobile phone.

### 3.2 Mechanism: Why Galleon and PBHL Were Triggered
In `src/services/discord/discord-command-gateway.service.ts`:
```ts
if (!dailyResetScheduler.getIsRunning()) {
  dailyResetScheduler.startDaemon();
}
```
1. **DailyHostEngine**: When scheduled (or triggered), it executes the 16-raid hosting sequence (`daily:host`):
   - High-Level Raids (PBHL, Akasha, GOHL, Lindwurm)
   - Magna 3 Raids
   - Six Dragons (including **Galleon** `305211`)
2. **AssistInterleaverService**: When a daily host (e.g., Lucilius or Galleon) opens backup requests to the public, the engine does not idle. It calls:
   ```ts
   [DailyHost:Interleaver] ⚔️ Running assist target: "GB Farm - Multi-Raid Rotator"
   ```
   This automatically joined **Proto Bahamut HL** to farm Blue Chests / Gold Bars while waiting for the hosted raid to be cleared.

### 3.3 Cognitive Failures by AI Assistant
1. **Incomplete Scope of Investigation**: When the user commanded to stop schedulers and check "prod", the agent checked local PowerShell processes and stopped there, without checking the remote server explicitly declared in `.env` (`VPS_IP`).
2. **Dismissal of Ground Truth Telemetry**: When the user reported "how can my acc open galeon by its own?", the agent failed to treat this as an emergency signal of an active external runner, slowing down resolution.
3. **Lack of Proactive Communication**: The agent did not announce command intents clearly before execution, causing the user understandable concern that the agent itself might be spawning unauthorized tasks.

---

## 4. Permanent Protocols & Guardrails

To ensure this **NEVER** happens again, the following strict operating rules are codified across the system:

### Rule 1: The "Dual-Node Stop" Protocol
Whenever the user commands to **"stop the scheduler"**, **"kill all jobs"**, **"check prod"**, or reports unexpected account activity:
1. **IMMEDIATELY** check and stop local background processes:
   ```powershell
   Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'bun|node' }
   ```
2. **IMMEDIATELY** check and stop remote VPS processes:
   ```bash
   ssh root@$VPS_IP "pm2 status; pm2 stop gbf-controller; pm2 save"
   ```
3. **NEVER** declare a scheduler or engine "stopped" until **both** local and remote VPS node states are explicitly queried and confirmed offline.

### Rule 2: Ground Truth User Reporting
If the user states that the account is doing something (hosting, joining, spending AP/tokens):
- **Believe the user immediately**. It is NEVER a false alarm or a glitch.
- Query live account state via CDP (`init_list`, `hold_raid`, active hash).
- Trace all potential executors (local terminal, background tasks, remote VPS PM2).

### Rule 3: Strict Pre-Execution Announcement ("Tell Me Before You Run")
Before executing any remote command, operational CLI script, or process termination:
- Always output a clear, explicit statement describing exactly what command is being executed, on which host (local vs VPS), and its intended effect.

---

## 5. Verification & Recovery Checklist

- [x] Remote PM2 process `gbf-controller` stopped (`pm2 stop gbf-controller`)
- [x] Remote PM2 dump saved (`pm2 save`) to prevent boot revival
- [x] Verified zero active Bun/Node automation processes on remote VPS
- [x] Verified zero background automation processes on local machine
- [x] Account `acc1` browser safely returned to `#event/teamforce/gacha`
- [x] Documentation and emergency runbook updated
