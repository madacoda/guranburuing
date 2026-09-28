# Principle 07: Reverse-Engineered Network API Reference

## 1. Executive Summary

Granblue Fantasy operates via a stateless HTTPS REST/JSON architecture. Every user action—from navigating menus to casting combat abilities—is transmitted as an individual HTTP transaction.

This document serves as an exhaustive reference of the internal API endpoints, request payloads, response schemas, required security headers, and common error responses.

---

## 2. Global Request Headers & Verification Standards

Every request sent to `https://game.granbluefantasy.jp` must include the following headers. Any mismatch flags the session on Cygames' edge proxy:

```http
POST /rest/multiraid/normal_attack_result.json HTTP/2
Host: game.granbluefantasy.jp
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36
Accept: application/json, text/javascript, */*; q=0.01
Accept-Language: en-US,en;q=0.9,ja;q=0.8
Content-Type: application/json; charset=UTF-8
X-Requested-With: XMLHttpRequest
X-VERSION: 1725901234
Origin: https://game.granbluefantasy.jp
Referer: https://game.granbluefantasy.jp/
Cookie: mbga_session=...; _ga=...
```

### 2.1 Critical Header Roles
* **`X-VERSION`**: The asset deployment build hash. If the server has deployed a hotfix and the client's `X-VERSION` does not match, all game endpoints respond with `{ "error": "version_error" }`.
* **`X-Requested-With`**: Must be `XMLHttpRequest`. Direct browser navigation or requests omitting this header will be rejected by the server firewall.
* **`Cookie`**: Contains the authenticated Mobage/DMM session credentials (`mbga_session`, `sp_token`, or DMM OAuth tokens).

---

## 3. Core API Endpoint Catalog

### 3.1 User & Session Endpoints

#### `GET /user/status`
Fetches current player vitals, energy pools, and currency balances.
* **Query Parameters**: `_=<timestamp>` (cache buster)
* **Response Schema**:
```json
{
  "status": {
    "now_ap": 840,
    "max_ap": 999,
    "now_ep": 10,
    "max_ep": 10,
    "level": 350,
    "rank": 350,
    "lupi": 99999999,
    "stone": 125400,
    "user_id": "12345678",
    "name": "Danchou"
  }
}
```

---

### 3.2 Quest & Daily Pro Skip Endpoints

#### `POST /quest/pro_skip/play`
Executes an instant batch Pro Skip clear for all daily island battles.
* **Request Payload**:
```json
{
  "quest_id": 300011,            // Target Pro Skip Group Identifier
  "use_item": true,              // Automatically use Half-Elixirs if AP is deficient
  "special_token": null
}
```
* **Response Schema**:
```json
{
  "success": true,
  "consumed_ap": 180,
  "rewards": {
    "exp": 120000,
    "rank_point": 96000,
    "rupees": 240000,
    "reward_list": [
      { "item_id": "1001", "name": "Tiamat Omega Anima", "count": 2 },
      { "item_id": "1002", "name": "Colossus Omega Anima", "count": 3 }
    ]
  }
}
```

---

### 3.3 Raid Assist & Joining Endpoints

#### `POST /rest/multiraid/quest_check`
Validates an external 8-character raid backup code before launching supporter selection.
* **Request Payload**:
```json
{
  "raid_id": "7F3B29A1",
  "special_token": null
}
```
* **Response Schema (Success)**:
```json
{
  "result": "success",
  "quest_id": "301071",          // Raid Quest ID (e.g. Proto Bahamut HL)
  "boss_name": "Proto Bahamut",
  "member_count": 14,
  "max_member_count": 18,
  "battle_status": 1,            // 1: Alive, 2: Defeated
  "consumed_ep": 3
}
```
* **Response Schema (Raid Dead / Completed)**:
```json
{
  "result": "error",
  "error_type": "already_ended",
  "message": "This battle has already ended."
}
```

---

### 3.4 Combat Engine Endpoints

#### `POST /rest/multiraid/start.json`
Initializes battle state, downloads party buffs, boss turn 1 stats, and initializes CreateJS canvas assets.
* **Request Payload**:
```json
{
  "raid_id": 98765432,
  "supporter_id": 10401,         // Supporter Summon Unique ID
  "party_id": 1
}
```

#### `POST /rest/multiraid/normal_attack_result.json`
Dispatches an attack turn. Triggers combat resolution, calculates damage dealt, updates turn counters, and receives enemy counterattack actions.
* **Request Payload**:
```json
{
  "raid_id": 98765432,
  "turn": 4,
  "ability_queue": []
}
```
* **Response Schema**:
```json
{
  "status": "success",
  "turn": 5,
  "boss": {
    "param": [
      {
        "hp": 1420500000,
        "hpmax": 2500000000,
        "recast": 2,             // Charge Diamonds
        "recastmax": 3
      }
    ]
  },
  "player": {
    "param": [
      { "hp": 48200, "hpmax": 52000, "alive": 1 },
      { "hp": 41000, "hpmax": 45000, "alive": 1 },
      { "hp": 39500, "hpmax": 42000, "alive": 1 },
      { "hp": 38000, "hpmax": 40000, "alive": 1 }
    ]
  }
}
```

#### `POST /rest/multiraid/ability_result.json`
Dispatches character ability activations.
* **Request Payload**:
```json
{
  "raid_id": 98765432,
  "ability_id": 1024,
  "pos": 1,                      // Frontline position (1 to 4)
  "target": 0
}
```

---

## 4. Standard Error Codes & Fallback Handlers

| Error Identifier | HTTP Code | Cause | Automated Action |
| :--- | :--- | :--- | :--- |
| `version_error` | 200 OK | New game build published; `X-VERSION` mismatch. | Hard reload page (`window.location.reload()`), re-read version header. |
| `already_ended` | 200 OK | Raid boss was defeated before join was committed. | Dismiss modal, release locks, return to idle. |
| `room_full` | 200 OK | Max player cap (30/30 or 18/18) reached. | Dismiss modal, release locks, return to idle. |
| `ep_insufficient` | 200 OK | Player has 0 EP remaining. | If configured, call `/item/use_normal_item` for Soul Berry; else abort. |
| `concurrent_access`| 200 OK | Multiple requests processed concurrently. | Pause all queues for 3000ms, sync state, resume sequentially. |
| `504 Gateway Timeout`| 504 | Cygames server load spike during Guild War. | Exponential backoff retry (1s, 2s, 4s). |
