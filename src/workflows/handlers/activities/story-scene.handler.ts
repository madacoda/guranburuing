// src/workflows/handlers/activities/story-scene.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { StorySceneSkipService } from '../../../services/navigation/story-scene-skip.service.js';
import { FateEngine } from '../../../engines/fate.engine.js';

export class StorySceneStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['skip_story_scene', 'auto_fate_episode', 'skip_fate_episode'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template, state, services } = context;
    const tStart = Date.now();
    const actionCode = step.code || step.action || 'skip_story_scene';

    if (state.stopRequested) {
      return { success: false, actionCode, durationMs: 0, message: 'Stop requested.' };
    }
    if (template.stopOnCaptcha !== false) {
      await services.sentinel.assertSafe();
    }

    if (actionCode === 'auto_fate_episode' || actionCode === 'skip_fate_episode') {
      const fateEngine = new FateEngine(page, services.sentinel);
      await fateEngine.ensureQuestSkipDisabled();
      const res = await fateEngine.processSingleFateEpisode();
      return {
        success: res.status === 'SUCCESS' || res.status === 'NO_UNREAD_EPISODES',
        actionCode,
        durationMs: Date.now() - tStart,
        message: res.message || `Fate episode status: ${res.status}`
      };
    }

    const timeoutMs = step.timeoutMs || 45000;
    const maxScenes = step.maxScenes || 10;
    const skipService = new StorySceneSkipService(page, services.sentinel);

    const outcome = await skipService.skipStoryScenes({
      timeoutMs,
      maxScenes,
      autoSelectChoice: true
    });

    return {
      success: outcome.success,
      actionCode: 'skip_story_scene',
      durationMs: Date.now() - tStart,
      message: outcome.message || `Skipped ${outcome.scenesSkipped} story scene(s)`
    };
  }
}
