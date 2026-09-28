# Principle 04: Remote Control Protocol & Gateway Architecture

## 1. Executive Summary

To enable remote interaction with a local, authenticated Granblue Fantasy browser session from a smartphone, tablet, or external laptop, the system employs a **Decoupled Gateway Architecture**. 

The raw Chrome DevTools Protocol (CDP) port is **never** exposed to the internet. Instead, a lightweight local daemon acts as a secure reverse proxy and state manager, exposing an authenticated, encrypted WebSocket and REST interface tailored for mobile companion interaction.

---

## 2. Top-Level Network Topology & Security Model

```
+---------------------------------------------------------------------------------+
|                        Remote Device (Mobile Companion PWA)                     |
|  - Real-time status cards (Current Route, AP/EP, Boss HP, Honors)               |
|  - One-click trigger buttons (Magna Pro, Hard Pro, Raid Joiner)                 |
|  - Low-latency viewport stream (WebP screencast / snapshot)                     |
|  - Full-screen visual & haptic alarm on CAPTCHA detection                       |
+---------------------------------------------------------------------------------+
                                         |
                                         | Encrypted Transport:
                                         | WSS / HTTPS with Bearer Token
                                         | Over: Tailscale / WireGuard / LAN / Cloudflare Tunnel
                                         v
+---------------------------------------------------------------------------------+
|                         Local Controller & Gateway Daemon                       |
|  - Fastify / Hono WebSocket Server (Authentication, Rate Limiter)               |
|  - Finite State Machine Engine (Pro Skip Orchestrator, Raid Combat Loop)         |
|  - The Sentinel Watchdog (CAPTCHA detector & emergency halt trigger)            |
|  - Push Notification Relay (Telegram Bot API / Discord Webhook)                |
+---------------------------------------------------------------------------------+
                                         |
                                         | Loopback Only:
                                         | ws://127.0.0.1:9222/devtools/page/...
                                         | Chrome DevTools Protocol (CDP)
                                         v
+---------------------------------------------------------------------------------+
|                     Local Authenticated Google Chrome Instance                  |
|  - User Profile (--user-data-dir) with active Mobage/DMM session                |
|  - Hardware accelerated CreateJS canvas + DOM layer                             |
+---------------------------------------------------------------------------------+
```

### 2.1 Security & Access Control
* **Loopback Isolation**: Chrome debug port `9222` binds strictly to `127.0.0.1`.
* **Zero-Trust Token Authentication**: The Gateway requires an `Authorization: Bearer <SECRET_TOKEN>` header on initial HTTP handshake before upgrading to WebSocket.
* **Network Encapsulation**: Remote access is routed through a private mesh network (e.g., **Tailscale**, **WireGuard**) or a password-protected **Cloudflare Zero Trust Tunnel**, ensuring no open public ports.

---

## 3. Communication Protocol (JSON WebSocket Schemas)

Communication is asynchronous and full-duplex using structured JSON messages. Every packet contains a `type`, a `traceId` (UUIDv4), and a `timestamp`.

### 3.1 Inbound Commands (Client -> Daemon)

#### `CMD_TRIGGER_DAILY` (Execute Pro Skip)
```json
{
  "type": "CMD_TRIGGER_DAILY",
  "traceId": "c8a4d791-3b8e-4a62-b34e-012984712abc",
  "timestamp": 1725901200000,
  "payload": {
    "target": "magna_pro",          // "hard_pro" | "magna_pro" | "manacura_pro" | "halo_pro" | "all"
    "autoReplenishAp": true,        // Allow using half-elixirs if AP is insufficient
    "maxElixirs": 3
  }
}
```

#### `CMD_JOIN_RAID` (Join External Raid Code)
```json
{
  "type": "CMD_JOIN_RAID",
  "traceId": "d9b5e802-4c9f-5b73-c45f-123095823bcd",
  "timestamp": 1725901210000,
  "payload": {
    "raidCode": "7F3B29A1",
    "preferredSummon": "Omega",    // "Omega" | "Optimus" | "Elemental_250" | "Lucifer"
    "enableFullAuto": true,
    "autoReplenishEp": true
  }
}
```

#### `CMD_SET_COMBAT_MODE` (Adjust Combat State)
```json
{
  "type": "CMD_SET_COMBAT_MODE",
  "traceId": "e0c6f913-5da0-6c84-d560-234106934cde",
  "timestamp": 1725901220000,
  "payload": {
    "mode": "FULL_AUTO"            // "FULL_AUTO" | "SEMI_AUTO" | "MANUAL_PAUSE"
  }
}
```

#### `CMD_EMERGENCY_STOP` (Hard Freeze)
```json
{
  "type": "CMD_EMERGENCY_STOP",
  "traceId": "f1d7a024-6eb1-7d95-e671-345217045def",
  "timestamp": 1725901230000,
  "payload": {
    "reason": "User manual intervention"
  }
}
```

#### `CMD_SOLVE_CAPTCHA_COMPLETE` (Manual Resolution Signal)
```json
{
  "type": "CMD_SOLVE_CAPTCHA_COMPLETE",
  "traceId": "a2e8b135-7fc2-8ea6-f782-456328156efa",
  "timestamp": 1725901300000,
  "payload": {
    "verified": true
  }
}
```

---

### 3.2 Outbound Telemetry & Notifications (Daemon -> Client)

#### `EVENT_TELEMETRY` (Periodic State Broadcast)
Broadcast every 2000ms or upon significant state transitions:
```json
{
  "type": "EVENT_TELEMETRY",
  "timestamp": 1725901202000,
  "data": {
    "currentHash": "#raid",
    "engineState": "IN_COMBAT",    // "IDLE" | "NAVIGATING" | "IN_COMBAT" | "PRO_SKIP" | "LOCKED_CAPTCHA"
    "user": {
      "userId": "12345678",
      "ap": 842,
      "ep": 8
    },
    "combat": {
      "raidId": "98765432",
      "bossHpPercent": 48.7,
      "turn": 6,
      "fullAutoActive": true
    }
  }
}
```

#### `EVENT_CAPTCHA_TRIGGERED` (CRITICAL SENTINEL ALERT)
Dispatched immediately when the Sentinel detects a verification popup:
```json
{
  "type": "EVENT_CAPTCHA_TRIGGERED",
  "timestamp": 1725901250000,
  "data": {
    "severity": "CRITICAL",
    "message": "Visual verification puzzle detected! All automation frozen.",
    "screenshotBase64": "data:image/webp;base64,UklGRt4AAABXRUJQVlA4...",
    "timeoutSeconds": 300
  }
}
```

#### `EVENT_TASK_COMPLETE` (Task Outcome Report)
```json
{
  "type": "EVENT_TASK_COMPLETE",
  "timestamp": 1725901265000,
  "data": {
    "taskName": "MAGNA_PRO_SKIP",
    "status": "SUCCESS",           // "SUCCESS" | "FAILED" | "ALREADY_COMPLETED"
    "durationMs": 4200,
    "lootSummary": [
      { "item": "Tiamat Omega Anima", "count": 2 },
      { "item": "Colossus Omega Anima", "count": 3 }
    ]
  }
}
```

---

## 4. Viewport Streaming & Bandwidth Optimization

To allow remote monitoring over mobile cellular data without saturating uplink bandwidth:

1. **Adaptive WebP Screencast (CDP `Page.startScreencast`)**:
   * Format: `webp`, Quality: `60%`, Max Width: `480px`.
   * Frame Decimation: `everyNthFrame: 12` (yields ~2-3 frames per second, perfectly sufficient for turn-based monitoring).
   * Bandwidth footprint: **< 150 KB/s**.
2. **Snapshot-on-Change**:
   * Instead of continuous streaming, the daemon only captures a screenshot during state transitions (e.g., entered raid, turned on Full Auto, raid completed, or CAPTCHA detected).
   * Reduces mobile data usage to **< 500 KB per entire raid cycle**.
