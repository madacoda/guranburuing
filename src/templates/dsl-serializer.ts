// src/templates/dsl-serializer.ts
import {
  WorkflowTemplate,
  WorkflowStep
} from '../types/workflow.types.js';

function serializeStep(step: WorkflowStep, indent = ''): string {
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
    case 'skill': {
      const ensureStr = step.ensureCast ? ' (make sure clicked or casted)' : '';
      if (step.targetCharacter) {
        return `${indent}c${step.character}s${step.skill} on ${step.targetCharacter}${ensureStr}`;
      }
      return `${indent}c${step.character}s${step.skill}${ensureStr}`;
    }
    case 'summon':
      if (step.target && isNaN(Number(step.target))) {
        return `${indent}summon ${step.target}`;
      }
      return `${indent}summon #${step.slot || 1}`;
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
    case 'wait_randomize':
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
    case 'start_quest':
      return `${indent}navigate ${step.target || step.page || ''}`;
    case 'click':
      return `${indent}click ${step.target || ''}`;
    case 'eval':
      return `${indent}eval ${step.script || ''}`;
    case 'confirm_result':
      return `${indent}confirm_result`;
    case 'log_enemy_hp':
      return `${indent}log_enemy_hp`;
    case 'exit_if_dead':
      return `${indent}exit_if_dead`;
    case 'exit_if_hp':
      return `${indent}exit_if_hp ${step.targetHpPct ?? step.targetHp ?? 0}`;
    case 'skip_story_scene':
      return `${indent}skip_story_scene`;
    case 'pro_skip_favorites':
      return `${indent}pro_skip_favorites`;
    case 'dismiss_popups':
      return `${indent}dismiss_popups`;
    case 'smart_full_auto':
      return `${indent}smart_full_auto`;
    case 'auto_fate_episode':
    case 'skip_fate_episode':
      return `${indent}auto_fate_episode`;
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
}

/**
 * Serializes a WorkflowTemplate into clean, human-readable DSL format.
 */
export function serializeToDsl(template: WorkflowTemplate): string {
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
  if (template.isSolo !== undefined) lines.push(`Solo: ${template.isSolo}`);
  if (template.logPath) lines.push(`LogPath: ${template.logPath}`);
  if (template.sector) lines.push(`Sector: ${template.sector}`);
  if (template.minHpPct !== undefined) lines.push(`Min HP: ${template.minHpPct}`);
  if (template.maxHpPct !== undefined) lines.push(`Max HP: ${template.maxHpPct}`);
  if (template.minPlayers !== undefined) lines.push(`Min Players: ${template.minPlayers}`);
  if (template.maxPlayers !== undefined) lines.push(`Max Players: ${template.maxPlayers}`);
  if (template.evaluatorStrategy) lines.push(`Strategy: ${template.evaluatorStrategy}`);
  if (template.minRaidScore !== undefined) lines.push(`Min Raid Score: ${template.minRaidScore}`);
  lines.push(`Elixir: ${template.autoElixir !== false}`);
  lines.push(`Berry: ${template.autoBerry !== false}`);
  lines.push('');
  lines.push('---');

  for (const step of template.steps) {
    lines.push(serializeStep(step));
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Serializes a WorkflowTemplate to a JSON string.
 */
export function serializeToJson(template: WorkflowTemplate, pretty = true): string {
  return JSON.stringify(template, null, pretty ? 2 : undefined);
}
