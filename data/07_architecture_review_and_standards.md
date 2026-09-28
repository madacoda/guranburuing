# Volume 7: Architecture Review, Root-Cause Analysis & Gold Standards

## 1. Executive Summary & Root-Cause Analysis

### 1.1 The Inquiry: "Why Were There Many Image Files in `logs/`?"
During operational monitoring, the user observed numerous `.png` files accumulated inside `c:\laragon\www\gbf\logs\` alongside markdown execution ledgers (`logs/workflow-acc1-gw-meat-farm---light-ex-.md`, `logs/gw-meat-light.md`).

A comprehensive forensic audit of the repository revealed the exact root cause:

```
[Diagnostic Reverse-Engineering]
  - scratch/capture-glow-real.ts
  - scratch/test-tap-ready-exact.ts
  - scratch/test-click-auto.ts
  - scratch/test-attack2.ts
  - scratch/test-ready-reload-glow.ts
  - 9 other diagnostic scratch scripts
            |
            | Hardcoded screenshot destinations:
            | await page.screenshot({ path: 'logs/tap-now-frame-1.png' })
            v
+--------------------------------------------------------------------------+
|                        Directory Pollution in logs/                      |
|                                                                          |
|   36 loose PNG images (~13 MB) dumped into logs/ root:                   |
|   - after-attack-zepto.png, after-card-click.png, after-test-attack.png  |
|   - click-auto-frame-1.png through frame-5.png                           |
|   - exact-frame-1.png through frame-6.png                                |
|   - glow-test-frame-1.png through frame-8.png                            |
|   - tap-now-frame-1.png through frame-8.png                              |
|                                                                          |
|   Mixed directly with legitimate operational logs:                       |
|   - logs/workflow-acc1-gw-meat-farm---light-ex-.md                      |
|   - logs/gw-meat-light.md, logs/gb-pbhl.md, logs/gb-akasha.md            |
+--------------------------------------------------------------------------+
```

### 1.2 The Forensic Findings
1. **Purpose of the Images**:
   - The images were high-frequency frame-by-frame diagnostic captures taken to reverse-engineer GBF's canvas timing, specific DOM glow states on the "Ready" combat screen, the Zepto `.trigger('tap')` behavior, and the Auto-Attack button state transitions.
2. **Why They Were Placed in `logs/`**:
   - In early development phases, developers used `logs/` as an unconstrained output directory for both text logs and binary screenshot dumps.
   - Because there was no centralized `ArtifactManager` with directory routing, 14 exploratory scratch scripts wrote `.png` files directly to `logs/`.
3. **Architectural Deviation**:
   - In **Gold Industry Standard Architecture**, dumping binary image assets into the root of an operational text logging directory violates the **Separation of Concerns (SoC)** principle, pollutes file browsing, bloats git status tracking, and risks disk exhaustion.

---

## 2. Remediation & Upgrades Executed

### 2.1 File System Sanitization
- All **36 loose PNG files** (~13 MB) were immediately relocated from `logs/` to an isolated namespace:
  `c:\laragon\www\gbf\scratch\captures\debug-frames/`
- `logs/` is now **100% clean**, strictly housing human-readable markdown logs and structured JSONL event streams.

### 2.2 Scratch Script Modernization
- All 14 scratch scripts (`scratch/capture-glow-real.ts`, `scratch/test-tap-ready-exact.ts`, `scratch/test-click-auto.ts`, etc.) were refactored to target `scratch/captures/debug-frames/` instead of `logs/`.
- Future executions of diagnostic or exploratory scripts will **never pollute `logs/`**.

### 2.3 Centralized `ArtifactManager` Implementation
A dedicated enterprise-grade service, [`ArtifactManager`](file:///c:/laragon/www/gbf/src/core/artifact-manager.ts), was introduced:
- **Namespaced Path Generation**: Organizes visual captures into `scratch/captures/<namespace>/<timestamp>_<label>.png` (or `logs/screenshots/` if specified).
- **Automated Directory Provisioning**: Transparently creates destination paths if non-existent.
- **Quota & Retention Pruning**: Automatically prunes older screenshots when a namespace exceeds a configurable threshold (default: 50 files), preventing unbounded disk consumption during long-running 17-hour farming sessions.

### 2.4 Dual-Mode Structured Logging Architecture
To elevate our logging from basic Markdown tables to Gold Industry Standard:
- **Human-Readable Presentation**: `DropLogger` and `UniversalWorkflowEngine` continue writing clean, styled Markdown tables for immediate inspection in VS Code, GitHub, and text editors.
- **Machine-Parsable Event Streaming (JSONL / NDJSON)**:
  - Every completed run or drop event simultaneously appends a structured JSON object to `logPath.jsonl` (e.g. `logs/workflow-acc1-gw-meat-farm---light-ex-.jsonl`, `logs/gb-pbhl.jsonl`).
  - Downstream telemetry consumers, Grafana pipelines, and the companion PWA dashboard can read metrics with $O(1)$ stream parsing rather than fragile regex table splitting.

---

## 3. Gold Industry Standard Architecture Blueprint

The project now strictly adheres to an enterprise six-layer separation model:

```
+--------------------------------------------------------------------------+
|                Granblue Fantasy Remote Controller Architecture            |
+--------------------------------------------------------------------------+
|  1. Configuration & Accounts Layer                                       |
|     - src/config.ts, src/auth/account-registry.ts, accounts.config.json  |
|     - Multi-account isolation, encrypted credentials, proxy bindings    |
+--------------------------------------------------------------------------+
|  2. Universal Templates & Dialect Engine Layer                           |
|     - src/templates/template-schema.ts (Strict Zod Validation)           |
|     - src/templates/template-parser.ts (Bidirectional DSL Normalizer)    |
|     - templates/*.json (Zero-hardcoded workflow blueprints)             |
+--------------------------------------------------------------------------+
|  3. Execution & Workflow Engines Layer                                   |
|     - src/engines/universal-workflow.engine.ts (State-Aware Engine)      |
|     - src/engines/pbhl.engine.ts, akasha.engine.ts, go.engine.ts        |
|     - src/engines/gw-meat-light.engine.ts, pro-skip.engine.ts           |
+--------------------------------------------------------------------------+
|  4. Biomechanical & Input Simulation Layer                               |
|     - src/human-motor.ts (Minimum-Jerk Splines & 2D Gaussian Jitter)     |
|     - CDP Kernel-Level Input Dispatch (isTrusted: true)                 |
+--------------------------------------------------------------------------+
|  5. Safety Sentinel & Telemetry Gateway Layer                            |
|     - src/sentinel-watchdog.ts (Real-time CAPTCHA Freeze & Alert Relay)  |
|     - src/gateway/server.ts (REST API & Viewport Screencast Stream)      |
+--------------------------------------------------------------------------+
|  6. Storage, Logging & Diagnostics Layer                                  |
|     - logs/*.md (Human-Readable Execution Ledgers)                      |
|     - logs/*.jsonl (Machine-Parsable Structured Event Streams)           |
|     - scratch/captures/ (Isolated Visual Captures with Retention Prune)  |
|     - data/ (Reverse-Engineered Knowledge Base & Machine Catalogs)       |
+--------------------------------------------------------------------------+
```

---

## 4. Directory Taxonomy & Governance Matrix

| Directory | Permitted Artifacts | Strictly Prohibited Artifacts | Retention Policy |
| :--- | :--- | :--- | :--- |
| **`src/`** | TypeScript source code (`.ts`), schemas, engines, type definitions. | Binary files, loose images, test runs, log files. | Version controlled via Git. |
| **`data/`** | Technical documentation (`.md`), machine-readable specifications (`index.json`), formulas, protocols. | Session data, passwords, temporary logs. | Version controlled via Git. |
| **`templates/`** | Validated JSON workflow templates conforming to Zod schema. | Untyped ad-hoc JSON files, runtime cache. | Version controlled via Git. |
| **`logs/`** | Structured text/markdown run logs (`*.md`), NDJSON event streams (`*.jsonl`), daemon console output (`*.log`). | Loose image files (`.png`, `.jpg`), temporary scratch scripts. | Rotated at 5,000 lines or 10 MB per file. |
| **`scratch/`** | One-off diagnostic scripts (`*.ts`), investigative exploration tools. | Production workflows, credential files. | Local scratch workspace. |
| **`scratch/captures/`**| Diagnostic screenshots, CAPTCHA alerts, frame-by-frame analysis organized by namespace. | Log files, source code. | Pruned automatically by `ArtifactManager` (max 50 files per namespace). |
| **`tests/`** | Deterministic unit and integration test suites (`*.test.ts`, `run-all.ts`). | Production runtime files, ad-hoc logs. | Version controlled via Git. |

---

## 5. Verification & Health Audit

1. **`logs/` Cleanliness**:
   - `logs/` directory contains **0 image files** and **8 markdown logs**.
2. **TypeScript Compilation**:
   - `node ./node_modules/typescript/bin/tsc --noEmit` exits with **0 errors**.
3. **Unified Test Suite**:
   - `npm test` runs all 7 test suites with a **100% pass rate** in 6.81s.
4. **Safety Watchdog**:
   - Integrated with `ArtifactManager` to isolate CAPTCHA captures to `scratch/captures/captcha/` with automatic retention pruning.
