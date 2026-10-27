// src/services/scheduler/daily-reset.scheduler.ts
import { AccountRegistry } from '../../auth/account-registry.js';
import { AccountConfig } from '../../types/account.types.js';
import { dailyRoutineOrchestrator, DailyRoutineResult } from './daily-routine.orchestrator.js';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';
import { GoldBarTrackerService } from '../telemetry/gold-bar-tracker.service.js';
import { rustBridge } from '../../core/rust-bridge.js';

export const DEFAULT_SCHEDULER_HOUR_JST = 21; // 21:00 JST (19:00 WIB) — GBF Peak Golden Time & Strike Time
export const DEFAULT_SCHEDULER_BUFFER_SECONDS = 15;

export interface SchedulerOptions {
  accountId?: string;
  isWindowed?: boolean;
  skipProSkips?: boolean;
  skipHosts?: boolean;
  targetHourJst?: number; // default 21 (21:00 JST / 19:00 WIB Peak Golden Time)
  bufferSeconds?: number; // default 15s (21:00:15 JST)
  notifyBeforeMinutes?: number; // default 5m advance warning
}

export interface ResetScheduleInfo {
  nextResetDate: Date;
  nextResetJstString: string;
  nextResetWibString: string;
  targetHourJst: number;
  msRemaining: number;
  formattedCountdown: string;
}

/**
 * Calculates the exact Date and milliseconds until the next scheduled GBF Daily Routine execution.
 * Defaults to 21:00:15 JST (19:00:15 WIB / 12:00:15 UTC) — the peak GBF Golden Time & Strike Time hour
 * when active Japanese & global player concurrency and Raid Finder backup join speed are at their highest.
 */
export function getNextDailyResetJst(
  bufferSeconds = DEFAULT_SCHEDULER_BUFFER_SECONDS,
  referenceDate: Date = new Date(),
  targetHourJst = DEFAULT_SCHEDULER_HOUR_JST
): { nextResetDate: Date; msRemaining: number } {
  const nativeUtcMs = rustBridge.getNextDailyResetUtcMs(
    referenceDate.getTime(),
    targetHourJst,
    bufferSeconds
  );
  if (nativeUtcMs !== null) {
    return {
      nextResetDate: new Date(nativeUtcMs),
      msRemaining: Math.max(0, nativeUtcMs - referenceDate.getTime())
    };
  }
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const nowJstMs = referenceDate.getTime() + jstOffsetMs;
  const nowJstDate = new Date(nowJstMs);

  const targetYear = nowJstDate.getUTCFullYear();
  const targetMonth = nowJstDate.getUTCMonth();
  const targetDay = nowJstDate.getUTCDate();

  // targetHourJst:00:bufferSeconds JST today in UTC-representation of JST (default 21:00:15 JST)
  let nextResetJstMs = Date.UTC(targetYear, targetMonth, targetDay, targetHourJst, 0, bufferSeconds);

  // If already past targetHourJst:00:bufferSeconds JST today, move to tomorrow
  if (nowJstMs >= nextResetJstMs) {
    nextResetJstMs = Date.UTC(targetYear, targetMonth, targetDay + 1, targetHourJst, 0, bufferSeconds);
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
 * Autonomous GBF Daily Peak-Hour Scheduler Daemon.
 * Continuously schedules and runs the complete daily routine at 21:00:15 JST (19:00:15 WIB) daily
 * during peak player Golden Time for maximum backup join rate and fastest raid clears,
 * with anti-drift synchronization, advance Discord alerts, and self-healing host retry.
 */
export class DailyResetScheduler {
  private isRunning = false;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private hasSentAdvanceNotice = false;
  private lastExecutedGbfDay: string | null = null;
  private targetHourJst = DEFAULT_SCHEDULER_HOUR_JST;
  private bufferSeconds = DEFAULT_SCHEDULER_BUFFER_SECONDS;

  /**
   * Retrieves timing details for the next scheduled execution.
   */
  public getScheduleInfo(
    bufferSeconds = this.bufferSeconds,
    targetHourJst = this.targetHourJst
  ): ResetScheduleInfo {
    const { nextResetDate, msRemaining } = getNextDailyResetJst(bufferSeconds, new Date(), targetHourJst);
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
    const wibFormatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Jakarta',
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
      nextResetWibString: `${wibFormatter.format(nextResetDate)} WIB`,
      targetHourJst,
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
    const bufferSec = options.bufferSeconds ?? DEFAULT_SCHEDULER_BUFFER_SECONDS;
    const targetHourJst = options.targetHourJst ?? DEFAULT_SCHEDULER_HOUR_JST;
    this.bufferSeconds = bufferSec;
    this.targetHourJst = targetHourJst;

    const notifyMin = options.notifyBeforeMinutes ?? 5;
    const targetAccountId = options.accountId || 'acc1';
    const wibHour = (targetHourJst + 22) % 24;

    const account = AccountRegistry.getAccount(targetAccountId);
    if (!account) {
      throw new Error(`[DailyResetScheduler] Account "${targetAccountId}" not found in registry.`);
    }

    const info = this.getScheduleInfo(bufferSec, targetHourJst);
    const hhJst = targetHourJst.toString().padStart(2, '0');
    const hhWib = wibHour.toString().padStart(2, '0');
    const ssStr = bufferSec.toString().padStart(2, '0');

    console.log('\n========================================================================');
    console.log('       ⏰ Granblue Fantasy - Autonomous Peak-Hour Scheduler Daemon      ');
    console.log('========================================================================');
    console.log(`Account:           ${account.name} (${account.id})`);
    console.log(`Target Schedule:   ${info.nextResetJstString} / ${info.nextResetWibString}`);
    console.log(`Daily Cadence:     ${hhJst}:00:${ssStr} JST (${hhWib}:00:${ssStr} WIB — Peak Golden Time)`);
    console.log(`Time Remaining:    ${info.formattedCountdown}`);
    console.log(`Advance Alert:     ${notifyMin} minutes prior to execution`);
    console.log(`Execution Plan:    Universal Pro Skips -> Daily Raid Hosting & Diagnostic Retry`);
    console.log('========================================================================\n');

    // Anti-drift tick loop: checks every 10 seconds
    this.checkTimer = setInterval(async () => {
      if (!this.isRunning) return;

      const currentInfo = this.getScheduleInfo(bufferSec, targetHourJst);
      const currentGbfDay = GoldBarTrackerService.getGbfDay();

      // 1. Advance notification (e.g. 5 minutes before scheduled peak execution)
      const notifyMsThreshold = notifyMin * 60 * 1000;
      if (currentInfo.msRemaining <= notifyMsThreshold && currentInfo.msRemaining > notifyMsThreshold - 30000 && !this.hasSentAdvanceNotice) {
        this.hasSentAdvanceNotice = true;
        console.log(`[DailyResetScheduler] 🔔 Advance notice: ${notifyMin} minutes until GBF Peak-Hour Daily Routine!`);
        if (discordDmRelay.isConfigured()) {
          try {
            await discordDmRelay.sendMessage(
              `⏰ **GBF Peak-Hour Daily Routine in ${notifyMin} Minutes!**\n` +
              `• **Target Time**: \`${currentInfo.nextResetJstString}\` (\`${currentInfo.nextResetWibString}\`)\n` +
              `• **Account**: **${account.name}** (\`${account.id}\`)\n` +
              `Autonomous Pro Skips and 16-Raid Daily Hosting will initiate at peak Golden Time for maximum backup clear speed.`
            );
          } catch (err: any) {
            console.warn(`[DailyResetScheduler] Failed to send advance Discord alert: ${err.message}`);
          }
        }
      }

      // 2. Trigger check: msRemaining <= 2000 and not yet executed for this GBF day
      if (currentInfo.msRemaining <= 2000 && this.lastExecutedGbfDay !== currentGbfDay) {
        console.log(`\n[DailyResetScheduler] 🎯 Scheduled peak time reached (${currentInfo.nextResetJstString} / ${currentInfo.nextResetWibString})!`);
        console.log(`[DailyResetScheduler] 🚀 Triggering autonomous daily routine for GBF day ${currentGbfDay}...`);

        this.lastExecutedGbfDay = currentGbfDay;
        this.hasSentAdvanceNotice = false;

        try {
          await this.triggerNow(account, options);
        } catch (err: any) {
          console.error(`[DailyResetScheduler] ❌ Error executing scheduled routine:`, err.message);
        }

        const nextInfo = this.getScheduleInfo(bufferSec, targetHourJst);
        console.log(`\n[DailyResetScheduler] ⏳ Next daily routine scheduled for: ${nextInfo.nextResetJstString} / ${nextInfo.nextResetWibString} (${nextInfo.formattedCountdown})`);
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
