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
  | 'back'
  | 'touch_tap'
  | 'wait'
  | 'wait_random'
  | 'wait_randomize'
  | 'wait_network'
  | 'wait_element'
  | 'wait_wave'
  | 'wait_for_wave'
  | 'wait_full_load'
  | 'confirm_result'
  | 'eval'
  | 'loop_while'
  | 'loop_until'
  | 'do_until_finish'
  | 'run_daily_target'
  | 'skip_story_scene'
  | 'auto_fate_episode'
  | 'skip_fate_episode'
  | 'pro_skip_favorites'
  | 'dismiss_popups'
  | 'smart_full_auto'
  | 'log_enemy_hp'
  | 'exit_if_dead'
  | 'exit_if_hp'
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
  targetHp?: number;        // Target boss HP threshold for early exit / condition
  targetHpPct?: number;     // Target boss HP percentage threshold for exit_if_hp
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
  ensureCast?: boolean;     // If true, retries drawer opening and click verification to ensure skill was casted
  waitForWave?: number;     // In multi-wave quests: wait until this wave (e.g. 2) is loaded and interactive before executing step
  wave?: number;            // Alias for waitForWave
  maxScenes?: number;       // For skip_story_scene: maximum consecutive cutscene parts to skip (default: 10)
  retries?: number;         // Step-level retries on failure (default: 1)
  label?: string;           // Step label for jump targets
  jumpTo?: string;          // Target label to jump to if condition is met
}

export interface WorkflowTemplate {
  name: string;
  description?: string;
  questUrl: string;
  stageUrl?: string;        // Optional Replicard stage map URL (e.g. 'https://game.granbluefantasy.jp/#replicard/stage/7')
  mode?: 'combat' | 'routine' | 'assist'; // Execution mode: 'combat' (default quest run), 'routine' (page/dialog/loop automation), 'assist' (raid finder)
  questId?: string | number; // Specific quest ID for stage maps (e.g. 819141 for Prometheus Militis)
  divisionId?: number;      // Replicard division ID (e.g. 3 for Serenity Ridge: Slopes)
  sector?: string;          // Replicard sector (e.g. 'Pink Sector (The Hanged Man)', 'Green Sector (The Tower)')
  targetEnemy?: string;     // Target enemy or encounter name (e.g. 'Avatar of Avarice', 'Goliath Keeper')
  element?: string;         // Target or player element (e.g. 'Fire', 'Water', 'Earth', 'Wind', 'Light', 'Dark')
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
  autoSetRaid?: boolean;    // Automatically configure Finder Tab/Slot (e.g. Tab 1) to target raid in search settings if needed
  autoSetRaidSlot?: number; // Optional slot override to configure (defaults to raidSlot || 1)
  targetRaidQuestId?: string | number; // Explicit quest ID override for finder slot configuration
  defaultRuns?: number;
  speedProfile?: 'stealth' | 'fast' | 'turbo';
  targetScore?: number;     // Default score to exit raid (e.g. 1480000 for Blue Chest)
  waves?: number;           // Total waves/battles in quest (e.g. 2 for Shiny Slime Search, 3 for Angel Halo)
  isSolo?: boolean;         // Mark quest as solo (Arcarum, Replicard, Fate Story). Automatically bypasses honorGuard and enables enemy HP tracking.
  honorGuard?: boolean;     // Enable/disable extra attack turns after combat pipeline if targetScore not reached (default: true)
  minBatchClaim?: number;   // Min raids before checking pending battles (default: 3)
  maxBatchClaim?: number;   // Max raids before checking pending battles (default: 5)
  batchClaimSize?: number;  // Fixed override for pending batch claim
  minHpPct?: number;        // Minimum boss HP% filter for raid join (e.g. 50 for honor, 1 for OTK burst)
  maxHpPct?: number;        // Maximum boss HP% filter for raid join (e.g. 20 for OTK burst)
  minPlayers?: number;      // Minimum active players filter for raid join (e.g. 3 for OTK burst)
  maxPlayers?: number;      // Maximum players filter for raid join (e.g. 5 for honor, 29 for OTK burst)
  minRaidScore?: number;    // Minimum viability score (0-100) to join raid (default: 40)
  evaluatorStrategy?: 'honor' | 'otk_burst' | 'leech' | 'farm'; // Scoring model: 'honor' (high HP, low players), 'otk_burst' / 'leech' (low HP <= 20%, active players >= 3), or 'farm' (adaptive, damage output, most joined raid & lowest HP)
  adaptive?: boolean;       // Enable adaptive raid candidate degradation to join the best active raid rather than idling in standby
  logPath?: string;         // Custom path to drop log (e.g. 'logs/gb-pbhl.md')
  interRunDelayMs?: number | [number, number]; // Explicit min-max or fixed delay between runs (with Gaussian jitter)
  delayBetweenRunsMs?: number | [number, number]; // Alias for interRunDelayMs
}

/**
 * Returns true if the workflow template represents a Solo quest (Arcarum, Replicard, Fate Episode, etc.).
 * Solo quests do not feature raid honors, multi-player rankings, or Blue Chests.
 */
export function isSoloWorkflowTemplate(tmpl?: WorkflowTemplate | null): boolean {
  if (!tmpl) return false;
  if (tmpl.isSolo === true) return true;
  if (tmpl.isSolo === false) return false;
  const qUrl = (tmpl.questUrl || '').toLowerCase();
  if (qUrl.includes('assist')) return false;
  const mode = (tmpl.mode || '').toLowerCase();
  if (mode === 'assist') return false;
  const name = (tmpl.name || '').toLowerCase();
  return (
    qUrl.includes('replicard') ||
    qUrl.includes('arcarum') ||
    qUrl.includes('fate') ||
    qUrl.includes('400151') ||
    qUrl.includes('40015') ||
    mode === 'single' ||
    mode === 'solo' ||
    name.includes('arcarum') ||
    name.includes('replicard') ||
    name.includes('paragon') ||
    name.includes('fortress') ||
    name.includes('slime') ||
    name.includes('fate')
  );
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
