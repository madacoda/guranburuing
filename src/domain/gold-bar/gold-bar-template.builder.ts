// src/domain/gold-bar/gold-bar-template.builder.ts
import { WorkflowTemplate } from '../../types/workflow.types.js';
import { GoldBarRaidDefinition } from './gold-bar.types.js';

/**
 * Builds a declarative WorkflowTemplate for Gold Bar hunter routines.
 * Enables UniversalWorkflowEngine to orchestrate all Gold Bar hunting via standard step pipelines.
 */
export function buildGoldBarWorkflowTemplate(
  raidDef: GoldBarRaidDefinition,
  options: {
    targetScore?: number;
    logPath?: string;
    speedProfile?: 'stealth' | 'fast' | 'turbo';
  } = {}
): WorkflowTemplate {
  const targetScore = options.targetScore || raidDef.defaultTargetScore;

  return {
    name: `Gold Bar Hunter - ${raidDef.name}`,
    description: `Automated ${raidDef.shortName} Dark Burst sequence orchestrated via UniversalWorkflowEngine.`,
    questUrl: 'https://game.granbluefantasy.jp/#quest/assist',
    raidSlot: raidDef.finderSlot,
    targetScore,
    logPath: options.logPath || raidDef.defaultLogPath,
    supporterPriority: [...raidDef.supporterPriorities],
    speedProfile: options.speedProfile || 'fast',
    humanMotor: true,
    stopOnCaptcha: true,
    autoElixir: false,
    autoBerry: true,
    steps: [
      {
        code: 'wait_element',
        name: 'Wait for Combat Loading & Buttons Interactable',
        target: '.btn-attack-start',
        timeoutMs: 6000
      },
      {
        code: 'wait_random',
        name: 'Human Delay for UI Interactable',
        minMs: 400,
        maxMs: 800
      },
      {
        code: 'skill',
        name: 'Character 4 Skill 1 (Ensured)',
        character: 4,
        skill: 1,
        ensureCast: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'quick_call',
        name: 'Quick Summon Call',
        waitForNetwork: 'summon_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Post-Summon Animation Cancel)'
      },
      {
        code: 'skill',
        name: 'Character 3 Skill 1',
        character: 3,
        skill: 1,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'skill',
        name: 'Character 2 Skill 1',
        character: 2,
        skill: 1,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'attack',
        name: 'Execute Attack',
        waitForNetwork: 'normal_attack_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Post-Attack Animation Cancel)'
      },
      {
        code: 'wait_random',
        name: 'Human-like Random Delay',
        minMs: 500,
        maxMs: 1500
      },
      {
        code: 'attack',
        name: 'Execute Attack Again',
        waitForNetwork: 'normal_attack_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Post-Attack Animation Cancel)'
      },
      {
        code: 'confirm_result',
        name: 'Confirm Battle Result & Claim Loot'
      }
    ]
  };
}
