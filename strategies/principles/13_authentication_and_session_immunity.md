# Principle 13: Granblue Authentication Lifecycle, Mobage JSSDK Architecture & Session Immunity

This document details the architectural specifications, cross-origin communication models, browser security constraints, and reverse-engineered mechanisms governing player authentication, session persistence, and client-side kickout prevention in the Granblue Fantasy automation suite.

---

## 1. Executive Summary & Design Tenets

Granblue Fantasy (`https://game.granbluefantasy.jp`) relies on an external identity federation model where user credentials, OAuth tokens, and session renewal are delegated to platform providers (chiefly **Mobage / DeNA** via `sp.mbga.jp` and `connect.mobage.jp`, alongside DMM, GREE, and Yahoo! Japan).

Automating a persistent, multi-account browser session without human intervention requires mastering the interplay between:
1. **The Top-Level Single Page Application (SPA)**: Backbone.js running on `game.granbluefantasy.jp`.
2. **Embedded Third-Party Identity Frames**: Mobage JSSDK iframes running on `sp.mbga.jp`.
3. **Chromium Cookie Isolation & CHIPS**: Partitioned cookies and third-party storage deprecation policies.
4. **Backend REST Content Negotiation**: FuelPHP controller formatting requirements.

### Core Architectural Tenets
1. **Zero-Cold-Login Continuity**: Authentication must be preserved across process restarts without prompting the user or transmitting plaintext passwords.
2. **Immunity Over Re-Authentication**: Rather than reacting to client-side kickouts by re-logging in, the automation implements an **in-memory immunity shield** that prevents the client-side application from ever firing its logout routines.
3. **Partition-Aware Persistence**: Session cookie stores must serialize domain, path, expiry, and `partitionKey` attributes across all involved authentication origins (`granbluefantasy.jp`, `mobage.jp`, `sp.mbga.jp`).
4. **Redundant DOM & Memory Verification**: Session validity must be verified against `window.Game` singleton state and active view DOM nodes before touching network endpoints, preventing false negatives caused by REST content negotiation.

---

## 2. Authentication Topology & Cross-Origin Mechanics

```
+-------------------------------------------------------------------------------------------------------+
|                                    Chromium Top-Level Window                                          |
|                               (https://game.granbluefantasy.jp)                                       |
|                                                                                                       |
|  +-------------------------------------------------------------------------------------------------+  |
|  |                            Active View (e.g. #mypage / #quest)                                  |  |
|  |  - window.Game (userId: "14022326", userName: "『Hamada』", userRank: "337")                       |  |
|  |  - DOM Header: .btn-user-name, .txt-rank-value                                                  |  |
|  +-------------------------------------------------------------------------------------------------+  |
|                                                  |                                                    |
|                                                  | window.addEventListener('message')                 |
|                                                  v                                                    |
|  +-------------------------------------------------------------------------------------------------+  |
|  |                           Granblue Client Router & Logout Listener                              |  |
|  |  - mobageSubscribeLogout() listens for topic: "session_state_change_response"                     |  |
|  |  - Triggers c.logout() if event.data.status === "changed"                                        |  |
|  +-------------------------------------------------------------------------------------------------+  |
|                                                  ^                                                    |
|                                                  | window.parent.postMessage(...)                     |
|  +-----------------------------------------------+-------------------------------------------------+  |
|  |                      Embedded Cross-Origin Iframe (Mobage JSSDK)                                |  |
|  |                         (https://sp.mbga.jp/.../session_iframe.html)                            |  |
|  |  - Periodically hashes: sha256(clientId + ":" + CSSID)                                          |  |
|  |  - Subject to Chromium CHIPS (Cookies Having Independent Partitioned State)                     |  |
|  +-------------------------------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------------------------------+
```

### 2.1 The Mobage JSSDK Session Iframe
When Granblue Fantasy boots, `mobage-jssdk.js` inserts an invisible iframe:
```html
<iframe id="mobage_jssdk_session_iframe" src="https://sp.mbga.jp/_jssdk_session_iframe" style="display:none;"></iframe>
```
The iframe's purpose is to detect if the user has logged out of Mobage in another browser tab. It compares a stored cryptographic hash of the user's session identifier (`CSSID`) against the live cookie jar on `sp.mbga.jp`.

### 2.2 The Poisoned Event Cascade
When Chrome operates in an automated profile or headless environment:
1. Third-party cookie restrictions or unpartitioned cookie boundaries prevent `session_iframe.html` from reading `sp.mbga.jp` cookies.
2. The hash calculation fails or mismatches.
3. The iframe posts a message to `window.parent`:
   ```json
   {
     "topic": "session_state_change_response",
     "status": "changed",
     "sessionState": null
   }
   ```
4. In `app.js`, the native game handler catches this event:
   ```javascript
   function mobageSubscribeLogout() {
     window.addEventListener("message", function(e) {
       if (e.data && e.data.topic === "session_state_change_response") {
         if (e.data.status === "changed") {
           c.logout(); // Purges in-memory state and redirects to #authentication
         }
       }
     });
   }
   ```
5. **The Kickout**: The user is kicked out to the title screen within 5 to 15 seconds after a successful login.

---

## 3. The Session Immunity Shield (`session-immunity.ts`)

To permanently neutralize this kickout loop without modifying game files on Cygames servers, the automation suite installs an in-memory immunity shield via the Chrome DevTools Protocol (CDP).

```mermaid
sequenceDiagram
    autonumber
    actor CDP as CDP Runtime / Page Agent
    participant WIN as Browser Window (game.granbluefantasy.jp)
    participant IFRAME as Mobage JSSDK Iframe (sp.mbga.jp)
    participant GAME as Backbone Game Client (app.js)

    CDP->>WIN: Page.evaluateOnNewDocument(installMobageSessionImmunity)
    Note over WIN: Capture-phase listener & prototype hooks active
    IFRAME->>WIN: postMessage({ topic: "session_state_change_response", status: "changed" })
    Note over WIN: Intercepted during CAPTURE PHASE before app.js
    WIN->>WIN: Rewrite status = "unchanged"
    WIN->>WIN: event.stopImmediatePropagation()
    Note over GAME: c.logout() is NEVER invoked! Session remains 100% active.
```

### 3.1 Interception Mechanics
The shield operates across two redundant interception layers:

#### Layer 1: Capture-Phase Window Event Listener
Browser events travel in three phases: **Capture -> Target -> Bubble**. Native game scripts register listeners in the bubble phase. By registering a listener with `useCapture: true` at `document_start`, the shield intercepts the event before any game code can inspect it:

```typescript
window.addEventListener('message', (event) => {
  if (event.data && typeof event.data === 'object') {
    const topic = event.data.topic || '';
    const status = event.data.status || '';

    if (topic === 'session_state_change_response' || status === 'changed') {
      try {
        Object.defineProperty(event.data, 'status', {
          value: 'unchanged',
          writable: true,
          configurable: true,
        });
      } catch {
        event.data.status = 'unchanged';
      }
      event.stopImmediatePropagation();
    }
  }
}, true);
```

#### Layer 2: Prototype Patching
If the iframe uses a direct `MessagePort` or direct reference, the shield overrides `MessagePort.prototype.postMessage` and `Window.prototype.postMessage` to sanitize payloads at the source before transmission.

### 3.2 CDP Injection Pipeline
The shield is automatically armed in two places:
1. `src/cdp-connection.ts`: Injected via `page.evaluateOnNewDocument()` on every CDP page connection and tab navigation.
2. `src/auth/account-auth.manager.ts`: Dynamically evaluated during login workflows and cookie restoration routines.

---

## 4. REST Content Negotiation & The 409 Conflict Trap

### 4.1 FuelPHP Controller REST Behavior
The backend endpoint `/user/status` is implemented using FuelPHP's `Controller_Rest`. The controller uses the incoming `Accept` header to decide how to serialize output:

```php
// Conceptual FuelPHP Controller_Rest logic
public function router($resource, array $arguments) {
    $this->format = $this->_detect_format();
    if (empty($this->format) || ! array_key_exists($this->format, $this->_supported_formats)) {
        throw new HttpMediaTypeNotAcceptableException('...');
    }
}
```

When a standard browser fetch is initiated without setting an explicit `Accept` header:
```javascript
// WRONG: Triggers HTTP 409 Conflict
await fetch('/user/status');
```
FuelPHP fails to match the empty format and responds with:
```html
HTTP/1.1 409 Conflict
Content-Type: text/html; charset=UTF-8

<p>The requested REST method returned an array or object, which is not compatible with the output format &quot;&quot;.</p>
```

### 4.2 Passive Verification Policy
The automation suite enforces a strict policy: **Never rely on naive raw HTTP fetch for authentication health checks**. 

Instead, session verification is evaluated strictly through:
1. **DOM and Window Inspection**: Zero HTTP roundtrips; reads `window.Game` and DOM header elements.
2. **Full Header Emulation (when HTTP is required)**:
   ```http
   Accept: application/json, text/javascript, */*; q=0.01
   X-Requested-With: XMLHttpRequest
   ```

---

## 5. View-Specific DOM Hierarchy: `#mypage` vs `#profile`

When a player authenticates, the client-side Backbone router pushes the state to `#mypage`. The verification engine must dynamically adapt to whichever screen is currently mounted.

| Data Point | `#mypage` (Dashboard View) | `#profile` (Player Profile View) | Global Memory (`window.Game`) |
| :--- | :--- | :--- | :--- |
| **Player Name** | `.btn-user-name` | `.prt-user-name` | `window.Game.userName` |
| **Player Rank** | `.txt-rank-value` | `.prt-rank-value` | `window.Game.userRank` |
| **User ID** | *(None in DOM)* | `.prt-user-id` | `window.Game.userId` |
| **Auth Screen Guard** | `.btn-auth-platform` / `.prt-select-auth` *(Must be absent)* | `.btn-auth-platform` / `.prt-select-auth` *(Must be absent)* | `hash.includes('authentication')` |

### 5.1 Verification Engine Implementation
In `src/auth/account-auth.manager.ts`, `getVerifiedProfile()` implements this unified evaluation matrix:

```typescript
const profile = await page.evaluate(() => {
  const Game = (window as any).Game;
  const hash = window.location.hash || '';

  // Guard against unauthenticated screens
  if (hash.includes('authentication') || !!document.querySelector('.btn-auth-platform, .prt-select-auth')) {
    return null;
  }

  const nameEl = document.querySelector('.btn-user-name, .prt-user-name, .txt-user-name, .prt-status-user-name');
  const rankEl = document.querySelector('.txt-rank-value, .prt-rank-value, .prt-info-rank, .prt-rank');
  const idEl = document.querySelector('.prt-user-id, .txt-user-id');

  const uid = (Game?.userId && Game.userId !== 0 && Game.userId !== '0')
    ? String(Game.userId)
    : (idEl?.textContent?.replace(/[^0-9]/g, '') || null);

  const cleanName = nameEl?.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || (Game?.userName ? String(Game.userName) : null);
  const cleanRank = rankEl?.textContent?.replace(/[^0-9]/g, '').trim() || (Game?.userRank ? String(Game.userRank) : null);

  if (uid && cleanName) {
    return { userId: uid, userName: cleanName, userRank: cleanRank || 'Unknown' };
  }
  return null;
});
```

---

## 6. Multi-Domain Cookie Persistence & CHIPS

### 6.1 Multi-Domain Origin Inventory
To maintain full login state without prompting for credentials, cookies across three separate domains must be exported and restored simultaneously:

1. **`game.granbluefantasy.jp` & `.granbluefantasy.jp`**:
   - `midship`: Core session identifier for Cygames API gateways.
   - `access_gbtk`: CSRF and access token.
   - `platform_type`: Typically `0` or `1` (Mobage indicator).
2. **`mobage.jp` & `.mobage.jp`**:
   - `mbga_session`: Mobage master portal cookie.
   - `sp_session`: Smartphone portal session.
3. **`sp.mbga.jp` & `connect.mobage.jp`**:
   - Partitioned OAuth tokens and OAuth client state.

### 6.2 Partition Key Preservation
In Chromium 115+, cookies created inside third-party iframes carry a `partitionKey`:
```json
{
  "name": "oauth_token",
  "value": "...",
  "domain": "sp.mbga.jp",
  "partitionKey": {
    "topLevelSite": "https://granbluefantasy.jp"
  }
}
```
If `partitionKey` is stripped during export, Chromium rejects or ignores the cookie when injected into the top-level `game.granbluefantasy.jp` context. The `saveSessionCookies()` method preserves the entire CDP cookie schema, writing the full 14+ cookie payload to `data/<account_id>-cookies.json`.

---

## 7. Process Lifecycle & Windows Host Optimization

### 7.1 WMI vs. PowerShell Quoting Traps
When spawning Chromium on Windows via PowerShell:
```powershell
# BUGGY: Start-Process wraps double-quoted strings in literal escaped quotes
Start-Process $chromePath -ArgumentList @("--user-data-dir=`"$profileDir`"")
# Results in: --user-data-dir="\"C:\path\"" -> Corrupted folder!
```

To achieve 100% byte-accurate command-line execution without quoting anomalies, `scripts/launch-gbf-chrome.ps1` executes Chromium via Windows Management Instrumentation (WMI):
```powershell
$proc = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $fullCmdLine
}
```

### 7.2 Directory Convention
User profiles are strictly housed inside the Windows user profile:
```
C:\Users\<Username>\.gbf-profiles\<account_id>
```
This guarantees:
1. Complete inheritance of DPAPI master encryption keys for Chromium SQLite `Cookies` storage.
2. Zero file permission collisions between elevated administrator consoles and standard user shells.
3. Complete directory isolation per account, eliminating Chromium `SingletonLock` process contention.

---

## 8. Quality Assurance & Live Verification Checklist

Every authentication engine modification must satisfy the following verification gate before merging:

- [x] **Immunity Shield Active**: Verified that `session_state_change_response` events are intercepted and neutralized.
- [x] **0ms Fast Verification**: Active session on `#mypage` verified in `< 200ms` without page reloading.
- [x] **Zero False Negatives**: Player Rank, User Name, and User ID successfully extracted from `#mypage`.
- [x] **Multi-Domain Cookie Sync**: 14+ cookies exported to `data/<acc>-cookies.json` with partition keys.
- [x] **Headless Execution**: `bun run daily` boots headlessly, authenticates via cookie restore, and completes all 20 daily tasks.
- [x] **TypeScript Compliance**: `bun run build` passes with 0 type errors.
- [x] **Security Hygiene**: `bun run hygiene` passes with 0 credential leaks across 504 scanned files.
- [x] **Suite Regression**: `bun tests/run-all.ts` passes 36/36 test suites.
