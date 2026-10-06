// src/types/workflow.types.ts

export type WorkflowActionType =
  | 'start_quest'
  | 'tap_ready'
  | 'quick_call'
  | 'attack'
  | 'reload'
  | 'f5'
  | 'skill'
  | 'summon'
  | 'auto'
  | 'guard'
  | 'target_enemy'
  | 'heal'
  | 'backup_request'
  | 'repeat'
  | 'condition'
  | 'exit_if_score'
  | 'wait_turn'
  | 'navigate'
  | 'click'
  | 'touch_tap'
  | 'wait'
  | 'wait_random'
  | 'wait_randomize'
  | 'wait_network'
  | 'wait_element'
  | 'confirm_result'
  | 'eval'
  | 'loop_while'
  | 'loop_until'
  | 'do_until_finish'
  | 'run_daily_target'
  | 'skip_story_scene'
  | 'pro_skip_favorites'
  | 'dismiss_popups'
  | 'smart_full_auto'
  | 'custom';

export interface WorkflowStepCondition {
  type: 'hp_below' | 'hp_above' | 'turn_at_least' | 'score_at_least';
  value: number;
}

export interface WorkflowStep {
  id?: string;
  name?: string;
  code: WorkflowActionType; // Primary action code, e.g. "tap_ready", "reload", "attack"
  action?: WorkflowActionType; // Backwards-compatible alias for code
  target?: string;          // Selector, URL, skill index ("1-3"), or network URL
  page?: string;            // Navigation target page URL or hash (e.g. #quest/extra, #gacha)
  tag?: string;             // Data catalog task identifier (e.g. "daily_magna_pro", "daily_rupie")
  character?: number;       // 1-indexed character slot for skill (1 to 4)
  skill?: number;           // 1-indexed skill slot for skill (1 to 4)
  targetCharacter?: number; // Target character slot for targeted skills
  slot?: number;            // Summon slot (1 to 6)
  mode?: 'full' | 'semi';   // Auto battle mode
  enemyIndex?: number;      // 1-indexed enemy index (1 to 3)
  potionType?: 'green' | 'blue' | 'elixir'; // Healing potion type
  targetScore?: number;     // Target score threshold for early exit
  condition?: WorkflowStepCondition; // Conditional evaluation
  repeatCount?: number;     // Number of times to loop subSteps
  subSteps?: WorkflowStep[]; // Nested steps for repeat blocks
  maxLoops?: number;        // Safety ceiling for loop_while / loop_until / do_until_finish blocks
  conditionElement?: string; // CSS selector or condition target for loop_while/until
  ms?: number;              // Fixed wait time in ms
  minMs?: number;           // Min wait time for randomized delay
  maxMs?: number;           // Max wait time for randomized delay
  x?: number;               // X coordinate for touch_tap
  y?: number;               // Y coordinate for touch_tap
  script?: string;          // JavaScript code for eval
  timeoutMs?: number;       // Maximum wait time for action
  waitForNetwork?: string;  // e.g. "summon_result.json", "ability_result.json", "normal_attack_result.json"
  delayAfterMs?: number;    // Optional pause after action
  skillsTurn1Only?: boolean; // For smart_full_auto: only cast skills on turn 1, subsequent turns attack/reload only
  tacticalSkillsMode?: 'smart' | 'turn1_only' | 'off'; // For smart_full_auto: tactical skill decision engine mode (default: 'smart')
  healHpThreshold?: number;     // For smart_full_auto: only cast Green (Heal) skills if party avg HP drops below this ratio (default: 0.75)
  minHealHpThreshold?: number;  // For smart_full_auto: only cast Green (Heal) skills if any frontline character HP drops below this ratio (default: 0.60)
  characters?: number[];    // For smart_full_auto: specific character slots to cast skills for (e.g. [1] for MC only)
  quickSummon?: boolean;    // For smart_full_auto: whether to cast quick summon on turn 1 (default: true)
  optional?: boolean;       // If true, step failure does not abort the run
  retries?: number;         // Step-level retries on failure (default: 1)
  label?: string;           // Step label for jump targets
  jumpTo?: string;          // Target label to jump to if condition is met
}

export interface WorkflowTemplate {
  name: string;
  description?: string;
  questUrl: string;
  mode?: 'combat' | 'routine' | 'assist'; // Execution mode: 'combat' (default quest run), 'routine' (page/dialog/loop automation), 'assist' (raid finder)
  supporterPriority?: string[];
  steps: WorkflowStep[];
  humanMotor?: boolean;     // Enable human motor variance (default: true)
  stopOnCaptcha?: boolean;  // Freeze automation & alert on CAPTCHA (default: true)
  autoElixir?: boolean;     // Auto-consume Half-Elixirs upon AP exhaustion (default: true)
  autoBerry?: boolean;      // Auto-consume Soul Berries upon EP exhaustion (default: true)
  autoReplenishAp?: boolean; // Alias for autoElixir
  autoReplenishEp?: boolean; // Alias for autoBerry
  raidSlot?: number;        // Slot filter (1-4) on Finder tab (#quest/assist)
  raidSlots?: number[];     // Multi-slot rotation filter list (e.g. [4, 3, 2]) on Finder tab
  defaultRuns?: number;
  speedProfile?: 'stealth' | 'fast' | 'turbo';
  targetScore?: number;     // Default score to exit raid (e.g. 1480000 for Blue Chest)
  minBatchClaim?: number;   // Min raids before checking pending battles (default: 3)
  maxBatchClaim?: number;   // Max raids before checking pending battles (default: 5)
  batchClaimSize?: number;  // Fixed override for pending batch claim
  minHpPct?: number;        // Minimum boss HP% filter for raid join (e.g. 50)
  maxPlayers?: number;      // Maximum players filter for raid join (e.g. 5)
  minRaidScore?: number;    // Minimum viability score (0-100) to join raid (default: 40)
  logPath?: string;         // Custom path to drop log (e.g. 'logs/gb-pbhl.md')
}

export interface WorkflowRunResult {
  runNumber: number;
  status: 'SUCCESS' | 'AP_EXHAUSTED' | 'FAILED' | 'STOPPED';
  durationMs: number;
  supporterName: string;
  itemsGained?: number;
  honors?: number;
  message: string;
}

export interface WorkflowSummary {
  templateName: string;
  accountId: string;
  totalRunsCompleted: number;
  totalDurationMs: number;
  averageDurationSec: number;
  logPath: string;
}
