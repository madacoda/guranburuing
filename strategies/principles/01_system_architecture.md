# Principle 01: Granblue Fantasy System Architecture & Web Runtime Analysis

## 1. Executive Overview

Granblue Fantasy (`https://game.granbluefantasy.jp`) is an enterprise-grade HTML5/JavaScript Single Page Application (SPA) designed to execute within Chromium and WebKit viewports. Originally launched in 2014, its frontend architecture represents a highly customized, production-hardened implementation of **Backbone.js** (Model-View-Router) with **Underscore.js** and **Zepto.js/jQuery**, coupled with a hybrid DOM and **CreateJS (EaselJS / TweenJS)** rendering engine.

This document provides an exhaustive technical analysis of the game client's internal architecture, runtime memory model, rendering pipelines, network protocols, and the mechanics required for programmatic remote control.

---

## 2. Frontend Runtime Architecture & Memory Model

```
+-----------------------------------------------------------------------------------------+
|                                      Browser Window                                     |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |                             DOM Overlay Layer (HTML/CSS)                          |  |
|  |  - Active Backbone Views (#mypage, #quest, #quest/assist, #result, etc.)          |  |
|  |  - Modal Manager & Dialogs (.pop-usual, .pop-raid-result, .prt-popup-body)       |  |
|  |  - Persistent Header/Footer (AP/EP counters, Currency, Menu buttons)              |  |
|  |  - Verification & CAPTCHA containers (.img-verification, .pop-usual.verification) |  |
|  +-----------------------------------------------------------------------------------+  |
|                                           ^                                             |
|                                           | CSS Z-Index Overlay                         |
|  +----------------------------------------+------------------------------------------+  |
|  |                            Canvas Layer (CreateJS / WebGL)                        |  |
|  |  - Canvas Elements: #canv, #cjs-canvas, #canvas                                   |  |
|  |  - EaselJS Stage Graph: Characters, Bosses, Backgrounds, Combat VFX               |  |
|  |  - Ticker Engine: create_stage.js, TweenJS animation timeline                     |  |
|  +-----------------------------------------------------------------------------------+  |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  |                              Global Game Runtime Scope                            |  |
|  |  - window.Game (Master Controller, Router, Storage, Profile, Build Metadata)       |  |
|  |  - window.stage (EaselJS Root Stage)                                              |  |
|  |  - window.createjs (CreateJS Framework Instance)                                  |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
                                             |
                                             | HTTPS REST / JSON (Headers: X-VERSION, CSRF)
                                             v
+-----------------------------------------------------------------------------------------+
|                                  Cygames Infrastructure                                 |
|  - Akamai Edge CDN (Asset distribution: sprites, audio, spine skeletons)               |
|  - API Gateway & Game Servers (Combat state, Quest transactions, Gacha engine)          |
|  - Security & Anti-Cheat Engine (CAPTCHA issuance, telemetry analysis, rate limiter)  |
+-----------------------------------------------------------------------------------------+
```

### 2.1 The Global `window.Game` Namespace
The entire client-side state is orchestrated through the `window.Game` singleton. Key sub-objects include:

| Property | Type | Technical Role |
| :--- | :--- | :--- |
| `Game.userId` | `string` | Unique alphanumeric identifier for the authenticated Mobage/DMM player account. |
| `Game.view` | `Backbone.View` | Currently mounted Backbone view instance representing the active screen. Contains subviews, DOM references, and event bindings. |
| `Game.router` | `Backbone.Router` | Client-side routing engine listening to hash changes (`window.onhashchange`). |
| `Game.storage` | `Object` | High-level wrapper around browser `localStorage` and `sessionStorage`, managing cached manifests, audio settings, and gameplay preferences. |
| `Game.version` | `string` | Client asset build timestamp (e.g. `1725901234`). Sent in the `X-VERSION` request header for server cache synchronization. |
| `Game.setting` | `Object` | Client configuration: animation speed (Normal/Fast), sound volumes, BGM mute, Full Auto ability toggles. |

### 2.2 Client-Side Hash Routing Mechanics
GBF does not perform hard document reloads during gameplay. Routing is entirely hash-driven:

```
https://game.granbluefantasy.jp/#<route_name>[/<parameters>]
```

When a hash change event fires:
1. `Game.router` intercepts the path string.
2. The active view's `remove()` or `destroy()` method unbinds listeners and clears memory.
3. A skeleton DOM layout is rendered from client-side Underscore templates.
4. An AJAX request is dispatched to the corresponding backend REST endpoint to fetch dynamic state.
5. The view's `render()` method populates the DOM and, if combat is involved, initializes the CreateJS stage.

#### Critical Routes Reference
* `#mypage`: Main player dashboard, AP/EP status, uncollected rewards, and ongoing raid alerts.
* `#quest`: Primary quest map and chapter selection.
* `#quest/extra`: Daily treasure dungeons, Special Quests, and **Pro Skip** entry points.
* `#quest/island`: Island battle overview where Magna/Hard Pro skips are consolidated.
* `#quest/assist`: Multi-raid backup requests list (public raids).
* `#quest/assist/enter_id`: Dedicated tab for entering private/external 8-character raid codes.
* `#quest/supporter/<quest_id>/<difficulty>/<element>`: Supporter summon selection grid.
* `#raid/<raid_id>` or `#multiraid/<raid_id>`: Combat engine and battle canvas.
* `#result_multi/<raid_id>`: Raid completion, loot drop distribution, honors, and blue chest outcomes.

### 2.3 Canvas Rendering Engine & CreateJS Pipeline
Combat animations and visual effects are managed via CreateJS:
- **Canvas Stacking**: The game mounts one or two `<canvas>` elements beneath the DOM overlay.
- **Stage & Ticker**: `window.stage` contains display objects (character sprites, weapon overlays, summons). Animation ticks are tied to `requestAnimationFrame` via `createjs.Ticker`.
- **DPR Scaling**: The canvas dynamically computes resolution based on `window.devicePixelRatio` and the user's selected resolution scale (Standard vs High).
- **DOM/Canvas Interplay**: Turn actions (clicking "Attack" or "Full Auto") occur on DOM buttons that trigger game events, which in turn signal the CreateJS stage to render sprite attack sequences while asynchronously awaiting the server's combat calculation response.

---

## 3. Network Architecture & Protocol Specification

GBF does **not** maintain persistent TCP/UDP game sockets (like WebSockets or WebTransport) for turn processing. Instead, it operates strictly via **stateless HTTP RESTful transactions**.

```
[ Browser Client ]  --- POST /rest/multiraid/normal_attack_result.json --->  [ Game Server ]
                     <--- JSON (New Boss HP, Status Effects, Buffs) -------
```

### 3.1 Core Transaction Endpoints

| Category | HTTP Endpoint | Payload / Parameters | Server Response |
| :--- | :--- | :--- | :--- |
| **Status** | `GET /user/status` | `_=<timestamp>` | AP, EP, Rank, Level, Rupees, Crystals, Unread Alerts |
| **Pro Skip** | `POST /quest/pro_skip/play` | `{ quest_id: ..., use_item: true }` | Consumed AP, drops array, cleared flag |
| **Raid Check** | `POST /rest/multiraid/quest_check` | `{ raid_id: "7F3B29A1" }` | Battle validity, alive status, participant count |
| **Raid Init** | `POST /rest/multiraid/start.json` | `{ raid_id: ..., supporter_id: ... }` | Full battle payload: Boss HP, party data, turn state |
| **Attack Turn** | `POST /rest/multiraid/normal_attack_result.json` | `{ raid_id: ..., turn: 3 }` | Damage dealt, boss triggers, counterattacks, new turn |
| **Skill Cast** | `POST /rest/multiraid/ability_result.json` | `{ raid_id: ..., ability_id: ..., pos: 1 }` | Skill cooldown, damage, applied buffs/debuffs |
| **Summon Call**| `POST /rest/multiraid/summon_result.json` | `{ raid_id: ..., summon_id: ... }` | Summon effect, damage, combo summon link |

### 3.2 Security Headers & Anti-Tamper Verification
Every HTTP request dispatched by the client is scrutinized by server middleware. Any deviation in expected headers flags the session:

* **`X-VERSION`**: A Unix timestamp or semantic hash representing the current asset build.
  * If the client sends an outdated `X-VERSION`, the server responds with HTTP 200 containing `{ error: "version_error" }`, forcing a client reload.
* **`X-Requested-With: XMLHttpRequest`**: Strictly enforced on all `/rest/` and `/quest/` API calls. Direct browser navigation to API URLs is rejected.
* **`Content-Type: application/json; charset=UTF-8`**: Standard for all mutations.
* **`Cookie`**: Holds the cryptographic session tokens (`mbga_session`, DMM tokens, or Mobage OAuth cookies).

---

## 4. Analysis of Remote Browser Control Approaches

Controlling an already-authenticated browser session can be accomplished through four primary technical architectures:

```
+---------------------------------------------------------------------------------------------------------+
|                                Comparative Matrix of Control Topologies                                 |
+------------------------------------+---------------+-----------------+----------------+-----------------+
| Paradigm                           | Reliability   | Ban Risk        | Setup Friction | Remote Quality  |
+------------------------------------+---------------+-----------------+----------------+-----------------+
| 1. Chrome DevTools Protocol (CDP)  | Excellent     | Very Low        | Low            | High            |
| 2. Chrome Browser Extension        | Very Good     | Low             | Medium         | High            |
| 3. WebRTC Screen & Input Relay     | Perfect       | None (100% User)| High           | High (Bandwidth)|
| 4. Headless REST API Emulation     | Poor / Fragile| Extreme         | Very High      | N/A (Headless)  |
+------------------------------------+---------------+-----------------+----------------+-----------------+
```

### Approach 1: Chrome DevTools Protocol (CDP) (Recommended Architecture)
* **Architecture**: The user launches standard desktop Google Chrome with `--remote-debugging-port=9222` and pointing to their existing `--user-data-dir`. A background daemon connects via WebSocket (`ws://localhost:9222/devtools/page/<id>`).
* **Strengths**:
  * Complete programmatic control over DOM querying, synthetic touch/mouse dispatch, screenshot capture, and network monitoring.
  * No modification of game JavaScript code; no suspicious content scripts injected into the DOM tree.
  * Preserves hardware acceleration, GPU canvas rendering, and genuine browser fingerprinting (WebRTC, WebGL, AudioContext).
* **Limitations**: Requires starting Chrome with the debugging CLI flag.

### Approach 2: Chrome Browser Extension with WebSocket Companion
* **Architecture**: An unpacked Chrome Extension installed in the user's primary profile. A content script bridges `game.granbluefantasy.jp` to a background Service Worker connected to an external WebSocket gateway.
* **Strengths**:
  * Starts automatically whenever the user opens their browser normally.
  * Direct access to DOM elements and page window events.
* **Limitations**:
  * Chrome Manifest V3 service workers sleep after inactivity, requiring keep-alive workarounds.
  * Potential for script detection if content scripts leak global variables or prototype pollutions.

### Approach 3: WebRTC Screen Mirroring with Input Relay ("Companion Streaming")
* **Architecture**: The desktop browser tab is captured via the Screen Capture API and encoded as an ultra-low-latency WebRTC video stream sent to a mobile web client. Touch taps on the phone are translated into physical mouse events on the desktop.
* **Strengths**:
  * Zero automation detection risk; every single action is initiated by a human finger.
  * Full visual fidelity; complete visibility of all combat animations and popups.
* **Limitations**: High network bandwidth consumption; requires active user attention for every tap.

### Approach 4: Headless REST API Emulation (Strictly Prohibited)
* **Architecture**: Reversing the API endpoints and making raw `curl` or `fetch` requests without running a browser.
* **Why this is rejected**:
  * Bypasses the CreateJS engine, rendering normal client telemetry nonexistent.
  * Extremely high ban rate; Cygames detects the absence of legitimate browser canvas fingerprinting, timing entropy, and asset CDN downloads.

---

## 5. Architectural Verdict & Strategy Blueprint

The optimal architecture combines **Approach 1 (CDP-Driven Local Controller)** with a **Secure WebSocket Remote Gateway**:

1. **Host Environment**: The user's desktop PC runs standard Google Chrome logged into their GBF account with `--remote-debugging-port=9222`.
2. **Local Daemon**: A lightweight Node.js/Bun daemon connects to Chrome via CDP using `puppeteer-core`.
3. **Safety Engine**: The daemon continuously operates a **Sentinel Watchdog**, evaluating page state for any verification CAPTCHAs before every single action.
4. **Remote Companion**: The daemon hosts an encrypted, authenticated WebSocket server accessible from the user's mobile device (over Tailscale or local Wi-Fi), enabling one-click triggers for daily pro skips, raid joining, and real-time status streaming.
