# Granblue Fantasy Automation Strategies & Knowledge Base

This directory houses the comprehensive architectural specifications, mathematical models, safety principles, operational commands, and workflow guides for the Granblue Fantasy Remote Controller and automation suite.

---

## Directory Navigation

### 1. [Principles & Core Specifications](./principles/README.md)
In-depth engineering documents explaining the underlying theory, mathematical models, network architecture, and security protocols:

- **[01. System Architecture](./principles/01_system_architecture.md)**: SPA structure, hash routing, authenticated session handling, and Chrome DevTools Protocol (CDP).
- **[02. Automation Mechanics](./principles/02_automation_mechanics.md)**: Pro Skip execution, AP top-up, Raid Joiner finite state machine, and battle lifecycles.
- **[03. Anti-Detection & Safety Protocols](./principles/03_anti_detection_and_safety.md)**: Threat modeling, Cygames detection vectors, in-game CAPTCHA verification, Sentinel Watchdog loop, and ban prevention.
- **[04. Remote Control Protocol](./principles/04_remote_control_protocol.md)**: WebSocket command schemas, telemetry broadcasting, and mobile companion connectivity.
- **[05. Implementation Roadmap](./principles/05_implementation_roadmap.md)**: Operational blueprints, PM2 daemon setup, and notification integrations.
- **[06. Combat Engine V1 & V2](./principles/06_combat_engine_v1_v2.md)**: Turn cycles, V2 tactical engine (Omens, Guard, Fatal Chain), and Full Auto skill rules.
- **[07. Network API Reference](./principles/07_network_api_reference.md)**: Reverse-engineered endpoints, headers, `X-VERSION` lifecycle, and error responses.
- **[08. Human Simulation Mathematics](./principles/08_human_simulation_mathematics.md)**: Flash & Hogan minimum jerk trajectories, cubic Bézier splines, 2D Gaussian spatial jitter, log-normal reaction latencies, rapid multi-click kinematics, and randomized delay windows.
- **[09. Companion UI Specification](./principles/09_companion_ui_spec.md)**: Mobile PWA ergonomics, live screencasting card, and emergency alert modals.
- **[10. Reference Implementation](./principles/10_reference_implementation.md)**: Complete TypeScript modular reference implementation.
- **[11. Senior Engineering & Management Architecture](./principles/11_senior_management_architecture.md)**: Executive topology, Clean Architecture tiering, DDD bounded contexts, 7-state FSM, and risk governance matrix.
- **[12. Discord Presence Architecture](./principles/12_discord_presence_architecture.md)**: Dual-Channel Live Rich Presence, WebSocket v10 bot gateway + local IPC named pipe telemetry.
- **[13. Authentication & Session Immunity](./principles/13_authentication_and_session_immunity.md)**: Mobage JSSDK cross-origin architecture, session immunity shield, CHIPS partitioning, FuelPHP REST content negotiation, and 0ms profile verification.
- **[14. VPS Remote Operations & Scheduler](./principles/14_vps_remote_operations_and_scheduler.md)**: Outbound Discord ChatOps gateway, dual-node control, PM2 survival, JST Strike Time scheduling.
- **[15. Human Behavioral Mimicry & Farming Cadence](./principles/15_human_behavioral_mimicry_and_farming_cadence.md)**: Multi-phase farming sessions, rest pauses, variety leeching, and supply maintenance.
- **[16. Live Battle DOM, Server Sync & Forensic Combat Diagnostics](./principles/16_gbf_live_combat_dom_and_diagnostics.md)**: Verified live selectors, `.btn-command-back.display-on` transitions, `pJsnData` vs `gGameStatus`, `{ popup, scenario: [] }` lockout rejection, Death/swap cascades, GW pending cap, and `step:audit` triage playbook.

---

### ⭐ [Root Cause Analysis: Authentication Failures vs. Success Blueprint](./AUTH_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md)
Exhaustive post-mortem and technical breakdown of the 6 root causes behind local Chrome session kickouts, setup verification hangs, and headless cookie failures, along with the 5 architectural fixes that made local automation 100% stable.

### ⭐ [Root Cause Analysis: Combat Failures, Success Factors & Verification Guardrails](./COMBAT_FAILURE_ROOT_CAUSES_AND_SOLUTIONS.md)
Evidence-backed post-mortem of Guild War & combat automation failures (`.lis-summon` false-open, Death/Nier swap cascades, Quick Call double-tap/false-confirm, `{ popup, scenario: [] }` lockout rejections, GW fatal enforcement, open per-step audit ledger flush scaling), paired with Success vs. Failure Factors and the False Positive / False Negative matrix.

### 2. [Workflows & Strategy Guides](./workflows)
Step-by-step guides for specific in-game farming and quest routines:

- **[Proto Bahamut HL (PBHL) Gold Bar Hunter (`pbhl.md`)](./workflows/pbhl.md)**:
  - Intelligent Finder scanning with 3s–15s randomized refresh on `#quest/assist` (4th slot).
  - Prioritized filtering (Priority 1: >70% HP & <=3/30, Priority 2: >=50% HP & <=4/30).
  - 10-Minute Timeout behavior (`⚠️ Currently PBHL is not optimal for raid gold bar`).
  - Tiered supporter priority (Hades 250 -> Baha 250 -> Hades any -> Dark first).
  - Combat rotation: Quick Call -> Nier S1+S2 on Ilsa -> Death summon -> Ilsa S1 -> optional Seox S1 (~35%) -> Attack loop until >= 1,480,000 pt with F5 reload.
  - Automatic pending battle cleanup, Gold Bar drop inspection, and logging to `logs/gb-pbhl.md`.
  - Granular turn-by-turn elapsed time logging and iteration performance metrics.
- **[Akasha HL Gold Bar Hunter (`akasha.md`)](./workflows/akasha.md)**:
  - Finder 3rd slot scanning with identical priority filtering.
  - Double F5 animation skipping: Quick Summon (F5) -> Nier S1 -> Death Summon (F5) -> Yukata Ilsa S1 -> Attack loop until honors > 1,560,000 pt.
  - Automatic pending battle cleanup, Gold Bar drop inspection, and logging to `logs/gb-akasha.md`.
- **[Daily Pro Skips (`daily.md`)](./workflows/daily.md)**:
  - 1-click execution for Hard Pro, Magna Pro, Manacura Pro, and Angel Halo Pro.
  - Automated AP replenishment with Half-Elixirs.
  - Sequential reward popup dismissal.
- **[Rise of the Beasts (`rotb.md`)](./workflows/rotb.md)**:
  - Baihu repeat farming (`rotb:baihu`).
  - Automatic Shenxian / Titan Extreme+ unlock check and execution (`rotb:earth`).
- **[Replicard Sandbox: Zone Goliath Stage 3 (`replicard-stage-3-goliath.md`)](./workflows/replicard-stage-3-goliath.md)**:
  - Universal Stage 3 map controller (`#replicard/stage/3`), Goliath Triune (Zone Boss, Earth), Avatar of Avarice (The Hanged Man), Goliath Keeper (The Tower), and Frenzied Howler (Death).
  - Smart Full Auto with 350ms wait & reload animation skip, AAP replenishment, and host material farming.
- **[Replicard Sandbox: The World (`theworld.md`)](./workflows/theworld.md)**:
  - Final core boss in Zone Mundus (Stage 10), plain damage omen cancellation via Beelzebub call, and New World Quartz farming.

---

### 3. [Operational Command Guide (`command.md`)](./command.md)
Quick reference for all CLI commands, daemon scripts, environment flags, and troubleshooting steps.

---

### 4. [Scratch Sandbox & Diagnostic Registry](../scratch/README.md)
Exhaustive inventory and governance policy for all 159 exploratory scripts, live DOM probes, test suites, and diagnostic screenshots.
