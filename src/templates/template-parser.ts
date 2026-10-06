// src/templates/template-parser.ts
import fs from 'fs';
import path from 'path';
import {
  WorkflowTemplate,
  WorkflowStep,
  WorkflowActionType,
  WorkflowStepCondition
} from '../types/workflow.types.js';
import {
  WorkflowTemplateSchema,
  validateWorkflowTemplate,
  normalizeActionCode,
  TemplateValidationResult
} from './template-schema.js';

export class TemplateParser {
  private static readonly TEMPLATES_DIR = path.resolve(process.cwd(), 'templates');

  /**
   * Lists all available template names in the templates directory.
   */
  public static listAvailableTemplates(): string[] {
    if (!fs.existsSync(this.TEMPLATES_DIR)) {
      fs.mkdirSync(this.TEMPLATES_DIR, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(this.TEMPLATES_DIR);
    const seen = new Set<string>();
    for (const f of files) {
      if (f.endsWith('.json') || f.endsWith('.txt') || f.endsWith('.dsl') || f.endsWith('.yaml') || f.endsWith('.yml')) {
        seen.add(f.replace(/\.(json|txt|dsl|yaml|yml)$/, ''));
      }
    }
    return Array.from(seen).sort();
  }

  /**
   * Validates a template object or raw data using strict Zod schema validation.
   */
  public static validate(data: unknown): TemplateValidationResult {
    return validateWorkflowTemplate(data);
  }

  /**
   * Loads and parses a template file by name. Supports .json, .dsl, .txt, .yaml.
   * Enforces compile-time schema validation and provides actionable error reports.
   */
  public static loadTemplate(templateName: string): WorkflowTemplate {
    const baseName = templateName.replace(/\.(json|txt|dsl|yaml|yml)$/, '');
    const possibleFiles = [
      path.join(this.TEMPLATES_DIR, `${baseName}.json`),
      path.join(this.TEMPLATES_DIR, `${baseName}.dsl`),
      path.join(this.TEMPLATES_DIR, `${baseName}.txt`),
      path.join(this.TEMPLATES_DIR, `${baseName}.yaml`),
      path.join(this.TEMPLATES_DIR, `${baseName}.yml`),
      path.join(this.TEMPLATES_DIR, baseName)
    ];

    const filePath = possibleFiles.find(p => fs.existsSync(p));

    if (!filePath) {
      throw new Error(
        `[TemplateParser] Template "${templateName}" not found in ${this.TEMPLATES_DIR}.\nAvailable: ${this.listAvailableTemplates().join(', ') || 'None'}`
      );
    }

    const rawContent = fs.readFileSync(filePath, 'utf-8').trim();

    // 1. JSON handling
    if (filePath.endsWith('.json') || rawContent.startsWith('{')) {
      try {
        const rawJson = JSON.parse(rawContent);
        const validation = validateWorkflowTemplate(rawJson);
        if (validation.valid && validation.template) {
          if (validation.warnings.length > 0) {
            console.warn(`[TemplateParser] ⚠️ Warnings in "${templateName}":\n  - ${validation.warnings.join('\n  - ')}`);
          }
          return validation.template;
        } else {
          throw new Error(
            `[TemplateParser] Invalid template structure in "${filePath}":\n  - ${validation.errors.join('\n  - ')}`
          );
        }
      } catch (err: any) {
        if (err.message.includes('[TemplateParser] Invalid template structure')) {
          throw err;
        }
        // If JSON.parse failed and file is not explicitly .json, try parsing as shorthand DSL
        if (!filePath.endsWith('.json')) {
          return this.parseShorthandDsl(rawContent, baseName);
        }
        throw new Error(`[TemplateParser] JSON syntax error in "${filePath}": ${err.message}`);
      }
    }

    // 2. Parse as shorthand DSL
    const dslTemplate = this.parseShorthandDsl(rawContent, baseName);
    const validation = validateWorkflowTemplate(dslTemplate);
    if (!validation.valid) {
      throw new Error(
        `[TemplateParser] DSL parsed template for "${templateName}" failed validation:\n  - ${validation.errors.join('\n  - ')}`
      );
    }
    if (validation.warnings.length > 0) {
      console.warn(`[TemplateParser] ⚠️ Warnings in DSL "${templateName}":\n  - ${validation.warnings.join('\n  - ')}`);
    }
    return validation.template!;
  }

  /**
   * Parses human-written shorthand DSL text supporting metadata directives,
   * compact action abbreviations, repeat blocks, and conditional exits.
   */
  public static parseShorthandDsl(content: string, defaultName: string): WorkflowTemplate {
    const rawLines = content.split('\n');
    let templateName = defaultName;
    let description = '';
    let mode: 'combat' | 'routine' | 'assist' = 'combat';
    let questUrl = 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0';
    let supporterPriority = ['Hades', 'Bahamut', 'Zeus', 'Lucifer'];
    let raidSlot: number | undefined;
    let raidSlots: number[] | undefined;
    let speedProfile: 'stealth' | 'fast' | 'turbo' = 'fast';
    let defaultRuns = 100;
    let humanMotor = true;
    let stopOnCaptcha = true;
    let autoElixir = true;
    let autoBerry = true;
    let targetScore: number | undefined;
    let minBatchClaim: number | undefined;
    let maxBatchClaim: number | undefined;
    let minHpPct: number | undefined;
    let maxPlayers: number | undefined;
    let logPath: string | undefined;

    const steps: WorkflowStep[] = [];
    let readyScreenOccurrence = 0;

    type BlockType = 'repeat' | 'loop_while' | 'loop_until' | 'do_until_finish';
    let currentBlockType: BlockType | null = null;
    let currentBlockTarget: string | undefined;
    let repeatCount = 1;
    let currentBlockSubSteps: WorkflowStep[] = [];

    for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
      const line = rawLines[lineIndex].trim();

      // Skip blank lines and comments
      if (line.length === 0 || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) {
        continue;
      }

      // Separators
      if (line.startsWith('---') || line.startsWith('===')) {
        continue;
      }

      // Metadata Directives (Header definitions)
      if (/^name\s*:\s*(.+)$/i.test(line)) {
        templateName = line.match(/^name\s*:\s*(.+)$/i)![1].trim();
        continue;
      }
      if (/^mode\s*:\s*(.+)$/i.test(line)) {
        const m = line.match(/^mode\s*:\s*(.+)$/i)![1].toLowerCase().trim();
        if (m === 'combat' || m === 'routine' || m === 'assist') {
          mode = m;
        }
        continue;
      }
      if (/^desc(?:ription)?\s*:\s*(.+)$/i.test(line)) {
        description = line.match(/^desc(?:ription)?\s*:\s*(.+)$/i)![1].trim();
        continue;
      }
      if (/^(?:start|quest|url)\s*:\s*(.+)$/i.test(line)) {
        const urlMatch = line.match(/https?:\/\/[^\s]+|#[^\s]+/);
        if (urlMatch) questUrl = urlMatch[0];
        continue;
      }
      if (/^speed(?:\s*profile)?\s*:\s*(.+)$/i.test(line)) {
        const val = line.match(/^speed(?:\s*profile)?\s*:\s*(.+)$/i)![1].toLowerCase().trim();
        if (val === 'stealth' || val === 'fast' || val === 'turbo') speedProfile = val;
        continue;
      }
      if (/^runs?\s*:\s*(\d+)$/i.test(line)) {
        defaultRuns = parseInt(line.match(/^runs?\s*:\s*(\d+)$/i)![1], 10);
        continue;
      }
      if (/^supporters?\s*:\s*(.+)$/i.test(line)) {
        const supStr = line.match(/^supporters?\s*:\s*(.+)$/i)![1];
        supporterPriority = supStr.split(',').map(s => s.trim()).filter(Boolean);
        continue;
      }
      if (/^slots?\s*:\s*([\d\s,]+)$/i.test(line)) {
        const slotNums = line.match(/^slots?\s*:\s*([\d\s,]+)$/i)![1]
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
      if (/^target_?score\s*:\s*(\d+)$/i.test(line)) {
        targetScore = parseInt(line.match(/^target_?score\s*:\s*(\d+)$/i)![1], 10);
        continue;
      }
      if (/^(?:auto_?)?elixir\s*:\s*(true|false)$/i.test(line)) {
        autoElixir = line.match(/true/i) !== null;
        continue;
      }
      if (/^(?:auto_?)?berry\s*:\s*(true|false)$/i.test(line)) {
        autoBerry = line.match(/true/i) !== null;
        continue;
      }
      if (/^batch_?claim\s*:\s*(\d+)\s*[-to\s]+\s*(\d+)$/i.test(line)) {
        const m = line.match(/^batch_?claim\s*:\s*(\d+)\s*[-to\s]+\s*(\d+)$/i)!;
        minBatchClaim = parseInt(m[1], 10);
        maxBatchClaim = parseInt(m[2], 10);
        continue;
      }

      // Check Block End: '}'
      if (currentBlockType && line === '}') {
        if (currentBlockType === 'repeat') {
          steps.push({
            id: `step_${steps.length + 1}`,
            name: `Repeat Block (${repeatCount}x)`,
            code: 'repeat',
            action: 'repeat',
            repeatCount,
            subSteps: currentBlockSubSteps
          });
        } else if (currentBlockType === 'loop_while') {
          steps.push({
            id: `step_${steps.length + 1}`,
            name: `Loop While (${currentBlockTarget})`,
            code: 'loop_while',
            action: 'loop_while',
            target: currentBlockTarget,
            subSteps: currentBlockSubSteps
          });
        } else if (currentBlockType === 'loop_until') {
          steps.push({
            id: `step_${steps.length + 1}`,
            name: `Loop Until (${currentBlockTarget})`,
            code: 'loop_until',
            action: 'loop_until',
            target: currentBlockTarget,
            subSteps: currentBlockSubSteps
          });
        } else if (currentBlockType === 'do_until_finish') {
          steps.push({
            id: `step_${steps.length + 1}`,
            name: `Do Until Finish (${currentBlockTarget})`,
            code: 'do_until_finish',
            action: 'do_until_finish',
            target: currentBlockTarget,
            tag: currentBlockTarget,
            subSteps: currentBlockSubSteps
          });
        }
        currentBlockType = null;
        currentBlockTarget = undefined;
        repeatCount = 1;
        currentBlockSubSteps = [];
        continue;
      }

      // Check Repeat Block Start: 'repeat 2 {' or 'loop 3 {'
      const repeatBlockMatch = line.match(/^(?:repeat|loop)\s+(\d+)\s*\{/i);
      if (repeatBlockMatch) {
        currentBlockType = 'repeat';
        repeatCount = parseInt(repeatBlockMatch[1], 10);
        currentBlockSubSteps = [];
        continue;
      }

      // Check Loop While Block Start: 'loop_while .selector {' or 'while .selector {'
      const loopWhileMatch = line.match(/^(?:loop_while|while)\s+(.+?)\s*\{/i);
      if (loopWhileMatch) {
        currentBlockType = 'loop_while';
        currentBlockTarget = loopWhileMatch[1].trim();
        currentBlockSubSteps = [];
        continue;
      }

      // Check Loop Until Block Start: 'loop_until .selector {' or 'until .selector {'
      const loopUntilMatch = line.match(/^(?:loop_until|until)\s+(.+?)\s*\{/i);
      if (loopUntilMatch) {
        currentBlockType = 'loop_until';
        currentBlockTarget = loopUntilMatch[1].trim();
        currentBlockSubSteps = [];
        continue;
      }

      // Check Do Until Finish Block Start: 'do_until_finish <target/tag> {'
      const doUntilFinishBlockMatch = line.match(/^(?:do_until_finish|loop_until_finish|until_finish)\s+(.+?)\s*\{/i);
      if (doUntilFinishBlockMatch) {
        currentBlockType = 'do_until_finish';
        currentBlockTarget = doUntilFinishBlockMatch[1].trim();
        currentBlockSubSteps = [];
        continue;
      }

      // Single-line inline repeat: "repeat 2: attack -> reload" or "loop 2: attack, f5"
      const inlineRepeatMatch = line.match(/^(?:repeat|loop)\s+(\d+)\s*:\s*(.+)$/i);
      if (inlineRepeatMatch) {
        const count = parseInt(inlineRepeatMatch[1], 10);
        const subActionStrings = inlineRepeatMatch[2].split(/->|,/).map(s => s.trim()).filter(Boolean);
        const compiledSubSteps: WorkflowStep[] = [];
        for (const subStr of subActionStrings) {
          const parsed = this.parseSingleDslAction(subStr, compiledSubSteps.length + 1);
          if (parsed) compiledSubSteps.push(parsed);
        }
        if (compiledSubSteps.length > 0) {
          const stepObj: WorkflowStep = {
            id: `step_${steps.length + 1}`,
            name: `Repeat (${count}x)`,
            code: 'repeat',
            action: 'repeat',
            repeatCount: count,
            subSteps: compiledSubSteps
          };
          if (currentBlockType) {
            currentBlockSubSteps.push(stepObj);
          } else {
            steps.push(stepObj);
          }
        }
        continue;
      }

      // Standard single-action parsing
      const step = this.parseSingleDslAction(line, currentBlockType ? currentBlockSubSteps.length + 1 : steps.length + 1, () => {
        readyScreenOccurrence++;
        return readyScreenOccurrence;
      });

      if (step) {
        if (currentBlockType) {
          currentBlockSubSteps.push(step);
        } else {
          steps.push(step);
        }
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
      minBatchClaim,
      maxBatchClaim,
      minHpPct,
      maxPlayers,
      logPath,
      steps
    };
  }

  /**
   * Helper that parses an individual action line into a typed WorkflowStep.
   */
  private static parseSingleDslAction(
    line: string,
    stepIndex: number,
    getReadyOccurrence?: () => number
  ): WorkflowStep | null {
    // Skip Story Scene / Fast Skip Dialogue
    if (/^skip[\s_]*(?:story[\s_]*scene|story|scene|fate)/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Fast-Skip Story Dialogue & Scene',
        code: 'skip_story_scene',
        action: 'skip_story_scene'
      };
    }

    // Pro Skip Favorites / Daily Favorites Macro
    if (/^(?:pro[\s_]*skip(?:[\s_]*favorites)?|daily[\s_]*(?:favorites|pro))/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Run All Pinned Favorite Daily Pro Skips',
        code: 'pro_skip_favorites',
        action: 'pro_skip_favorites'
      };
    }

    // Dismiss Popups & Modals
    if (/^dismiss[\s_]*(?:popups?|modals?|all)/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Dismiss All Popups and Modals',
        code: 'dismiss_popups',
        action: 'dismiss_popups'
      };
    }

    // Do Until Finish / Run Daily Target: "do_until_finish daily_magna_pro" or "run_daily daily_magna_pro"
    const doUntilMatch = line.match(/^(?:do_until_finish|loop_until_finish|until_finish|run_daily_target|run_daily|daily_target)\s+(.+)/i);
    if (doUntilMatch) {
      const targetTag = doUntilMatch[1].trim();
      return {
        id: `step_${stepIndex}`,
        name: `Do Until Finish (${targetTag})`,
        code: 'do_until_finish',
        action: 'do_until_finish',
        target: targetTag,
        tag: targetTag
      };
    }

    // 1. Ready screen tap
    if (/tab[\s_]*ready|tap[\s_]*ready|^ready(?:\s*:\s*click)?/i.test(line)) {
      const occurrence = getReadyOccurrence ? getReadyOccurrence() : 1;
      if (occurrence === 1) {
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
        name: 'Tap Ready Screen (Attack)',
        code: 'attack',
        action: 'attack',
        waitForNetwork: 'normal_attack_result.json'
      };
    }

    // 2. F5 / Reload / Refresh
    if (/^f5|^reload|^refresh/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: `Instant Reload F5 (Step ${stepIndex})`,
        code: 'reload',
        action: 'reload'
      };
    }

    // 3. Attack / Atk (supports optional delay: "attack 350", "attack wait 350ms")
    const atkMatch = line.match(/^(?:attack|atk)(?:[\s_]+(?:wait[\s_]+)?(\d+)(?:ms)?)?/i);
    if (atkMatch) {
      const delay = atkMatch[1] ? parseInt(atkMatch[1], 10) : undefined;
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
    if (/^quick[\s_]*(?:call|summon)|^qs\b/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Execute Quick Call',
        code: 'quick_call',
        action: 'quick_call',
        waitForNetwork: 'summon_result.json'
      };
    }

    // 5. Result Confirmation & Loot: "confirm", "loot", "confirm a bit", "result"
    if (/^(?:confirm|loot|dismiss|result)(?:[\s_]+a[\s_]+bit)?/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Confirm Battle Result & Dismiss Popups',
        code: 'confirm_result',
        action: 'confirm_result'
      };
    }

    // 6. Skill with target character: "c4s2 on 2", "c4s2->c2", "skill 4-2 on 2"
    const skillTargetMatch = line.match(/(?:skill[\s_]*|c)(\d)[-\s_]*(?:skill[\s_]*|s)?(\d)\s*(?:on|->)\s*(?:c|char|character)?\s*(\d)/i);
    if (skillTargetMatch) {
      const charNum = parseInt(skillTargetMatch[1], 10);
      const skillNum = parseInt(skillTargetMatch[2], 10);
      const targetChar = parseInt(skillTargetMatch[3], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Character ${charNum} Skill ${skillNum} on Character ${targetChar}`,
        code: 'skill',
        action: 'skill',
        character: charNum,
        skill: skillNum,
        targetCharacter: targetChar,
        waitForNetwork: 'ability_result.json'
      };
    }

    // 7. Regular skill: "c1s3", "skill 1-3", "skill 1 3", "char 1 skill 3", "1-3"
    const skillMatch = line.match(/(?:skill[\s_]*|c)(\d)[-\s_]*(?:skill[\s_]*|s)?(\d)/i);
    if (skillMatch) {
      const charNum = parseInt(skillMatch[1], 10);
      const skillNum = parseInt(skillMatch[2], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Character ${charNum} Skill ${skillNum}`,
        code: 'skill',
        action: 'skill',
        character: charNum,
        skill: skillNum,
        waitForNetwork: 'ability_result.json'
      };
    }

    // 8. Summon: "summon 1", "call 3"
    const summonMatch = line.match(/(?:summon|call)[\s_]*(\d+)/i);
    if (summonMatch) {
      const slot = parseInt(summonMatch[1], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Invoke Summon Slot ${slot}`,
        code: 'summon',
        action: 'summon',
        slot,
        waitForNetwork: 'summon_result.json'
      };
    }

    // 9. Target Enemy / Select Enemy: "target 1", "select enemy 2", "enemy 3"
    const targetEnemyMatch = line.match(/(?:target(?:[\s_]*enemy)?|select[\s_]+enemy|enemy)[\s_]*(\d+)/i);
    if (targetEnemyMatch) {
      const enemyIdx = parseInt(targetEnemyMatch[1], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Select Enemy ${enemyIdx}`,
        code: 'target_enemy',
        action: 'target_enemy',
        enemyIndex: enemyIdx
      };
    }

    // 10. Heal / Potion: "heal green", "heal blue", "potion green", "potion blue", "elixir"
    const healMatch = line.match(/(?:heal|potion)[\s_]*(green|blue|elixir)/i);
    if (healMatch) {
      const pType = healMatch[1].toLowerCase() as 'green' | 'blue' | 'elixir';
      return {
        id: `step_${stepIndex}`,
        name: `Use ${pType.toUpperCase()} Potion`,
        code: 'heal',
        action: 'heal',
        potionType: pType
      };
    }

    // 11. Backup Request: "backup", "request_backup", "backup_request"
    if (/backup(?:[\s_]*request)?|request[\s_]+backup/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Request Multi-Raid Backup',
        code: 'backup_request',
        action: 'backup_request'
      };
    }

    // 12. Exit if Score: "exit_if_score 1480000", "if score >= 1480000 exit"
    const exitScoreMatch = line.match(/(?:exit[\s_]*if[\s_]*score|exit[\s_]*on[\s_]*score)[\s_]*(\d+)|if\s+score\s*>=\s*(\d+)\s+exit/i);
    if (exitScoreMatch) {
      const score = parseInt(exitScoreMatch[1] || exitScoreMatch[2], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Exit if Honors >= ${score.toLocaleString()}`,
        code: 'exit_if_score',
        action: 'exit_if_score',
        targetScore: score
      };
    }

    // 13. Wait Turn: "wait_turn 2"
    const waitTurnMatch = line.match(/wait[\s_]*turn[\s_]*(\d+)/i);
    if (waitTurnMatch) {
      const turn = parseInt(waitTurnMatch[1], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Wait until Turn ${turn}`,
        code: 'wait_turn',
        action: 'wait_turn',
        condition: { type: 'turn_at_least', value: turn }
      };
    }

    // 14. Wait Random: "wait_random 300 800"
    const waitRandomMatch = line.match(/(?:wait[\s_]*random|wait[\s_]*randomize|delay[\s_]*random)[\s_]+(\d+)[\s_]+(\d+)/i);
    if (waitRandomMatch) {
      const minMs = parseInt(waitRandomMatch[1], 10);
      const maxMs = parseInt(waitRandomMatch[2], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Wait Random (${minMs}ms - ${maxMs}ms)`,
        code: 'wait_random',
        action: 'wait_random',
        minMs,
        maxMs
      };
    }

    // 15. Wait Network: "wait_network normal_attack_result.json"
    const waitNetMatch = line.match(/wait[\s_]*network[\s_]+(.+)/i);
    if (waitNetMatch) {
      const netUrl = waitNetMatch[1].trim();
      return {
        id: `step_${stepIndex}`,
        name: `Wait Network (${netUrl})`,
        code: 'wait_network',
        action: 'wait_network',
        waitForNetwork: netUrl
      };
    }

    // 16. Wait Element: "wait_element .btn-attack-start"
    const waitElemMatch = line.match(/wait[\s_]*element[\s_]+(.+)/i);
    if (waitElemMatch) {
      const selector = waitElemMatch[1].trim();
      return {
        id: `step_${stepIndex}`,
        name: `Wait Element (${selector})`,
        code: 'wait_element',
        action: 'wait_element',
        target: selector
      };
    }

    // 17. Wait: "wait 500", "sleep 500", "delay 500"
    const waitMatch = line.match(/(?:wait|sleep|delay)\s*(\d+)/i);
    if (waitMatch) {
      const ms = parseInt(waitMatch[1], 10);
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
    if (/^(?:smart_full_auto|fast_full_auto|smart_auto|fast_auto)/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Smart Full Auto Execution',
        code: 'smart_full_auto',
        action: 'smart_full_auto'
      };
    }
    if (/^full_auto\b/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Toggle Full Auto Mode',
        code: 'auto',
        action: 'auto',
        mode: 'full'
      };
    }
    if (/semi_auto/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Toggle Semi Auto Mode',
        code: 'auto',
        action: 'auto',
        mode: 'semi'
      };
    }
    if (/^auto\b/i.test(line)) {
      return {
        id: `step_${stepIndex}`,
        name: 'Toggle Auto Mode',
        code: 'auto',
        action: 'auto',
        mode: 'full'
      };
    }

    // 19. Guard: "guard all", "guard 1"
    const guardMatch = line.match(/guard\s*(all|\d)/i);
    if (guardMatch) {
      const tgt = guardMatch[1].toLowerCase();
      return {
        id: `step_${stepIndex}`,
        name: `Guard (${tgt})`,
        code: 'guard',
        action: 'guard',
        target: tgt
      };
    }

    // 20. Navigate / Goto: "navigate https://..."
    const navMatch = line.match(/(?:navigate|goto)\s+(.+)/i);
    if (navMatch) {
      const targetUrl = navMatch[1].trim();
      return {
        id: `step_${stepIndex}`,
        name: `Navigate to ${targetUrl}`,
        code: 'navigate',
        action: 'navigate',
        target: targetUrl
      };
    }

    // 21. Touch Tap: "touch_tap 240 370"
    const touchMatch = line.match(/(?:touch_tap|tap)\s+(\d+)\s+(\d+)/i);
    if (touchMatch) {
      const x = parseInt(touchMatch[1], 10);
      const y = parseInt(touchMatch[2], 10);
      return {
        id: `step_${stepIndex}`,
        name: `Touch Tap (${x}, ${y})`,
        code: 'touch_tap',
        action: 'touch_tap',
        x,
        y
      };
    }

    // 22. Eval JavaScript: "eval window.location.reload()"
    const evalMatch = line.match(/eval\s+(.+)/i);
    if (evalMatch) {
      return {
        id: `step_${stepIndex}`,
        name: 'Execute Custom Eval Script',
        code: 'eval',
        action: 'eval',
        script: evalMatch[1].trim()
      };
    }

    // 23. Click Selector: "click .btn-attack-start"
    const clickMatch = line.match(/click\s+(.+)/i);
    if (clickMatch) {
      return {
        id: `step_${stepIndex}`,
        name: `Click ${clickMatch[1]}`,
        code: 'click',
        action: 'click',
        target: clickMatch[1].trim()
      };
    }

    return null;
  }

  /**
   * Serializes a WorkflowTemplate into clean, human-readable DSL format.
   */
  public static serializeToDsl(template: WorkflowTemplate): string {
    const lines: string[] = [];

    lines.push(`# =========================================================================`);
    lines.push(`# Workflow Template: ${template.name}`);
    if (template.description) lines.push(`# Description: ${template.description}`);
    lines.push(`# =========================================================================`);
    lines.push('');
    lines.push(`Name: ${template.name}`);
    if (template.description) lines.push(`Description: ${template.description}`);
    if (template.mode) lines.push(`Mode: ${template.mode}`);
    lines.push(`Quest: ${template.questUrl}`);
    if (template.speedProfile) lines.push(`Speed: ${template.speedProfile}`);
    if (template.defaultRuns) lines.push(`Runs: ${template.defaultRuns}`);
    if (template.supporterPriority && template.supporterPriority.length > 0) {
      lines.push(`Supporters: ${template.supporterPriority.join(', ')}`);
    }
    if (template.raidSlots && template.raidSlots.length > 0) {
      lines.push(`Slots: ${template.raidSlots.join(', ')}`);
    } else if (template.raidSlot) {
      lines.push(`Slot: ${template.raidSlot}`);
    }
    if (template.targetScore) lines.push(`TargetScore: ${template.targetScore}`);
    lines.push(`Elixir: ${template.autoElixir !== false}`);
    lines.push(`Berry: ${template.autoBerry !== false}`);
    lines.push('');
    lines.push('---');

    const serializeStep = (step: WorkflowStep, indent = ''): string => {
      const code = step.code || step.action;
      switch (code) {
        case 'tap_ready':
          return `${indent}tap_ready`;
        case 'quick_call':
          return `${indent}quick_call`;
        case 'attack':
          return `${indent}attack`;
        case 'reload':
        case 'f5':
          return `${indent}reload`;
        case 'skill':
          if (step.targetCharacter) {
            return `${indent}c${step.character}s${step.skill} on ${step.targetCharacter}`;
          }
          return `${indent}c${step.character}s${step.skill}`;
        case 'summon':
          return `${indent}summon ${step.slot || 1}`;
        case 'target_enemy':
          return `${indent}target ${step.enemyIndex || 1}`;
        case 'heal':
          return `${indent}heal ${step.potionType || 'green'}`;
        case 'backup_request':
          return `${indent}backup_request`;
        case 'exit_if_score':
          return `${indent}exit_if_score ${step.targetScore || 1480000}`;
        case 'wait_turn':
          return `${indent}wait_turn ${step.condition?.value || 2}`;
        case 'auto':
          return `${indent}${step.mode === 'semi' ? 'semi_auto' : 'full_auto'}`;
        case 'guard':
          return `${indent}guard ${step.target || 'all'}`;
        case 'wait_random':
          return `${indent}wait_random ${step.minMs || 300} ${step.maxMs || 800}`;
        case 'wait_network':
          return `${indent}wait_network ${step.waitForNetwork || 'normal_attack_result.json'}`;
        case 'wait_element':
          return `${indent}wait_element ${step.target || '.btn-attack-start'}`;
        case 'wait':
          return `${indent}wait ${step.ms || 500}`;
        case 'touch_tap':
          return `${indent}touch_tap ${step.x || 240} ${step.y || 480}`;
        case 'navigate':
          return `${indent}navigate ${step.target || ''}`;
        case 'click':
          return `${indent}click ${step.target || ''}`;
        case 'eval':
          return `${indent}eval ${step.script || ''}`;
        case 'confirm_result':
          return `${indent}confirm_result`;
        case 'skip_story_scene':
          return `${indent}skip_story_scene`;
        case 'pro_skip_favorites':
          return `${indent}pro_skip_favorites`;
        case 'dismiss_popups':
          return `${indent}dismiss_popups`;
        case 'smart_full_auto':
          return `${indent}smart_full_auto`;
        case 'loop_while':
          if (step.subSteps && step.subSteps.length > 0) {
            const subLines = step.subSteps.map(s => serializeStep(s, `${indent}  `)).join('\n');
            return `${indent}loop_while ${step.target || step.conditionElement || ''} {\n${subLines}\n${indent}}`;
          }
          return `${indent}# Empty loop_while block`;
        case 'loop_until':
          if (step.subSteps && step.subSteps.length > 0) {
            const subLines = step.subSteps.map(s => serializeStep(s, `${indent}  `)).join('\n');
            return `${indent}loop_until ${step.target || step.conditionElement || ''} {\n${subLines}\n${indent}}`;
          }
          return `${indent}# Empty loop_until block`;
        case 'repeat':
          if (step.subSteps && step.subSteps.length > 0) {
            const subLines = step.subSteps.map(s => serializeStep(s, `${indent}  `)).join('\n');
            return `${indent}repeat ${step.repeatCount || 2} {\n${subLines}\n${indent}}`;
          }
          return `${indent}# Empty repeat block`;
        case 'do_until_finish':
        case 'run_daily_target':
          if (step.subSteps && step.subSteps.length > 0) {
            const subLines = step.subSteps.map(s => serializeStep(s, `${indent}  `)).join('\n');
            return `${indent}do_until_finish ${step.tag || step.target || ''} {\n${subLines}\n${indent}}`;
          }
          return `${indent}do_until_finish ${step.tag || step.target || ''}`;
        default:
          return `${indent}# Custom action: ${code}`;
      }
    };

    for (const step of template.steps) {
      lines.push(serializeStep(step));
    }

    lines.push('---');
    return lines.join('\n');
  }

  /**
   * Serializes a WorkflowTemplate to a JSON string.
   */
  public static serializeToJson(template: WorkflowTemplate, pretty = true): string {
    return JSON.stringify(template, null, pretty ? 2 : undefined);
  }

  /**
   * Saves a WorkflowTemplate to the templates directory in JSON or DSL format.
   */
  public static saveTemplate(
    template: WorkflowTemplate,
    format: 'json' | 'dsl' = 'json',
    fileName?: string
  ): string {
    const slug = (fileName || template.name).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const targetFile = path.join(this.TEMPLATES_DIR, `${slug}.${format}`);
    const content = format === 'dsl' ? this.serializeToDsl(template) : this.serializeToJson(template);
    fs.writeFileSync(targetFile, content, 'utf-8');
    return targetFile;
  }
}
