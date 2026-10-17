// src/templates/dsl-compiler.ts
import {
  WorkflowTemplate,
  WorkflowStep
} from '../types/workflow.types.js';

// Pre-compiled module-level regular expressions for zero-allocation single-pass DSL parsing
const RX_QUOTE_TRIM = /^["'`]+|["'`]+$/g;
const RX_TRAILING_PAREN = /\s*\([^)]*\)$/;
const RX_ENSURE_COMMENT = /\b(make\s*sure|ensure|clicked\s*or\s*casted|required?)\b/i;

// Header Metadata Directives
const RX_META_NAME = /^name\s*:\s*(.+)$/i;
const RX_META_MODE = /^mode\s*:\s*(.+)$/i;
const RX_META_DESC = /^desc(?:ription)?\s*:\s*(.+)$/i;
const RX_META_QUEST_PREFIX = /^(?:start|quest|url)\s*:\s*(.+)$/i;
const RX_META_STAGE_PREFIX = /^(?:stage_?url|stage)\s*:\s*(.+)$/i;
const RX_URL_EXTRACT = /https?:\/\/[^\s]+|#[^\s]+/;
const RX_META_SPEED = /^speed(?:\s*profile)?\s*:\s*(.+)$/i;
const RX_META_RUNS = /^runs?\s*:\s*(\d+)$/i;
const RX_META_SUPPORTERS = /^supporters?\s*:\s*(.+)$/i;
const RX_META_SLOTS = /^slots?\s*:\s*([\d\s,]+)$/i;
const RX_META_TARGET_SCORE = /^target_?score\s*:\s*(\d+)$/i;
const RX_META_ELIXIR = /^(?:auto_?)?elixir\s*:\s*(true|false)$/i;
const RX_META_BERRY = /^(?:auto_?)?berry\s*:\s*(true|false)$/i;
const RX_META_SOLO = /^solo\s*:\s*(true|false)$/i;
const RX_META_BATCH_CLAIM = /^batch_?claim\s*:\s*(\d+)\s*[-to\s]+\s*(\d+)$/i;
const RX_META_LOG_PATH = /^log_?path\s*:\s*(.+)$/i;
const RX_META_SECTOR = /^sector\s*:\s*(.+)$/i;
const RX_META_TARGET_ENEMY = /^(?:target_enemy|enemy|target_boss|boss)\s*:\s*(.+)$/i;
const RX_META_MIN_HP = /^(?:min[\s_]?hp(?:[\s_]?pct)?|min[\s_]?health)\s*:\s*(\d+)%?$/i;
const RX_META_MAX_HP = /^(?:max[\s_]?hp(?:[\s_]?pct)?|max[\s_]?health)\s*:\s*(\d+)%?$/i;
const RX_META_HP_RANGE = /^hp(?:[\s_]?pct)?\s*:\s*(\d+)\s*(?:-|to|\.\.)\s*(\d+)\s*%?$/i;
const RX_META_MIN_PLAYERS = /^min[\s_]?players?\s*:\s*(\d+)$/i;
const RX_META_MAX_PLAYERS = /^max[\s_]?players?\s*:\s*(\d+)$/i;
const RX_META_STRATEGY = /^(?:evaluator[\s_]?strategy|strategy)\s*:\s*(honor|otk_burst|leech)$/i;
const RX_META_MIN_RAID_SCORE = /^min[\s_]?(?:raid[\s_]?)?score\s*:\s*(\d+)$/i;

// Control Flow Block Headers
const RX_BLOCK_REPEAT = /^(?:repeat|loop)\s+(\d+)\s*\{/i;
const RX_BLOCK_LOOP_WHILE = /^(?:loop_while|while)\s+(.+?)\s*\{/i;
const RX_BLOCK_LOOP_UNTIL = /^(?:loop_until|until)\s+(.+?)\s*\{/i;
const RX_BLOCK_DO_UNTIL_FINISH = /^(?:do_until_finish|loop_until_finish|until_finish)\s+(.+?)\s*\{/i;
const RX_INLINE_REPEAT = /^(?:repeat|loop)\s+(\d+)\s*:\s*(.+)$/i;
const RX_INLINE_SPLIT = /->|,/;

// Single Action Matchers
const RX_ACT_FATE = /^(?:auto[\s_]*fate(?:[\s_]*episode)?|fate[\s_]*(?:stories|episode|auto))/i;
const RX_ACT_SKIP_STORY = /^skip[\s_]*(?:story[\s_]*scene|story|scene)/i;
const RX_ACT_PRO_SKIP = /^(?:pro[\s_]*skip(?:[\s_]*favorites)?|daily[\s_]*(?:favorites|pro))/i;
const RX_ACT_DISMISS = /^dismiss[\s_]*(?:popups?|modals?|all)/i;
const RX_ACT_DO_UNTIL = /^(?:do_until_finish|loop_until_finish|until_finish|run_daily_target|run_daily|daily_target)\s+(.+)/i;
const RX_ACT_READY = /(?:tab|tap)(?:[\s_]+the)?[\s_]*ready|^ready(?:\s*:\s*click)?/i;
const RX_ACT_HAS_ATTACK = /(?:attack|atk)/i;
const RX_ACT_RELOAD = /^f5|^reload|^refresh/i;
const RX_ACT_ATTACK = /^(?:attack|atk)(?:[\s_]+again)?(?:[\s_]+(?:wait[\s_]+)?(\d+)(?:ms)?)?/i;
const RX_ACT_QUICK_CALL = /^quick[\s_]*(?:call|summon)|^qs\b/i;
const RX_ACT_CONFIRM = /^(?:confirm|loot|dismiss|result|done|finish|rerun|next)(?:[\s_]+a[\s_]+bit)?/i;
const RX_ACT_LOG_HP_1 = /^(?:log|check|print)[\s_]*(?:enemy[\s_]*)?hp\b/i;
const RX_ACT_LOG_HP_2 = /^enemy[\s_]*hp\b/i;
const RX_ACT_EXIT_DEAD = /^(?:exit|finish|stop)[\s_]*(?:if[\s_]*)?dead\b/i;
const RX_ACT_EXIT_HP = /^(?:exit|finish|stop)[\s_]*(?:if[\s_]*)?(?:enemy[\s_]*)?hp[\s_]*(\d+)\%?/i;
const RX_ACT_ATTACK_UNTIL_HONOR = /^(?:check[\s_]*(?:the[\s_]*)?honor[\s_]*and[\s_]*)?(?:keep[\s_]*)?attack(?:ing)?[\s_]*until[\s_]*honor/i;
const RX_ACT_SKILL_TARGET = /^(?:(?:char(?:acter)?|c)[\s_]*(\d)|skill[\s_]*(\d))[-\s_]*(?:skill[\s_]*|s)?(\d)\s*(?:on|->)\s*(?:c|char|character)?\s*(\d)$/i;
const RX_ACT_SKILL = /^(?:(?:char(?:acter)?|c)[\s_]*(\d)|skill[\s_]*(\d)|(\d))[-\s_]*(?:skill[\s_]*|s)?(\d)$/i;
const RX_ACT_SUMMON = /^(?:summon|call)(?:[\s_]+(?:number|slot|no\.?|#))?[\s_]*#?([a-zA-Z0-9_\-]+)$/i;
const RX_DIGITS_ONLY = /^\d+$/;
const RX_ACT_TARGET_ENEMY = /(?:target(?:[\s_]*enemy)?|select[\s_]+enemy|enemy)[\s_]*(\d+)/i;
const RX_ACT_HEAL = /(?:heal|potion)[\s_]*(green|blue|elixir)/i;
const RX_ACT_BACKUP = /backup(?:[\s_]*request)?|request[\s_]+backup/i;
const RX_ACT_EXIT_SCORE = /(?:exit[\s_]*if[\s_]*score|exit[\s_]*on[\s_]*score)[\s_]*(\d+)|if\s+score\s*>=\s*(\d+)\s+exit/i;
const RX_ACT_WAIT_TURN = /wait[\s_]*turn[\s_]*(\d+)/i;
const RX_ACT_WAIT_RANDOM = /^(?:wait[\s_]*random(?:ize)?|delay[\s_]*random|random[\s_]*delay|random[\s_]*wait|wait[\s_]+(?:a[\s_]+bit,?\s*)?(?:randomize[\s_]+a[\s_]+bit|human[\s_]*like))(?:[\s_]+(\d+)[\s_]+(\d+))?$/i;
const RX_ACT_WAIT_INTERACTABLE = /^(?:wait[\s_]+(?:for[\s_]+)?(?:loading|ready|screen|full[\s_]*load)|wait[\s_]+(?:a[\s_]+bit,?\s*)?(?:only[\s_]+a[\s_]+bit,?\s*)?(?:make[\s_]+sure[\s_]+(?:all\s+)?interactable)|make[\s_]+sure[\s_]+(?:all[\s_]+)?(?:interactable|loaded|full[\s_]*load))/i;
const RX_ACT_WAIT_NETWORK = /wait[\s_]*network[\s_]+(.+)/i;
const RX_ACT_WAIT_ELEMENT = /wait[\s_]*element[\s_]+(.+)/i;
const RX_ACT_WAIT_MS = /(?:wait|sleep|delay)\s*(\d+)/i;
const RX_ACT_SMART_FA = /^(?:smart_full_auto|fast_full_auto|smart_auto|fast_auto)/i;
const RX_ACT_FULL_AUTO = /^full_auto\b/i;
const RX_ACT_SEMI_AUTO = /semi_auto/i;
const RX_ACT_AUTO = /^auto\b/i;
const RX_ACT_GUARD = /guard\s*(all|\d)/i;
const RX_ACT_NAVIGATE = /(?:navigate|goto)\s+(.+)/i;
const RX_ACT_TOUCH_TAP = /(?:touch_tap|tap)\s+(\d+)\s+(\d+)/i;
const RX_ACT_EVAL = /eval\s+(.+)/i;
const RX_ACT_CLICK = /click\s+(.+)/i;

const COMBAT_CODES = new Set(['skill', 'summon', 'quick_call', 'attack', 'smart_full_auto']);

function checkStepsHaveCombat(st: WorkflowStep[]): boolean {
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if ((s.code && COMBAT_CODES.has(s.code)) || (s.subSteps && checkStepsHaveCombat(s.subSteps))) {
      return true;
    }
  }
  return false;
}

/**
 * Compiles human-written shorthand DSL text into a structured WorkflowTemplate.
 */
export function parseShorthandDsl(content: string, defaultName: string): WorkflowTemplate {
  const rawLines = content.split('\n');
  let templateName = defaultName;
  let description = '';
  let mode: 'combat' | 'routine' | 'assist' = 'combat';
  let questUrl = 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0';
  let stageUrl: string | undefined;
  let supporterPriority = ['Hades', 'Bahamut', 'Zeus', 'Lucifer'];
  let raidSlot: number | undefined;
  let raidSlots: number[] | undefined;
  let speedProfile: 'stealth' | 'fast' | 'turbo' = 'fast';
  let defaultRuns = 100;
  const humanMotor = true;
  const stopOnCaptcha = true;
  let autoElixir = true;
  let autoBerry = true;
  let targetScore: number | undefined;
  let minBatchClaim: number | undefined;
  let maxBatchClaim: number | undefined;
  let minHpPct: number | undefined;
  let maxHpPct: number | undefined;
  let minPlayers: number | undefined;
  let maxPlayers: number | undefined;
  let minRaidScore: number | undefined;
  let evaluatorStrategy: 'honor' | 'otk_burst' | 'leech' | undefined;
  let logPath: string | undefined;
  let isSolo: boolean | undefined;
  let sector: string | undefined;
  let targetEnemy: string | undefined;

  const steps: WorkflowStep[] = [];
  let readyScreenOccurrence = 0;
  let seenPriorCombatAction = false;

  type BlockType = 'repeat' | 'loop_while' | 'loop_until' | 'do_until_finish';
  interface BlockFrame {
    type: BlockType;
    target?: string;
    repeatCount: number;
    subSteps: WorkflowStep[];
  }
  const blockStack: BlockFrame[] = [];

  const pushStepToActiveScope = (stepObj: WorkflowStep): void => {
    if (stepObj.code && COMBAT_CODES.has(stepObj.code)) {
      seenPriorCombatAction = true;
    }
    if (blockStack.length > 0) {
      blockStack[blockStack.length - 1].subSteps.push(stepObj);
    } else {
      steps.push(stepObj);
    }
  };

  const currentScopeStepCount = (): number =>
    blockStack.length > 0 ? blockStack[blockStack.length - 1].subSteps.length : steps.length;

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    let line = rawLines[lineIndex].trim();

    // Skip blank lines and comments
    if (line.length === 0 || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) {
      continue;
    }

    // Separators
    if (line.startsWith('---') || line.startsWith('===')) {
      continue;
    }

    // Strip extraneous surrounding quotes or backticks from user typing/copy-paste
    line = line.replace(RX_QUOTE_TRIM, '').trim();

    let m: RegExpExecArray | null;

    // Metadata Directives (Header definitions) - single-pass exec
    if ((m = RX_META_NAME.exec(line))) {
      templateName = m[1].trim();
      continue;
    }
    if ((m = RX_META_MODE.exec(line))) {
      const val = m[1].toLowerCase().trim();
      if (val === 'combat' || val === 'routine' || val === 'assist') {
        mode = val;
      }
      continue;
    }
    if ((m = RX_META_DESC.exec(line))) {
      description = m[1].trim();
      continue;
    }
    if (RX_META_QUEST_PREFIX.test(line)) {
      const urlMatch = RX_URL_EXTRACT.exec(line);
      if (urlMatch) questUrl = urlMatch[0];
      continue;
    }
    if (RX_META_STAGE_PREFIX.test(line)) {
      const stageMatch = RX_URL_EXTRACT.exec(line);
      if (stageMatch) stageUrl = stageMatch[0];
      continue;
    }
    if ((m = RX_META_SPEED.exec(line))) {
      const val = m[1].toLowerCase().trim();
      if (val === 'stealth' || val === 'fast' || val === 'turbo') speedProfile = val;
      continue;
    }
    if ((m = RX_META_RUNS.exec(line))) {
      defaultRuns = parseInt(m[1], 10);
      continue;
    }
    if ((m = RX_META_SUPPORTERS.exec(line))) {
      supporterPriority = m[1].split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }
    if ((m = RX_META_SLOTS.exec(line))) {
      const slotNums = m[1]
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= 4);
      if (slotNums.length === 1) {
        raidSlot = slotNums[0];
        raidSlots = [slotNums[0]];
      } else if (slotNums.length > 1) {
        raidSlot = slotNums[0];
        raidSlots = slotNums;
      }
      continue;
    }
    if ((m = RX_META_TARGET_SCORE.exec(line))) {
      targetScore = parseInt(m[1], 10);
      continue;
    }
    if ((m = RX_META_ELIXIR.exec(line))) {
      autoElixir = m[1].toLowerCase() === 'true';
      continue;
    }
    if ((m = RX_META_BERRY.exec(line))) {
      autoBerry = m[1].toLowerCase() === 'true';
      continue;
    }
    if ((m = RX_META_SOLO.exec(line))) {
      isSolo = m[1].toLowerCase() === 'true';
      continue;
    }
    if ((m = RX_META_BATCH_CLAIM.exec(line))) {
      minBatchClaim = parseInt(m[1], 10);
      maxBatchClaim = parseInt(m[2], 10);
      continue;
    }
    if ((m = RX_META_LOG_PATH.exec(line))) {
      logPath = m[1].trim();
      continue;
    }
    if ((m = RX_META_SECTOR.exec(line))) {
      sector = m[1].trim();
      continue;
    }
    if ((m = RX_META_TARGET_ENEMY.exec(line))) {
      targetEnemy = m[1].trim();
      continue;
    }
    if ((m = RX_META_MIN_HP.exec(line))) {
      minHpPct = parseInt(m[1], 10);
      continue;
    }
    if ((m = RX_META_MAX_HP.exec(line))) {
      maxHpPct = parseInt(m[1], 10);
      continue;
    }
    if ((m = RX_META_HP_RANGE.exec(line))) {
      minHpPct = parseInt(m[1], 10);
      maxHpPct = parseInt(m[2], 10);
      continue;
    }
    if ((m = RX_META_MIN_PLAYERS.exec(line))) {
      minPlayers = parseInt(m[1], 10);
      continue;
    }
    if ((m = RX_META_MAX_PLAYERS.exec(line))) {
      maxPlayers = parseInt(m[1], 10);
      continue;
    }
    if ((m = RX_META_STRATEGY.exec(line))) {
      evaluatorStrategy = m[1].toLowerCase() as 'honor' | 'otk_burst' | 'leech';
      continue;
    }
    if ((m = RX_META_MIN_RAID_SCORE.exec(line))) {
      minRaidScore = parseInt(m[1], 10);
      continue;
    }

    // Check Block End: '}'
    if (blockStack.length > 0 && line === '}') {
      const frame = blockStack.pop()!;
      const nextIdx = currentScopeStepCount() + 1;
      let blockStep: WorkflowStep;
      if (frame.type === 'repeat') {
        blockStep = {
          id: `step_${nextIdx}`,
          name: `Repeat Block (${frame.repeatCount}x)`,
          code: 'repeat',
          action: 'repeat',
          repeatCount: frame.repeatCount,
          subSteps: frame.subSteps
        };
      } else if (frame.type === 'loop_while') {
        blockStep = {
          id: `step_${nextIdx}`,
          name: `Loop While (${frame.target})`,
          code: 'loop_while',
          action: 'loop_while',
          target: frame.target,
          subSteps: frame.subSteps
        };
      } else if (frame.type === 'loop_until') {
        blockStep = {
          id: `step_${nextIdx}`,
          name: `Loop Until (${frame.target})`,
          code: 'loop_until',
          action: 'loop_until',
          target: frame.target,
          subSteps: frame.subSteps
        };
      } else {
        blockStep = {
          id: `step_${nextIdx}`,
          name: `Do Until Finish (${frame.target})`,
          code: 'do_until_finish',
          action: 'do_until_finish',
          target: frame.target,
          tag: frame.target,
          subSteps: frame.subSteps
        };
      }
      pushStepToActiveScope(blockStep);
      continue;
    }

    // Check Repeat Block Start: 'repeat 2 {' or 'loop 3 {'
    if ((m = RX_BLOCK_REPEAT.exec(line))) {
      blockStack.push({
        type: 'repeat',
        repeatCount: parseInt(m[1], 10),
        subSteps: []
      });
      continue;
    }

    // Check Loop While Block Start: 'loop_while .selector {' or 'while .selector {'
    if ((m = RX_BLOCK_LOOP_WHILE.exec(line))) {
      blockStack.push({
        type: 'loop_while',
        target: m[1].trim(),
        repeatCount: 1,
        subSteps: []
      });
      continue;
    }

    // Check Loop Until Block Start: 'loop_until .selector {' or 'until .selector {'
    if ((m = RX_BLOCK_LOOP_UNTIL.exec(line))) {
      blockStack.push({
        type: 'loop_until',
        target: m[1].trim(),
        repeatCount: 1,
        subSteps: []
      });
      continue;
    }

    // Check Do Until Finish Block Start: 'do_until_finish <target/tag> {'
    if ((m = RX_BLOCK_DO_UNTIL_FINISH.exec(line))) {
      blockStack.push({
        type: 'do_until_finish',
        target: m[1].trim(),
        repeatCount: 1,
        subSteps: []
      });
      continue;
    }

    // Single-line inline repeat: "repeat 2: attack -> reload" or "loop 2: attack, f5"
    if ((m = RX_INLINE_REPEAT.exec(line))) {
      const count = parseInt(m[1], 10);
      const subActionStrings = m[2].split(RX_INLINE_SPLIT).map(s => s.trim()).filter(Boolean);
      const compiledSubSteps: WorkflowStep[] = [];
      for (const subStr of subActionStrings) {
        const parsed = parseSingleDslAction(subStr, compiledSubSteps.length + 1);
        if (parsed) {
          if (parsed.code && COMBAT_CODES.has(parsed.code)) {
            seenPriorCombatAction = true;
          }
          compiledSubSteps.push(parsed);
        }
      }
      if (compiledSubSteps.length > 0) {
        const stepObj: WorkflowStep = {
          id: `step_${currentScopeStepCount() + 1}`,
          name: `Repeat (${count}x)`,
          code: 'repeat',
          action: 'repeat',
          repeatCount: count,
          subSteps: compiledSubSteps
        };
        pushStepToActiveScope(stepObj);
      }
      continue;
    }

    // Standard single-action parsing with O(1) combat action tracking
    const step = parseSingleDslAction(
      line,
      currentScopeStepCount() + 1,
      () => {
        readyScreenOccurrence++;
        return readyScreenOccurrence;
      },
      () => seenPriorCombatAction
    );

    if (step) {
      pushStepToActiveScope(step);
    }
  }

  return {
    name: templateName,
    description,
    mode,
    questUrl,
    supporterPriority,
    raidSlot,
    raidSlots,
    speedProfile,
    defaultRuns,
    humanMotor,
    stopOnCaptcha,
    autoElixir,
    autoBerry,
    autoReplenishAp: autoElixir,
    autoReplenishEp: autoBerry,
    targetScore,
    isSolo,
    minBatchClaim,
    maxBatchClaim,
    minHpPct,
    maxHpPct,
    minPlayers,
    maxPlayers,
    evaluatorStrategy,
    minRaidScore,
    logPath,
    sector,
    targetEnemy,
    stageUrl,
    steps
  };
}

/**
 * Helper that parses an individual action line into a typed WorkflowStep.
 */
export function parseSingleDslAction(
  rawLine: string,
  stepIndex: number,
  getReadyOccurrence?: () => number,
  hasPriorCombatActions?: () => boolean
): WorkflowStep | null {
  const line = rawLine.replace(RX_QUOTE_TRIM, '').trim();
  let m: RegExpExecArray | null;

  // Auto Fate Episode Routine
  if (RX_ACT_FATE.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Clear Fate Episode (Cutscene Skip & Full Auto Combat)',
      code: 'auto_fate_episode',
      action: 'auto_fate_episode'
    };
  }

  // Skip Story Scene / Fast Skip Dialogue
  if (RX_ACT_SKIP_STORY.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Fast-Skip Story Dialogue & Scene',
      code: 'skip_story_scene',
      action: 'skip_story_scene'
    };
  }

  // Pro Skip Favorites / Daily Favorites Macro
  if (RX_ACT_PRO_SKIP.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Run All Pinned Favorite Daily Pro Skips',
      code: 'pro_skip_favorites',
      action: 'pro_skip_favorites'
    };
  }

  // Dismiss Popups & Modals
  if (RX_ACT_DISMISS.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Dismiss All Popups and Modals',
      code: 'dismiss_popups',
      action: 'dismiss_popups'
    };
  }

  // Do Until Finish / Run Daily Target: "do_until_finish daily_magna_pro" or "run_daily daily_magna_pro"
  if ((m = RX_ACT_DO_UNTIL.exec(line))) {
    const targetTag = m[1].trim();
    return {
      id: `step_${stepIndex}`,
      name: `Do Until Finish (${targetTag})`,
      code: 'do_until_finish',
      action: 'do_until_finish',
      target: targetTag,
      tag: targetTag
    };
  }

  // 1. Ready screen tap: "tap ready", "tap the ready", "ready: click"
  if (RX_ACT_READY.test(line)) {
    const occurrence = getReadyOccurrence ? getReadyOccurrence() : 1;
    const hasPrior = hasPriorCombatActions ? hasPriorCombatActions() : false;
    // Turn 0 quick call only if it is the very first combat action of the raid and not explicitly attack
    if (occurrence === 1 && !hasPrior && !RX_ACT_HAS_ATTACK.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Tap Ready Screen (Quick Call)',
        code: 'tap_ready',
        action: 'tap_ready',
        waitForNetwork: 'summon_result.json'
      };
    }
    return {
      id: `step_${stepIndex}`,
      name: 'Tap Ready Screen (Full Auto / Turn Action)',
      code: 'tap_ready',
      action: 'tap_ready'
    };
  }

  // 2. F5 / Reload / Refresh
  if (RX_ACT_RELOAD.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: `Instant Reload F5 (Step ${stepIndex})`,
      code: 'reload',
      action: 'reload'
    };
  }

  // 3. Attack / Atk (supports optional delay: "attack 350", "attack wait 350ms")
  if ((m = RX_ACT_ATTACK.exec(line))) {
    const delay = m[1] ? parseInt(m[1], 10) : undefined;
    return {
      id: `step_${stepIndex}`,
      name: 'Execute Normal Attack',
      code: 'attack',
      action: 'attack',
      waitForNetwork: 'normal_attack_result.json',
      ...(delay !== undefined ? { delayAfterMs: delay } : {})
    };
  }

  // 4. Quick Call / Quick Summon / QS
  if (RX_ACT_QUICK_CALL.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Execute Quick Call',
      code: 'quick_call',
      action: 'quick_call',
      waitForNetwork: 'summon_result.json'
    };
  }

  // 5. Result Confirmation & Loot
  if (RX_ACT_CONFIRM.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Confirm Battle Result & Dismiss Popups',
      code: 'confirm_result',
      action: 'confirm_result'
    };
  }

  // 5b. Log Enemy HP
  if (RX_ACT_LOG_HP_1.test(line) || RX_ACT_LOG_HP_2.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Log Enemy HP & Remaining HP',
      code: 'log_enemy_hp',
      action: 'log_enemy_hp'
    };
  }

  // 5c. Exit If Dead
  if (RX_ACT_EXIT_DEAD.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Exit Combat if Enemy Defeated',
      code: 'exit_if_dead',
      action: 'exit_if_dead'
    };
  }

  // 5d. Exit If HP Threshold
  if ((m = RX_ACT_EXIT_HP.exec(line))) {
    const threshold = parseInt(m[1], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Exit if Enemy HP <= ${threshold}%`,
      code: 'exit_if_hp',
      action: 'exit_if_hp',
      targetHpPct: threshold
    };
  }

  // Shorthand for loop until honor
  if (RX_ACT_ATTACK_UNTIL_HONOR.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Loop Attack Until Target Honor Reached',
      code: 'repeat',
      action: 'repeat',
      repeatCount: 10,
      subSteps: [
        {
          id: `step_${stepIndex}_1`,
          name: 'Exit if Honors Met',
          code: 'exit_if_score',
          action: 'exit_if_score',
          targetScore: 1800000
        },
        {
          id: `step_${stepIndex}_2`,
          name: 'Execute Normal Attack',
          code: 'attack',
          action: 'attack',
          optional: true,
          waitForNetwork: 'normal_attack_result.json'
        },
        {
          id: `step_${stepIndex}_3`,
          name: 'Instant Reload F5',
          code: 'reload',
          action: 'reload'
        }
      ]
    };
  }

  const hasEnsureComment = RX_ENSURE_COMMENT.test(line);
  const cleanLine = line.replace(RX_TRAILING_PAREN, '').trim();

  // 6. Skill with target character: "c4s2 on 2", "c4s2->c2", "skill 4-2 on 2"
  if ((m = RX_ACT_SKILL_TARGET.exec(cleanLine))) {
    const charNum = parseInt(m[1] || m[2], 10);
    const skillNum = parseInt(m[3], 10);
    const targetChar = parseInt(m[4], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Character ${charNum} Skill ${skillNum} on Character ${targetChar}${hasEnsureComment ? ' (Ensured)' : ''}`,
      code: 'skill',
      action: 'skill',
      character: charNum,
      skill: skillNum,
      targetCharacter: targetChar,
      waitForNetwork: 'ability_result.json',
      ...(hasEnsureComment ? { ensureCast: true } : {})
    };
  }

  // 7. Regular skill: "c1s3", "skill 1-3", "1-3"
  if ((m = RX_ACT_SKILL.exec(cleanLine))) {
    const charNum = parseInt(m[1] || m[2] || m[3], 10);
    const skillNum = parseInt(m[4], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Character ${charNum} Skill ${skillNum}${hasEnsureComment ? ' (Ensured)' : ''}`,
      code: 'skill',
      action: 'skill',
      character: charNum,
      skill: skillNum,
      waitForNetwork: 'ability_result.json',
      ...(hasEnsureComment ? { ensureCast: true } : {})
    };
  }

  // 8. Summon
  if ((m = RX_ACT_SUMMON.exec(cleanLine))) {
    const param = m[1].trim();
    const isNum = RX_DIGITS_ONLY.test(param);
    const slot = isNum ? parseInt(param, 10) : 1;
    const target = isNum ? undefined : param.toLowerCase();
    return {
      id: `step_${stepIndex}`,
      name: isNum ? `Invoke Summon Slot ${slot}` : `Invoke Summon (${param})`,
      code: 'summon',
      action: 'summon',
      slot,
      ...(target ? { target } : {}),
      waitForNetwork: 'summon_result.json'
    };
  }

  // 9. Target Enemy / Select Enemy
  if ((m = RX_ACT_TARGET_ENEMY.exec(cleanLine))) {
    const enemyIdx = parseInt(m[1], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Select Enemy ${enemyIdx}`,
      code: 'target_enemy',
      action: 'target_enemy',
      enemyIndex: enemyIdx
    };
  }

  // 10. Heal / Potion
  if ((m = RX_ACT_HEAL.exec(line))) {
    const pType = m[1].toLowerCase() as 'green' | 'blue' | 'elixir';
    return {
      id: `step_${stepIndex}`,
      name: `Use ${pType.toUpperCase()} Potion`,
      code: 'heal',
      action: 'heal',
      potionType: pType
    };
  }

  // 11. Backup Request
  if (RX_ACT_BACKUP.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Request Multi-Raid Backup',
      code: 'backup_request',
      action: 'backup_request'
    };
  }

  // 12. Exit if Score
  if ((m = RX_ACT_EXIT_SCORE.exec(line))) {
    const score = parseInt(m[1] || m[2], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Exit if Honors >= ${score.toLocaleString()}`,
      code: 'exit_if_score',
      action: 'exit_if_score',
      targetScore: score
    };
  }

  // 13. Wait Turn
  if ((m = RX_ACT_WAIT_TURN.exec(line))) {
    const turn = parseInt(m[1], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Wait until Turn ${turn}`,
      code: 'wait_turn',
      action: 'wait_turn',
      condition: { type: 'turn_at_least', value: turn }
    };
  }

  // 13b. Wait for Loading / Interactable
  if (RX_ACT_WAIT_INTERACTABLE.test(cleanLine)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Wait for Combat Loading & Buttons Interactable',
      code: 'wait_element',
      action: 'wait_element',
      target: '.btn-attack-start'
    };
  }

  // 14. Wait Random / Random Delay
  if ((m = RX_ACT_WAIT_RANDOM.exec(cleanLine))) {
    const minMs = m[1] ? parseInt(m[1], 10) : 500;
    const maxMs = m[2] ? parseInt(m[2], 10) : 1500;
    return {
      id: `step_${stepIndex}`,
      name: `Random Delay (${minMs}ms - ${maxMs}ms)`,
      code: 'wait_random',
      action: 'wait_random',
      minMs,
      maxMs
    };
  }

  // 15. Wait Network
  if ((m = RX_ACT_WAIT_NETWORK.exec(line))) {
    const netUrl = m[1].trim();
    return {
      id: `step_${stepIndex}`,
      name: `Wait Network (${netUrl})`,
      code: 'wait_network',
      action: 'wait_network',
      waitForNetwork: netUrl
    };
  }

  // 16. Wait Element
  if ((m = RX_ACT_WAIT_ELEMENT.exec(line))) {
    const selector = m[1].trim();
    return {
      id: `step_${stepIndex}`,
      name: `Wait Element (${selector})`,
      code: 'wait_element',
      action: 'wait_element',
      target: selector
    };
  }

  // 17. Wait
  if ((m = RX_ACT_WAIT_MS.exec(line))) {
    const ms = parseInt(m[1], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Wait ${ms}ms`,
      code: 'wait',
      action: 'wait',
      ms,
      delayAfterMs: ms
    };
  }

  // 18. Auto / Smart Full Auto / Full Auto / Semi Auto
  if (RX_ACT_SMART_FA.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Smart Full Auto Execution',
      code: 'smart_full_auto',
      action: 'smart_full_auto'
    };
  }
  if (RX_ACT_FULL_AUTO.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Toggle Full Auto Mode',
      code: 'auto',
      action: 'auto',
      mode: 'full'
    };
  }
  if (RX_ACT_SEMI_AUTO.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Toggle Semi Auto Mode',
      code: 'auto',
      action: 'auto',
      mode: 'semi'
    };
  }
  if (RX_ACT_AUTO.test(line)) {
    return {
      id: `step_${stepIndex}`,
      name: 'Toggle Auto Mode',
      code: 'auto',
      action: 'auto',
      mode: 'full'
    };
  }

  // 19. Guard
  if ((m = RX_ACT_GUARD.exec(line))) {
    const tgt = m[1].toLowerCase();
    return {
      id: `step_${stepIndex}`,
      name: `Guard (${tgt})`,
      code: 'guard',
      action: 'guard',
      target: tgt
    };
  }

  // 20. Navigate / Goto
  if ((m = RX_ACT_NAVIGATE.exec(line))) {
    const targetUrl = m[1].trim();
    return {
      id: `step_${stepIndex}`,
      name: `Navigate to ${targetUrl}`,
      code: 'navigate',
      action: 'navigate',
      target: targetUrl
    };
  }

  // 21. Touch Tap
  if ((m = RX_ACT_TOUCH_TAP.exec(line))) {
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    return {
      id: `step_${stepIndex}`,
      name: `Touch Tap (${x}, ${y})`,
      code: 'touch_tap',
      action: 'touch_tap',
      x,
      y
    };
  }

  // 22. Eval JavaScript
  if ((m = RX_ACT_EVAL.exec(line))) {
    return {
      id: `step_${stepIndex}`,
      name: 'Execute Custom Eval Script',
      code: 'eval',
      action: 'eval',
      script: m[1].trim()
    };
  }

  // 23. Click Selector
  if ((m = RX_ACT_CLICK.exec(line))) {
    return {
      id: `step_${stepIndex}`,
      name: `Click ${m[1]}`,
      code: 'click',
      action: 'click',
      target: m[1].trim()
    };
  }

  return null;
}
