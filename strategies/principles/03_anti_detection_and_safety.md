# Principle 03: Anti-Detection, Safety Protocols & Ban Mitigation

## 1. Executive Summary & Threat Landscape

Cygames operates one of the most proactive anti-automation and telemetry verification systems in the browser gaming industry. Historically, automated macroing, unsanctioned browser extensions (e.g., Viramate), and external API bots have resulted in massive ban waves—particularly during competitive events such as Unite and Fight (Guild War / GW).

To ensure complete account longevity, any automation or remote system must be engineered from the ground up around **safety-first principles**, **behavioral entropy**, and the **Human-in-the-Loop Sentinel Watchdog**.

---

## 2. Cygames Detection Vectors & Threat Matrix

```
+-----------------------------------------------------------------------------------------------+
|                                Cygames Detection Vector Analysis                              |
+--------------------------+------------------------------+-------------------------------------+
| Vector                   | Detection Mechanism          | Countermeasure / Principle          |
+--------------------------+------------------------------+-------------------------------------+
| 1. Visual Verification   | Periodic / Triggered image   | Sentinel Watchdog: Immediate hard   |
|    (Image CAPTCHA)       | puzzle (character / items)   | freeze and push notification.       |
+--------------------------+------------------------------+-------------------------------------+
| 2. Behavioral Telemetry  | Linear mouse coordinates,    | Bézier trajectory synthesis,        |
|                          | uniform click intervals      | Gaussian latency, spatial jitter.   |
+--------------------------+------------------------------+-------------------------------------+
| 3. Environment Fingerprint| `navigator.webdriver`,       | Attach to genuine, authenticated    |
|                          | SwiftShader WebGL, CDP flags | desktop Chrome user profile.        |
+--------------------------+------------------------------+-------------------------------------+
| 4. Network Concurrency   | Overlapping API requests,    | Enforce strict sequential dispatch  |
|                          | multiple concurrent tabs     | and network idle barriers.          |
+--------------------------+------------------------------+-------------------------------------+
| 5. Endurance Anomalies   | 6+ hours of uninterrupted    | Session duration caps (max 45m)     |
|                          | repetitive actions           | and mandatory randomized rest gaps. |
+--------------------------+------------------------------+-------------------------------------+
```

---

## 3. Deep Dive: Visual Verification (Image CAPTCHA)

### 3.1 Trigger Conditions & Characteristics
Cygames does not use Google reCAPTCHA or Cloudflare Turnstile. Instead, it employs a **proprietary in-game visual verification system**:
* **Appearance**: A modal dialogue (`.pop-usual.verification` or `.prt-popup-body .img-verification`) overlays the screen.
* **Challenge Type**: Sliced character portraits or game items are presented. The player is instructed to identify and click specific matching tiles within a time limit.
* **Trigger Heuristics**:
  1. High-frequency repetitive quest launches or raid joins.
  2. Sustained continuous play without human-like irregular pauses.
  3. Randomized statistical audits during high-traffic game events.

### 3.2 Account Penalty Escalation Structure
Cygames enforces a tiered strike policy:
* **Strike 1 (Warning / Soft Ban)**: 24-hour restriction from joining co-op and multi-raids; temporary captcha frequency increase.
* **Strike 2 (Suspension)**: 7-day to 30-day full account suspension, rank lock, honor points reset to 0 in active events.
* **Strike 3 (Permanent Termination)**: Total account deletion ("Ban Hammer"); permanent revocation of Mobage/DMM player data.

> [!CAUTION]
> **Never Attempt Automated / ML CAPTCHA Solving**:
> Third-party OCR, vision models, or CAPTCHA-solving APIs are prone to misclassifying distorted game sprite slices or exceeding the tight verification timeout. An incorrect submission immediately logs an intentional violation on Cygames servers.

---

## 4. The Human-in-the-Loop Sentinel Watchdog

The **Sentinel Watchdog** is an immutable safety guarantee: **the automation layer must immediately yield control to a human whenever a verification modal appears**.

```
+---------------------------------------------------------------------------------+
|                            The Sentinel Watchdog Loop                           |
+---------------------------------------------------------------------------------+

                       [AUTOMATION RUNNING]
                                 |
           (Inspect DOM & Canvas before EVERY click / route)
                                 v
                 +-------------------------------+
                 | Is Verification Modal Active? |
                 +-------------------------------+
                       /                   \
                 [NO] /                     \ [YES]
                     v                       v
         (Proceed with action)   +---------------------------------------+
                                 | 1. HARD EMERGENCY FREEZE              |
                                 |    - Abort current action queue       |
                                 |    - Clear all active timers          |
                                 |    - Block all synthetic input        |
                                 +---------------------------------------+
                                                     |
                                                     v
                                 +---------------------------------------+
                                 | 2. DISPATCH CRITICAL NOTIFICATIONS    |
                                 |    - Capture high-res tab screenshot  |
                                 |    - Send push alert to user's phone  |
                                 |      (via Telegram / Discord Webhook) |
                                 |    - Play local audible alarm sound   |
                                 +---------------------------------------+
                                                     |
                                                     v
                                 +---------------------------------------+
                                 | 3. MANUAL RESOLUTION BY HUMAN         |
                                 |    - User solves puzzle in browser    |
                                 |    - User confirms completion in UI   |
                                 +---------------------------------------+
                                                     |
                                                     v
                                 +---------------------------------------+
                                 | 4. RESUME AUTOMATION                  |
                                 +---------------------------------------+
```

### 4.1 DOM Detection Selectors
```typescript
const CAPTCHA_SELECTORS = [
  '.prt-popup-body .img-verification',
  '.pop-usual.verification',
  'div[class*="verification"]',
  'div[id*="verification"]',
  '.cnt-verification',
  'canvas.cnt-verification',
  'img[src*="verification"]'
];
```

### 4.2 Sentinel Implementation & Emergency Pause Protocol
In the active codebase ([`src/sentinel-watchdog.ts`](file:///c:/laragon/www/gbf/src/sentinel-watchdog.ts)), the Sentinel operates with strict non-negotiable rules:

1. **Continuous Pre-Flight Checks (`assertSafe`)**:
   Before every synthetic action (navigation, mouse movement, click, skill cast, summon call), the automation calls `await this.sentinel.assertSafe()`.
2. **Never Navigate Away**:
   If a verification challenge is active, the engine **never** reloads the page, alters the URL hash, or closes the tab. Navigating away while a CAPTCHA modal is active triggers an immediate strike on Cygames servers.
3. **Bring Browser to Foreground**:
   Calls `await this.page.bringToFront()` so the player immediately sees the challenge on their screen without searching through minimized windows.
4. **Audible Terminal Alarm**:
   Emits repeated ASCII Bell signals (`\x07\x07\x07`) through stdout to alert the operator in real-time.
5. **Human Resolution Loop (`waitForUserToSolveCaptcha`)**:
   Enters an asynchronous wait loop polling every 2,000ms until the user manually solves the puzzle in their browser and the modal disappears from the DOM.
6. **Graceful Auto-Resume**:
   Once the verification challenge is cleared by the human, the watchdog logs confirmation and allows the automation session to proceed safely.

---

## 5. Behavioral Humanization & Entropy Modeling

### 5.1 Bounded Gaussian & Log-Normal Latency
Automated systems that employ fixed delays (e.g. `sleep(1000)`) are trivial for server-side telemetry to flag via basic variance tests ($\sigma^2 \approx 0$).

Human reaction times naturally follow a **log-normal distribution**:

$$T_{\text{delay}} = t_{\text{base}} + e^{\mu + \sigma Z}, \quad Z \sim \mathcal{N}(0, 1)$$

* **Fast Confirmation (e.g. OK buttons)**: Mean $\mu = 450\text{ms}$, $\sigma = 80\text{ms}$, range $[300\text{ms}, 850\text{ms}]$.
* **Page Navigation Decisions**: Mean $\mu = 1400\text{ms}$, $\sigma = 250\text{ms}$, range $[800\text{ms}, 2400\text{ms}]$.
* **Micro-Hesitations**: 5% of all actions inject a randomized pause of $2500\text{ms} - 5500\text{ms}$, mimicking a player reading notifications or shifting attention.

### 5.2 2D Gaussian Spatial Jitter
Clicking the exact geometric center $(x_c, y_c)$ of an element repeatedly is an immediate bot indicator. Instead, clicks must sample from a 2D Gaussian distribution bounded by an inner safety zone:

```
+---------------------------------------------+
| Element Bounding Box (width x height)       |
|   +-------------------------------------+   |
|   | Inner Safe Zone (60% Area)          |   |
|   |         . (x, y) Click              |   |
|   |           sampled via 2D Gaussian   |   |
|   +-------------------------------------+   |
+---------------------------------------------+
```

$$x = x_c + \mathcal{N}\left(0, \frac{\text{width}}{6}\right), \quad y = y_c + \mathcal{N}\left(0, \frac{\text{height}}{6}\right)$$

Clamped with safety boundary padding ($\pm 3\text{px}$) to prevent accidental boundary misses.

### 5.3 Cubic Bézier Mouse Trajectories
Rather than instantaneous cursor teleportation, the cursor follows smooth, minimum-jerk curves:
* Generate a cubic Bézier curve with two randomized control points offset from the straight line.
* Discretize the curve into 15-30 intermediate mouse move events dispatched via CDP `Input.dispatchMouseEvent({ type: 'mouseMoved', x, y })`.
* Vary velocity along the curve (ease-in, ease-out) matching human neuromuscular movement models.

### 5.4 Rapid Multi-Click & Finger Tapping Emulation
Active human players frequently double- or triple-tap buttons (especially ability icons, Quick Call, and Attack) when anticipating action resolution:
* **Configurable Multi-Click**: Controlled via `HumanClickOptions` (`allowMultiClick`, `multiClickChance`, `maxClicks`).
* **Tap Probability**: 25% – 45% probability on combat skills and attack buttons.
* **Rapid Inter-Tap Latency**: 50ms – 120ms between taps.
* **Spatial Jitter**: Micro-displacements ($\pm 2-3\text{px}$) between successive taps mimicking physical fingertip micro-vibrations.

### 5.5 Behavioral Variety & Dynamic Intervals
* **Occasional Secondary Actions**: Injecting human-like variety into combat rotations, such as occasionally casting Seox Skill 1 (~35% chance) before entering the attack phase.
* **Dynamic Waiting Windows**: Randomized waiting intervals (e.g. 3s – 15s between search refreshes in Raid Finder) preventing uniform polling patterns.

---

## 6. Browser Fingerprint Sanctity

1. **Avoid Headless Browser Mode**:
   - Vanilla Headless Chrome sets `navigator.webdriver = true`.
   - WebGL renderer strings return `Google SwiftShader` or `llvmpipe` instead of NVIDIA/AMD/Intel hardware names.
   - Missing plugins array and screen dimension mismatches.
2. **Attach via Chrome DevTools Protocol (CDP)**:
   - Running real Chrome or dedicated SRWare Iron with `--remote-debugging-port=9222` preserves all genuine hardware acceleration, audio contexts, canvas rendering, and user-profile cookies.
   - The game client executes in an identical environment to normal manual play sessions.
