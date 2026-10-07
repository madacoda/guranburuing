// src/workflows/registry/step-handler.registry.ts
import { WorkflowActionType, WorkflowStep } from '../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../context/workflow-context.types.js';

/**
 * Central registry and dispatcher for workflow step execution strategies.
 * Adheres to OCP: New step actions can be registered without modifying the dispatcher.
 */
export class StepHandlerRegistry {
  private handlers = new Map<WorkflowActionType, IStepHandler>();

  public register(handler: IStepHandler): this {
    for (const action of handler.supportedActions) {
      this.handlers.set(action, handler);
    }
    return this;
  }

  public get(action: WorkflowActionType): IStepHandler | undefined {
    return this.handlers.get(action);
  }

  public has(action: WorkflowActionType): boolean {
    return this.handlers.has(action);
  }

  /**
   * Executes a workflow step via its registered handler with duration timing and error safety.
   */
  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const action = step.code || step.action;
    if (!action) {
      return {
        success: false,
        actionCode: 'custom',
        durationMs: 0,
        message: 'Step missing action code.'
      };
    }

    const handler = this.handlers.get(action);
    if (!handler) {
      return {
        success: false,
        actionCode: action,
        durationMs: 0,
        message: `No handler registered for action "${action}".`
      };
    }

    const start = Date.now();
    try {
      const result = await handler.execute(step, context);
      result.durationMs = Date.now() - start;
      return result;
    } catch (err: any) {
      return {
        success: false,
        actionCode: action,
        durationMs: Date.now() - start,
        message: err?.message || String(err)
      };
    }
  }
}
