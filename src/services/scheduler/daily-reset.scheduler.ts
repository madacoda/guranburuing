// src/services/scheduler/daily-reset.scheduler.ts
import { AccountRegistry } from '../../auth/account-registry.js';
import { AccountConfig } from '../../types/account.types.js';
import { dailyRoutineOrchestrator, DailyRoutineResult } from './daily-routine.orchestrator.js';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';
import { GoldBarTrackerService } from '../telemetry/gold-bar-tracker.service.js';

export interface SchedulerOptions {
  accountId?: string;
  isWindowed?: boolean;
  skipProSkips?: boolean;
  skipHosts?: boolean;
  bufferSeconds?: number; // default 15s after 05:00:00 JST
  notifyBeforeMinutes?: number; // default 5m advance warning
}

export interface ResetScheduleInfo {
  nextResetDate: Date;
  nextResetJstString: string;
  msRemaining: number;
  formattedCountdown: string;
}

/**
 * Calculates the exact Date and milliseconds until the next GBF Daily Reset.
 * GBF daily reset is at 05:00:00 JST (Japan Standard Time, UTC+9).
 * A default buffer of 15 seconds (05:00:15 JST) is added to ensure Cygames daily reset triggers have finished propagating.
 */
export function getNextDailyResetJst(bufferSeconds = 15, referenceDate: Date = new Date()): { nextResetDate: Date; msRemaining: number } {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const nowJstMs = referenceDate.getTime() + jstOffsetMs;
  const nowJstDate = new Date(nowJstMs);

  const targetYear = nowJstDate.getUTCFullYear();
  const targetMonth = nowJstDate.getUTCMonth();
  const targetDay = nowJstDate.getUTCDate();

  // 05:00:15 JST today in UTC-representation of JST
  let nextResetJstMs = Date.UTC(targetYear, targetMonth, targetDay, 5, 0, bufferSeconds);

  // If already past 05:00:15 JST today, move to tomorrow 05:00:15 JST
  if (nowJstMs >= nextResetJstMs) {
    nextResetJstMs = Date.UTC(targetYear, targetMonth, targetDay + 1, 5, 0, bufferSeconds);
  }

  // Convert back to real UTC time
  const nextResetRealUtcMs = nextResetJstMs - jstOffsetMs;
  const nextResetDate = new Date(nextResetRealUtcMs);
  const msRemaining = Math.max(0, nextResetRealUtcMs - referenceDate.getTime());

  return { nextResetDate, msRemaining };
}

/**
 * Formats milliseconds remaining into human-readable "Xh Ym Zs".
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s (Reset imminent)';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

/**
 * Autonomous GBF Daily Reset Scheduler Daemon.
 * Continuously schedules and runs the complete daily reset routine at 05:00:15 JST daily,
 * with anti-drift synchronization, advance Discord alerts, and self-healing host retry.
 */
export class DailyResetScheduler {
  private isRunning = false;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private hasSentAdvanceNotice = false;
  private lastExecutedGbfDay: string | null = null;

  /**
   * Retrieves timing details for the next scheduled reset.
   */
  public getScheduleInfo(bufferSeconds = 15): ResetScheduleInfo {
    const { nextResetDate, msRemaining } = getNextDailyResetJst(bufferSeconds);
    const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    return {
      nextResetDate,
      nextResetJstString: `${jstFormatter.format(nextResetDate)} JST`,
      msRemaining,
      formattedCountdown: formatCountdown(msRemaining)
    };
  }

  /**
   * Starts the continuous background daemon.
   */
  public startDaemon(options: SchedulerOptions = {}): void {
    if (this.isRunning) {
      console.log('[DailyResetScheduler] ⚠️ Scheduler daemon is already running.');
      return;
    }

    this.isRunning = true;
    const bufferSec = options.bufferSeconds ?? 15;
    const notifyMin = options.notifyBeforeMinutes ?? 5;
    const targetAccountId = options.accountId || 'acc1';

    const account = AccountRegistry.getAccount(targetAccountId);
    if (!account) {
      throw new Error(`[DailyResetScheduler] Account "${targetAccountId}" not found in registry.`);
    }

    const info = this.getScheduleInfo(bufferSec);
    console.log('\n========================================================================');
    console.log('       ⏰ Granblue Fantasy - Autonomous Daily Reset Scheduler Daemon     ');
    console.log('========================================================================');
    console.log(`Account:           ${account.name} (${account.id})`);
    console.log(`Target Reset:      ${info.nextResetJstString} (Daily 05:00:${bufferSec.toString().padStart(2, '0')} JST)`);
    console.log(`Time Remaining:    ${info.formattedCountdown}`);
    console.log(`Advance Alert:     ${notifyMin} minutes prior to reset`);
    console.log(`Execution Plan:    Universal Pro Skips -> Daily Raid Hosting & Diagnostic Retry`);
    console.log('========================================================================\n');

    // Anti-drift tick loop: checks every 10 seconds
    this.checkTimer = setInterval(async () => {
      if (!this.isRunning) return;

      const currentInfo = this.getScheduleInfo(bufferSec);
      const currentGbfDay = GoldBarTrackerService.getGbfDay();

      // 1. Advance notification (e.g. 5 minutes before reset)
      const notifyMsThreshold = notifyMin * 60 * 1000;
      if (currentInfo.msRemaining <= notifyMsThreshold && currentInfo.msRemaining > notifyMsThreshold - 30000 && !this.hasSentAdvanceNotice) {
        this.hasSentAdvanceNotice = true;
        console.log(`[DailyResetScheduler] 🔔 Advance notice: ${notifyMin} minutes until GBF daily reset!`);
        if (discordDmRelay.isConfigured()) {
          try {
            await discordDmRelay.sendMessage(
              `⏰ **GBF Daily Reset in ${notifyMin} Minutes!**\n` +
              `• **Target Time**: \`${currentInfo.nextResetJstString}\`\n` +
              `• **Account**: **${account.name}** (\`${account.id}\`)\n` +
              `Autonomous Pro Skips and Daily Raid Hosting will initiate promptly after reset.`
            );
          } catch (err: any) {
            console.warn(`[DailyResetScheduler] Failed to send advance Discord alert: ${err.message}`);
          }
        }
      }

      // 2. Trigger check: msRemaining <= 0 or current time crossed the reset boundary
      if (currentInfo.msRemaining <= 2000 && this.lastExecutedGbfDay !== currentGbfDay) {
        console.log(`\n[DailyResetScheduler] 🎯 Reset time reached (${currentInfo.nextResetJstString})!`);
        console.log(`[DailyResetScheduler] 🚀 Triggering autonomous daily reset routine for GBF day ${currentGbfDay}...`);

        this.lastExecutedGbfDay = currentGbfDay;
        this.hasSentAdvanceNotice = false;

        try {
          await this.triggerNow(account, options);
        } catch (err: any) {
          console.error(`[DailyResetScheduler] ❌ Error executing scheduled routine:`, err.message);
        }

        const nextInfo = this.getScheduleInfo(bufferSec);
        console.log(`\n[DailyResetScheduler] ⏳ Next daily reset scheduled for: ${nextInfo.nextResetJstString} (${nextInfo.formattedCountdown})`);
      }
    }, 10000);
  }

  /**
   * Manually triggers the daily reset routine immediately.
   */
  public async triggerNow(
    account?: AccountConfig,
    options: SchedulerOptions = {}
  ): Promise<DailyRoutineResult> {
    const targetAccount = account || AccountRegistry.getAccount(options.accountId || 'acc1');
    if (!targetAccount) {
      throw new Error(`[DailyResetScheduler] Account "${options.accountId || 'acc1'}" not found.`);
    }

    console.log(`[DailyResetScheduler] ⚡ Executing routine now for [${targetAccount.name}]...`);
    return await dailyRoutineOrchestrator.executeRoutine(targetAccount, {
      isWindowed: options.isWindowed,
      skipProSkips: options.skipProSkips,
      skipHosts: options.skipHosts
    });
  }

  /**
   * Stops the background scheduler daemon.
   */
  public stopDaemon(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.isRunning = false;
    console.log('[DailyResetScheduler] 🛑 Scheduler daemon stopped.');
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }
}

export const dailyResetScheduler = new DailyResetScheduler();
