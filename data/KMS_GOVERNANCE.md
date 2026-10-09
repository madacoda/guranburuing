# Granblue Fantasy Knowledge Management System (KMS) Governance Standard

**Version:** 2.0.0  
**Status:** Approved Architectural Standard  
**Authority:** Senior Principal Systems Architect  
**Target Repository:** `C:\laragon\www\gbf\data\`

---

## 1. Executive Summary & Purpose

The Granblue Fantasy Knowledge Management System (`data/`) serves as the authoritative, versioned Single Source of Truth (SSOT) for all gameplay constants, combat physics, damage formulas, network contracts, DOM selectors, V2 omen triggers, and cognitive decision trees.

This document formalizes the **10 Golden Principles of KMS Governance**, ensuring zero drift, strict relational integrity, schema-first enforcement, and absolute security across automated workflows.

---

## 2. The 10 Golden Principles of Local KMS Architecture

### Principle 1: Schema-First Authority (Draft 2020-12)
No data file shall exist in `data/` without an authoritative JSON Schema located in `data/schemas/`. Every dataset must declare its matching `$schema` URI in its root metadata.

### Principle 2: Strict Separation of Static Knowledge vs. Transient State
The `data/` directory is an immutable, version-controlled knowledge base.
- **FORBIDDEN IN KNOWLEDGE REPO**: Session tokens, temporary SQLite database dumps (`*.db`), browser profiles, scratch files, and logs.
- **SENSITIVE CREDENTIAL POLICY**: Session tokens (`*-cookies.json`) are strictly ignored via `.gitignore` and protected by Apache `.htaccess`. Production VPS deployments consume credentials exclusively via headless memory injection or environment variables (`GBF_SESSION_COOKIE`).

### Principle 3: Semantic Versioning & Metadata Contract
Every authoritative JSON catalog must include top-level metadata:
```json
{
  "$schema": "../schemas/<subsystem>.schema.json",
  "version": "2.0.0",
  "generatedAt": "2026-10-08T00:00:00.000Z",
  "description": "Clear human-readable description of domain scope."
}
```

### Principle 4: Deterministic O(1) Indexing
Data is structured to allow direct map lookups in TypeScript services (`DataCatalogService`):
- Raids indexed by both `id` (`pbhl`) and numeric `questId` (`301061`).
- Elements indexed by internal ID (`1`–`6`) and slug (`fire`, `water`, etc.).
- Modals indexed by functional identifier (`stage_detail_modal`).
- Routes indexed by Backbone hash fragment (`#quest/multi/0`).

### Principle 5: Relational Integrity Across Subsystems
Cross-references between subsystems must resolve to valid primary keys:
- Every `raidId` referenced in `combat/omens.catalog.json` or `raids/raid-join-decision.json` must exist in `raids/raids.catalog.json`.
- Every `element` string must exist in `elements/elements.catalog.json`.
- Every `questType` referenced in `combat/supporter-summons.catalog.json` must have a defined handler.

### Principle 6: Fail-Safe Safety Interlocks
Any cognitive decision tree that controls high-stakes actions must encode hardware-style safety interlocks:
- **Zombified Safety Interlock**: Completely locks all potion and heal commands when Zombified status is detected, preventing self-inflicted party wipes.
- **Repel / 100% Cut Halt**: Pauses normal attack queues when reflect or absolute barrier buffs are active.
- **3-Assist Limit Unjamming**: Prevents issuing join requests when 3 active or 5 pending raids are unresolved.

### Principle 7: Domain-Driven Modular Partitioning
Data is segregated strictly by domain boundary:
- `raids/`: Multi-boss constants, stages, chapters, and drop probabilities.
- `combat/`: Mechanics, V1 vs V2, omens, counter taxonomy, plain damage, status effects, supporter selection, and action priorities.
- `elements/`: 7-Element matrix, multipliers, and party selection heuristics.
- `ui/`: DOM selectors, modal overlays, and Backbone.js client routes.
- `network/`: HTTP REST specifications, auth gateways, and Akamai CDN layouts.
- `automation/`: Daily routines, pro-skips, and anti-detection kinematics.
- `events/`: Collaboration events, scenario events, Master Events Registry, and treasure trade optimization.

### Principle 8: Cognitive Decision Engine Independence
Decision logic is encoded in declarative JSON trees rather than hardcoded in imperative TypeScript. Modifying a counter strategy, adjusting an HP join threshold, or updating a blue chest target requires **zero code changes or recompilations**.

### Principle 9: Dual Documentation & Machine Synchronization
Every technical research volume (`data/*.md`) corresponds to structured JSON catalogs in `data/`. When game mechanics are rebalanced, both the human-facing markdown volume and the machine-readable catalog must be updated atomically.

### Principle 10: Automated CI Verification & Zero-Warning Mandate
The integrity of the KMS is defended by automated test assertions:
- All catalogs parse as valid JSON.
- Every declared `$schema` file physically exists and validates.
- TypeScript compiler (`tsc`) passes with zero errors.
- Unified test runner passes all regression suites with 100% success.

---

## 3. Directory Layout & Ontology Map

```text
data/
├── KMS_GOVERNANCE.md                    # This document (Architecture & Standards)
├── README.md                            # Comprehensive Developer Guide & Volume Index
├── index.json                           # Unified Master Catalog & Backward Compatibility Layer
├── presence-mode.json                   # Discord RPC Status
├── schemas/                             # JSON Schemas (Draft 2020-12)
│   ├── raid-catalog.schema.json         # Schema: Raids & Quests
│   ├── categories.schema.json           # Schema: Raid Categories
│   ├── drop-tables.schema.json          # Schema: Drops & Blue Chest Probabilities
│   ├── raid-evaluation.schema.json      # Schema: Join Heuristics & TTD
│   ├── selectors.schema.json            # Schema: DOM HUD & Selectors
│   ├── modals.schema.json               # Schema: Modal Dialogs & Overlays
│   ├── navigation-routes.schema.json    # Schema: Backbone.js Hash Routes
│   ├── endpoints.schema.json            # Schema: REST APIs & Headers
│   ├── auth-and-login.schema.json       # Schema: Platform Gateways & Cookies
│   ├── cdn-assets.schema.json           # Schema: Akamai CDN Assets
│   ├── combat-physics.schema.json       # Schema: Lockout & Damage Formulas
│   ├── battle-systems.schema.json       # Schema: V1 vs V2 Architecture
│   ├── omens-catalog.schema.json        # Schema: V2 Omens & Resolvers
│   ├── plain-damage-catalog.schema.json # Schema: Plain DMG Sources & Pipeline
│   ├── status-effects-catalog.schema.json # Schema: Buffs, Debuffs & Interlocks
│   ├── supporter-summons.schema.json    # Schema: Grid Archetypes & Tab Routing
│   ├── tactical-action-priority.schema.json # Schema: Combat Action Priority
│   ├── element-catalog.schema.json      # Schema: Elemental Attributes & Matrix
│   ├── daily-catalog.schema.json        # Schema: Daily Pro Skips & Routines
│   ├── anti-detection.schema.json       # Schema: Biomechanical Motor Kinematics
│   ├── recovery-policies.schema.json    # Schema: Resource & Session Recovery
│   ├── battle-reload-profiles.schema.json # Schema: Combat Reload & CreateJS Acceleration
│   ├── event-automation.schema.json     # Schema: Scenario Events & Token Drawbox
│   ├── cooldown-and-pacing.schema.json  # Schema: Server Cooldowns & Rest Schedules
│   ├── multi-account-orchestration.schema.json # Schema: CDP Port & Topology
│   ├── state-machine-recovery.schema.json # Schema: State Machine & Error Self-Healing
│   ├── sentinel-watchdog.schema.json    # Schema: CAPTCHA Tripwires & Escalation
│   ├── events.schema.json               # Schema: Master Events Catalog & Schedules
│   ├── event-detail.schema.json         # Schema: Detailed Collaboration & Scenario Events
│   ├── event-farming-optimizer.schema.json # Schema: Event Farming Decision Trees
│   ├── side-stories.schema.json         # Schema: Permanent Side Story Vault & Spark Calculations
│   └── side-story-optimizer.schema.json # Schema: Side Story Farming Priorities & Pacing
├── raids/                               # Raids Subsystem
├── events/                              # Events Subsystem (Master & Detailed Event Catalogs)
│   ├── events.catalog.json              # Master Registry of All Events
│   ├── biography045-gintama.catalog.json# Authoritative Gintama Collaboration Catalog
│   ├── event-farming-optimizer.json    # Algorithmic Event Farming Decision Tree
│   ├── side-stories.catalog.json        # Permanent Side Story Vault (56 Stories, 8 Sagas)
│   └── side-story-optimizer.json        # Side Story Speed-Clearing & Spark Acceleration Tree
├── combat/                              # Combat Subsystem
├── elements/                            # Elements Subsystem
├── ui/                                  # UI & Navigation Subsystem
├── network/                             # Network & Protocol Subsystem
└── automation/                          # Automation & Operational Resilience Subsystem (9 Catalogs)
```

---

## 4. Runbook: Adding or Modifying Knowledge Data

1. **Schema Check**: If adding a new field, update the corresponding file in `data/schemas/*.schema.json` first.
2. **Catalog Update**: Edit the target JSON file in its domain subsystem folder.
3. **TypeScript Synchronization**: Update `src/domain/data/data-catalog.types.ts` and `src/domain/data/data-catalog.service.ts` if exposing new query methods.
4. **Master Index**: Add the file reference to `data/index.json` under `architecture.modules`.
5. **Validation**: Execute:
   ```bash
   bun tests/test-data-catalog-architecture.ts
   bun run build
   bun run test
   ```
