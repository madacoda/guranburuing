# Volume 2: Network Protocols & REST API Internals

## 1. Network Transport & HTTP/2 Architecture

Granblue Fantasy’s backend infrastructure is hosted on AWS (Tokyo region `ap-northeast-1`) behind CloudFront and high-performance reverse proxies.

- **Protocol**: HTTP/2 (ALPN: `h2`, `http/1.1`)
- **Transport Security**: TLS 1.3 / TLS 1.2
- **Session Authentication**: Cookie-based. GBF relies on partner platform OAuth tokens which exchange for an active session cookie:
  - Mobage: `sp_session_id`, `mobage_user_id`
  - DMM: `dmm_token`, `login_secure_id`
- **TLS & Client Fingerprinting (JA3 / JA4)**:
  - Cygames CloudFront distributions observe TLS cipher suite negotiation, HTTP/2 SETTINGS frames, and pseudo-header ordering (`:method`, `:authority`, `:scheme`, `:path`).
  - Raw `curl` or non-browser HTTP clients triggering combat endpoints will instantly present an anomalous JA3 signature and get flagged.
  - Automation engines MUST either run directly inside real Chromium (Puppeteer/CDP) or use a TLS-impersonating HTTP client (such as `curl-impersonate` or `tls-client`) mimicking Chrome's exact ClientHello and ALPN.

---

## 2. Mandatory HTTP Request Headers

Every XMLHttpRequest made by the GBF client to `game.granbluefantasy.jp` enforces a strict set of headers. If any header is missing or deviates from the expected format, the request triggers an immediate error (HTTP 403, 400, or `{"error": "invalid_request"}`).

```http
POST /rest/multiraid/normal_attack_result.json HTTP/2
Host: game.granbluefantasy.jp
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36
Accept: application/json, text/javascript, */*; q=0.01
Accept-Language: en-US,en;q=0.9,ja;q=0.8
Content-Type: application/json; charset=UTF-8
X-Requested-With: XMLHttpRequest
X-VERSION: 1726800000
Origin: https://game.granbluefantasy.jp
Referer: https://game.granbluefantasy.jp/
Cookie: <session_cookies>
```

### 2.1 The `X-VERSION` Header Lifecycle
- The `X-VERSION` header represents the client asset build timestamp or deployment hash.
- It is dynamically extracted by the client during initial load from the game script or HTML header:
  ```javascript
  // Extracted from window.Game.version or stage data
  const currentVersion = window.Game?.version || $('html').data('version');
  ```
- **Stale Version Handling**: If the server performs a silent deployment while an automation run is active, subsequent API requests will return:
  ```json
  {
    "version": "outdated",
    "redirect": "/#mypage"
  }
  ```
  The automation framework must catch this payload, refresh the browser context to obtain the latest version string, and resume the pipeline.

---

## 3. Reverse-Engineered Endpoint Catalog & Payloads

### 3.1 Battle Initialization: `/rest/multiraid/start.json`
- **Method**: `POST`
- **Trigger**: Sent upon loading the `#raid_multi/<raid_id>` view.
- **Request Payload**:
  ```json
  {
    "special_token": null,
    "raid_id": "12345678"
  }
  ```
- **Response Schema (Key Attributes)**:
  ```json
  {
    "battle_id": 987654321,
    "turn": 1,
    "multi": 1,
    "is_v2": 0,
    "boss": {
      "param": [
        {
          "cjs": "enemy_3040011",
          "name": "Proto Bahamut",
          "hp": 240000000,
          "hpmax": 240000000,
          "recast": 3,
          "recastmax": 3,
          "modeflag": 0,
          "modenext": 1
        }
      ]
    },
    "player": {
      "param": [
        {
          "pid": 1,
          "alive": 1,
          "hp": 32000,
          "hpmax": 32000,
          "recast": 0,
          "recastmax": 100,
          "leader": 1,
          "ability": {
            "1": {"id": 101, "state": "0", "recast": "0"},
            "2": {"id": 102, "state": "0", "recast": "0"},
            "3": {"id": 103, "state": "0", "recast": "0"},
            "4": {"id": 104, "state": "0", "recast": "0"}
          }
        }
      ]
    },
    "supporter": {
      "user_id": 999999,
      "summon_id": 2040003000
    }
  }
  ```

---

### 3.2 Turn Execution: `/rest/multiraid/normal_attack_result.json`
- **Method**: `POST`
- **Trigger**: Initiated when the player clicks "Attack" or when Auto-Attack triggers.
- **Request Payload**:
  ```json
  {
    "special_token": null,
    "raid_id": "12345678",
    "is_guard_status": 0,
    "is_auto": 0
  }
  ```
  *(Note: In V2 battles, `is_guard_status` contains a bitmask or array of character guard states).*

- **Response Schema (Key Attributes)**:
  ```json
  {
    "status": {
      "turn": 2,
      "timer": 3540,
      "burst": 0,
      "ability": {},
      "boss": {
        "param": [
          {
            "hp": 218450120,
            "recast": 2,
            "modeflag": 1
          }
        ]
      },
      "player": {
        "param": [
          { "pid": 1, "hp": 31200, "recast": 25 },
          { "pid": 2, "hp": 28500, "recast": 40 },
          { "pid": 3, "hp": 29000, "recast": 100 },
          { "pid": 4, "hp": 30000, "recast": 100 }
        ]
      }
    },
    "scenario": [
      {
        "cmd": "attack",
        "from": "player",
        "num": 4,
        "damage": [
          { "target": 1, "value": 750000 },
          { "target": 1, "value": 810000 },
          { "target": 1, "value": 790000 }
        ]
      },
      {
        "cmd": "special_npc",
        "name": "Ougi Name",
        "damage": [
          { "target": 1, "value": 4500000 }
        ]
      }
    ]
  }
  ```
- **Crucial Optimization Note**: The `scenario` array instructs CreateJS how to draw the animations. The server has **already** calculated the outcome. This is the foundation of the "F5 / Refresh" technique: once the server returns HTTP 200 for this request, the turn is permanently committed on the server, and the client animation sequence can be safely discarded by reloading the raid URL.

---

### 3.3 Ability Activation: `/rest/multiraid/ability_result.json`
- **Method**: `POST`
- **Trigger**: Activating a character ability (1 through 4).
- **Request Payload**:
  ```json
  {
    "special_token": null,
    "raid_id": "12345678",
    "ability_id": 102,
    "ability_sub_id": 0,
    "target_id": 0
  }
  ```
- **Response Schema**:
  ```json
  {
    "status": {
      "turn": 1,
      "player": { ... }
    },
    "scenario": [
      {
        "cmd": "ability",
        "name": "Dual Arts",
        "effect": "Double Ougi Active"
      }
    ]
  }
  ```
- **Ability Concurrency Rules**:
  - Abilities **cannot** be cast in parallel on the server.
  - Sending concurrent requests will result in an immediate HTTP 200 with `{"error": "concurrent_access"}` or an HTTP 500 error.
  - Each ability request must complete before the subsequent ability request is dispatched.

---

### 3.4 Summon Invocation: `/rest/multiraid/summon_result.json`
- **Method**: `POST`
- **Trigger**: Casting a main, sub, or supporter summon.
- **Request Payload**:
  ```json
  {
    "special_token": null,
    "raid_id": "12345678",
    "summon_id": 2040003000,
    "is_quick_summon": 1
  }
  ```
- **Summon Rules**: Only 1 summon invocation per player per turn is permitted.

---

### 3.5 Raid Status & Health Polling: `/quest/raid_info`
- **Method**: `POST`
- **Trigger**: Polling boss HP, participant count, and raid status without executing an action.
- **Request Payload**:
  ```json
  {
    "special_token": null,
    "raid_id": "12345678"
  }
  ```
- **Response Schema**:
  ```json
  {
    "raid_status": 1,
    "boss_hp_percent": 42.5,
    "member_count": 18,
    "point": 1485200
  }
  ```
- **Use Case**: Used by high-performance automation to inspect honor (`point`) thresholds and decide whether to abort or continue.

---

### 3.6 Post-Raid Reward Claiming: `/rest/multiraid/result_multi/data`
- **Method**: `GET` or `POST`
- **Trigger**: Sent when opening the `#result_multi/<raid_id>` view.
- **Response Schema**:
  ```json
  {
    "point": 1560000,
    "rank": 2,
    "reward": {
      "article": [
        { "item_id": "1001", "name": "Gold Brick", "count": 1, "box_type": "blue" },
        { "item_id": "104", "name": "Soul Balm", "count": 2, "box_type": "gold" }
      ]
    }
  }
  ```
- **Drop Chest Types**:
  - `box_type: "gold"`: Standard host/join chest.
  - `box_type: "red"`: Host chest or MVP/Vice-MVP chest.
  - `box_type: "blue"`: Special honor-based drop chest (Hihiirokane, Eternity Sand).

---

## 4. Error Codes & Recovery Matrix

| Error Identifier | HTTP Status | Root Cause | Automation Engine Response |
| :--- | :--- | :--- | :--- |
| `version_error` | 200 | Game version mismatch / new deployment | Force reload (`Page.reload()`), parse new `X-VERSION`, restart workflow |
| `already_ended` | 200 | Raid was defeated by other players | Catch error, navigate to `#quest/assist` or next raid |
| `room_full` | 200 | Raid reached maximum capacity (e.g. 18/18 or 30/30) | Clear pending raid queue, search next raid ID |
| `ep_insufficient` | 200 | Account has 0 EP remaining | Trigger Soul Berry usage endpoint (`/item/use`) or abort |
| `concurrent_access` | 200 | Request sent while previous action unresolved | Enforce strict async semaphore; wait 300ms and retry |
| `invalid_token` | 403/200 | Session expired or CSRF token invalidated | Re-authenticate session via OAuth or alert user |
| `429 Too Many Requests` | 429 | Exceeded requests/sec burst limit | Exponential backoff ($1.5 \times \text{delay}$), sleep 3000ms |
