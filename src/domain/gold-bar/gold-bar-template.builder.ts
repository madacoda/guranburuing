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
      { code: 'tap_ready' },
      { code: 'quick_call', optional: true },
      { code: 'skill', character: 4, skill: 1 },
      { code: 'skill', character: 4, skill: 2, targetCharacter: 2 },
      { code: 'summon', slot: 3 },
      { code: 'skill', character: 2, skill: 1 },
      {
        code: 'repeat',
        repeatCount: 10,
        subSteps: [
          { code: 'exit_if_score', targetScore },
          { code: 'attack' },
          { code: 'reload' }
        ]
      }
    ]
  };
}
