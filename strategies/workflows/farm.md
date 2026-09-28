# Gold Bar Multi-Raid Rotator (`gb-farm`)

## 1. Executive Summary & Objective

`gb-farm` is the unified master farming controller for Granblue Fantasy Gold Bar hunting. Instead of camping a single raid when activity is slow, `gb-farm` dynamically monitors and rotates across all three premier Gold Bar raids:
- **Proto Bahamut HL (PBHL / Tsuyo Baha)** - Finder Slot 4
- **Akasha HL** - Finder Slot 3
- **Grand Order HL (GO HL)** - Finder Slot 2

### Key Architectural Principles:
1. **Randomized Multi-Slot Rotation**:
   - In each search cycle, the checking order across PBHL, Akasha, and GO is shuffled using an unbiased Fisher-Yates algorithm.
   - If Slot A has no candidate matching our health/player criteria, it immediately switches to Slot B without waiting or refreshing.
   - If Slot B has no candidate, it checks Slot C.
   - Only when all 3 slots have no eligible candidates does it pause (randomized 2.5s - 5.0s), click `.btn-search-refresh`, and repeat with a newly shuffled order.
2. **Domain-Specific Execution Hand-Off**:
   - When an eligible candidate is selected, `FarmEngine` hands off execution to the matching raid engine (`PbhlEngine`, `AkashaEngine`, or `GoEngine`).
   - Each engine runs its specialized supporter summon priority, party confirmation, combat rotation, and honor target:
     - **PBHL**: Light supporter priority | Target: 1,480,000 pt | Combat: Quick Call -> Nier S1, S2 -> Death -> Ilsa S1 -> Attack
     - **Akasha**: Dark supporter priority | Target: 1,560,000 pt | Combat: Quick Call (F5) -> Nier S1 -> Death (F5) -> Ilsa S1 -> Attack
     - **GO HL**: Dark supporter priority | Target: 1,480,000 pt | Combat: Quick Call (F5) -> Nier S1, S2 -> Death -> Ilsa S1 -> Attack
3. **Isolated Drop Rate & Dry Streak Accounting**:
   - Every completed battle and unclaimed pending battle claim is recorded into that raid's dedicated Markdown log:
     - `logs/gb-pbhl.md`
     - `logs/gb-akasha.md`
     - `logs/gb-go.md`
   - Keeps individual and cross-raid drop rate telemetry 100% clean and verifiable.
4. **Randomized Batch Pending Battle Claims**:
   - Automatically claims rewards in batches of 3 to 5 raids (strictly below GBF's 5-raid cap).
   - Resolves Gold Bar drops with full attribution to the raid that dropped it.

---

## 2. Quick Start & CLI Execution

```bash
# Continuous multi-raid rotation (runs indefinitely until Ctrl+C)
npm run gb-farm

# Run a specific number of total raids (e.g. 10 raids across any of the 3 types)
npm run gb-farm 10
```

---

## 3. Slot Configuration & Health Criteria

| Raid | Finder Slot | Target Honors | Health & Player Threshold | Supporter Summon Priority | Log Destination |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **PBHL** | Slot 4 | 1,480,000 pt | P1: HP > 70% & <= 3/30<br>P2: HP >= 50% & <= 4/30 | Light: Lucifer 250 -> Triple Zero -> Zeus 250 | `logs/gb-pbhl.md` |
| **Akasha HL** | Slot 3 | 1,560,000 pt | P1: HP > 70% & <= 3/30<br>P2: HP >= 50% & <= 4/30 | Dark: Hades 250 -> Bahamut 250 -> Hades any | `logs/gb-akasha.md` |
| **GO HL** | Slot 2 | 1,480,000 pt | P1: HP > 70% & <= 3/18<br>P2: HP >= 50% & <= 4/18 | Dark: Hades 250 -> Bahamut 250 -> Hades any | `logs/gb-go.md` |
