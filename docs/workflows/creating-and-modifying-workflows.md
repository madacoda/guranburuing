# Modifying & Creating Universal Workflows Guide

This guide details how to read, customize, and write declarative workflow templates (`templates/*.json`), validate them against schema gates, and execute them reliably with the Granblue Fantasy Automation Suite.

---

## 1. Workflow Architecture & Lifecycle

All farming and combat routines run on the **Universal Workflow Engine**, driven by declarative JSON templates stored in `templates/`:

```
┌─────────────────────────┐     ┌────────────────────────┐     ┌────────────────────────┐
│  templates/*.json       │ ──> │  Zod Schema Validator   │ ──> │ UniversalWorkflowEngine│
│  (Declarative Pipeline) │     │ (bun run workflow:val) │     │ (Sub-7.5s Combat Loop) │
└─────────────────────────┘     └────────────────────────┘     └────────────────────────┘
                                                                           │
                                                                           ▼
                                                               ┌────────────────────────┐
                                                               │  Chrome CDP Execution  │
                                                               │  (Windowed / Headless) │
                                                               └────────────────────────┘
```

Each workflow execution adheres to a 3-phase lifecycle:
1. **Entry & Supporter Resolution**: Navigates to the designated `questUrl` (e.g. `#quest/assist` or `#quest/supporter/...`), selects matching friend supporter summons based on `supporterPriority`, and confirms the party deck.
2. **Combat Loop Execution**: Steps are dispatched sequentially (`skill`, `summon`, `quick_call`, `attack`, `reload`, `repeat`, `smart_full_auto`). Turn animations are optionally cancelled via smart F5 reloads.
3. **Settlement & Looping**: `confirm_result` claims battle honors, tokens, and loot drops, handles AP/EP auto-replenishment, and loops until `runs` is satisfied.

---

## 2. Anatomy of a Template (`templates/gb-pbhl.json`)

Here is the exact structure of the Proto Bahamut HL burst template ([`templates/gb-pbhl.json`](../../templates/gb-pbhl.json)):

```json
{
  "name": "GB Farm - Proto Bahamut HL",
  "description": "PBHL Gold Bar speed burst: C4S3 -> Reload -> Tap Ready -> Reload -> Summon 2 -> Loop if <1.5M honors",
  "questUrl": "https://game.granbluefantasy.jp/#quest/assist",
  "raidSlot": 4,
  "targetScore": 1500000,
  "logPath": "logs/gb-pbhl.md",
  "supporterPriority": ["Agni", "Bahamut", "Shiva", "Michael"],
  "humanMotor": true,
  "stopOnCaptcha": true,
  "autoElixir": false,
  "autoBerry": true,
  "defaultRuns": 1000,
  "speedProfile": "fast",
  "steps": [
    {
      "code": "skill",
      "character": 4,
      "skill": 3,
      "optional": true,
      "waitForNetwork": "ability_result.json"
    },
    { "code": "reload" },
    { "code": "tap_ready" },
    { "code": "reload" },
    { "code": "summon", "slot": 2, "waitForNetwork": "summon_result.json" },
    { "code": "reload" },
    { "code": "tap_ready" },
    {
      "code": "repeat",
      "repeatCount": 15,
      "subSteps": [
        { "code": "exit_if_score", "targetScore": 1500000 },
        { "code": "reload" },
        { "code": "tap_ready" }
      ]
    },
    { "code": "confirm_result" }
  ]
}
```

### Top-Level Configuration Reference

| Property | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `name` | `string` | **Required** | Descriptive name shown in CLI logs and Discord Rich Presence |
| `description` | `string` | `""` | Detailed description of the team composition and rotation |
| `questUrl` | `string` | **Required** | Game entry route (`#quest/assist`, `#quest/supporter/...`, `#replicard/...`) |
| `raidSlot` | `number` | `undefined` | Raid finder tab index on `#quest/assist` (`1` = Grand Order, `2` = Akasha, `3` = PBHL) |
| `targetScore` | `number` | `undefined` | Target honors before exiting combat early (e.g. `1500000` for Blue Chest) |
| `supporterPriority` | `string[]` | `[]` | Priority summon names to search for (e.g. `["Hades", "Bahamut"]`) |
| `speedProfile` | `enum` | `"fast"` | `"fast"` (150ms delays), `"turbo"` (75ms delays), or `"stealth"` (860ms delays) |
| `defaultRuns` | `number` | `1` | Default number of battle runs to execute if not specified on CLI |
| `autoElixir` | `boolean` | `true` | Automatically consumes Half-Elixirs when AP is exhausted |
| `autoBerry` | `boolean` | `true` | Automatically consumes Soul Berries when EP is exhausted |
| `humanMotor` | `boolean` | `true` | Enables Gaussian spatial coordinate jitter and biological movement curves |
| `stopOnCaptcha` | `boolean` | `true` | Halts execution immediately upon visual verification modal and alerts Discord |
| `logPath` | `string` | `undefined` | File path to append drop and battle telemetry logs (e.g. `logs/gb-pbhl.md`) |
| `steps` | `object[]` | **Required** | Array of action step objects executed in sequential order |

---

## 3. Step Action Catalog

Each element in `steps` must have a valid `code` corresponding to an engine handler:

### 1. `skill` (Cast Character Skill)
Triggers a specific character skill slot (1 to 4).
```json
{
  "code": "skill",
  "character": 4,
  "skill": 3,
  "targetCharacter": 1,
  "ensureCast": true,
  "optional": true,
  "waitForNetwork": "ability_result.json"
}
```
- `character` (`1-4`): Character party slot from left to right (`1` = Main Character, `4` = Slot 4).
- `skill` (`1-4`): Skill slot number (1 to 4).
- `targetCharacter` (optional, `1-4`): If the skill targets an ally (e.g. Florence Skill 1 on MC or Nier Skill 3 on MC), target character slot.
- `ensureCast` (optional, `boolean`): Enforces server network/state confirmation with automatic popup/lockout retry loops. **In Guild War workflows (`isGuildWarWorkflowTemplate`), any `ensureCast: true` failure/cooldown skip is strictly FATAL** and aborts the run instead of continuing into a broken turn.
- `optional` (optional, `boolean`): If `true`, does not fail or halt if skill is on cooldown.
- `waitForNetwork` (optional, `string`): Waits for specific API payload (`"ability_result.json"`).

### 2. `quick_call` (Fire Quick Summon)
Instantly triggers the designated Quick Summon button on the top combat HUD.
```json
{
  "code": "quick_call",
  "ensureCast": true,
  "waitForNetwork": "summon_result.json"
}
```
- Supports `ensureCast: true` and `waitForNetwork: "summon_result.json"`. When followed immediately by `reload`, fast-confirms on valid `summon_result.json` `scenario` payload so `F5` cancels the summon animation immediately.

### 3. `summon` (Call Sub-Aura Summon)
Calls a summon from sub-slots 1 through 6.
```json
{
  "code": "summon",
  "slot": 2,
  "ensureCast": true,
  "waitForNetwork": "summon_result.json"
}
```
- `slot` (`1-6`): Summon sub-slot to call (`1` = Main, `2-5` = Sub summons, `6` = Friend supporter).
- `ensureCast` (optional, `boolean`): Mandatory confirmation; in Guild War workflows, any failed or unavailable ensured summon (`summon` or Death `quick_call`) aborts the run as FATAL.

### 4. `attack` (Normal Attack)
Triggers normal attack button.
```json
{ "code": "attack" }
```

### 5. `reload` (Instant F5 Reload)
Reloads the game page to skip lengthy attack, summon, or chain burst animations.
```json
{ "code": "reload" }
```

### 6. `tap_ready` (Tap Ready / Full Auto)
Clicks the in-game "Tap to start / Ready" banner or activates in-game Full Auto.
```json
{ "code": "tap_ready" }
```

### 7. `smart_full_auto` (Methodological Tactical Auto)
Executes methodological skill prioritization across all active party members:
`Field (Purple) -> Debuff (Blue) -> Buff (Yellow) -> Damage Nuke (Red) -> Conditional Heal (Green)`
accompanied by automated attack and F5 reload loops.
```json
{
  "code": "smart_full_auto",
  "maxTurns": 25,
  "postAttackWaitMs": 350
}
```

### 8. `repeat` (Sub-Step Loop Block)
Repeats an enclosed list of sub-steps for a set number of iterations.
```json
{
  "code": "repeat",
  "repeatCount": 10,
  "subSteps": [
    { "code": "exit_if_score", "targetScore": 1500000 },
    { "code": "attack" },
    { "code": "reload" }
  ]
}
```

### 9. `exit_if_score` (Honor Guard Early Exit)
Checks current synced battle honors. If current honors $\ge$ `targetScore`, breaks out of combat loop early and proceeds to `confirm_result`.
```json
{
  "code": "exit_if_score",
  "targetScore": 1500000
}
```

### 10. `target_enemy` (Switch Enemy Focus)
Switches boss target in multi-target raids.
```json
{
  "code": "target_enemy",
  "enemyIndex": 2
}
```

### 11. `heal` (Drink Potions)
Consumes green or blue recovery potions.
```json
{
  "code": "heal",
  "item": "green_potion",
  "character": 1
}
```

### 12. `backup_request` (Request Raid Backup)
Broadcasts backup request to Everyone, Friends, and Crew.
```json
{ "code": "backup_request" }
```

### 13. `confirm_result` (Claim Loot & Loop)
Waits for battle result screen, collects pending honors, dismisses level-up / weapon drops, and re-queues.
```json
{ "code": "confirm_result" }
```

---

## 4. How to Modify `templates/gb-pbhl.json`

Suppose you want to customize [`templates/gb-pbhl.json`](../../templates/gb-pbhl.json) with your own tactical rotation:
- Cast Character 4 Skill 3, then Character 1 Skill 1.
- Fire Quick Summon (e.g. Yatima / Triple Zero).
- Attack, reload, and repeat 3 times before checking honors.

### Step 1: Edit the JSON File
Open `templates/gb-pbhl.json` in your editor and adjust the `steps` array:

```diff
   "steps": [
     {
       "code": "skill",
       "character": 4,
       "skill": 3,
       "optional": true,
       "waitForNetwork": "ability_result.json"
     },
+    {
+      "code": "skill",
+      "character": 1,
+      "skill": 1,
+      "waitForNetwork": "ability_result.json"
+    },
     { "code": "reload" },
-    { "code": "tap_ready" },
+    { "code": "quick_call" },
     { "code": "reload" },
-    { "code": "tap_ready" },
+    { "code": "attack" },
     { "code": "reload" },
     {
       "code": "repeat",
-      "repeatCount": 15,
+      "repeatCount": 5,
       "subSteps": [
         { "code": "exit_if_score", "targetScore": 1500000 },
+        { "code": "attack" },
         { "code": "reload" }
       ]
     },
     { "code": "confirm_result" }
   ]
```

### Step 2: Validate Schema Compliance
Run the template schema validation gate:
```bash
bun run workflow:validate
```
The validator inspects all templates against Zod AST rules:
- Verifies character numbers are within 1–4.
- Verifies summon slots are within 1–6.
- Verifies all step codes match known engine actions.
- Verifies `targetScore` is a positive number.

If any field is misconfigured, the validator outputs the exact line number and error reason.

---

## 5. How to Create a Brand New Custom Workflow

To create a new farming routine (e.g. `templates/my-custom-omega.json`):

### Step 1: Create `templates/my-custom-omega.json`
```json
{
  "name": "My Custom Omega Raid",
  "description": "Quick Call -> Attack -> Reload -> Full Auto -> Confirm",
  "questUrl": "https://game.granbluefantasy.jp/#quest/supporter/300151/1/0/2",
  "speedProfile": "fast",
  "defaultRuns": 20,
  "autoElixir": true,
  "humanMotor": true,
  "stopOnCaptcha": true,
  "supporterPriority": ["Colossus Omega", "Shiva"],
  "steps": [
    { "code": "quick_call" },
    { "code": "attack" },
    { "code": "reload" },
    { "code": "smart_full_auto", "maxTurns": 10 },
    { "code": "confirm_result" }
  ]
}
```

### Step 2: Validate Your New Template
```bash
bun run workflow:validate
```
You will see:
```text
✅ [PASS] "my-custom-omega" -> "My Custom Omega Raid" (5 steps, fast speed, ...)
```

---

## 6. How to Run Your Modified or Custom Workflow

You have **4 flexible ways** to run any modified or custom workflow:

### Method 1: Direct CLI Runner (Most Flexible)
Execute directly via `src/cli/run-workflow.ts`:
```bash
# Run 20 runs on Account 1 with visible browser window:
bun src/cli/run-workflow.ts acc1 my-custom-omega 20 --windowed

# Run 100 runs in silent background mode:
bun src/cli/run-workflow.ts acc1 gb-pbhl 100

# Run on secondary account (acc2):
bun src/cli/run-workflow.ts acc2 my-custom-omega 50
```

### Method 2: Account Shortcut Syntax
```bash
# Syntax: bun run <account> <template_name> [runs] [--windowed]
bun run acc1 gb-pbhl 25
bun run acc1 my-custom-omega 10 --windowed
bun run acc2 gb-pbhl 50
```

### Method 3: Interactive Terminal Selector (UI Picker)
Run without arguments to launch the terminal picker:
```bash
bun run workflow
```
- It automatically discovers all JSON templates in `templates/`.
- Use arrow keys to select your template.
- Select target account and enter desired run count.

### Method 4: Auto-Generate Package.json Scripts (`templates:sync`)
If you want dedicated `bun run <template>` scripts registered in `package.json`, run:
```bash
bun run templates:sync
```
This automatically registers:
- `bun run my-custom-omega` (silent background execution)
- `bun run my-custom-omega:windowed` (visible GUI execution)

---

## 7. Common Pitfalls & Senior Best Practices

1. **Always End with `confirm_result`**: Every combat workflow must conclude with `{ "code": "confirm_result" }` to claim loot, handle AP recovery, and trigger the next iteration (mandatory in GW because even 1 unclaimed battle blocks starting the next quest).
2. **Reload After Attacks & Summons (Including Swap Summons like Death)**: Granblue Fantasy combat animations can take 4–12 seconds, and mid-turn backline swaps (`Death -> Nier`) do not refresh `stage.pJsnData` or all HUD drawers until reloaded. Adding `{ "code": "reload" }` after `{ "code": "attack" }`, `{ "code": "summon" }`, or `{ "code": "quick_call" }` cuts animation time and syncs swapped characters cleanly.
3. **Use `ensureCast: true` on Mandatory Steps & `optional: true` on Situational Skills**: Use `ensureCast: true` + `waitForNetwork` on critical burst skills, summons, Quick Calls, and attacks (fatal in GW). Set `"optional": true` for situational skills that may be on cooldown.
4. **Test Live & Inspect Step Audit (`step:audit`)**: After running `--runs 1`, inspect `bun run step:audit <template>` (`data/step-audit-ledger.json`) to verify 100% step pass rate, retry counts, recast transitions, and upstream cascade diagnostics. For full DOM/API details, see [`strategies/principles/16_gbf_live_combat_dom_and_diagnostics.md`](../../strategies/principles/16_gbf_live_combat_dom_and_diagnostics.md).
