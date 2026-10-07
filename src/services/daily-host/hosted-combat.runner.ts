// src/services/daily-host/hosted-combat.runner.ts
import { Page } from 'puppeteer-core';
import { IHostedCombatRunner, IBackupBroadcastService, IStageModalNavigator } from '../../domain/daily-host/daily-host.interfaces.js';
import { DailyRaidHostDefinition, HostedCombatOutcome } from '../../domain/daily-host/daily-host.types.js';
import { UniversalWorkflowEngine } from '../../engines/universal-workflow.engine.js';
import { logNormalDelay } from '../../human-motor.js';

export class HostedCombatRunner implements IHostedCombatRunner {
  private page: Page;
  private workflow: UniversalWorkflowEngine;
  private backupBroadcaster: IBackupBroadcastService;
  private navigator: IStageModalNavigator;
  private stopRequested = false;

  constructor(
    page: Page,
    workflow: UniversalWorkflowEngine,
    backupBroadcaster: IBackupBroadcastService,
    navigator: IStageModalNavigator
  ) {
    this.page = page;
    this.workflow = workflow;
    this.backupBroadcaster = backupBroadcaster;
    this.navigator = navigator;
  }

  public updatePage(page: Page): void {
    this.page = page;
    this.backupBroadcaster.updatePage(page);
    this.navigator.updatePage(page);
  }

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Inspects authoritative combat telemetry from page DOM and stage objects.
   */
  public async getAuthoritativeBattleState(): Promise<{
    isMounted: boolean;
    isVictory: boolean;
    isWipedOut: boolean;
    bossHp: number;
    bossHpMax: number;
    bossHpPct: number;
    currentHonors: number;
  }> {
    return await this.page.evaluate(() => {
      const stage = (window as any).stage;
      const gStatus = stage?.gGameStatus;
      const pJsn = stage?.pJsnData;

      const hash = window.location.hash || '';
      const hasVictoryPopup = !!document.querySelector('.pop-raid-result');
      const isResultHash = hash.includes('result_multi') || hash.includes('result');
      const isWinFlag =
        gStatus?.win === true || gStatus?.finish === true || pJsn?.finish === true || pJsn?.is_clear === true;

      // Extract Boss HP
      const boss = gStatus?.boss?.param?.[0] || pJsn?.boss?.param?.[0];
      const bossHp = boss?.hp !== undefined ? Number(boss.hp) : null;
      const bossHpMax = boss?.hpmax !== undefined ? Number(boss.hpmax) : null;

      const gauge = document.querySelector('.prt-boss-gauge .prt-hp-gauge-inner') as HTMLElement;
      const gaugePct = gauge ? parseFloat(gauge.style.width || '100') : 100;

      let bossHpPct = 100;
      if (bossHp !== null && bossHpMax !== null && bossHpMax > 0) {
        bossHpPct = (bossHp / bossHpMax) * 100;
      } else if (!isNaN(gaugePct)) {
        bossHpPct = gaugePct;
      }

      // Check frontline wipeout (all 4 frontline dead)
      const players = pJsn?.player?.param || gStatus?.player?.param || [];
      const frontline = players.slice(0, 4);
      const isWipedOut =
        frontline.length > 0 && frontline.every((p: any) => p && (Number(p.hp) <= 0 || p.alive === 0));

      // Extract current honors
      let currentHonors = 0;
      const pointEl = document.querySelector('.txt-point, .prt-point, .prt-total-honor, .txt-total-point');
      if (pointEl && pointEl.textContent) {
        const parsed = parseInt(pointEl.textContent.replace(/,/g, '').trim(), 10);
        if (!isNaN(parsed)) currentHonors = parsed;
      }

      const isVictory = isResultHash || hasVictoryPopup || (isWinFlag && bossHpPct <= 0);

      return {
        isMounted: !!(stage && (gStatus || pJsn)),
        isVictory,
        isWipedOut,
        bossHp: bossHp ?? 0,
        bossHpMax: bossHpMax ?? 0,
        bossHpPct,
        currentHonors
      };
    }).catch(() => ({
      isMounted: false,
      isVictory: false,
      isWipedOut: false,
      bossHp: 0,
      bossHpMax: 0,
      bossHpPct: 100,
      currentHonors: 0
    }));
  }

  /**
   * Executes the sustained combat stage for the hosted raid:
   * 1. Broadcasts backup request to ALL scopes (Everyone, Friends, Crew).
   * 2. Turn 1 Quick Summon.
   * 3. Tactical frontline skills triage.
   * 4. Attack dispatch + lockout animation reload (F5).
   * 5. Continuously battles turn after turn until boss HP hits 0% and victory screen mounts.
   */
  public async executeHostedCombat(
    raid: DailyRaidHostDefinition,
    maxTurns = 60
  ): Promise<HostedCombatOutcome> {
    const t0 = Date.now();
    let backupRequested = false;
    let turnsElapsed = 0;
    let totalHonors = 0;
    const maxSafetyTurns = maxTurns || 60;
    const maxSafetyTimeoutMs = 15 * 60 * 1000; // 15 minute safety ceiling per raid
    const combatStartTime = Date.now();

    console.log(`[DailyHost:Combat] ⚔️ Engaging Smart Full Auto combat for "${raid.name}"...`);

    while (!this.stopRequested && Date.now() - combatStartTime < maxSafetyTimeoutMs) {
      // 1. Check authoritative battle state
      const state = await this.getAuthoritativeBattleState();
      totalHonors = Math.max(totalHonors, state.currentHonors, (this.workflow as any).currentBattleHonors || 0);

      if (state.isVictory || (state.bossHpPct <= 0 && state.isMounted)) {
        console.log(
          `[DailyHost:Combat] 🏆 Boss defeated! Raid "${raid.name}" reached 0% HP. Total Honors: ${totalHonors.toLocaleString()} pt.`
        );
        return {
          isVictoryConfirmed: true,
          turnsElapsed,
          honorsEarned: totalHonors,
          message: 'Victory confirmed!',
          durationMs: Date.now() - t0
        };
      }

      // Check for frontline wipeout
      if (state.isWipedOut) {
        console.log(
          `[DailyHost:Combat] 💀 Player frontline incapacitated. Backup participants active. Awaiting pub to clear boss (Boss HP: ${state.bossHpPct.toFixed(1)}%)...`
        );
        const pubCleared = await this.waitForRaidClearFromPub(300000);
        return {
          isVictoryConfirmed: pubCleared,
          turnsElapsed,
          honorsEarned: totalHonors,
          message: pubCleared ? 'Victory confirmed via backup pub!' : 'Timed out waiting for backup pub clear.',
          durationMs: Date.now() - t0
        };
      }

      // Wait for HUD readiness before taking actions
      await (this.workflow as any).waitForCombatInputReady(8000);

      // Re-verify after HUD ready
      const freshState = await this.getAuthoritativeBattleState();
      if (freshState.isVictory || (freshState.bossHpPct <= 0 && freshState.isMounted)) {
        console.log(
          `[DailyHost:Combat] 🏆 Boss defeated! Raid "${raid.name}" concluded. Total Honors: ${totalHonors.toLocaleString()} pt.`
        );
        return {
          isVictoryConfirmed: true,
          turnsElapsed,
          honorsEarned: totalHonors,
          message: 'Victory confirmed!',
          durationMs: Date.now() - t0
        };
      }

      // 2. Broadcast Backup Request (Share to ALL: Everyone, Friends & Crew) on Turn 1 (or retry)
      if (!backupRequested) {
        console.log(`[DailyHost:Combat] 📢 Broadcasting initial Backup Request (Share to ALL: Everyone, Friends & Crew)...`);
        const result = await this.backupBroadcaster.broadcastBackupRequestToAll();
        if (result.broadcastSuccessful) {
          backupRequested = true;
          console.log(`[DailyHost:Combat] ✅ Backup request successfully sent to: ${result.activeScopes.join(', ')}`);
        }
      } else if (await this.backupBroadcaster.canBroadcastBackup()) {
        console.log(
          `[DailyHost:Combat] 📢 [Turn ${turnsElapsed}] 3-minute cooldown expired! Re-broadcasting backup request to Everyone / Raid Finders...`
        );
        const rebroadcast = await this.backupBroadcaster.broadcastBackupRequestToAll();
        if (rebroadcast.broadcastSuccessful) {
          console.log(`[DailyHost:Combat] ✅ Backup request re-broadcasted to: ${rebroadcast.activeScopes.join(', ')}`);
        }
      }

      turnsElapsed++;

      // 3. Turn 1 Quick Summon
      if (turnsElapsed === 1) {
        const qsReady = await this.page.evaluate(() => {
          const btn = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
          return !!(btn && btn.offsetParent !== null && !btn.classList.contains('disabled'));
        }).catch(() => false);

        if (qsReady) {
          console.log(`[DailyHost:Combat] [Turn ${turnsElapsed}] Invoking Quick Summon...`);
          await (this.workflow as any).handleQuickCall({
            code: 'quick_call',
            waitForNetwork: 'summon_result.json',
            optional: true
          });
          await logNormalDelay(150, 0.1);
        }
      }

      // 4. Tactical Ready Skills (smart frontline abilities)
      console.log(`[DailyHost:Combat] [Turn ${turnsElapsed}] Executing smart tactical skills triage...`);
      await (this.workflow as any).executeTacticalReadySkills(undefined, 0.75, 0.6, turnsElapsed);

      // Check if skills defeated the boss
      const postSkillsState = await this.getAuthoritativeBattleState();
      if (postSkillsState.isVictory || (postSkillsState.bossHpPct <= 0 && postSkillsState.isMounted)) {
        return {
          isVictoryConfirmed: true,
          turnsElapsed,
          honorsEarned: totalHonors,
          message: 'Victory confirmed!',
          durationMs: Date.now() - t0
        };
      }

      // 5. Dispatch Attack
      console.log(`[DailyHost:Combat] [Turn ${turnsElapsed}] Dispatching Attack command...`);
      await (this.workflow as any).handleAttack({
        code: 'attack',
        waitForNetwork: 'normal_attack_result.json'
      });

      // 6. Fast animation cancel via reload (F5)
      await logNormalDelay(350, 0.1);
      console.log(`[DailyHost:Combat] [Turn ${turnsElapsed}] Reloading (F5) to cancel attack animation...`);
      await (this.workflow as any).handleReload({ code: 'reload' });
      await logNormalDelay(200, 0.1);

      // Read updated stats after reload
      const postTurnState = await this.getAuthoritativeBattleState();
      totalHonors = Math.max(totalHonors, postTurnState.currentHonors, (this.workflow as any).currentBattleHonors || 0);
      console.log(
        `[DailyHost:Combat] [Turn ${turnsElapsed}] Boss HP: ${postTurnState.bossHpPct.toFixed(1)}% | Honors: ${totalHonors.toLocaleString()} pt`
      );

      if (postTurnState.isVictory || (postTurnState.bossHpPct <= 0 && postTurnState.isMounted)) {
        console.log(`[DailyHost:Combat] 🏆 Boss defeated on Turn ${turnsElapsed}!`);
        return {
          isVictoryConfirmed: true,
          turnsElapsed,
          honorsEarned: totalHonors,
          message: 'Victory confirmed!',
          durationMs: Date.now() - t0
        };
      }

      if (turnsElapsed >= maxSafetyTurns) {
        console.log(
          `[DailyHost:Combat] Reached max turns ceiling (${maxSafetyTurns}). Awaiting backup pub to finish...`
        );
        const pubCleared = await this.waitForRaidClearFromPub(300000);
        return {
          isVictoryConfirmed: pubCleared,
          turnsElapsed,
          honorsEarned: totalHonors,
          message: pubCleared ? 'Victory confirmed via backup pub!' : 'Timed out waiting for raid clear.',
          durationMs: Date.now() - t0
        };
      }
    }

    return {
      isVictoryConfirmed: false,
      turnsElapsed,
      honorsEarned: totalHonors,
      message: 'Safety timeout reached before raid conclusion.',
      durationMs: Date.now() - t0
    };
  }

  /**
   * Confirms result screen (#result_multi/...) and returns cleanly to #quest/multi/0.
   */
  public async confirmAndDismissBattleResult(): Promise<void> {
    console.log('[DailyHost:Combat] Awaiting result screen and confirming rewards...');
    const t0 = Date.now();
    const maxWaitMs = 45000;

    while (Date.now() - t0 < maxWaitMs) {
      if (this.stopRequested) return;

      const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (curHash.includes('result_multi') || curHash.includes('result')) {
        console.log('[DailyHost:Combat] 🏆 Result screen reached. Acknowledging rewards...');
        await (this.workflow as any).handleDismissPopups();
        await logNormalDelay(600, 0.15);
        break;
      }

      if (Date.now() - t0 > 6000 && curHash.includes('raid')) {
        const isDead = await this.page.evaluate(() => {
          const boss = (window as any).stage?.gGameStatus?.boss?.param?.[0];
          return boss && Number(boss.hp) <= 0;
        }).catch(() => false);

        if (isDead) {
          console.log('[DailyHost:Combat] Boss at 0% HP. Reloading to trigger result redirect...');
          await (this.workflow as any).handleReload({ code: 'reload' });
        }
      }

      await logNormalDelay(1000, 0.15);
    }

    await (this.workflow as any).handleDismissPopups();
    await this.navigator.navigateToMultiList();

    const hasRemainingRestart = await this.page.evaluate(() => {
      const pop = document.querySelector('.popRestartQuest, .pop-usual');
      return !!(pop && pop.textContent?.includes('in progress'));
    }).catch(() => false);

    if (hasRemainingRestart) {
      console.warn('[DailyHost:Combat] ⚠️ Notice: In-progress raid modal still active after result resolution.');
    } else {
      console.log('[DailyHost:Combat] ✅ Raid slot cleanly freed and verified ready for next host.');
    }
  }

  /**
   * Waits for backup pub participants to clear the boss when frontline is down.
   */
  private async waitForRaidClearFromPub(timeoutMs = 300000): Promise<boolean> {
    const t0 = Date.now();
    let lastCooldownCheck = 0;
    while (Date.now() - t0 < timeoutMs) {
      if (this.stopRequested) return false;

      const state = await this.getAuthoritativeBattleState();
      if (state.isVictory || (state.bossHpPct <= 0 && state.isMounted)) {
        return true;
      }

      // Check if 3-minute backup cooldown expired while awaiting pub clear
      if (Date.now() - lastCooldownCheck >= 10000) {
        lastCooldownCheck = Date.now();
        if (await this.backupBroadcaster.canBroadcastBackup()) {
          console.log(
            '[DailyHost:Combat] 📢 3-minute cooldown expired while awaiting pub! Re-broadcasting backup request to Everyone / Raid Finders...'
          );
          const rebroadcast = await this.backupBroadcaster.broadcastBackupRequestToAll();
          if (rebroadcast.broadcastSuccessful) {
            console.log(`[DailyHost:Combat] ✅ Backup request re-broadcasted to: ${rebroadcast.activeScopes.join(', ')}`);
          }
        }
      }

      await (this.workflow as any).handleReload({ code: 'reload' });
      await logNormalDelay(6000, 0.15);
    }
    return false;
  }
}
