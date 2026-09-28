# Principle 09: Mobile Companion UI & PWA Specification

## 1. Executive Summary

The **Mobile Companion UI** is a lightweight, responsive Progressive Web App (PWA) designed to be operated from a smartphone or tablet while away from the desktop gaming machine.

It serves as the remote cockpit: providing **live visual feedback**, **one-touch daily macro execution**, **instant raid joining**, and an **uncompromising safety alarm** if a verification CAPTCHA is encountered.

---

## 2. Design Principles & Ergonomics

* **Thumb-Zone Optimization**: All primary action buttons are anchored to the lower half of the viewport for effortless single-handed mobile operation.
* **Minimum Touch Target**: Every interactive element satisfies a minimum dimension of $48 \times 48\text{px}$ with at least $8\text{px}$ margin.
* **Low-Latency Status Feedback**: Every user interaction provides immediate optimistic UI feedback (tactile vibration via `navigator.vibrate`, button state transition) while awaiting WebSocket confirmation.
* **High Contrast Dark Theme**: Deep OLED black backgrounds (`#0B0E14`) with vivid cyan accents (`#00F0FF`) and danger alerts (`#FF0055`) for crystal-clear readability.

---

## 3. Mobile Companion UI Wireframe Layout

```
+-----------------------------------------------------------+
| [GBF Companion]     [● CONNECTED]     [SENTINEL: ARMED]   |  <-- Top Status Bar
+-----------------------------------------------------------+
| AP: [=================== 840/999 ]   EP: [●●●●●●●●○○ 8/10]|  <-- Resource Bar
+-----------------------------------------------------------+
| +-------------------------------------------------------+ |
| |                                                       | |
| |             LIVE VIEWPORT SCREENCAST (WebP)           | |  <-- Live Canvas View
| |                                                       | |
| +-------------------------------------------------------+ |
| Route: #raid/301071   |   Turn: 5   |   Boss HP: 48.7%   |
+-----------------------------------------------------------+
| [ QUICK DAILY MACROS ]                                    |
| +-----------------------+       +-----------------------+ |
| |  ⚡ Magna Pro Skip    |       |  ⚔️ Hard Pro Skip     | |
| +-----------------------+       +-----------------------+ |
| +-----------------------+       +-----------------------+ |
| |  🛡️ Manacura Pro     |       |  🌟 Angel Halo Pro    | |
| +-----------------------+       +-----------------------+ |
+-----------------------------------------------------------+
| [ RAID JOINER ]                                           |
| [ Raid ID (e.g. 7F3B29A1)       ]   [ Paste Clipboard ]   |
| Summon: [ Omega (Colossus/Tiamat) v ]                      |
| [ ▶ JOIN RAID & FULL AUTO                             ]   |
+-----------------------------------------------------------+
| [ 🛑 EMERGENCY STOP ALL AUTOMATION                    ]   |  <-- Bottom Danger Bar
+-----------------------------------------------------------+
```

---

## 4. The Critical CAPTCHA Alarm Modal Specification

When the daemon emits `EVENT_CAPTCHA_TRIGGERED`, the Companion UI immediately hijacks the screen with an un-dismissible high-priority emergency modal:

```
+===========================================================+
| ! ! ! CRITICAL ALERT: VERIFICATION DETECTED ! ! !         |  <-- Flashing Red Header
+===========================================================+
| Automation has been INSTANTLY FROZEN.                     |
| Please solve the puzzle in your desktop browser.          |
|                                                           |
| +-------------------------------------------------------+ |
| |                                                       | |
| |           HIGH-RES CAPTCHA SCREENSHOT                 | |
| |                                                       | |
| +-------------------------------------------------------+ |
|                                                           |
| [ 🔊 SNOOZE AUDIO ALARM ]                                 |
| [ ✅ I HAVE SOLVED THE PUZZLE (RESUME)                 ]  |
+===========================================================+
```

### 4.1 Client Alarm Behavior
1. **Audio Beacon**: Loops a loud recurring attention chime using the Web Audio API or HTML5 Audio.
2. **Haptic Vibration**: Invokes `navigator.vibrate([500, 200, 500, 200, 1000])` continuously until acknowledged.
3. **Screen Wake Lock**: Invokes `navigator.wakeLock.request('screen')` to prevent the phone display from dimming or locking while the alert is active.

---

## 5. Front-End Technical Architecture (Single-File PWA)

To minimize deployment complexity, the Companion UI is structured as a zero-build-step single file (`index.html`) served directly by the Fastify gateway:

* **HTML5**: Semantic tags, accessible ARIA attributes.
* **Vanilla CSS**: CSS Custom Properties (Variables), Flexbox, CSS Grid, smooth transitions.
* **JavaScript**: Native ES6+, WebSocket client with automatic exponential backoff reconnection (`1s`, `2s`, `4s`, max `10s`).
* **PWA Manifest (`manifest.json`)**: Allows "Add to Home Screen" on iOS Safari and Android Chrome, enabling a full-screen, address-bar-free native app experience.
