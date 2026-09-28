# Strategy Run & Architecture Todo [COMPLETED]

## 1. Universal Workflow as Architecture Staple
- [x] **Universal Workflow Engine (`UniversalWorkflowEngine`) is now the single system backbone**:
  - All strategy flows (Daily routines, Fate episodes, Raid Gold Bar farming, Guild Wars) are standardized as declarative templates (`templates/*.json`, `templates/*.dsl`).
  - Unified multi-account CDP session routing (`acc1`, `acc2`), automated reconnect watchdog, mobile viewport enforcement, anti-captcha sentinel freeze, and human motor jitter across all workflows.
  - Refactored `package.json` and strategy runners (`pbhl`, `gb-pbhl`, `gb-akasha`, `gb-go`, `gb-farm`, `fate`, `gw-meat-light`, `gw-nm95-light`) to route through the universal engine.

## 2. Refactored Default "run daily"
- [x] **Default `run daily` directly runs the Universal Daily Routine**:
  - Completely removed/subsumed `daily:universal`.
  - `bun run daily` (or `bun src/cli/run-daily.ts`) runs `daily-universal` on `acc1` for 1 run by default.
  - Added dedicated CLI shortcuts:
    - `bun run daily`: Default account 1-run universal daily (Pro Skips, 100 Rupie Gacha, Skyscope, Casino).
    - `bun run daily:acc1` / `bun run daily:acc2`: Account-targeted runs.
    - `bun run daily:all`: Runs universal daily routine across all enabled accounts sequentially.
    - `bun run daily:windowed`: Launches in visual headful mode for inspection.
    - `bun run daily:favorites`: Runs favorites pro skips only (`daily-favorites`).
  - Refactored `src/cli/run-daily.ts` with multi-account support, scorecard reporting, and graceful exit handling.

## 3. Verified Fate Stories & Strategy Templates
- [x] **Fate Stories (`fate-stories`) fully operational**:
  - Fixed `handleSkipStoryScene` in `src/engines/universal-workflow.engine.ts` to support `.btn-scene-skip` and `.pop-synopsis .btn-scene-skip` modal confirmations.
  - Updated `templates/fate-stories.json` and `templates/fate-stories.dsl` with live GBF DOM selectors (`.btn-quest-list.fate`, `.prt-list-contents:not(.is-cleared)`).
  - Resolved dynamic AJAX render timing in `handleLoopWhile` by adding an initial settle polling window.
  - **Live Verification**: Successfully processed 25 consecutive Fate Episodes on `acc1`, auto-skipping dialogues, collecting rewards, and returning home with zero manual intervention.
- [x] **All 10 production workflow templates verified 100% compliant via `bun run workflow:validate`**.
- [x] **Unit test scorecard**: 8/8 suites passing (100% pass rate).

## 4. Daily Pro Skip Catalog Expansion & Command Guide
- [x] **Athena Showdown (Primal Legends Pro) Resolution**:
  - Identified Athena Showdown belongs to **Primal Legends Pro** (`data-pro-chapter-id="30547"`, `questId: "305471"`).
  - Added `daily_primal_pro` (`Primal Legends Pro`) and `daily_eternals_pro` (`Eternals Unlock Treasure Pro`) to [`templates/daily-universal.dsl`](file:///c:/laragon/www/gbf/templates/daily-universal.dsl) and compiled to [`templates/daily-universal.json`](file:///c:/laragon/www/gbf/templates/daily-universal.json).
  - Refined `executeAutomatedProSkip` in [`src/engines/universal-workflow.engine.ts`](file:///c:/laragon/www/gbf/src/engines/universal-workflow.engine.ts) to scope banner detection strictly to `.pop-pro-quest-list .prt-stage-quest.active .prt-quest-banner`.
  - Added `waitForSelector` for `.btn-pro-list, .btn-pro-quest` in `ensureProListModalOpen` to eliminate page-transition timing glitches.
  - **Live Verification**: `bun run daily:acc1` executed and cleared `Primal Legends Pro`, `Showdown Pro`, `Clash Pro`, `Six-Dragon Advent Pro`, and `Eternals Unlock Treasure Pro` with 100% pass.
- [x] **Command Guide (`strategies/command.md`) Updated**:
  - Enforced Bun (`bun run ...`) as the primary execution standard.
  - Documented full Guild War Nightmare (NM95) automation (`gw-nm95`, `gw-nm95-light`, `gw-nm95-light:windowed`), rotation sequence, and custom NM template authoring (NM90/NM100/NM150/NM200).
  - Documented complete 11 Pro Skips roster and all CLI operational modes.

## 5. GW NM95 Combat Rotation & Summon Slot 2 Stability
- [x] **Summon Slot 2 Call Precision**:
  - Diagnosed in live battle DOM: In GBF combat, summon cards are strictly **1-indexed** (`pos="1"` = Quick Summon, `pos="2"` = Slot 2, `pos="3"` = Slot 3, etc.).
  - Fixed 0-indexed offset bug where `slot: 2` evaluated to `pos="1"` (which was already exhausted by Quick Call and disabled).
  - Added robust summon tray drawer handling: closes character drawer if `.btn-command-back.display-on` is active, checks if `.btn-command-summon.summon-on` is already open, and taps `.btn-command-summon` without toggling off.
  - Added full multi-selector modal confirmation support (`.pop-summon-detail .btn-usual-ok`, `.btn-usual-ok.btn-summon-use`, `.btn-call`, `.se-summon-call`).
  - Added summon animation lock settling (`waitForCombatInputReady`) to ensure MC and party skill queues never fire prematurely while the game canvas is locked.
  - Enhanced `dismissCombatDrawersAndPopups` to detect fixed overlays and dismiss error dialogs (such as "Not enough Machine Cells").