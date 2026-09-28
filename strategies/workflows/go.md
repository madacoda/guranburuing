# Grand Order HL (降臨、調停の翼) Gold Bar Hunter (`gb-go`)

## 1. Executive Summary & Objective

**Grand Order HL** (*降臨、調停の翼* / *GO HL*) is an 18-player premier Gold Bar (*ヒヒイロカネ*) raid.

The **Blue Chest** (*青箱*) contains an un-capped Gold Bar drop, reaching maximum drop probability at **~1,480,000 pt** (~148,000,000 total damage dealt). The `gb-go` engine automates the entire end-to-end farming cycle:
1. **Intelligent Finder Scanning**: Constantly monitors `#quest/assist` (Finder tab, **2nd slot** / Grand Order HL) for healthy, low-participant raids (P1: HP > 70% & <= 3/18 players, P2: HP >= 50% & <= 4/18 players).
2. **Priority Supporter Selection**: Selects optimal Dark supporters (Lvl 250 Hades / Bahamut).
3. **High-Performance Ereshkigal Rotation**:
   - Quick Summon Call -> instant F5 reload
   - 4th Char (Nier) Skill 1, Skill 2 on Char #2 (Yukata Ilsa)
   - Death Summon -> instant F5 reload
   - 2nd Char (Yukata Ilsa) Skill 1
   - Attack loop with F5 refresh until honor > 1,480,000 pt
4. **Resilient Recovery & Unclaimed Battles**: Claims rewards in randomized batches of 3 - 5 raids, inspects for Gold Bars, and logs results to `logs/gb-go.md`.

---

## 2. Quick Start & CLI Execution

```bash
# Continuous farming loop
npm run gb-go

# Run specific number of raids
npm run gb-go 5
```
