# Volume 1: Granblue Fantasy Core Engine & Client Internals

## 1. Executive Architecture Overview

Granblue Fantasy (GBF) is a hybrid Single Page Application (SPA) designed originally for mobile browsers (WebKit/Safari and Chrome for Android) and later adapted for desktop through Chromium-based wrappers (AndApp, Chrome Extension, and generic modern desktop browsers).

Unlike modern reactive applications (React/Vue/Svelte), GBF’s client architecture was established between 2013 and 2014 and remains built upon a legacy enterprise front-end stack:
- **Core MVC Framework**: Backbone.js (`0.9.10` / `1.1.2` customized fork)
- **DOM & Utility Layer**: Zepto.js (a minimalist jQuery-compatible library optimized for mobile WebKit)
- **Rendering & Animation Engine**: CreateJS suite, specifically:
  - **EaselJS**: 2D HTML5 Canvas rendering for battle scenes, sprite sheets, particle effects, and cinematic summons.
  - **TweenJS**: Programmatic interpolation for UI transitions, character sprite movement, and damage number bounce physics.
  - **SoundJS**: WebAudio / HTML5 Audio abstraction managing BGM, character battle voices, and SFX.
- **Templating**: Underscore.js micro-templates (`_.template`) compiled client-side or delivered pre-compiled inside asset bundles.

```
+-------------------------------------------------------------------------+
|                              GBF Browser Window                         |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |                       DOM HUD Layer (Zepto.js)                    |  |
|  |   - Health Bars (#enemy-hp, #user-hp)                             |  |
|  |   - Ability Trays (.prt-ability-list)                             |  |
|  |   - Attack Button (.btn-attack-start)                             |  |
|  |   - Popups, Modals, System Notifications                          |  |
|  +-------------------------------------------------------------------+  |
|                                  |                                      |
|                                  v                                      |
|  +-------------------------------------------------------------------+  |
|  |                  CreateJS Canvas Layer (#canvas)                  |  |
|  |   - EaselJS Stage (Stage / Container / Sprite / Bitmap)           |  |
|  |   - Character & Boss Spines / Spritesheets                        |  |
|  |   - Damage Numbers, Critical Overlays, Particle Effects           |  |
|  |   - TweenJS Animation Ticker (createjs.Ticker)                    |  |
|  +-------------------------------------------------------------------+  |
|                                  |                                      |
|                                  v                                      |
|  +-------------------------------------------------------------------+  |
|  |              Backbone.js MVC & State Management                   |  |
|  |   - Global Context: window.stage, stage.gGameStatus, stage.pJsnData|  |
|  |   - Router: window.location.hash navigation (#raid_multi/...)    |  |
|  |   - Controllers: view.quest.raid, model.quest.raid               |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

---

## 2. Canvas vs. DOM Hybrid Rendering

### 2.1 The Two-Layer Split
GBF does not render its entire interface on HTML5 Canvas. It utilizes a strict physical separation:
1. **The Canvas Layer (`#canvas`, `canvas#cjs-canvas`)**:
   - Houses the character animations, boss animations, backgrounds, summons, and visual effects.
   - Driven by `createjs.Stage`.
   - Has zero native DOM accessibility; buttons drawn here cannot be targeted via CSS selectors unless mapped to coordinate bounding boxes.
2. **The DOM HUD Layer (`#cnt-raid`, `#prt-command-top`, etc.)**:
   - Floats transparently directly above or adjacent to the canvas.
   - Contains all actionable game controls: Attack button, Ability buttons, Summon carousel, Auto button, Guard toggles (V2), and Turn/Raid statistics.
   - Driven by Backbone Views and Zepto event delegation.

### 2.2 Event Interception: Physical Click vs. Zepto `tap`
In native mobile WebKit (circa 2014), the 300ms click delay prompted developers to implement custom touch handlers. GBF’s Zepto.js listens for `touchstart`, `touchmove`, and `touchend`, synthesizing a custom `tap` event:
```javascript
// Internal Zepto event listener pattern in GBF
$('#btn-attack-start').on('tap', function(e) {
    if (stage.gGameStatus.lock) return false;
    view.startAttack();
});
```
- **Puppeteer / CDP Implication**:
  - Sending a raw DOM synthetic event via `element.dispatchEvent(new MouseEvent('click'))` will **fail** on elements that exclusively bind to `tap` or touch sequences.
  - Sending Chrome DevTools Protocol `Input.dispatchTouchEvent` or `Input.dispatchMouseEvent` with valid touch/pointer sequences correctly triggers Zepto's touch listeners and sets `isTrusted: true`.
  - Alternatively, in injected contexts, invoking Zepto's `.trigger('tap')` or invoking the Backbone View method directly bypasses DOM event listener quirks.

---

## 3. Global JS Context & State Reflection

GBF exposes several critical objects on the `window` scope that reveal the complete instantaneous state of the client. These can be inspected and evaluated via CDP `Runtime.evaluate`.

### 3.1 `window.stage`
The primary operational context during combat. Key properties include:
- `stage.gGameStatus`: The operational state machine of the current battle.
  - `stage.gGameStatus.lock`: Boolean flag. When `true`, the client is processing an animation, awaiting network resolution, or resolving damage. Any user input received during `lock === true` is dropped or queued.
  - `stage.gGameStatus.attacking`: Boolean flag indicating if an attack sequence is actively animating.
  - `stage.gGameStatus.turn`: Current battle turn count as known by the client.
  - `stage.gGameStatus.speed`: Animation playback speed (`1` = normal, `2` = fast/skip mode).
- `stage.pJsnData`: The raw JSON data received from the most recent server transaction (`/start.json`, `/ability_result.json`, or `/normal_attack_result.json`).
  - Contains full party HP, charge bar percentages, active boss mode (Normal, Overdrive, Break), and status effect IDs.

### 3.2 `window.createjs.Ticker`
- Controls the animation loop:
  ```javascript
  createjs.Ticker.getFPS(); // Typically 30 or 60 depending on browser vs mobile setting
  ```
- **Performance Leak Warning**: When running in headless Chromium, if Chromium throttles requestAnimationFrame (`--disable-background-timer-throttling` not passed), `Ticker` will slow down drastically, causing combat animations to freeze and timeouts to trigger.

### 3.3 Backbone Router & Navigation (`window.location.hash`)
GBF handles client-side routing exclusively via the URL hash fragment.
- Battle URL: `https://game.granbluefantasy.jp/#raid_multi/<raid_id>` or `#raid/<raid_id>`
- Quest Selection: `#quest/supporter/<quest_id>/1`
- Party Formation: `#party/index/0/raid/<raid_id>`
- Result Screen: `#result_multi/<raid_id>`

Direct navigation via `window.location.hash = '#...'` or `Backbone.history.navigate('#...', { trigger: true })` avoids full page reloads and executes instant in-engine view transitions.

---

## 4. Memory Lifecycle & Leaks in Long-Running Sessions

### 4.1 The CreateJS Texture Leak
Because GBF was designed for intermittent mobile browsing sessions, its asset management does not aggressively free WebGL/Canvas textures when transitioning between raids:
- Character spritesheets, enemy boss frames, and audio buffers remain cached in `createjs.UID` tables and DOM image element caches.
- In automated environments running 200+ consecutive raids, Chromium renderer memory will scale linearly from ~300 MB up to 3.5 GB, eventually triggering an `Out of Memory (OOM)` renderer crash.

### 4.2 Mitigation Strategies for Automation Engines
1. **Periodic Tab Recycling**:
   - After every 30 to 50 raids, the automation engine should close the current browser `Page` and open a fresh page within the same `BrowserContext` (retaining cookie and local storage state).
   - This reclaims 100% of leaked V8 heap and GPU texture memory in under 800ms.
2. **Asset Cache Manipulation**:
   - Cache static assets (`game-a.granbluefantasy.jp/assets/...`) via a local HTTP proxy or CDP cache interceptor to eliminate network bandwidth while freeing renderer memory.

---

## 5. Asset Delivery & CDN Architecture

- **Asset Hostnames**:
  - `game-a.granbluefantasy.jp`
  - `game-a1.granbluefantasy.jp` through `game-a5.granbluefantasy.jp`
- **Dynamic Content & REST API**:
  - `game.granbluefantasy.jp` (API gateway, session validation, combat calculation)
- **Manifests & Versioning**:
  - Client loads `manifest.json` or versioned asset tables upon boot.
  - Game code uses an integer/hash version header (`X-VERSION`) passed on every XMLHttpRequest. If the client version mismatches the server’s active deployment, the server returns an HTTP 200 with `{"version": "outdated"}` or redirect, requiring a clean reload.
