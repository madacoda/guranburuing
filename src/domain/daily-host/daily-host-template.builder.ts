// src/domain/daily-host/daily-host-template.builder.ts
import { WorkflowTemplate } from '../../types/workflow.types.js';
import { DailyRaidHostDefinition } from './daily-host.types.js';

/**
 * Builds a declarative WorkflowTemplate for daily raid hosting.
 * Enables UniversalWorkflowEngine to orchestrate all daily host battles (Smart Full Auto + Pub Backup).
 */
export function buildDailyHostWorkflowTemplate(
  raidDef: DailyRaidHostDefinition,
  options: {
    maxTurns?: number;
    logPath?: string;
  } = {}
): WorkflowTemplate {
  return {
    name: `Daily Host - ${raidDef.name}`,
    description: `Automated daily host routine for ${raidDef.name} (${raidDef.category.toUpperCase()}) orchestrated via UniversalWorkflowEngine.`,
    questUrl: `https://game.granbluefantasy.jp/#quest/multi/0`,
    logPath: options.logPath || 'logs/daily-host.md',
    supporterPriority: ['Hades', 'Bahamut', 'Lucifer', 'Zeus', 'Agni', 'Varuna', 'Titan', 'Zephyrus', 'Kaguya'],
    speedProfile: 'fast',
    humanMotor: true,
    stopOnCaptcha: true,
    autoElixir: true,
    autoBerry: false,
    steps: [
      { code: 'tap_ready' },
      { code: 'backup_request' },
      { code: 'quick_call', optional: true },
      { code: 'auto', mode: 'full' },
      {
        code: 'repeat',
        repeatCount: options.maxTurns || 30,
        subSteps: [
          { code: 'attack' },
          { code: 'reload' }
        ]
      },
      { code: 'confirm_result' }
    ]
  };
}
