# Principle 15: Human Behavioral Mimicry, Farming Cadence & Account Maintenance

## 1. Executive Summary & Behavioral Entropy

Modern game telemetry systems (such as Cygames' heuristics) detect automation not merely through client-side API checks, but through **macro-level statistical anomalies**:

```
+------------------------------------+------------------------------------+
| Unsafe Botting Telemetry           | Human Player Telemetry             |
+------------------------------------+------------------------------------+
| • 8–16 hours uninterrupted farming | • 45–75m sessions with rest pauses |
| • Exclusively 1 raid (e.g. PBHL)   | • Mixed activity (GB + leech + M3) |
| • 0 page visits outside of combat  | • Checks inventory, shop, missions |
| • Zero-millisecond direct hash URL | • Natural UI navigation through    |
|   jumping (#quest/assist)          |   #mypage, #quest, and menus       |
| • Fixed uniform sleep intervals    | • Log-normal reaction times with   |
|                                    |   fatigue drift and hesitations    |
| • Ignores monthly shop resets      | • Purchases monthly pots & berries |
+------------------------------------+------------------------------------+
```

To achieve true human-grade longevity, automation must move beyond simple click scripts. It must operate as an **autonomous human player simulation** with natural session rhythms, multi-raid variety, periodic supply audits, and calendar-aligned shop maintenance.

---

## 2. The 4-Phase Human Farming Cadence

Rather than continuous infinite looping on a single raid, the **Human Farming Cadence** breaks execution into realistic, organic player cycles:

```
                      ┌──────────────────────────────────────┐
                      │        Phase 1: Priority GB          │
                      │  • 15–25 Raids (PBHL / Akasha / GO)  │
                      │  • Blue chest honor burst & exit     │
                      └──────────────────┬───────────────────┘
                                         │
                                         ▼
                      ┌──────────────────────────────────────┐
                      │        Phase 2: Variety Leech        │
                      │  • 2–4 Random Assist Raids           │
                      │  • Magna 3 / Six Dragons / Revans    │
                      │  • 1-turn burst / drop leeching      │
                      └──────────────────┬───────────────────┘
                                         │
                                         ▼
                      ┌──────────────────────────────────────┐
                      │      Phase 3: Supply / Inventory     │
                      │  • Navigate to #item or #shop        │
                      │  • Audit Gold Bar & Elixir counts    │
                      │  • Check Skyscope mission rewards    │
                      └──────────────────┬───────────────────┘
                                         │
                                         ▼
                      ┌──────────────────────────────────────┐
                      │       Phase 4: Natural Rest Gap      │
                      │  • Randomized 8–20 minute pause      │
                      │  • Return to #mypage (idle state)    │
                      │  • Optional fatigue cool-down        │
                      └──────────────────┬───────────────────┘
                                         │
                                         └──► (Loop to Phase 1)
```

### Phase 1: Priority Gold Bar (GB) Burst Farming (70% – 80% Weight)
- **Primary Objective**: Blue Chest Gold Bar hunting across the Big Three:
  - **Proto Bahamut HL (PBHL)**: Slot 4, 1.48M target honor.
  - **Akasha HL**: Slot 3, 1.56M target honor.
  - **Grand Order HL (GO HL)**: Slot 2, 1.48M target honor.
- **Dynamic Rotation**: The engine scans PBHL first; if no eligible rooms (HP 70%–90%, <4 players) exist, it checks Akasha, then GO HL, preventing idle waiting.
- **Batch Claims**: Pending battles are claimed in batches of 3 to 5 to maximize throughput while staying below GBF's 5-unclaimed limit.

### Phase 2: Casual Variety & Leech Interleaving (15% – 20% Weight)
- **Why Real Players Leech**: Real players frequently open the multi-raid backup tab and join dying high-level raids (HP ≤ 20%) to consume excess EP, gather host materials (Omega anima, dragon jewels), farm weapon copies, or cap weekly Renown/Prestige pendants.
- **Mimicry Value**: A profile that does 20 PBHL raids and then joins 2 random Magna 3 raids (e.g. Colossus Ira or Tiamat Aura) displays an organic interest in general game progression, breaking linear botting fingerprints.

### Phase 3: Inventory & Supply Audits (Every 30–50 Raids)
- **Why It Matters**: A human player who farms Gold Bars frequently checks their inventory to see their total Gold Brick count (`ヒヒイロカネ`), Damascus crystals, and Half Elixir reserves.
- **Execution**: The bot navigates to `https://game.granbluefantasy.jp/#item`, scans the inventory DOM, logs the exact counts, and saves a JSON snapshot.

### Phase 4: Natural Rest Gaps & Circadian Limits
- **Fatigue Modeling**: Continuous playtime should be capped at **45 to 75 minutes**.
- **Rest Interval**: After each session, the bot navigates to `#mypage` and rests for **8 to 22 minutes** (sampled from a Gaussian distribution).
- **Overnight Sleep Block**: Optional blackout period (e.g. 02:00 to 07:00 JST) during which no automated farming occurs, perfectly mimicking a player sleeping.

---

## 3. Inventory & Supply Auditing Architecture

### 3.1 Item Identification & Extraction
GBF manages items through category tabs under `#item`:
- **Evolution / Special Items (`#item/evolution` or `/item/evolution_list`)**:
  - `Gold Brick / Gold Bar (ヒヒイロカネ)`: Item ID `20004`
  - `Damascus Ingot (ダマスカス鋼)`: Item ID `20005`
  - `Damascus Crystal (ダマスカス骸晶)`: Item ID `20006`
  - `Perpetuity Ring (久遠の指輪)`: Item ID `20015`
- **Recovery Items (`#item/recovery` or `/item/recovery_and_evolution_list`)**:
  - `Half Elixir (エリクシールハーフ)`: Item ID `20002`
  - `Soul Berry (ソウルシード)`: Item ID `20003`
  - `Full Elixir (エリクシール)`: Item ID `20001`
- **Moons & Currencies**:
  - `Gold Moon (ゴールドムーン)`: Item ID `20013`
  - `Silver Moon (シルバームーン)`: Item ID `20012`
  - `Bronze Moon (ブロンズムーン)`: Item ID `20011`

### 3.2 Audit Telemetry Ledger
Snapshots are recorded to `logs/inventory-audit.json` with historical tracking:
```json
{
  "timestamp": "2026-10-14T15:30:00.000Z",
  "jstDate": "2026-10-15",
  "supplies": {
    "goldBars": 14,
    "damascusIngots": 8,
    "damascusCrystals": 42,
    "halfElixirs": 6850,
    "soulBerries": 34200,
    "goldMoons": 145,
    "silverMoons": 320,
    "bronzeMoons": 1150
  },
  "deltaSinceLastAudit": {
    "goldBars": +1,
    "halfElixirs": -45,
    "soulBerries": -120
  }
}
```

---

## 4. Monthly Shop & Moon Exchange Routines

In Granblue Fantasy, high-value monthly trade allowances reset at **05:00:00 JST on the 1st day of every month**.

### 4.1 Moon Exchange (`#shop/exchange/list/11`)
- **Bronze Moons**: Players universally convert surplus Bronze Moons into Half Elixirs (e.g., 5 Bronze Moons = 100 Half Elixirs).
- **Silver Moons**: Exchanged for Half Elixirs or stored for Damascus Ingots (20 Silver Moons).
- **Gold Moons**: Monitored and saved (100–150 for Superlative/Illuminated weapons or Siero's Special Pick Ticket).

### 4.2 Monthly Casino Stock (`#casino/exchange`)
- Monthly allotment of Half Elixirs (100 pots) and Soul Berries (200 berries).
- Monthly Omega Animas (Tiamat, Colossus, Leviathan, Yggdrasil, Luminiera, Celeste).

### 4.3 Autonomous Calendar Trigger
On the 1st of each month (after 05:00 JST), the scheduler or human orchestrator can autonomously execute:
```ts
if (isFirstDayOfMonthJst() && !hasExecutedMonthlyResetThisMonth()) {
  await monthlyShopService.executeMonthlyTradePipeline();
}
```

---

## 5. Non-Linear UI Navigation vs. Direct Hash Warping

### The Detection Hazard of Direct Hash Warping:
Naive bots repeatedly invoke:
```js
location.hash = '#quest/assist';
// ... combat ...
location.hash = '#quest/assist';
```
In genuine browser usage, a user clicks through the navigation tree. Granblue's client monitors route transitions through Backbone.js/Zepto history listeners.

### The Humanized Routing Protocol:
```
[In Combat / Result]
         │
         ▼
[Click "OK" on Result Modal]
         │
         ▼
[Navigates to #mypage or #quest naturally]
         │
         ▼ (Natural 400ms – 900ms log-normal hesitation)
[Click Top Nav / Footer Menu "Quests" (.btn-quest)]
         │
         ▼
[Click "Raids" / "Backup Requests" Tab (.btn-multi)]
         │
         ▼
[Select Target Slot]
```

To balance performance with realism:
- High-frequency burst loops (during an active 30-minute GB session) can use direct navigation to keep up with competitive raid fill speeds.
- Between sessions, transition points, and rest breaks, the engine **must perform organic UI navigation** through `#mypage` and menu headers.

---

## 6. Implementation Blueprint

| Component | Responsibility | Location |
| :--- | :--- | :--- |
| `InventoryAuditorService` | Navigates to `#item`, parses supply counts, and writes JSON/MD ledgers | `src/services/behavior/inventory-auditor.service.ts` |
| `MonthlyShopRoutineService` | Purchases monthly Half Elixirs / Berries from Moon & Casino shops on the 1st of the month | `src/services/behavior/monthly-shop-routine.service.ts` |
| `HumanCadenceOrchestrator` | Coordinates the 4-phase cadence: GB priority + variety leech + rest gaps + inventory check | `src/services/behavior/human-cadence-orchestrator.service.ts` |
| `CLI: farm:human` | CLI entry point to launch the human-cadence farming loop | `src/cli/run-human-cadence.ts` |
| `Discord Command: /gbf farm:human` | Remote operator command to start human-cadence farming | `src/services/discord/discord-command-gateway.service.ts` |
| `Discord Command: /gbf inventory` | Remote command to view current Gold Bar and Elixir counts | `src/services/discord/discord-command-gateway.service.ts` |
