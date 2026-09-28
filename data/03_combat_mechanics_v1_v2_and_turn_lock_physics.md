# Volume 3: Combat Mechanics (V1 & V2) and Turn-Lock Physics

## 1. Battle System V1: Foundational Mechanics

The classic combat engine (V1) governs older raids (Prototype Bahamut HL, Akasha, Grand Order HL, Lucilius Normal, etc.).

### 1.1 The Boss Mode Bar
- **Normal Mode**: Boss builds charge diamonds (1 diamond gained per turn elapsed or via specific special triggers).
- **Overdrive Mode**: Entered when the boss accumulates sufficient damage to fill the mode bar. Charge attacks deal significantly amplified damage or inflict severe raid-wide debuffs.
- **Break Mode**: Entered when the mode bar is depleted while in Overdrive. During Break:
  - The boss cannot gain charge diamonds.
  - The boss does not unleash diamond-based charge attacks.
  - "Break Assassin" (Salt) buffs grant 280% damage amplification.

### 1.2 Chain Burst (V1)
When multiple characters cast Charge Attacks (Ougi) in the same turn:
- **2-Chain**: Burst damage dealing ~25% bonus damage of the elemental affinity.
- **3-Chain**: Burst damage dealing ~35% bonus damage.
- **4-Chain (Full Burst)**: Burst damage dealing ~50% bonus damage up to damage cap (typically 1.68M base cap).
- **5+ Chain (Over Burst)**: Occurs when characters perform dual charge attacks (e.g. Kengo with Unsigned Kaneshige).

---

## 2. Battle System V2: Reactive Mechanics

Introduced in 6-Dragon Raids, Revans (Diaspora, Siegfried, Mugen, etc.), and Super Ultimate Bahamut (SUBHL), V2 alters turn flow from passive damage absorption to active condition solving.

```
+--------------------------------------------------------------------------+
|                            V2 Turn Resolution Loop                       |
|                                                                          |
|   1. Omen Appears (Yellow = Damage/Hit condition, Red = Uncancellable)    |
|                          |                                               |
|                          v                                               |
|   2. Engine Evaluates Party State                                        |
|         |                                        |                       |
|         +-- [Condition Can Be Cleared?]          +-- [Cannot Clear?]     |
|         |   - e.g. 30 hits, 15M skill dmg        |                       |
|         |   - Execute targeted skills/summons    |                       |
|         v                                        v                       |
|   3. Omen Cancelled! (Attack safely)     3. Engage Guard Mechanic        |
|                                             - Toggle .btn-guard (90% cut)|
|                                             - Mitigate fatal wipe        |
+--------------------------------------------------------------------------+
```

### 2.1 Omens (Predications)
Prior to turn execution, the boss announces its forthcoming special attack in the DOM and network state (`stage.pJsnData.boss.param[0].condition`):
- **Omen Types**:
  - **Cancelable (Yellow Ring)**: Displays an explicit requirement (e.g., "Deal 30 hits", "Deal 15M skill damage", "Activate 4 Charge Attacks", "Dispel 2 buffs").
  - **Uncancelable (Red Diamond)**: Cannot be broken by damage or hits; must be mitigated via Guard, 100% Cut (Phalanx + Carbuncle), or invulnerability buffs.
- **Cancellation Impact**:
  - Nullifies the boss's special attack entirely for that turn.
  - Resets all charge diamonds to 0.
  - Often inflicts "Stun" or defense reduction on the boss.

### 2.2 The Guard Mechanic
- Characters can be placed into Guard mode individually via `.btn-guard` or collectively.
- **Mitigation**: Incoming damage is reduced by **90%**.
- **Constraint**: A character in Guard mode **cannot attack, cannot gain charge bar from attacking, and cannot trigger counter-attacks**.

### 2.3 Fated Chain (FC)
- A dedicated 100-point gauge accumulates across turns at a rate of:
  $$\Delta \text{FC} = \text{Chain Count} \times 10\%$$
- When fully charged ($100\%$), unleashing Fated Chain deals ~4.5M plain damage to all enemies and frequently satisfies high-tier omen cancellation conditions.

---

## 3. Turn-Lock (Lockout) Physics & Mathematical Formulation

### 3.1 The Client-Server Asymmetry
When a player clicks "Attack" or when the client submits `/rest/multiraid/normal_attack_result.json`:
1. The server calculates the complete outcome (damage values, crits, HP changes, multi-attack procs, drops) in **50 to 120 milliseconds**.
2. The server responds with HTTP 200 containing the `scenario` array.
3. The client's CreateJS engine begins playing the animation frame-by-frame. A 4-chain full burst takes **12 to 14 seconds** to animate on screen.

### 3.2 The Server-Side Lockout Formula
To prevent players who refresh their browsers from attacking at infinite speed, the Cygames server enforces a **mandatory server-side lockout timer** ($L_{server}$).

The lockout duration is determined by the number of attack hits and charge attacks executed in that turn:

$$L_{turn} = L_{base} + \left( \sum_{i=1}^{P} H_i \times K_{hit} \right) + L_{ougi}(N_{ougi})$$

Where:
- $L_{base}$: Base network processing window $\approx 1.0\text{s}$
- $P$: Number of active party members attacking ($1 \le P \le 4$)
- $H_i$: Number of physical hits performed by character $i$ (Single = 1, Double = 2, Triple = 3, Quadruple = 4)
- $K_{hit}$: Lockout penalty per physical attack hit $\approx 0.35\text{s}$
- $N_{ougi}$: Number of Charge Attacks performed ($0 \le N_{ougi} \le 8$)

#### Charge Attack Lockout Multipliers ($L_{ougi}$)
| Charge Attacks Unleashed | Resulting Chain | Server Lockout Duration ($L_{ougi}$) | Total Animation Time (No Refresh) |
| :--- | :--- | :--- | :--- |
| **0 (Normal Attack, SA)** | None | **~1.2s - 2.0s** | ~2.5s |
| **0 (Normal Attack, TA)** | None | **~3.8s - 4.5s** | ~4.5s |
| **1 C.A.** | 1 Chain | **~4.0s** | ~6.0s |
| **2 C.A.** | 2-Chain Burst | **~6.5s** | ~9.0s |
| **3 C.A.** | 3-Chain Burst | **~9.0s** | ~11.5s |
| **4 C.A.** | 4-Chain Full Burst | **~12.5s - 13.5s** | ~16.0s |
| **5+ C.A.** | Over Burst | **~15.5s - 18.0s** | ~22.0s |

*Note: Bonus Damage (Echoes / Tsuika Damage) and Supplemental Damage do NOT increase server lockout time; they only increase damage calculations. This is why multi-hit Echo setups are the holy grail of high-speed racing.*

### 3.3 The Refresh (F5) Exploitation & Synchronization
Refreshing the page (`Page.reload()` or `#raid_multi/<raid_id>` hash reload) bypasses the client animation time ($T_{anim}$), collapsing it to the page reload time ($T_{reload} \approx 600\text{ms}$).

However, if the player attempts to attack before $L_{turn}$ has elapsed:
- The attack button is grayed out.
- Clicking or dispatching `/normal_attack_result.json` returns HTTP 200 with an error popup: *"Waiting for turn processing..."*.

#### Optimal Automation Wait Formula
To maximize Turns-Per-Minute (TPM) without triggering server lockout rejections:

$$T_{wait} = \max\left(0, L_{turn} - (T_{current} - T_{attack\_dispatched})\right) + \epsilon$$

Where $\epsilon$ is a humanized safety margin ($50\text{ms} \le \epsilon \le 150\text{ms}$).

---

## 4. Honor-to-Damage Formulas & Blue Chest Probability Curves

In high-tier raids (Gold Bar and Eternity Sand hosts), drops are governed by personal Contribution Points (Honors / 貢献度).

### 4.1 Damage to Honor Conversion
Honors are derived linearly from raw damage inflicted on the boss:

$$\text{Honors} = \left\lfloor \frac{\text{Damage}}{1000} \right\rfloor + \text{Bonus}_{\text{debuff/heal}}$$

- **100,000,000 damage (100M)** $\implies$ **100,000 Honors**
- **1,480,000,000 damage (1.48B / 148M actual boss HP)** $\implies$ **1,480,000 Honors (1.48M)**

---

### 4.2 Gold Bar Raids: Blue Chest Drop Thresholds

Blue Chests contain the ultra-rare **Gold Brick (Hihiirokane / ヒヒイロカネ)** with an internal drop rate between **1.0% and 1.5%** once the chest is secured.

The probability of obtaining the Blue Chest itself ($P_{blue}$) follows a piecewise curve based on personal honors ($H$):

```
Probability P(Blue)
  100% |                                      +------------------------
       |                                     /
   80% |                                    /
       |                                   /
   50% |                                  /
       |                                 /
   20% |                       +--------+
    0% +-----------------------+
       0                      0.8M     1.48M                 Honors (H)
```

#### Raid Threshold Matrix
| Raid Name | Boss Max HP | Blue Chest 100% Threshold | Target Damage | Optimal Turn Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Prototype Bahamut HL (PBHL)** | 2.00 Billion | **1,480,000 (1.48M)** | ~148 Million | 2 to 3 turns (Lucha / Viking burst) |
| **Akasha HL** | 1.20 Billion | **1,560,000 (1.56M)** | ~156 Million | 2 to 3 turns (Dark Lucha / Kengo) |
| **Grand Order HL (GOHL)** | 1.35 Billion | **1,480,000 (1.48M)** | ~148 Million | 1 to 2 turns (Light Nehan / Viking) |

#### Exact Blue Chest Mathematical Curve (PBHL Model)
$$P_{blue}(H) = \begin{cases} 
      0 & H < 500,000 \\
      0.15 \times \left(\frac{H - 500000}{300000}\right) & 500,000 \le H < 800,000 \\
      0.15 + 0.85 \times \left(\frac{H - 800000}{680000}\right)^{1.2} & 800,000 \le H < 1,480,000 \\
      1.00 & H \ge 1,480,000 
   \end{cases}$$

**Operational Rule for Automation**: Once the client network interceptor registers $\ge 1.48\text{M}$ honors in PBHL or $\ge 1.56\text{M}$ in Akasha, it must **immediately abort the battle** and proceed to join the next raid. Continuing to attack beyond this threshold yields zero additional Gold Bar expected value and wastefully ties up execution cycles.
