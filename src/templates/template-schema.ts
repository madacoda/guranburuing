// src/templates/template-schema.ts
import { z } from 'zod';
import { WorkflowActionType, WorkflowStep, WorkflowTemplate } from '../types/workflow.types.js';

export const ACTION_ALIASES: Record<string, WorkflowActionType> = {
  f5: 'reload',
  reload: 'reload',
  refresh: 'reload',
  ready: 'tap_ready',
  tap_ready: 'tap_ready',
  tab_ready: 'tap_ready',
  quick_call: 'quick_call',
  quick_summon: 'quick_call',
  qs: 'quick_call',
  attack: 'attack',
  atk: 'attack',
  confirm: 'confirm_result',
  confirm_result: 'confirm_result',
  loot: 'confirm_result',
  result: 'confirm_result',
  skill: 'skill',
  ability: 'skill',
  summon: 'summon',
  call: 'summon',
  auto: 'auto',
  full_auto: 'auto',
  semi_auto: 'auto',
  guard: 'guard',
  target_enemy: 'target_enemy',
  target: 'target_enemy',
  select_enemy: 'target_enemy',
  heal: 'heal',
  potion: 'heal',
  backup_request: 'backup_request',
  backup: 'backup_request',
  repeat: 'repeat',
  loop: 'repeat',
  condition: 'condition',
  if: 'condition',
  exit_if_score: 'exit_if_score',
  wait_turn: 'wait_turn',
  navigate: 'navigate',
  goto: 'navigate',
  touch_tap: 'touch_tap',
  tap: 'touch_tap',
  eval: 'eval',
  click: 'click',
  wait_random: 'wait_random',
  wait_randomize: 'wait_random',
  delay_random: 'wait_random',
  wait_network: 'wait_network',
  wait_element: 'wait_element',
  wait: 'wait',
  delay: 'wait',
  sleep: 'wait',
  start_quest: 'start_quest',
  skip_story_scene: 'skip_story_scene',
  skip_story: 'skip_story_scene',
  skip_scene: 'skip_story_scene',
  skip_fate: 'skip_story_scene',
  fate_skip: 'skip_story_scene',
  pro_skip_favorites: 'pro_skip_favorites',
  pro_skip: 'pro_skip_favorites',
  daily_favorites: 'pro_skip_favorites',
  daily_pro: 'pro_skip_favorites',
  loop_while: 'loop_while',
  while: 'loop_while',
  loop_until: 'loop_until',
  until: 'loop_until',
  do_until_finish: 'do_until_finish',
  loop_until_finish: 'do_until_finish',
  until_finish: 'do_until_finish',
  until_finished: 'do_until_finish',
  run_daily_target: 'run_daily_target',
  daily_target: 'run_daily_target',
  dismiss_popups: 'dismiss_popups',
  dismiss_popup: 'dismiss_popups',
  dismiss_modal: 'dismiss_popups',
  dismiss_modals: 'dismiss_popups',
  dismiss: 'dismiss_popups',
  smart_full_auto: 'smart_full_auto',
  fast_full_auto: 'smart_full_auto',
  smart_auto: 'smart_full_auto',
  fast_auto: 'smart_full_auto'
};

export function normalizeActionCode(raw: string): WorkflowActionType {
  const clean = (raw || '').toLowerCase().trim();
  return ACTION_ALIASES[clean] || 'custom';
}

export const WorkflowActionTypeSchema = z.enum([
  'start_quest',
  'tap_ready',
  'quick_call',
  'attack',
  'reload',
  'f5',
  'skill',
  'summon',
  'auto',
  'guard',
  'target_enemy',
  'heal',
  'backup_request',
  'repeat',
  'condition',
  'exit_if_score',
  'wait_turn',
  'navigate',
  'click',
  'touch_tap',
  'wait',
  'wait_random',
  'wait_randomize',
  'wait_network',
  'wait_element',
  'confirm_result',
  'eval',
  'loop_while',
  'loop_until',
  'do_until_finish',
  'run_daily_target',
  'skip_story_scene',
  'pro_skip_favorites',
  'dismiss_popups',
  'smart_full_auto',
  'custom'
]);

export const WorkflowStepConditionSchema = z.object({
  type: z.enum(['hp_below', 'hp_above', 'turn_at_least', 'score_at_least']),
  value: z.number().nonnegative({ message: 'Condition value must be non-negative' })
});

export const WorkflowStepCoreSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  code: z.string().optional(),
  action: z.string().optional(),
  target: z.string().optional(),
  page: z.string().optional(),
  tag: z.string().optional(),
  conditionElement: z.string().optional(),
  character: z.number().int().min(1, 'Character slot must be 1 to 4').max(4, 'Frontline character slot must be 1 to 4').optional(),
  skill: z.number().int().min(1, 'Skill slot must be 1 to 4').max(4, 'Skill slot must be 1 to 4').optional(),
  targetCharacter: z.number().int().min(1, 'Target character slot must be 1 to 4').max(4, 'Target character slot must be 1 to 4').optional(),
  slot: z.number().int().min(1, 'Summon slot must be 1 to 6').max(6, 'Summon slot must be 1 to 6').optional(),
  mode: z.enum(['full', 'semi']).optional(),
  enemyIndex: z.number().int().min(1, 'Enemy index must be 1 to 3').max(3, 'Enemy index must be 1 to 3').optional(),
  potionType: z.enum(['green', 'blue', 'elixir']).optional(),
  targetScore: z.number().positive('targetScore must be a positive number').optional(),
  condition: WorkflowStepConditionSchema.optional(),
  repeatCount: z.number().int().min(1, 'repeatCount must be at least 1').optional(),
  maxLoops: z.number().int().min(1, 'maxLoops must be at least 1').optional(),
  ms: z.number().int().min(0, 'ms must be non-negative').optional(),
  minMs: z.number().int().min(0, 'minMs must be non-negative').optional(),
  maxMs: z.number().int().min(0, 'maxMs must be non-negative').optional(),
  x: z.number().min(0, 'X coordinate must be non-negative').optional(),
  y: z.number().min(0, 'Y coordinate must be non-negative').optional(),
  script: z.string().optional(),
  timeoutMs: z.number().int().positive('timeoutMs must be positive').optional(),
  waitForNetwork: z.string().optional(),
  delayAfterMs: z.number().int().min(0, 'delayAfterMs must be non-negative').optional(),
  skillsTurn1Only: z.boolean().optional(),
  tacticalSkillsMode: z.enum(['smart', 'turn1_only', 'off']).optional(),
  healHpThreshold: z.number().min(0).max(1).optional(),
  minHealHpThreshold: z.number().min(0).max(1).optional(),
  characters: z.array(z.number().int().min(1).max(4)).optional(),
  quickSummon: z.boolean().optional(),
  optional: z.boolean().optional(),
  retries: z.number().int().min(0).max(5).optional(),
  label: z.string().optional(),
  jumpTo: z.string().optional()
});

export const WorkflowStepSchema: z.ZodType<WorkflowStep, z.ZodTypeDef, any> = WorkflowStepCoreSchema.extend({
  subSteps: z.lazy(() => WorkflowStepSchema.array().optional())
}).superRefine((data, ctx) => {
  const action = normalizeActionCode(data.code || data.action || '');

  if (action === 'skill') {
    if (data.character === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['character'],
        message: 'Action "skill" requires "character" (1-4)'
      });
    }
    if (data.skill === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['skill'],
        message: 'Action "skill" requires "skill" (1-4)'
      });
    }
  }

  if (action === 'summon') {
    if (data.slot === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slot'],
        message: 'Action "summon" requires "slot" (1-6)'
      });
    }
  }

  if (action === 'touch_tap') {
    if (data.x === undefined || data.y === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x'],
        message: 'Action "touch_tap" requires both "x" and "y" coordinates'
      });
    }
  }

  if (action === 'wait_random' || action === 'wait_randomize') {
    if (data.minMs !== undefined && data.maxMs !== undefined && data.minMs > data.maxMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minMs'],
        message: `"minMs" (${data.minMs}) cannot be greater than "maxMs" (${data.maxMs})`
      });
    }
  }

  if (action === 'loop_while' || action === 'loop_until') {
    if (!data.target && !data.conditionElement) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: `Action "${action}" requires "target" or "conditionElement"`
      });
    }
    if (!data.subSteps || data.subSteps.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subSteps'],
        message: `Action "${action}" requires non-empty "subSteps" array`
      });
    }
  }

  if (action === 'do_until_finish' || action === 'run_daily_target') {
    if (!data.target && !data.tag && !data.page) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: `Action "${action}" requires "target", "tag", or "page"`
      });
    }
  }

  if (action === 'repeat') {
    if (!data.repeatCount || data.repeatCount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['repeatCount'],
        message: 'Action "repeat" requires "repeatCount" >= 1'
      });
    }
    if (!data.subSteps || data.subSteps.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['subSteps'],
        message: 'Action "repeat" requires non-empty "subSteps" array'
      });
    }
  }

  if (action === 'exit_if_score') {
    if (!data.targetScore || data.targetScore <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetScore'],
        message: 'Action "exit_if_score" requires a positive "targetScore"'
      });
    }
  }
}).transform(raw => {
  const resolvedCode = normalizeActionCode(raw.code || raw.action || '');
  return {
    ...raw,
    code: resolvedCode,
    action: resolvedCode,
    name: raw.name || `Step (${resolvedCode})`
  } as WorkflowStep;
});

export const WorkflowTemplateSchema = z.object({
  name: z.string({ required_error: 'Template "name" is required' }).min(1, 'Template name cannot be empty'),
  description: z.string().optional().default(''),
  mode: z.enum(['combat', 'routine', 'assist']).optional().default('combat'),
  questUrl: z.string().optional().default('https://game.granbluefantasy.jp/#mypage').refine(
    url => url.startsWith('http://') || url.startsWith('https://') || url.startsWith('#'),
    { message: 'questUrl must be a valid HTTP(S) URL or in-game hash (e.g. #quest/...)' }
  ),
  supporterPriority: z.array(z.string()).optional().default(['Zeus', 'Lucifer', 'Hades', 'Bahamut']),
  raidSlot: z.number().int().min(1, 'raidSlot must be 1 to 4').max(4, 'raidSlot must be 1 to 4').optional(),
  raidSlots: z.array(z.number().int().min(1).max(4)).optional(),
  humanMotor: z.boolean().optional().default(true),
  stopOnCaptcha: z.boolean().optional().default(true),
  autoElixir: z.boolean().optional().default(true),
  autoBerry: z.boolean().optional().default(true),
  autoReplenishAp: z.boolean().optional(),
  autoReplenishEp: z.boolean().optional(),
  defaultRuns: z.number().min(1, 'defaultRuns must be at least 1').optional().default(100),
  speedProfile: z.enum(['stealth', 'fast', 'turbo']).optional().default('fast'),
  targetScore: z.number().positive().optional(),
  minBatchClaim: z.number().int().min(1).max(5).optional().default(3),
  maxBatchClaim: z.number().int().min(1).max(5).optional().default(5),
  batchClaimSize: z.number().int().min(1).max(5).optional(),
  minHpPct: z.number().min(0).max(100).optional(),
  maxPlayers: z.number().int().min(1).max(30).optional(),
  minRaidScore: z.number().min(0).max(100).optional(),
  logPath: z.string().optional(),
  steps: z.array(WorkflowStepSchema).min(1, 'Template must contain at least 1 workflow step')
}).transform(val => {
  // Synchronize aliases
  return {
    ...val,
    autoElixir: val.autoReplenishAp !== undefined ? val.autoReplenishAp : val.autoElixir,
    autoBerry: val.autoReplenishEp !== undefined ? val.autoReplenishEp : val.autoBerry,
    autoReplenishAp: val.autoReplenishAp !== undefined ? val.autoReplenishAp : val.autoElixir,
    autoReplenishEp: val.autoReplenishEp !== undefined ? val.autoReplenishEp : val.autoBerry,
    raidSlots: val.raidSlots || (val.raidSlot ? [val.raidSlot] : undefined)
  } as WorkflowTemplate;
});

export interface TemplateValidationResult {
  valid: boolean;
  template?: WorkflowTemplate;
  errors: string[];
  warnings: string[];
}

export function validateWorkflowTemplate(raw: unknown): TemplateValidationResult {
  const result = WorkflowTemplateSchema.safeParse(raw);
  if (result.success) {
    const warnings: string[] = [];
    const template = result.data;

    // Check semantic best practice warnings
    if (template.questUrl.includes('assist') && (!template.raidSlot && (!template.raidSlots || template.raidSlots.length === 0))) {
      warnings.push('Template targets "#quest/assist" but specifies neither "raidSlot" nor "raidSlots". Defaults to [4, 3, 2].');
    }

    if (template.steps.length > 0 && template.mode !== 'routine') {
      const hasAttack = template.steps.some(s => s.code === 'attack' || s.code === 'auto' || s.code === 'smart_full_auto' || s.code === 'tap_ready');
      if (!hasAttack) {
        warnings.push('Template contains no attack, auto, or tap_ready steps. Battles may not advance.');
      }
      const hasConfirm = template.steps.some(s => s.code === 'confirm_result');
      if (!hasConfirm) {
        warnings.push('Template does not end with "confirm_result". Battle result popups might not be automatically dismissed.');
      }
    }

    return {
      valid: true,
      template,
      errors: [],
      warnings
    };
  }

  const errors = result.error.errors.map(err => {
    const path = err.path.length > 0 ? err.path.join('.') : 'root';
    return `[${path}] ${err.message}`;
  });

  return {
    valid: false,
    errors,
    warnings: []
  };
}
