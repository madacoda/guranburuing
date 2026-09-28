# Principle 02: Automation Mechanics & Gameplay Workflows

## 1. Executive Summary

Automating tasks in Granblue Fantasy requires a robust, event-driven state machine that operates deterministically within the browser's DOM and routing constraints. This document details the exact mechanics, DOM structures, state transitions, and exception-handling logic for two primary use cases:
1. **Daily Pro Skip Automation ("Fight All -> OK")**: Zero-combat batch clearing of daily island and treasure quests.
2. **Raid Joining & Combat Automation**: Automated raid code entry, supporter summon selection, and in-game Full Auto (FA) execution.

---

## 2. Daily Pro Skip Workflows ("Fight All -> OK")

Cygames provides "Pro Skip" features to condense daily farming into 1-click batch transactions. These consume AP instantly and award all accumulated experience, rank points, and drop chests without entering the combat engine.

### 2.1 The Supported Pro Skip Categories

| Pro Skip Target | Route / Location | AP Cost | Requirements & Scope |
| :--- | :--- | :--- | :--- |
| **Hard Pro** | `#quest/extra` -> Island section | 90 AP | Instantly clears all 6 elemental Hard battles (Tiamat, Colossus, Leviathan, Yggdrasil, Luminiera, Celeste). |
| **Magna / Extreme Pro** | `#quest/extra` -> Island section | 180 AP | Instantly clears all 6 elemental Extreme Magna battles (Tiamat Omega, Colossus Omega, etc.). |
| **Manacura / Impossible Pro** | `#quest/extra` -> Island section | 240 AP | Clears the 6 Magna HL Impossible daily battles. |
| **Angel Halo Pro** | `#quest/extra` -> Special section | 60 AP | Clears 3 runs of Angel Halo simultaneously. |
| **Event Daily Skips** | `#event/...` | 0 - 30 AP | Clears the daily event battle for active scenario events. |

---

### 2.2 Pro Skip State Machine Execution Model

```
+-----------------------------------------------------------------------------------------+
|                                  Pro Skip State Machine                                 |
+-----------------------------------------------------------------------------------------+

 [STATE: INIT]
       |
       | 1. Navigate Hash: #quest/extra (or #quest/island)
       v
 [STATE: AWAIT_ROUTE_RENDER]
       |
       | 2. Observe DOM for `.prt-extra-list` or `.prt-island-list`
       v
 [STATE: INSPECT_PRO_SKIP_STATUS]
       |
       +---> (Already Cleared: 0/1 left, `.disable` / `.is-completed`) ---> [STATE: EXIT_SUCCESS]
       |
       +---> (Available: `.btn-pro-skip` visible & active)
       v
 [STATE: CHECK_AP_RESOURCES]
       |
       +---> (AP >= Required) --------------------------------------+
       |                                                            |
       +---> (AP < Required)                                       |
             |                                                      |
             v                                                      |
       [STATE: REPLENISH_AP]                                        |
             | - Wait for AP recovery modal (.pop-usual)            |
             | - Select Half-Elixir (.btn-use-item)                 |
             | - Click Confirm (.btn-usual-ok)                      |
             v                                                      |
       [STATE: DISPATCH_PRO_SKIP] <---------------------------------+
             |
             | 3. Dispatch humanized click on `.btn-pro-skip`
             v
 [STATE: CONFIRM_PRO_SKIP_MODAL]
             |
             | 4. Wait for confirmation dialogue (`.pop-usual`)
             | 5. Dispatch humanized click on `.pop-usual .btn-usual-ok`
             v
 [STATE: AWAIT_TRANSACTION_RESPONSE]
             |
             | 6. Wait for `/quest/pro_skip/play` HTTP response
             v
 [STATE: DISMISS_REWARD_MODAL]
             |
             | 7. Wait for reward summary container (`.prt-result-head`, `.pop-usual`)
             | 8. Click Close / OK (`.btn-usual-ok` or `.btn-usual-cancel`)
             v
 [STATE: COMPLETE_IDLE]
```

---

### 2.3 Exact DOM Selectors for Pro Skip Elements

```
+-------------------------------------------------------------------------+
| Dialog: .pop-usual                                                      |
| +---------------------------------------------------------------------+ |
| | Title / Description: .prt-popup-header, .txt-popup-body             |
| | "Play all Pro quests for today?"                                    |
| +---------------------------------------------------------------------+ |
| | Cancel Button:                 | Confirm Button:                    | |
| | .btn-usual-cancel              | .btn-usual-ok                      | |
| +--------------------------------+------------------------------------+ |
+-------------------------------------------------------------------------+
```

* **Pro Skip Button Container**: `div[data-location-href*="pro_skip"]` or `div.btn-pro-skip`.
* **Disabled Flag**: If cleared, button has class `.disable`, `.is-completed`, or text indicator `0/1`.
* **Modal Overlay Wrapper**: `.pop-usual`.
* **Modal Affirmative Button**: `.pop-usual .btn-usual-ok`.
* **Modal Dismiss / Cancel**: `.pop-usual .btn-usual-cancel`.
* **AP Recovery Item Selector**: `.prt-item-list .btn-use-item[data-item-id="1"]` (Half-Elixir).

---

## 3. Raid Joining & Battle Automation

Joining public or private raids requires coordinating URL navigation, summon selection, battle initialization, Full Auto activation, and outcome monitoring.

### 3.1 The Raid Lifecycle State Machine

```
+-----------------------------------------------------------------------------------------+
|                                    Raid Automation FSM                                  |
+-----------------------------------------------------------------------------------------+

 [STATE: IDLE]
       |
       | (Receive Command: JOIN_RAID with raidCode e.g. "A7F391B2")
       v
 [STATE: NAVIGATE_ASSIST]
       |
       | 1. Navigate Hash: #quest/assist
       | 2. Await DOM header `.prt-assist-header`
       v
 [STATE: SWITCH_TO_ENTER_ID]
       |
       | 3. Click "Enter ID" tab: `.tab-enter-id` (Hash: #quest/assist/enter_id)
       | 4. Wait for text input element: `input.frm-raid-id`
       v
 [STATE: INPUT_RAID_CODE]
       |
       | 5. Clear input field, simulate human typing with random key delays (40-120ms)
       | 6. Click Join button: `.btn-post-key` (triggers `/rest/multiraid/quest_check`)
       v
 [STATE: EVALUATE_JOIN_RESPONSE]
       |
       +---> [EXC: RAID_ENDED] ("This battle has already ended")
       |     - Dismiss modal: click `.btn-usual-ok`
       |     - Return to [STATE: IDLE] with status `RAID_EXPIRED`
       |
       +---> [EXC: ROOM_FULL] ("Maximum participants reached")
       |     - Dismiss modal: click `.btn-usual-ok`
       |     - Return to [STATE: IDLE] with status `ROOM_FULL`
       |
       +---> [EXC: EP_INSUFFICIENT] (0 EP remaining)
       |     - If autoReplenishEp == true: Click `.btn-use-item` (Soul Berry) -> Retry
       |     - Else: Dismiss -> Return to [STATE: IDLE] with status `EP_EMPTY`
       |
       +---> [SUCCESS: SUMMON_SELECT_SCREEN]
             v
 [STATE: SELECT_SUPPORTER_SUMMON]
       |
       | 7. Hash: #quest/supporter/...
       | 8. Scan supporter summon list: `.prt-supporter-list .btn-supporter`
       | 9. Match preferred summon (e.g. Omega, Optimus, Lucifer, Bahamut)
       | 10. Click matched summon card
       v
 [STATE: AWAIT_BATTLE_INIT]
       |
       | 11. Hash transitions to `#raid/<raid_id>` or `#multiraid/<raid_id>`
       | 12. Await Canvas load (`#canv`, `#cjs-canvas`) and battle UI DOM overlay
       v
 [STATE: ENGAGE_FULL_AUTO]
       |
       | 13. Wait for combat interactive readiness: `.btn-auto` or `.btn-ability-auto` visible
       | 14. Check if Full Auto is already engaged; if not, dispatch click
       | 15. Verify `.btn-auto.active` class is applied
       v
 [STATE: COMBAT_OBSERVER_LOOP]
       |
       | 16. Periodic Polling (every 1.5s - 2.5s):
       |     - Sentinel Check: Inspect for `.img-verification` (CAPTCHA)
       |     - Battle Check: Read enemy HP from `.txt-enemy-hp` or Canvas status
       |     - Turn Check: Read active turn counter
       |     - Completion Check: Detect navigation to `#result_multi` or modal `.pop-raid-result`
       v
 [STATE: COLLECT_LOOT_AND_FINALIZE]
       |
       | 17. On `#result_multi`: Dismiss reward modals, record honors and drops
       | 18. Return to [STATE: IDLE]
```

---

## 4. Key Error Boundaries & Recovery Matrix

| Scenario | Detection Selector / Condition | Immediate Recovery Action |
| :--- | :--- | :--- |
| **Battle Already Ended** | `.pop-usual .txt-popup-body` contains `"ended"` or `"終了"` | Click `.btn-usual-ok`, abort join, log `RAID_ALREADY_DEAD`, return to idle. |
| **Room Full (30/30)** | `.pop-usual .txt-popup-body` contains `"participants"` or `"参戦人数"` | Click `.btn-usual-ok`, abort join, log `RAID_ROOM_FULL`, return to idle. |
| **Network Lag / 504 Gateway** | HTTP 504 on `/rest/` or modal `.pop-usual` with `"network error"` | Wait 3000ms, click `.btn-usual-ok` (Retry) or reload current hash route. |
| **Client Version Outdated** | Server returns `{ error: "version_error" }` | Hard reload page (`location.reload()`), wait for `#mypage`, resume state. |
| **Stuck in Combat Loop** | Boss HP does not change for > 90 seconds | Dispatch CDP `Page.reload()`, re-enter battle instance (GBF saves turn state server-side). |
| **Verification CAPTCHA** | `.img-verification` or `.verification` present | **SENTINEL HARD HALT**. Freeze all input, trigger push notification, wait for manual human solve. |

---

## 5. Event-Driven vs Polling Paradigm

To prevent race conditions, the automation engine must strictly avoid naive `setTimeout()` chaining:

* **Hash Synchronization**: All transitions must verify that `window.location.hash` matches the target state before inspecting the DOM.
* **MutationObserver Watching**: Attach observers to `.cnt-quest`, `.cnt-raid`, and `.prt-popup-body` to react immediately when elements mount into the DOM.
* **Network Idle Barriers**: Before dispatching clicks on action buttons, ensure there are **zero active in-flight XHR/fetch requests** to eliminate double-submission bugs.
