# Volume 18: Weapon Grids & Progression Archetypes

**Companion Catalog:** [`data/combat/weapon-grids.catalog.json`](file:///c:/laragon/www/guranburuing/data/combat/weapon-grids.catalog.json)  
**Schema:** [`data/schemas/weapon-grids.schema.json`](file:///c:/laragon/www/guranburuing/data/schemas/weapon-grids.schema.json)  

---

## 1. Overview & Progression Milestones

Weapon grids in Granblue Fantasy operate on a multiplicative stacking damage engine governed by distinct skill modifiers:
$$\text{Total ATK} = \text{Base ATK} \times (1 + \text{Omega ATK}) \times (1 + \text{Normal ATK}) \times (1 + \text{EX ATK}) \times (1 + \text{Elemental Mod}) \times (1 + \text{Seraphic Mod})$$

Player progression is divided into three distinct operational milestones:

1. **Early Game (Rank 1–119: Magna 1 Baseline)**:
   - Primary Objective: Clear main quest up to Chapter 114 to unlock Omega Pro Skips, Arcarum, and Side Stories.
   - Grid Composition: 5–6 Omega 1 weapons (Colossus Cane, Leviathan Gaze, Yggdrasil Crystal Blade, Tiamat Bolt, Luminiera Sword, Celeste Claw), 1 Bahamut Weapon (Nova), 1 Seraphic Weapon, 1–2 EX weapons (Xeno / Side Story).
   - Expected Performance: Capable of soloing all standard Omega and Extreme+ event battles.

2. **Mid Game (Rank 120–199: Magna 2 & Ennead Transition)**:
   - Primary Objective: Uncap Dark Opus to Lv 200 (ULB), forge Astral Weapons, farm Magna 2 raids (Shiva, Europa, Alexiel, Grimnir, Metatron, Avatar) and Ennead weapons (Atum, Tefnut, Bennu, Ra, Horus, Osiris).
   - Grid Composition: Shift toward 100% Critical Hit Rate grids (Last Storm Harps, Nibelung Horns, Pillar of Flame, Ancient Ecke Sachs) and Ougi Sentience setups (Tyros Zither, Abyss Spine).
   - Expected Performance: Capable of racing in 18-man HL raids and tackling early V2 content (Six Dragons).

3. **Late / Endgame (Rank 200+: Magna 3 & Primal Specialization)**:
   - Primary Objective: Magna 3 (Omega Rebirth) farming (Lv 250 summons and Exalted weapons), Revans weapon awakening (Attack/Defense/Special Lv 15–20), Transcendence Dark Opus (Lv 210–250), Ultima Lv 200 (Gauph Keys), and optional Illustrious weapons (Hrunting, Ereshkigal).
   - Expected Performance: Capable of soloing or executing 6-man Revans and Apex raids (Dark Rapture Zero, Hexachromatic Hierarch, Super Ultimate Bahamut).

---

## 2. Universal Grid Pieces & Weapon Mechanics

### 2.1 Dark Opus Weapons (The Core Anchor)
Dark Opus weapons provide the largest single offensive boost in any grid:
- **Skill 1**: Massive Omega or Primal ATK + HP.
- **Skill 2 (Second Pendulum - Rank 170+)**:
  - *Alpha*: Normal Attack Damage Cap +10%.
  - *Beta*: Charge Attack Damage Cap +15% / CA DMG +50%.
  - *Gamma*: Skill Damage Cap +50%.
  - *Delta*: Chain Burst Damage Cap +50%.
- **Skill 3 (Third Pendulum / Chain - Rank 200+)**:
  - *Stamina*: Boost to ATK based on high HP (Standard general use).
  - *Enmity*: Boost to ATK based on low HP.
  - *Falsehood (Chain)*: Grants party 35% Echo and Double Strike upon Ougi at the cost of charge bar loss (Essential for 1–2 turn burst racing).
  - *Freyr (Chain)*: Grants party teamwide multi-buffs on Ougi.
  - *Extremity / Transcendence (Lv 210–250)*: Amplifies summon aura scaling and grants unique damage cap bonuses.

### 2.2 Ultima Weapons (Gauph Keys & Weapon Proficiency)
Transcendence Ultima weapons (Lv 200) transcend elemental barriers and are slotted across all 6 elements:
- **Key 1**: Boost to ATK and HP for allies matching weapon proficiency.
- **Key 2**: Damage Cap Boost (+10% Normal Cap, +15% CA Cap, or +50% Skill Cap). Stacks with Dark Opus Key 2.
- **Key 3 (Gauph Key Seraphic / Tria)**: Grants +25% Seraphic damage amplification against superior element. Replaces Seraphic weapons, freeing up an entire grid slot!

### 2.3 Resonator Weapons (Grand Weapon Power Spike)
Weapons possessing Resonator skills (Lord of Flames, Landslide Scepter, Kaguya Folding Fan, Harmonia, Pain and Suffering) grant progressive teamwide buffs based on the count of same-element weapons in the grid:
- 1 Weapon: +7% EX ATK, +3% Damage Cap.
- 3 Weapons: +20% EX ATK, +7% Damage Cap.
- 5 Weapons: +40% EX ATK, +20% Special Damage Cap.

### 2.4 Revans Weapons & Awakening Modes
Revans weapons drop from 6-man endgame raids and achieve their full power via Awakening:
- **Attack Awakening**: Adds flat +3,500 ATK, +15% Normal ATK, and +5% Damage Cap. (Used for burst and racing grids).
- **Defense Awakening**: Adds flat +3,000 HP, +40% DEF, and +15% Max HP. (Mandatory for High-Difficulty survival in Faa0, Hexa, and NM250).
- **Special Awakening**: Adds +10% Special Damage Cap, +30% CA Damage, and flat supplemental damage.

---

## 3. Comprehensive 6-Element Grid Matrix

| Element | Magna 1 Starter | Magna 2 Midgame | Magna 3 / Endgame Magna | Primal / Optimus Peak |
| :--- | :--- | :--- | :--- | :--- |
| **Fire** | 5x Colossus Cane Omega, Baha, Seraphic, Ray of Zhuque | 4x Ancient Ecke Sachs (100% Crit), 2x Nilakantha, Dark Opus | 3x Ira Volcanic Blade, 2x Extinction Blade (Atk), Scythe (Lv 250), Ultima | 2x Lord of Flames, 2x Crimson Scale, Extinction Blade, Agni Lv 250 |
| **Water** | 6x Leviathan Gaze, Baha Dagger, Wand of Gabriel | 3x Tyros Zither (Ougi), 2x Spirit of Mana, Staff of Renunciation | 3x Mare Abyssal Dagger (100% Crit), 3x Schrodinger (Def), Fateless | 2x Wamdus Cnidocyte, Taisai Bow, Galilei Donna, 3x Schrodinger, Varuna Lv 250 |
| **Earth** | 6x Yggdrasil Crystal Blade, Baha Sword, Gauntlet of Uriel | 3x Nibelung Horn (100% Crit), 3x Nibelung Klinge, Yggdrasil Bough | 3x Arbos Verdant Greatsword, 3x Siegfried Fang (Def), 2x Galleon Jaw | Hrunting (150 GM), 3x Landslide Scepter, 2x Siegfried Fang, Titan Lv 250 |
| **Wind** | 6x Tiamat Bolt (Enmity), Baha Dagger, Ring of Raphael | 3x Last Storm Harp (100% Crit), 2x Coruscant Crozier, Cradle | 3x Aura Tempest Dagger (100% Crit/DATA), 3x Sette di Spade (Def) | 2x Kaguya Folding Fan, 2x Galatine, 3x Sette di Spade, Zephyrus Lv 250 |
| **Light** | 6x Luminiera Sword Omega, Baha Sword, Harp of Haladom | 3x Pillar of Flame (100% Crit), Mittron Bow, Sword of Renunciation | 3x Credo Holy Sword, 2x Symposium (Atk), 2x Harmonia, Ultima Sword | 2x Harmonia, 2x Rinne, 2x Eden, Symposium (Special), Zeus Lv 250 |
| **Dark** | 6x Celeste Claw (Enmity), Baha Dagger, Scythe of Belial | 2x Abyss Spine (Ougi), 2x Fediel Spine, Scythe of Repudiation | 3x Ater Dark Scythe (100% Crit), 2x Agastia Dagger, 2x Pain & Suffering | Ereshkigal (150 GM), 2x Pain & Suffering, 2x Bab-el-Mandeb, Hades Lv 250 |

---

## 4. Operational Alignment with Automation Engine

1. **Party & Grid Auto-Selection (`party-selection-rules.json`)**:
   - Workflows query `data/combat/weapon-grids.catalog.json` by `elementId` and `tier`.
   - When entering High Difficulty content (SUBHL, Revans), the engine automatically selects grids flagged with `Defense` awakenings and $\ge 60\%$ estimated HP modifiers.
2. **Burst Route Selection**:
   - When running sub-5 second farming (`gw-meat`, `otkraid`, `event-raid`), the engine matches against `Burst_OTK` archetypes featuring Falsehood Opus or Illustrious weapons (Hrunting/Ereshkigal).
