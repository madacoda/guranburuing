// src/services/daily-host/failure-analyzer.service.ts
import { DailyRaidExecutionRecord, DailyRaidExecutionStatus } from '../../domain/daily-host/daily-host.types.js';

export type FailureCategory =
  | 'GENUINE_MATERIAL_DEFICIT'  // Material count verified insufficient (e.g. 0/1 Silver Centrum) -> DO NOT RETRY
  | 'DAILY_LIMIT_EXHAUSTED'     // 0 remaining daily host attempts -> DO NOT RETRY
  | 'MODAL_OBSTRUCTION'         // Stage modal / popup / dialog blocked click -> RETRIABLE
  | 'NAVIGATION_TIMEOUT'        // Multi list navigation timed out -> RETRIABLE
  | 'SUPPORTER_TIMEOUT'         // Supporter summon card load timed out -> RETRIABLE
  | 'PARTY_CONFIRM_TIMEOUT'     // Party launch click timed out -> RETRIABLE
  | 'COMBAT_WIPEOUT'            // Failed combat / wipeout -> RETRIABLE with pub backup
  | 'NETWORK_TRANSIENT'         // Network error / CDP disconnection -> RETRIABLE
  | 'UNKNOWN';

export interface FailureDiagnosis {
  category: FailureCategory;
  isRetriable: boolean;
  reason: string;
  diagnosticDetails: string;
  recommendedAction: string;
}

/**
 * Critical Failure Diagnostic Analyzer for Daily Hosted Raids.
 * Performs deep semantic inspection on raid execution results to distinguish
 * between genuine material exhaustion (which must NOT be retried) and transient
 * UI/modal/network issues (which can be safely and autonomously self-healed).
 */
export class FailureAnalyzerService {
  /**
   * Evaluates a raid execution record and produces a comprehensive failure diagnosis.
   */
  public static diagnose(record: DailyRaidExecutionRecord): FailureDiagnosis {
    // 1. Success cases
    if (record.status === 'CLEARED') {
      return {
        category: 'UNKNOWN',
        isRetriable: false,
        reason: 'Raid cleared successfully.',
        diagnosticDetails: `Cleared in ${record.turnsElapsed} turns with ${record.honorsEarned.toLocaleString()} honors.`,
        recommendedAction: 'None: Victory confirmed.'
      };
    }

    // 2. Daily limit exhausted
    if (record.status === 'SKIPPED_LIMIT' || record.message.includes('Daily host limit reached') || record.message.includes('0 remaining')) {
      return {
        category: 'DAILY_LIMIT_EXHAUSTED',
        isRetriable: false,
        reason: 'Daily host limit exhausted.',
        diagnosticDetails: 'All daily attempts for this raid have already been completed for the current server cycle.',
        recommendedAction: 'Skip: No host attempts remaining until next 05:00 JST reset.'
      };
    }

    // 3. Genuine Material Shortage (Verified via in-game treasure modal)
    const isMaterialShortage =
      record.status === 'SKIPPED_NO_MATERIAL' ||
      record.message.toLowerCase().includes('insufficient host materials') ||
      record.message.toLowerCase().includes('missing materials') ||
      /held:\s*0\b/i.test(record.message) ||
      /held:\s*\d+,\s*required:\s*\d+/i.test(record.message);

    if (isMaterialShortage) {
      return {
        category: 'GENUINE_MATERIAL_DEFICIT',
        isRetriable: false,
        reason: 'Genuine material shortage verified in-game.',
        diagnosticDetails: record.message,
        recommendedAction: 'Do not retry: Requires farming or shop trading for host treasure before hosting can proceed.'
      };
    }

    // 4. Modal / Dialog / DOM Obstruction
    const isModalIssue =
      record.message.includes('Could not open Stage modal') ||
      record.message.includes('not found in stage modal') ||
      record.message.includes('Failed to click quest Play button') ||
      record.message.includes('Failed to confirm host treasure offer') ||
      record.message.includes('Pending battles modal intercepted') ||
      record.message.includes('modal');

    if (isModalIssue) {
      return {
        category: 'MODAL_OBSTRUCTION',
        isRetriable: true,
        reason: 'Modal overlay or DOM selection obstruction.',
        diagnosticDetails: record.message,
        recommendedAction: 'Retry with DOM sanitation: Dismiss lingering overlay popups, clear pending battles, and re-open stage modal.'
      };
    }

    // 5. Supporter Summon Selection Timeout
    if (record.message.includes('Supporter summon selection timed out') || record.message.includes('supporter')) {
      return {
        category: 'SUPPORTER_TIMEOUT',
        isRetriable: true,
        reason: 'Supporter summon selection timed out or failed to load.',
        diagnosticDetails: record.message,
        recommendedAction: 'Retry with page refresh: Re-enter supporter selection page to fetch fresh summon list.'
      };
    }

    // 6. Party Confirmation / Quest Launch Timeout
    if (record.message.includes('Failed to confirm party and launch battle') || record.message.includes('party deck')) {
      return {
        category: 'PARTY_CONFIRM_TIMEOUT',
        isRetriable: true,
        reason: 'Party deck confirmation button blocked or unresponsive.',
        diagnosticDetails: record.message,
        recommendedAction: 'Retry after dismiss: Acknowledge AP replenishment or prompt dialogs, then tap quest start.'
      };
    }

    // 7. Navigation Timeout / Network lag
    const isNetworkIssue =
      record.message.includes('Navigation timeout') ||
      record.message.includes('timeout') ||
      record.message.includes('CDP') ||
      record.message.includes('net::') ||
      record.message.includes('Protocol error');

    if (isNetworkIssue) {
      return {
        category: 'NETWORK_TRANSIENT',
        isRetriable: true,
        reason: 'Transient network latency or page loading timeout.',
        diagnosticDetails: record.message,
        recommendedAction: 'Retry after connection stabilization: Wait 2-3s, re-verify CDP, and re-attempt stage navigation.'
      };
    }

    // 8. Combat defeat / Timeout without victory confirmation
    if (record.message.includes('Combat defeat') || record.message.includes('Combat') || record.turnsElapsed > 0) {
      return {
        category: 'COMBAT_WIPEOUT',
        isRetriable: true,
        reason: 'Combat concluded without victory confirmation (wipeout or timeout).',
        diagnosticDetails: record.message,
        recommendedAction: 'Retry with assist priority: Re-enter raid if still active and broadcast backup request to Everyone.'
      };
    }

    // 9. Unknown / Unclassified error (default to retriable once with sanitation)
    return {
      category: 'UNKNOWN',
      isRetriable: true,
      reason: 'Unclassified operational error.',
      diagnosticDetails: record.message,
      recommendedAction: 'Retry with clean browser state after full DOM reset.'
    };
  }

  /**
   * Helper to check if a record represents a retriable failure.
   */
  public static isRetriable(record: DailyRaidExecutionRecord): boolean {
    return this.diagnose(record).isRetriable;
  }

  /**
   * Produces an aggregated diagnostic breakdown across an entire execution run.
   */
  public static generateDiagnosticReport(records: DailyRaidExecutionRecord[]): {
    totalRaids: number;
    clearedCount: number;
    skippedLimitCount: number;
    skippedMaterialCount: number;
    failedCount: number;
    retriableCount: number;
    diagnoses: { raidId: string; raidName: string; diagnosis: FailureDiagnosis }[];
  } {
    const diagnoses = records.map(r => ({
      raidId: r.raid.id,
      raidName: r.raid.name,
      diagnosis: this.diagnose(r)
    }));

    return {
      totalRaids: records.length,
      clearedCount: records.filter(r => r.status === 'CLEARED').length,
      skippedLimitCount: records.filter(r => r.status === 'SKIPPED_LIMIT').length,
      skippedMaterialCount: records.filter(r => r.status === 'SKIPPED_NO_MATERIAL').length,
      failedCount: records.filter(r => r.status === 'FAILED').length,
      retriableCount: diagnoses.filter(d => d.diagnosis.isRetriable).length,
      diagnoses
    };
  }
}
