# Granblue Fantasy Remote Controller & Automation — Master Task Breakdown

## 1. Project Overview & Objective

The objective of this engineering plan is to construct a **production-grade, battle-tested, secure, and human-mimetic remote controller and automation system** for Granblue Fantasy (`game.granbluefantasy.jp`).

The application enables a player to remotely trigger **1-click daily Pro Skips (Hard Pro, Magna Pro, etc.)**, **join raids with external backup codes**, and **run in-game Full Auto (FA)** from a mobile companion PWA while away from their desktop PC.

The system is built upon the foundational research established in [strategies/principles](file:///c:/laragon/www/gbf/strategies/principles).

---

## 2. Work Breakdown Structure (WBS) & Task Matrix

```
+---------------------------------------------------------------------------------------------------+
|                                     Master Task Dependency Graph                                  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  [Task 01: Environment & CDP Foundation]                                                          |
|         |                                                                                         |
|         +---> [Task 02: Human Motor Simulation Library]                                           |
|         |            |                                                                            |
|         |            v                                                                            |
|         +---> [Task 03: Sentinel Watchdog & Alert Relay]                                          |
|                      |                                                                            |
|                      +------------------------+                                                   |
|                      |                        |                                                   |
|                      v                        v                                                   |
|       [Task 04: Daily Pro Skip Engine]   [Task 05: Raid Joiner & Combat Engine]                   |
|                      |                        |                                                   |
|                      +------------------------+                                                   |
|                                  |                                                                |
|                                  v                                                                |
|               [Task 06: Remote Gateway & WebSocket Server]                                        |
|                                  |                                                                |
|                                  v                                                                |
|               [Task 07: Mobile Companion PWA Frontend]                                            |
|                                  |                                                                |
|                                  v                                                                |
|               [Task 08: E2E Integration & Operations]                                             |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

### Complete Task Index & Implementation Status

- [x] **[Task 01: Environment & CDP Foundation](file:///c:/laragon/www/gbf/strategies/tasks/task_01_environment_and_cdp_foundation.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `package.json`, `tsconfig.json`, `scripts/launch-gbf-chrome.ps1`, `src/config.ts`, `src/cdp-connection.ts`
  - **Verification**: Dedicated Chrome profile mapped via CDP connection manager implemented with anti-throttling flags and conflict management.
- [x] **[Task 02: Human Motor Simulation Library](file:///c:/laragon/www/gbf/strategies/tasks/task_02_human_motor_simulation_library.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `src/human-motor.ts`, `tests/test-human-motor.ts`
  - **Verification**: `bun run tests/test-human-motor.ts` PASSED. Continuous cubic Bézier cursor tracking, 2D Gaussian spatial jitter within inner 60%, log-normal reaction latencies.
- [x] **[Task 03: Sentinel Watchdog & Alert Relay](file:///c:/laragon/www/gbf/strategies/tasks/task_03_sentinel_watchdog_and_alert_relay.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `src/sentinel-watchdog.ts`, `src/alert-relay.ts`, `tests/test-sentinel-alert.ts`
  - **Verification**: `bun run tests/test-sentinel-alert.ts` PASSED. Real-time DOM/canvas CAPTCHA detector (`.img-verification`), emergency hard freeze, 60s alert rate-limiting, and Telegram/Discord push relay.
- [x] **[Task 04: Daily Pro Skip Engine](file:///c:/laragon/www/gbf/strategies/tasks/task_04_daily_pro_skip_engine.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `src/engines/pro-skip.engine.ts`, `tests/test-pro-skip-unit.ts`
  - **Verification**: `bun run tests/test-pro-skip-unit.ts` PASSED. Island Extra navigation, 0/1 completion state check, Half-Elixir AP replenishment, and multi-modal sequential dismiss loop (`dismissAllPopups`).
- [x] **[Task 05: Raid Joiner & Combat Engine](file:///c:/laragon/www/gbf/strategies/tasks/task_05_raid_joiner_and_combat_engine.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `src/engines/raid.engine.ts`, `tests/test-raid-engine-unit.ts`
  - **Verification**: `bun run tests/test-raid-engine-unit.ts` PASSED. Assist code input, supporter summon elemental tabs (Fire to Dark), pending battle limits check, party wipeout detection, and anti-hang refresh watchdog.
- [x] **[Task 06: Remote Gateway & WebSocket Server](file:///c:/laragon/www/gbf/strategies/tasks/task_06_remote_gateway_and_websocket_server.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `src/gateway/server.ts`, `src/gateway/screencast.ts`, `tests/test-gateway-server.ts`
  - **Verification**: `bun run tests/test-gateway-server.ts` PASSED. Fastify HTTP & WebSocket gateway, Bearer token auth, **Async Mutex concurrency lock**, keepalive pings, static file serving, and screencast backpressure throttling.
- [x] **[Task 07: Mobile Companion PWA Frontend](file:///c:/laragon/www/gbf/strategies/tasks/task_07_mobile_companion_pwa_frontend.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `public/index.html`, `public/manifest.json`
  - **Verification**: Verified via HTTP GET `/` and `/manifest.json` in test suite. Single-file responsive PWA cockpit, thumb-zone macro buttons, live stream canvas, Web Audio unlock on touch, Screen Wake Lock API, and emergency CAPTCHA alarm overlay.
- [x] **[Task 08: E2E Integration & Operations](file:///c:/laragon/www/gbf/strategies/tasks/task_08_end_to_end_integration_and_deployment.md)**
  - **Status**: `[x]` Implemented & Verified
  - **Deliverables**: `src/index.ts`, `ecosystem.config.js`, `scripts/start-daemon.ps1`, `tests/smoke-test.ts`
  - **Verification**: `bun run tests/smoke-test.ts` PASSED. Full TypeScript `tsc` build clean (exit code 0). Automated pre-flight smoke tests passed. Ready for production deployment.

---

## 3. Battle-Tested Production Highlights

This task breakdown addresses the critical real-world failure points encountered when automating Chromium and Granblue Fantasy:

1. **Chromium 111+ Remote Origin Rejections**: Fixed via `--remote-allow-origins=*` in Task 01.
2. **Windows Chrome Process Conflicts**: Task 01 detects if Chrome is running without port 9222 and offers automatic restart.
3. **Background Timer Throttling**: Fixed via `--disable-background-timer-throttling` and `--disable-backgrounding-occluded-windows`.
4. **Off-Screen Click Misses**: Task 02 enforces `scrollIntoView()` before computing target coordinates.
5. **Cursor Teleportation**: Task 02 tracks persistent cursor position across all calls.
6. **Alert Spamming**: Task 03 enforces a 60-second cooldown on Telegram/Discord notifications.
7. **Stacked Modal Hangs**: Task 04 implements a sequential dismiss loop handling up to 5 consecutive dialogs (Loot -> Level Up -> Rank Up).
8. **Summon Element Mismatch**: Task 05 switches to the correct elemental tab (1 to 7) before selecting supporter summons.
9. **Combat Animation Locks**: Task 05 incorporates an automatic 60-second desync refresh watchdog.
10. **Race Conditions**: Task 06 implements an Async Mutex so concurrent commands cannot collide.
11. **Mobile Audio Restrictions**: Task 07 unlocks the Web Audio context on the user's first touch.
12. **Stale Lock Hangs**: Task 08 cleans up any orphaned Chrome `SingletonLock` files before starting.

info:
Ensure the target browser profile has valid authenticated sessions (cookies) before launching automated routines.