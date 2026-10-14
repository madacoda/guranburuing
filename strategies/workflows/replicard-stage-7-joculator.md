# Replicard Sandbox: Zone Joculator (Stage 7 / Here Be Swords)

Comprehensive guide, reverse-engineered stage routing, and automated burst execution for **Zone Joculator** (Stage 7 / Arctic Plains: Flumen Glacialis) and the Justice Defender **Lady of Redemption**.

---

## 1. Overview & Stage Topology

Zone Joculator is the water-centric sector of Replicard Sandbox's *Here Be Swords* partition.

```
Zone Joculator (Stage 7) Hub: https://game.granbluefantasy.jp/#replicard/stage/7
  │
  ├── Sector: Arctic Plains: Flumen Glacialis (Division 7)
  │     │
  │     ├── [5-Gauge Mob] Maiden of the Depths (Quest ID: 816031 | Water | 20 AAP)
  │     │     └── Drops: Water Sephira Box, Defender Hell Gauge
  │     │
  │     └── [Defender / Boss] Lady of Redemption (Quest ID: 816071 | Water | 30 AAP)
  │           ├── In-Game URL: https://game.granbluefantasy.jp/#replicard/supporter/7/7/7/816071/25
  │           ├── Attribute: attribute2 (Water) -> Player Advantage: Earth
  │           ├── Stock: Up to 999 Defender attempts (observed: 638 attempts in stock)
  │           └── Drops: Justice Idean, Aquaborne Astra, Justice Veritas, Sephira weapons
```

---

## 2. Combat Strategy & Rotation Specification

The workflow utilizes the proven high-speed burst rotation established for *Lilywhite Paragon*, optimized with animation cancels (F5 reloads) and non-blocking network listener confirmations.

### Targeted Rotation Sequence (Verbatim User Specification):

| Step | Action | Target / Code | Synchronization | Purpose |
| :---: | :--- | :--- | :--- | :--- |
| **1** | Ensured Skill | Character 4 Skill 1 | `ability_result.json` | Core debuff / team steroid (guaranteed cast) |
| **2** | Quick Summon | Quick Call | `summon_result.json` | Sub-aura burst / main call damage |
| **3** | Animation Skip | Reload (F5) | Browser Reload | Bypasses call animation lockout |
| **4** | Skill Cast | Character 3 Skill 1 | `ability_result.json` | Echo / CA prep / auxiliary nuke |
| **5** | Skill Cast | Character 2 Skill 1 | `ability_result.json` | Element buff / damage amplifier |
| **6** | Skill Cast | Character 2 Skill 2 | `ability_result.json` | Supplemental damage / team cap up |
| **7** | Skill Cast | Character 1 Skill 1 | `ability_result.json` | MC class mastery nuke |
| **8** | Skill Cast | Character 1 Skill 3 | `ability_result.json` | MC steroid / multi-strike buff |
| **9** | Turn 1 Attack | Normal Attack | `normal_attack_result.json` | First massive burst phase |
| **10** | Animation Skip | Reload (F5) | Browser Reload | Bypasses attack lockout |
| **11** | Summon Cast | Summon Slot 4 | `summon_result.json` | Secondary nuke / supplemental call |
| **12** | Turn 2 Attack | Normal Attack | `normal_attack_result.json` | Turn 2 burst phase |
| **13** | Animation Skip | Reload (F5) | Browser Reload | Bypasses attack lockout |
| **14** | Summon Cast | Summon Slot 3 | `summon_result.json` | Tertiary nuke / chain finisher call |
| **15** | Turn 3 Attack | Normal Attack | `normal_attack_result.json` | Turn 3 final cleanup |
| **16** | Result Claim | Confirm Result | `result/` listener | Claims Sephira boxes & triggers rerun |

---

## 3. CLI Commands & Execution

### Dedicated Shortcuts:
```bash
# 1. Run Lady of Redemption burst workflow in headless mode:
bun run redemption

# 2. Run Lady of Redemption with visible browser GUI:
bun run redemption:windowed

# 3. Via run-arcarum CLI with custom run count:
bun run arcarum:redemption 100
bun run arcarum:lady 50

# 4. Universal Stage 7 Map Scanner (auto-targets Lady of Redemption when available):
bun run arcarum:stage7 200

# 5. Farm Maiden of the Depths (5-gauge mob to build defender gauge):
bun run arcarum:maiden 100
```

---

## 4. Technical Artifacts

- **JSON Template**: [`templates/arcarum-lady-of-redemption-smart.json`](file:///c:/laragon/www/guranburuing/templates/arcarum-lady-of-redemption-smart.json)
- **5-Gauge Template**: [`templates/arcarum-maiden-of-the-depths-smart.json`](file:///c:/laragon/www/guranburuing/templates/arcarum-maiden-of-the-depths-smart.json)
- **Stage 7 Map Template**: [`templates/arcarum-stage-7-smart.json`](file:///c:/laragon/www/guranburuing/templates/arcarum-stage-7-smart.json)
- **Controller Presets**: [`src/cli/run-arcarum.ts`](file:///c:/laragon/www/guranburuing/src/cli/run-arcarum.ts)
- **Unit Test Suite**: [`tests/test-arcarum-stage-7-joculator.ts`](file:///c:/laragon/www/guranburuing/tests/test-arcarum-stage-7-joculator.ts)
