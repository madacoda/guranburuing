# Arcarum: The World (ワールド) Automated Battle Hunter (`arcarum-theworld`)

## 1. Executive Summary & Objective

**The World** (*ワールド* / *Zone Mundus* / Quest `819131`) is the climactic encounter in Replicard Sandbox, rewarding crucial materials including The World Idean, Astras, Verums, Lapis Genesis, and Sephira Stones.

The `arcarum-theworld` automated battle runner manages the complete end-to-end combat lifecycle:
1. **Direct Replicard Supporter Entry**: Navigates directly to `#replicard/supporter/10/10/16/819131/25/0/25085`.
2. **AAP Auto-Replenishment**: Detects AAP deficiency modals and automatically restores AAP using Half Elixirs or Full Elixirs.
3. **Omen Plain Damage Counter (Beelzebub Summon)**:
   - Scans DOM and enemy special skill conditions for the critical trigger: **"Deal 1,000,000 plain damage"** (`無属性ダメージを1,000,000与える`).
   - Automatically selects and calls the **Beelzebub** summon (`2040408000`), dealing 3,000,000 plain damage to instantly cancel the omen.
   - Executes an anticipatory F5 reload to skip the summon cutscene.
4. **Biomechanical Human Motor Simulation**:
   - Natural randomized delays (200ms - 600ms) with Gaussian spatial jitter.
   - Left-to-right skill sequencing across party members (Char 1 -> Char 2 -> Char 3 -> Char 4) or Full Auto (`.btn-auto`).
   - Natural motor variance: ~18% chance to bypass skills and directly click Attack on turns where skills are unneeded.
   - Animation skip: 94% chance to reload (F5) right after attack dispatches, with a rare 6% chance to let the animation resolve naturally.
5. **Sentinel Watchdog**: Pauses immediately upon detecting visual verification challenges (CAPTCHA), sounding an audible alarm and alerting the user.
6. **Telemetry & Logging**: Records turns, run duration, and loot drops to `logs/arcarum-theworld.md`.

---

## 2. Recommended Setup

| Slot | Setup / Role |
| :---: | :--- |
| **Summon** | **Beelzebub** in Summon deck (Sub or Main) to counter the 1,000,000 Plain DMG omen |
| **Party** | Any high-burst or sustained elemental composition (Zephyrus, Hades, Agni, etc.) |
| **Full Auto** | Supported out of the box with intelligent omen interruptions |

---

## 3. Quick Start & CLI Execution

Run the runner from PowerShell:

```bash
# Continuous loop (runs indefinitely until Ctrl+C)
npm run arcarum-theworld

# Run a specific number of battles (e.g. 10 battles)
npm run arcarum-theworld 10

# Manual left-to-right skill activation mode
npx tsx src/cli/run-arcarum-theworld.ts 10 manual_skills
```

### CLI Parameters
```bash
npm run arcarum-theworld [runs] [mode]
```
- `runs`: Total battles to complete (default: `Infinity` / continuous).
- `mode`: Combat execution mode (`full_auto` [default] or `manual_skills`).
