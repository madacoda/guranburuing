# Granblue Fantasy Remote Controller & Automation Principles

This repository directory contains the comprehensive, production-grade architectural specification, reverse-engineered API catalog, human motor simulation models, safety protocols, and reference implementation for controlling an authenticated Granblue Fantasy (`game.granbluefantasy.jp`) browser session remotely and automating daily/raid tasks.

---

## Complete Document Index

| # | Document | Title & Focus | Key Topics |
| :---: | :--- | :--- | :--- |
| **01** | **[System Architecture](./01_system_architecture.md)** | **Web Runtime & Remote Topologies** | Backbone.js SPA structure, hash routing (`#mypage`, `#quest`), REST/JSON APIs, session authentication, CDP vs Extension vs WebRTC. |
| **02** | **[Automation Mechanics](./02_automation_mechanics.md)** | **Daily Pro Skip & Raid Combat Workflows** | Hard/Magna/Manacura/Halo Pro Skip execution, AP top-up, Raid Joiner FSM, Full Auto (FA) activation, battle lifecycle. |
| **03** | **[Anti-Detection & Safety](./03_anti_detection_and_safety.md)** | **Threat Modeling & Ban Prevention** | Cygames detection vectors, image CAPTCHAs, behavioral entropy (Gaussian delay, jittered click coordinates), Sentinel Watchdog pattern. |
| **04** | **[Remote Protocol & Gateway](./04_remote_control_protocol.md)** | **Remote Control Network Architecture** | WebSocket command schema, telemetry broadcasting, live viewport streaming (Screencast / Snapshot), mobile PWA companion. |
| **05** | **[Implementation Roadmap](./05_implementation_roadmap.md)** | **Execution Blueprint & Operations** | Node.js / Bun + `puppeteer-core` implementation, Chrome profile attachment, PM2 daemon, Telegram / Discord alert integration. |
| **06** | **[Combat Engine V1 & V2](./06_combat_engine_v1_v2.md)** | **Battle Systems & Full Auto Rules** | Classic turn cycle vs V2 tactical engine (Omens, Guard, Fatal Chain), Full Auto skill color hierarchy, targeted skill exclusions. |
| **07** | **[Network API Reference](./07_network_api_reference.md)** | **Reverse-Engineered Endpoint Catalog** | Endpoints (`/user/status`, `/quest/pro_skip/play`, `/rest/multiraid/...`), `X-VERSION` lifecycle, headers, and error codes. |
| **08** | **[Human Simulation Mathematics](./08_human_simulation_mathematics.md)** | **Kinematics & Biological Latency** | Fitts's Law, Flash & Hogan minimum jerk hypothesis, cubic Bézier spline interpolation, 2D Gaussian spatial jitter, log-normal delays. |
| **09** | **[Mobile Companion UI Spec](./09_companion_ui_spec.md)** | **PWA Cockpit & Ergonomics** | Thumb-zone wireframes, resource gauges, live WebP screencast card, one-touch macro grid, emergency CAPTCHA full-screen alarm. |
| **10** | **[Reference Implementation](./10_reference_implementation.md)** | **Production-Grade TypeScript Codebase** | Modular code: CDP connection manager, human motor driver, Sentinel watchdog, Pro Skip engine, Raid joiner engine, Fastify gateway. |
| **11** | **[Senior Management Architecture](./11_senior_management_architecture.md)** | **Autonomous Swarm & Enterprise Ops** | Universal engine orchestrator, DSL compiler, multi-account isolation, drop auditing, recovery state machines. |
| **12** | **[Discord Presence Architecture](./12_discord_presence_architecture.md)** | **Dual-Channel Live Rich Presence** | Bot Gateway v10 + Desktop IPC named pipe, real-time battle telemetry, daily/session Gold Bar tracking, rate limit immunity. |
| **13** | **[Authentication & Session Immunity](./13_authentication_and_session_immunity.md)** | **Mobage JSSDK Architecture & Kickout Immunity** | Cross-origin `session_iframe` mechanics, capture-phase `postMessage` interception, CHIPS cookie partitioning, FuelPHP REST negotiation, and 0ms `#mypage` profile verification. |
| **14** | **[VPS Remote Operations & Scheduler](./14_vps_remote_operations_and_scheduler.md)** | **Zero-Inbound ChatOps & Autonomous Scheduler** | Discord outbound gateway, exclusive CDP port lock, PM2 daemon survival, JST Strike Time scheduling, dual-node audit protocol. |
| **15** | **[Human Behavioral Mimicry & Cadence](./15_human_behavioral_mimicry_and_farming_cadence.md)** | **Organic Farming Cadence & Maintenance** | Multi-phase farming sessions, rest intervals, variety leeching, menu/inventory visits, monthly supply shop purchases. |
| **16** | **[Live Battle DOM, Server Sync & Diagnostics](./16_gbf_live_combat_dom_and_diagnostics.md)** | **Verified Combat Selectors & Step Audit Triage** | `.btn-command-back.display-on` drawer vs summon tray transitions, `pJsnData` vs `gGameStatus`, `{ popup, scenario: [] }` lockout rejection, Death/swap cascades, GW pending cap, `step:audit` root-cause playbook. |

---

## Core Operational Tenets

1. **Leverage Existing Authenticated Session**: By attaching to Google Chrome via Chrome DevTools Protocol (CDP) on `--remote-debugging-port=9222`, no user credentials or multi-factor OAuth tokens are handled in plaintext, and genuine browser fingerprints (GPU, audio, WebGL) are preserved.
2. **The Human-in-the-Loop Sentinel**: Never attempt unattended CAPTCHA cracking. If a verification modal appears, immediately freeze automation and push an emergency alert with a high-resolution screenshot to the user's mobile device for manual resolution.
3. **Use Native In-Game Full Auto**: Let the official game client handle combat abilities and attack cadence during raids, avoiding suspicious high-speed API spamming.
4. **Biologically Plausible Motor Simulation**: All mouse interactions must respect minimum jerk velocity curves, 2D Gaussian spatial jitter, and log-normal temporal distributions.
5. **Idempotent State Machines**: State transitions must be driven by DOM readiness and hash changes, not fragile hardcoded sleep timers.
