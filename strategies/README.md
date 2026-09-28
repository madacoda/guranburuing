# Granblue Fantasy Automation Strategies & Knowledge Base

This directory houses the comprehensive architectural specifications, mathematical models, safety principles, operational commands, and workflow guides for the Granblue Fantasy Remote Controller and automation suite.

---

## Directory Navigation

### 1. [Principles & Core Specifications](file:///c:/laragon/www/gbf/strategies/principles)
In-depth engineering documents explaining the underlying theory, mathematical models, network architecture, and security protocols:

- **[01. System Architecture](file:///c:/laragon/www/gbf/strategies/principles/01_system_architecture.md)**: SPA structure, hash routing, authenticated session handling, and Chrome DevTools Protocol (CDP).
- **[02. Automation Mechanics](file:///c:/laragon/www/gbf/strategies/principles/02_automation_mechanics.md)**: Pro Skip execution, AP top-up, Raid Joiner finite state machine, and battle lifecycles.
- **[03. Anti-Detection & Safety Protocols](file:///c:/laragon/www/gbf/strategies/principles/03_anti_detection_and_safety.md)**: Threat modeling, Cygames detection vectors, in-game CAPTCHA verification, Sentinel Watchdog loop, and ban prevention.
- **[04. Remote Control Protocol](file:///c:/laragon/www/gbf/strategies/principles/04_remote_control_protocol.md)**: WebSocket command schemas, telemetry broadcasting, and mobile companion connectivity.
- **[05. Implementation Roadmap](file:///c:/laragon/www/gbf/strategies/principles/05_implementation_roadmap.md)**: Operational blueprints, PM2 daemon setup, and notification integrations.
- **[06. Combat Engine V1 & V2](file:///c:/laragon/www/gbf/strategies/principles/06_combat_engine_v1_v2.md)**: Turn cycles, V2 tactical engine (Omens, Guard, Fatal Chain), and Full Auto skill rules.
- **[07. Network API Reference](file:///c:/laragon/www/gbf/strategies/principles/07_network_api_reference.md)**: Reverse-engineered endpoints, headers, `X-VERSION` lifecycle, and error responses.
- **[08. Human Simulation Mathematics](file:///c:/laragon/www/gbf/strategies/principles/08_human_simulation_mathematics.md)**: Flash & Hogan minimum jerk trajectories, cubic Bézier splines, 2D Gaussian spatial jitter, log-normal reaction latencies, rapid multi-click kinematics, and randomized delay windows.
- **[09. Companion UI Specification](file:///c:/laragon/www/gbf/strategies/principles/09_companion_ui_spec.md)**: Mobile PWA ergonomics, live screencasting card, and emergency alert modals.
- **[10. Reference Implementation](file:///c:/laragon/www/gbf/strategies/principles/10_reference_implementation.md)**: Complete TypeScript modular reference implementation.
- **[11. Senior Engineering & Management Architecture](file:///c:/laragon/www/gbf/strategies/principles/11_senior_management_architecture.md)**: Executive topology, Clean Architecture tiering, DDD bounded contexts, 7-state FSM, and risk governance matrix.

---

### 2. [Workflows & Strategy Guides](file:///c:/laragon/www/gbf/strategies/workflows)
Step-by-step guides for specific in-game farming and quest routines:

- **[Proto Bahamut HL (PBHL) Gold Bar Hunter (`pbhl.md`)](file:///c:/laragon/www/gbf/strategies/workflows/pbhl.md)**:
  - Intelligent Finder scanning with 3s–15s randomized refresh on `#quest/assist` (4th slot).
  - Prioritized filtering (Priority 1: >70% HP & <=3/30, Priority 2: >=50% HP & <=4/30).
  - 10-Minute Timeout behavior (`⚠️ Currently PBHL is not optimal for raid gold bar`).
  - Tiered supporter priority (Hades 250 -> Baha 250 -> Hades any -> Dark first).
  - Combat rotation: Quick Call -> Nier S1+S2 on Ilsa -> Death summon -> Ilsa S1 -> optional Seox S1 (~35%) -> Attack loop until >= 1,480,000 pt with F5 reload.
  - Automatic pending battle cleanup, Gold Bar drop inspection, and logging to `logs/gb-pbhl.md`.
  - Granular turn-by-turn elapsed time logging and iteration performance metrics.
- **[Akasha HL Gold Bar Hunter (`akasha.md`)](file:///c:/laragon/www/gbf/strategies/workflows/akasha.md)**:
  - Finder 3rd slot scanning with identical priority filtering.
  - Double F5 animation skipping: Quick Summon (F5) -> Nier S1 -> Death Summon (F5) -> Yukata Ilsa S1 -> Attack loop until honors > 1,560,000 pt.
  - Automatic pending battle cleanup, Gold Bar drop inspection, and logging to `logs/gb-akasha.md`.
- **[Daily Pro Skips (`daily.md`)](file:///c:/laragon/www/gbf/strategies/workflows/daily.md)**:
  - 1-click execution for Hard Pro, Magna Pro, Manacura Pro, and Angel Halo Pro.
  - Automated AP replenishment with Half-Elixirs.
  - Sequential reward popup dismissal.
- **[Rise of the Beasts (`rotb.md`)](file:///c:/laragon/www/gbf/strategies/workflows/rotb.md)**:
  - Baihu repeat farming (`rotb:baihu`).
  - Automatic Shenxian / Titan Extreme+ unlock check and execution (`rotb:earth`).

---

### 3. [Operational Command Guide (`command.md`)](file:///c:/laragon/www/gbf/strategies/command.md)
Quick reference for all CLI commands, daemon scripts, environment flags, and troubleshooting steps.

---

### 4. [Scratch Sandbox & Diagnostic Registry](file:///c:/laragon/www/gbf/scratch/README.md)
Exhaustive inventory and governance policy for all 159 exploratory scripts, live DOM probes, test suites, and diagnostic screenshots.
