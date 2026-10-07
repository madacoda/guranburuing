// src/workflows/context/workflow-state-store.ts
import { WorkflowExecutionState } from './workflow-context.types.js';

export type StateChangeListener<K extends keyof WorkflowExecutionState> = (
  newValue: WorkflowExecutionState[K],
  oldValue: WorkflowExecutionState[K]
) => void;

/**
 * High-performance, O(1) in-memory state store for workflow execution.
 * Avoids Redux-style object allocations to prevent V8 GC pauses during combat loops.
 */
export class WorkflowStateStore implements WorkflowExecutionState {
  public currentScore = 0;
  public currentTurn = 1;
  public currentRaidId = 'N/A';
  public isCombatActive = false;
  public totalGoldBarsAccumulated = 0;
  public totalBlueChestsAccumulated = 0;
  public totalHonorsAccumulated = 0;
  public totalCompletedRuns = 0;
  public lastAttackLockoutExpires = 0;
  public stopRequested = false;
  public myUserId?: string;

  private listeners = new Map<keyof WorkflowExecutionState, Set<StateChangeListener<any>>>();

  public on<K extends keyof WorkflowExecutionState>(key: K, listener: StateChangeListener<K>): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(listener);
    return () => {
      this.listeners.get(key)?.delete(listener);
    };
  }

  public setScore(newScore: number): void {
    const old = this.currentScore;
    if (newScore !== old) {
      this.currentScore = Math.max(0, newScore);
      this.notify('currentScore', this.currentScore, old);
    }
  }

  public setTurn(newTurn: number): void {
    const old = this.currentTurn;
    if (newTurn !== old) {
      this.currentTurn = Math.max(1, newTurn);
      this.notify('currentTurn', this.currentTurn, old);
    }
  }

  public advanceTurn(): number {
    const next = this.currentTurn + 1;
    this.setTurn(next);
    return next;
  }

  public setRaidId(id: string): void {
    const old = this.currentRaidId;
    if (id !== old) {
      this.currentRaidId = id || 'N/A';
      this.notify('currentRaidId', this.currentRaidId, old);
    }
  }

  public recordGoldBar(): void {
    const old = this.totalGoldBarsAccumulated;
    this.totalGoldBarsAccumulated++;
    this.notify('totalGoldBarsAccumulated', this.totalGoldBarsAccumulated, old);
  }

  public recordBlueChest(): void {
    const old = this.totalBlueChestsAccumulated;
    this.totalBlueChestsAccumulated++;
    this.notify('totalBlueChestsAccumulated', this.totalBlueChestsAccumulated, old);
  }

  public requestStop(): void {
    const old = this.stopRequested;
    this.stopRequested = true;
    this.notify('stopRequested', true, old);
  }

  public resetBattleState(): void {
    this.currentScore = 0;
    this.currentTurn = 1;
    this.isCombatActive = false;
    this.lastAttackLockoutExpires = 0;
  }

  private notify<K extends keyof WorkflowExecutionState>(
    key: K,
    newValue: WorkflowExecutionState[K],
    oldValue: WorkflowExecutionState[K]
  ): void {
    const subs = this.listeners.get(key);
    if (subs) {
      for (const sub of subs) {
        try {
          sub(newValue, oldValue);
        } catch {
          // Prevent listener errors from halting loop
        }
      }
    }
  }
}
