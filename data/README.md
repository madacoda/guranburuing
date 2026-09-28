# Granblue Fantasy Technical Knowledge Base & Automation Compendium

This directory (`C:\laragon\www\gbf\data\`) contains the authoritative, reverse-engineered technical knowledge base for Granblue Fantasy (GBF) and high-performance browser automation systems.

---

## Compendium Volumes

| Volume | Document File | Core Subject Matter |
| :--- | :--- | :--- |
| **Vol. 1** | [`01_gbf_core_engine_and_client_internals.md`](file:///c:/laragon/www/gbf/data/01_gbf_core_engine_and_client_internals.md) | Backbone.js MVC, Zepto.js touch/tap events, CreateJS / EaselJS stage loops, global `window.stage` runtime, DOM vs Canvas layer separation, V8 heap texture leaks. |
| **Vol. 2** | [`02_network_protocols_and_rest_api_internals.md`](file:///c:/laragon/www/gbf/data/02_network_protocols_and_rest_api_internals.md) | HTTP/2 transport contracts, TLS JA3/JA4 fingerprinting, `X-VERSION` lifecycle, full JSON schemas for `/start.json`, `/normal_attack_result.json`, `/ability_result.json`, and error recovery matrix. |
| **Vol. 3** | [`03_combat_mechanics_v1_v2_and_turn_lock_physics.md`](file:///c:/laragon/www/gbf/data/03_combat_mechanics_v1_v2_and_turn_lock_physics.md) | V1 vs V2 combat, Omens, Guard, Fated Chain, Server-side Lockout physics formulas ($L_{turn}$), F5 animation skip mechanics, and Blue Chest mathematical probability curves. |
| **Vol. 4** | [`04_anti_cheat_detection_vectors_and_mitigation.md`](file:///c:/laragon/www/gbf/data/04_anti_cheat_detection_vectors_and_mitigation.md) | Cygames server telemetry, `isTrusted` DOM verification, invisible honeypot elements, Bivariate Gaussian spatial jitter, Log-Normal latency distributions, and Minimum-Jerk kinematic splines. |
| **Vol. 5** | [`05_high_performance_farming_blueprints.md`](file:///c:/laragon/www/gbf/data/05_high_performance_farming_blueprints.md) | Gold Bar racing meta (PBHL 1.48M, Akasha 1.56M, GOHL 1.48M), Guild Wars EX+ 0-button meat farming, Replicard Sandbox Sephira Box loops, and Magna I/II Pro Skips. |
| **Vol. 6** | [`06_system_architecture_and_future_improvements.md`](file:///c:/laragon/www/gbf/data/06_system_architecture_and_future_improvements.md) | Comprehensive engineering audit of this app, 6 high-impact technical upgrades (CDP network fast-path, Chromium GPU/FPS throttling, proactive memory recycling, WebSocket raid broker). |
| **Vol. 7** | [`07_architecture_review_and_standards.md`](file:///c:/laragon/www/gbf/data/07_architecture_review_and_standards.md) | Architectural audit, forensic root-cause analysis of image dumps in `logs/`, remediation steps, dual-mode structured logging (Markdown + JSONL), and enterprise directory governance. |
| **Data** | [`index.json`](file:///c:/laragon/www/gbf/data/index.json) | Machine-readable JSON database of endpoints, raid parameters, combat constants, DOM selectors, and Chromium flag presets for runtime programmatic consumption. |

---

## Machine-Readable Consumption in TypeScript

The data catalog can be directly imported into our TypeScript automation pipeline:

```typescript
import technicalData from '../../data/index.json';

// Retrieve exact Blue Chest target for Proto Bahamut HL
const pbhl = technicalData.raids.find(r => r.id === 'pbhl');
console.log(`PBHL Target Honors: ${pbhl.blueChestThreshold}`); // 1480000

// Compute theoretical lockout for a 4-chain full burst
const totalHits = 12; // 4 characters * Triple Attack
const lockoutTime = technicalData.combatFormulas.lockoutSeconds.base +
  (totalHits * technicalData.combatFormulas.lockoutSeconds.hitMultiplier) +
  technicalData.combatFormulas.lockoutSeconds.ougiMultipliers["4"];

console.log(`Calculated Server Lockout: ${lockoutTime} seconds`); // 18.2s
```

---

## Key Performance Standards & Invariants

1. **Never Click Synthetic Events**: Never call `.click()` in DOM injection; always dispatch through CDP `Input.dispatchMouseEvent` / `Input.dispatchTouchEvent` to retain `isTrusted: true`.
2. **Honor Threshold Egress**: In Gold Bar raids (PBHL, Akasha, GOHL), immediately exit the raid upon hitting the target honor threshold (1.48M / 1.56M).
3. **Turn Resolution Fast-Path**: Trigger page reload or next command immediately when `/rest/multiraid/normal_attack_result.json` returns HTTP 200, rather than waiting for client DOM animations to complete.
4. **Periodic Memory Cleanse**: Cycle browser tabs every 40-50 raids to flush CreateJS WebGL textures and maintain lean memory footprints.
