// src/workflows/registry/default-registry.factory.ts
import { StepHandlerRegistry } from './step-handler.registry.js';
import {
  SkillStepHandler,
  AttackStepHandler,
  QuickCallStepHandler,
  ReloadStepHandler,
  AutoStepHandler,
  TargetEnemyStepHandler,
  HealStepHandler,
  BackupRequestStepHandler,
  TapReadyStepHandler
} from '../handlers/combat/index.js';
import {
  RepeatStepHandler,
  ExitIfScoreStepHandler,
  ConditionStepHandler
} from '../handlers/control-flow/index.js';
import { WaitStepHandler } from '../handlers/timing/index.js';
import { NavigationStepHandler } from '../handlers/navigation/index.js';
import {
  ProSkipStepHandler,
  StorySceneStepHandler,
  LoopControlStepHandler
} from '../handlers/activities/index.js';

/**
 * Creates and initializes a StepHandlerRegistry pre-loaded with all standard handlers.
 */
export function createDefaultStepHandlerRegistry(): StepHandlerRegistry {
  const registry = new StepHandlerRegistry();

  // Combat Handlers
  registry.register(new SkillStepHandler());
  registry.register(new AttackStepHandler());
  registry.register(new QuickCallStepHandler());
  registry.register(new ReloadStepHandler());
  registry.register(new AutoStepHandler());
  registry.register(new TargetEnemyStepHandler());
  registry.register(new HealStepHandler());
  registry.register(new BackupRequestStepHandler());
  registry.register(new TapReadyStepHandler());

  // Control Flow Handlers
  registry.register(new RepeatStepHandler());
  registry.register(new ExitIfScoreStepHandler());
  registry.register(new ConditionStepHandler());

  // Timing Handlers
  registry.register(new WaitStepHandler());

  // Navigation Handlers
  registry.register(new NavigationStepHandler());

  // Activity Handlers
  registry.register(new ProSkipStepHandler());
  registry.register(new StorySceneStepHandler());
  registry.register(new LoopControlStepHandler());

  return registry;
}
