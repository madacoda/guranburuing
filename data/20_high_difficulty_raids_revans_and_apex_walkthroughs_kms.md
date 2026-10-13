# Volume 20: High-Difficulty Raids, Revans & Apex Walkthroughs

**Companion Catalog:** [`data/raids/revans-and-apex-walkthroughs.catalog.json`](file:///c:/laragon/www/guranburuing/data/raids/revans-and-apex-walkthroughs.catalog.json)  
**Schema:** [`data/schemas/revans-and-apex.schema.json`](file:///c:/laragon/www/guranburuing/data/schemas/revans-and-apex.schema.json)  

---

## 1. Battle System 2.0 & Raid Overview

High-difficulty raids in Granblue Fantasy operate almost exclusively on **Battle System 2.0 (V2)**, introducing:
1. **Omen Telegraphs**: Upcoming boss special attacks are declared with precise cancel conditions (e.g., hit count, damage thresholds, debuffs, skill types).
2. **Guard Mechanics**: Guarding reduces incoming elemental and plain damage by $90\%$, but forfeits the character's turn action.
3. **Fatal Chain (FC)**: A 100% gauge filled by executing 4-chain bursts, required to cancel designated high-threat omens.

This volume formalizes the tactical playbooks for the three pinnacle raid tiers: **Magna 3 (Omega Rebirth)**, **Revans Impossible Series (6-Man)**, and **Apex Super Endgame Raids**.

---

## 2. Magna 3 (Omega Rebirth) Mechanics & Strategy

Magna 3 raids (850M HP, 18-player, V2) drop the Exalted series weapons and Omega Rebirth anima required to uncap Magna summons to Lv 250:

| Raid | Element | Boss Mechanic | Core Omen & Cancel Requirement | Optimal Counter Roster |
| :--- | :--- | :--- | :--- | :--- |
| **Colossus Ira** | Fire | Heat Dissipation & High DEF | **75% Magma Core**: Deal 30M DMG or 35 hits.<br>**25% Dimensional Cleave**: 4 Ougis or 40 hits. | Water Kengo Ougi Loop: Vajra + Haaselia (FLB) + Poseidon. |
| **Tiamat Aura** | Wind | Tempest Barrier (Immune to non-crit) | **80% Aerial Jail**: Deal 25M Critical Damage.<br>**20% Supercell**: Cast 4 Skills or 36 hits. | Fire Percival Burst: Percival (Grand) + Michael + Zeta. |
| **Leviathan Mare** | Water | Tsunami Counters & Skill Sealing | **70% Abyssal Tide**: Deal 5 Debuffs or 30 hits.<br>**30% Torrential Flood**: 36 hits or 3M Plain DMG. | Earth Hrunting / Caim: Hrunting Berserker + Galleon + Caim. |
| **Yggdrasil Arbos**| Earth | Verdant Barrier & Massive Regrowth | **75% Forest Wrath**: Deal 35M DMG.<br>**25% World Tree Judgment**: 4 Ougis or 35 hits. | Wind Charlotta Skill Spam: Charlotta (Grand) + Catura + Narmaya. |
| **Luminiera Credo**| Light | Holy Light Mirrors & Dispel Checks | **75% Divine Lance**: Dispel 2 buffs.<br>**25% Aegis Judgment**: Deal 40 hits or 4 Ougis. | Dark Ereshkigal / Fediel: Fediel + Lich + Seox (Transcendence). |
| **Celeste Ater** | Dark | Fog of Death (Max HP Reductions) | **70% Cursed Fog**: Cleanse 3 debuffs or 30M DMG.<br>**20% Underworld Gate**: 4 Ougis or 40 hits. | Light Kengo Ougi Loop: Horus + Cosmos + Yuni. |

---

## 3. The 6 Revans Impossible Raids (2.0B HP, 6-Man)

Revans raids represent the mid-to-endgame gate. A single player error can wipe the raid or trigger irreversible damage mitigation.

### 3.1 Diaspora (Water) - The 100% Gamma Paradigm
- **Raid Logic**: Diaspora features two distinct phases. Phase 1 requires filling the Activation Gauge to 100 via either α (Normal Attack/Hits), β (Skill Damage), or γ (Charge Attack Damage). The global community standard requires **strictly 100% γ** to prevent Diaspora from entering lethal multi-hit rampage modes.
- **Role Assignment**:
  - *Host (Earth Kengo)*: Enters solo. Attacks exclusively with Charge Attacks until γ reaches 100.
  - *Bursters (Robin Hood / Berserker)*: Join once γ is 100. Unload 36-hit nukes and Hrunting attacks to clear Phase 2 in seconds.

### 3.2 Seofon (Wind) - Spirit Sword Control
- **Raid Logic**: Every uncanceled omen grants Seofon a Spirit Sword stack. At 5 stacks, Seofon gains permanent $50\%$ damage reduction and unleashes lethal party wipes.
- **Omen Cycle**: Every 3 turns triggers *Infinite Creacion* (Cancel: Deal 40M Damage or 6 Charge Attacks).
- **Execution**: Fire Kengo with Satyr, Silva (Yukata), and Michael easily generates 6 Ougis every 3 turns, keeping Spirit Sword stacks at zero permanently.

### 3.3 Siegfried (Earth) - The Uyuni Curse
- **Raid Logic**: Applies permanent *Uyuni* aura: all healing heals the boss or damages allies, and party defense is cut in half.
- **Omen Cycle**: Every 3 turns triggers *Manigance* (Cancel: Cast 5 skills or deal 30M damage).
- **Execution**: Wind Paladin or Manadiver stacking 3+ *Sette di Spade* (Defense Awakening). Charlotta (Grand) provides permanent TA and 1-turn cooldown cuts to satisfy 5-skill cancels.

### 3.4 Mugen (Fire) - Rampage Containment
- **Raid Logic**: Push Mugen from 100% to 70% without letting the Rampage bar hit 100. At 70%, Mugen transforms into *Ballistic Rampage*, dealing lethal normal attacks each turn.
- **Execution**: Water Haaselia invulnerability loop. Poseidon redirects incoming lethal hits while Haaselia and Anne maintain 100% water defense and barrier uptime.

### 3.5 Cosmos (Light) - The Balance Scale
- **Raid Logic**: Features a dynamic Balance Gauge:
  - Dealing Charge Attack damage pulls the scale toward *Order* (Left).
  - Dealing Normal Attack / Skill damage pulls the scale toward *Chaos* (Right).
  - **Failsafe**: If the gauge reaches $100\%$ on either side, Cosmos casts *Equilibrium Fall*, wiping the party for 100,000 plain damage.
- **Execution**: Dark Kengo (Fediel, Lich, Shalem). Alternates turns between Fediel/Lich normal attack nukes and MC charge attacks to hold the gauge strictly between $40\%$ and $60\%$.

### 3.6 Agastia (Dark) - Satellite Destruction
- **Raid Logic**: Spawns 6 Satellite nodes that reflect damage and inflict skill seal.
- **Omen Cycle**: Every 2 turns triggers *Satellite Cannon* (Cancel: Deal 6 Charge Attacks in a single turn).
- **Execution**: Light Kengo with Horus and Cosmos. Both characters double Ougi every turn, easily achieving 6 Ougis per turn with zero skill button dependency.

---

## 4. Apex Endgame Walkthroughs

### 4.1 Dark Rapture Zero (Faa-0) - 3.5B HP
- **Phase 1 (100%-80%: Twelve Ordeals 2.0)**: Must clear initial 12 elemental and tactical trials within 10 turns.
- **Phase 2 (80%-20%: Paradise Lost Cycles)**: At 80% and 60%, casts *Paradise Lost* (Cancel: 60M DMG or 66 hits). Uncanceled = absolute game over.
- **Phase 3 (20%-0%: The Final Countdown)**: Faa-0 gains 6 actions per turn. Every turn casts *Axion Apocalypse* (Cancel: 99 hits or 40M Skill DMG). Must be burned down within 4 turns using all remaining summon calls and Full Assassin turns.

### 4.2 Hexachromatic Hierarch (Tengen) - 3.2B HP
- **Mechanics**: Transitions across three elemental pairs (Fire/Water, Earth/Wind, Light/Dark).
- **2M Damage Cap Limit**: Individual damage instances are hard-capped at 2,000,000, severely nerfing single-hit Ougi strats and requiring high-hit-count supplemental multiattack teams.

### 4.3 Super Ultimate Bahamut (SUBHL) - 3.0B HP
- **Mechanics**: 6-element coordinate raid.
- **75% Dynastic Execution**: Must hit 20M damage to cancel.
- **50% Cocoon Phase**: Deal 50M damage within 6 turns to prevent Bahamut from emerging with permanent multi-buffs.
- **10% Sirius Strike**: Deals 100% max HP plain damage. Must be bypassed with targeted Substitute-All sacrificial units or invulnerability.
