# Volume 5: High-Performance Farming Blueprints

## 1. The Gold Bar (Hihiirokane) Trio

Gold Bar farming is the premier endgame activity in Granblue Fantasy. Efficiency is measured in **Honors Per Second (HPS)** and **Raids Joined Per Minute (RPM)**.

```
+-------------------------------------------------------------------------+
|                  Gold Bar Racing Execution Pipeline                     |
|                                                                         |
|  [Raid Discovery]                                                       |
|    - Intercept Raid Code via WebSocket / TweetDeck (~30-50ms)           |
|                                                                         |
|  [Join & Initial Handshake]                                             |
|    - POST /quest/battle_key_check -> POST /rest/multiraid/start.json   |
|    - Validate Boss HP > 60% (abort immediately if boss is at < 20%)     |
|                                                                         |
|  [Burst Sequence (2-3 Turns)]                                           |
|    - Turn 1: Pre-buffs + Tag Team (Luchador) -> Refresh                |
|    - Turn 2: Main Attack -> Refresh                                     |
|    - Turn 3 (Optional): Summon Qilin -> Tag Team -> Attack              |
|                                                                         |
|  [Threshold Validation & Egress]                                        |
|    - Inspect Honors >= Target (1.48M PBHL / 1.56M Akasha)               |
|    - Force-abort battle window, queue next raid code                    |
+-------------------------------------------------------------------------+
```

---

### 1.1 Prototype Bahamut HL (PBHL / Tsuno)
- **Raid Parameters**: 18 players, 2.0 Billion HP, Dark/Light/Multi-element shifts.
- **Blue Chest Ceiling**: **1,480,000 Honors (~148M Damage)**.
- **Meta Archetype 1: Dark Luchador (Fastest Burst)**
  - **Party**: MC (Luchador), Seox (Lv150), Nier, Predator.
  - **Grid Core**: 2x Pain and Suffering (Bwk), Fediel Spine, Skeletal Eclipse.
  - **Turn Flow**:
    - **Step 1**: Cast Nier Skill 1 (Field) $\rightarrow$ Nier Skill 3 (MC double strike).
    - **Step 2**: Cast Predator Skill 1, 2, 3 (Triple Strike, Assassin, Hostility).
    - **Step 3**: Cast Seox Skill 1 $\rightarrow$ Luchador Skill 1 (Tag Team).
    - **Step 4**: Execute page refresh via URL reload (bypassing animation).
    - **Step 5**: Click Attack $\rightarrow$ Immediate refresh.
    - **Step 6**: Validate honors $\ge 1.48\text{M}$. If below, invoke Qilin summon and repeat Tag Team.
  - **Total Real-Time Execution**: **14 to 18 seconds**.

- **Meta Archetype 2: Dark Ereshkigal (0-1 Button Zero Brain)**
  - **Weapon**: Ereshkigal (150 Gold Moon weapon).
  - **Setup**: Grants party-wide triple strike + 50% echo on turn 1 automatically.
  - **Turn Flow**:
    - Turn 1: Click Attack $\rightarrow$ Refresh.
    - Turn 2: Click Attack $\rightarrow$ Refresh.
    - Blue Chest reached in **8 seconds total**.

---

### 1.2 Akasha HL
- **Raid Parameters**: 18 players, 1.2 Billion HP, Dark element.
- **Blue Chest Ceiling**: **1,560,000 Honors (~156M Damage)**.
- **Unique Raid Physics: Turn Acceleration**:
  - The Akasha field shifts time forwards randomly by **1, 2, or 3 turns** after every action.
  - *Strategic Advantage*: Character skill cooldowns tick down at $2\times$ to $3\times$ speed, allowing powerful long-cooldown skills to be reused in rapid succession.
  - *Strategic Hazard*: Short-duration buffs (1-turn assassin, cuts) expire prematurely if turn jumps occur unexpectedly.
- **Execution Blueprint**:
  - Target: Focus on multi-turn high-cap burst (Light Viking / Relic Buster or Dark Luchador).
  - Maintain awareness of the 55% and 25% phase changes (Phantasmagoria triggers plain damage and buff clears).

---

### 1.3 Grand Order HL (GOHL)
- **Raid Parameters**: 18 players, 1.35 Billion HP, Light element.
- **Blue Chest Ceiling**: **1,480,000 Honors (~148M Damage)**.
- **Unique Raid Physics: The Grand Order Field**:
  - Amplifies critical hit damage and elemental weakness modifiers.
- **Meta Archetype: Light Nehan + Florence Hyper-Burst**:
  - **Party**: MC (Relic Buster / Viking), Nehan, Mugen (Halloween), Florence (Relic Buster target).
  - **Execution**:
    - Florence Skill 1 targets MC (grants all skills reset and massive damage cap).
    - Nehan Skill 1, 2, 3 (party-wide double strike, guaranteed TA, light echo, bonus cap).
    - Mugen Skill 2 (perpetual amp).
    - Turn 1 Attack $\rightarrow$ Refresh.
    - Raid cleared to 1.5M honors in **1 single turn (6 seconds total)**.

---

## 2. Guild Wars (Unite & Fight / Kouki) Speed Farming

Guild Wars demands maximum raw AP/EP efficiency and ultra-low latency execution over consecutive 17-hour days.

### 2.1 Meat Farming: EX+ (24M / 25M HP 1-Turn Kill)
The goal is to eliminate the 24,000,000 HP boss in **0 buttons, 0 summons (0b0s)**:
- **0b0s Execution Flow**:
  1. Load `#quest/supporter/...`
  2. Select Supporter Summon via CDP click (or skip if predetermined)
  3. Load battle screen
  4. Immediately dispatch `/rest/multiraid/normal_attack_result.json`
  5. Intercept server response (confirming boss HP = 0)
  6. Force reload directly to `#quest/supporter/...` to initiate next meat battle without viewing the victory screen.
- **Cycle Time**: **3.8 to 4.5 seconds per run** ($\sim 800\text{--}900$ meat/hour).

### 2.2 Nightmare (NM) Boss Tiers
- **NM90 (42M HP)**: 1-Turn burst setups (similar to EX+ expanded).
- **NM95 (131M HP)**: 2 to 3-turn burst utilizing assassin setups.
- **NM150 (288M HP)**: 4 to 6-turn setup incorporating dispel management and defense piercing.
- **NM200 (575M HP)**: Endurance high-speed setups requiring automated dispel condition solving (V2 omens or heavy buff wiping) and sustain.

---

## 3. Replicard Sandbox (Here Be Swords / Staves)

Sandbox farming is the foundation for Evoker 5-Star uncaps, New World Foundation weapons, and Ideian/Astron stockpiles.

### 3.1 Sephira Box Acceleration
- Defeating standard mobs fills the Sephira Gauge (5 slots).
- When the 5th slot fills, a **Sephira Treasure Box** drops (containing Ideians, Astrons, Lusters, or Verums).
- **Optimal Mob Target**: 1-Gauge Mobs (low HP, ~20M–22M HP).
- **Execution Blueprint**:
  - MC with 0-button auto-attack grid (Ereshkigal Dark or Hraesvelgr Water).
  - Loop: Battle Start $\rightarrow$ Normal Attack $\rightarrow$ Instant Page Reload $\rightarrow$ Repeat.
  - Yield: 1 Sephira Box every 5 battles ($\sim 45\text{ seconds}$).

---

## 4. Daily Pro Skip Routines

The game permits instantaneous batch resolution of daily standard raids via the "Pro Skip" feature:
- **Omega Pro Skip (Magna I)**: Clears Tiamat, Colossus, Leviathan, Yggdrasil, Luminiera, and Celeste in 1 request.
- **Omega II Pro Skip (Magna II)**: Clears Shiva, Europa, Alexiel, Grimnir, Metatron, and Avatar in 1 request.
- **Endpoint**:
  ```http
  POST /quest/pro_skip HTTP/2
  Host: game.granbluefantasy.jp
  Content-Type: application/json
  
  {
    "quest_id": 305001
  }
  ```
- Automating this daily at 05:00 JST (server reset) guarantees daily animas, quartz, and fodder in under 2 seconds of network time without rendering a single canvas frame.
