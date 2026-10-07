import { Page } from 'puppeteer-core';
import { IActiveHostedRaidScanner, IHostedCombatRunner, IAssistInterleaver } from '../../domain/daily-host/daily-host.interfaces.js';
import { DailyRaidHostDefinition, DailyRaidExecutionRecord, DailyRaidCategory, DailyHostExecutionOptions } from '../../domain/daily-host/daily-host.types.js';
import { DAILY_HOST_CATALOG } from '../../domain/daily-host/daily-host.catalog.js';
import { UniversalWorkflowEngine } from '../../engines/universal-workflow.engine.js';
import { logNormalDelay } from '../../human-motor.js';

export class ActiveHostedRaidScanner implements IActiveHostedRaidScanner {
  private page: Page;
  private workflow: UniversalWorkflowEngine;
  private combatRunner: IHostedCombatRunner;
  private interleaver?: IAssistInterleaver;

  constructor(
    page: Page,
    workflow: UniversalWorkflowEngine,
    combatRunner: IHostedCombatRunner,
    interleaver?: IAssistInterleaver
  ) {
    this.page = page;
    this.workflow = workflow;
    this.combatRunner = combatRunner;
    this.interleaver = interleaver;
  }

  public updatePage(page: Page): void {
    this.page = page;
    this.combatRunner.updatePage(page);
    this.interleaver?.updatePage(page);
  }

  /**
   * Scans for any active self-hosted raid (via URL, popup, or Backup Requests Recent tab)
   * and clears it before starting new hosts.
   *
   * @param scanRecentTab If true, inspects #quest/assist Recent tab (used in pre-flight).
   *                      If false, only checks current screen / active battle without navigating away.
   * @param options       Optional execution options including assist interleaving configuration.
   */
  public async scanAndResumeActiveHostedRaid(
    scanRecentTab = true,
    options?: DailyHostExecutionOptions
  ): Promise<DailyRaidExecutionRecord | null> {
    // 1. Check if already inside an active raid battle
    const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(curHash)) {
      console.log(`[DailyHost:Scanner] ⚔️ Active raid battle detected in browser (${curHash}). Engaging combat...`);
      return await this.resolveAndClearActiveRaid('', options);
    }

    // 2. Check if popRestartQuest modal is open on screen
    const restartInfo = await this.page.evaluate(() => {
      const pop = document.querySelector(
        '.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual'
      ) as HTMLElement;
      if (!pop) return null;
      const text = pop.innerText || '';
      if (!text.includes('in progress') && !text.includes('Resume Quests')) return null;

      const okBtn = pop.querySelector('.btn-usual-ok, .btn-resume') as HTMLElement;
      return { text, hasOk: !!okBtn };
    }).catch(() => null);

    if (restartInfo && restartInfo.hasOk) {
      console.log(`\n========================================================================`);
      console.log(`[DailyHost:Scanner] ⚠️ Active in-progress hosted raid detected!`);
      console.log(`[DailyHost:Scanner] Notice: "${restartInfo.text.replace(/\n+/g, ' ').substring(0, 120)}..."`);
      console.log(`[DailyHost:Scanner] Clicking [Resume] to rejoin battle and clear it...`);
      console.log(`========================================================================\n`);

      const clicked = await this.page.evaluate(() => {
        const pop = document.querySelector(
          '.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual'
        ) as HTMLElement;
        const okBtn = pop?.querySelector('.btn-usual-ok, .btn-resume') as HTMLElement;
        if (okBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(okBtn).trigger('tap');
          okBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        await logNormalDelay(1500, 0.15);
        await (this.workflow as any).waitForBattleToMount(12000);
        return await this.resolveAndClearActiveRaid(restartInfo.text, options);
      }
    }

    // 3. Proactive scan: check Recent / Joined tab on #quest/assist for any active hosted raid
    if (!scanRecentTab) {
      return null;
    }

    return await this.checkRecentTabForHostedRaid(options);
  }

  /**
   * Scans #quest/assist -> Recent tab (#tab-multi) for self-hosted raids (data-raid-type="0").
   */
  private async checkRecentTabForHostedRaid(options?: DailyHostExecutionOptions): Promise<DailyRaidExecutionRecord | null> {
    try {
      console.log('[DailyHost:Scanner] 🔍 Checking Backup Requests Recent tab (#quest/assist) for active hosted raids...');

      await this.page.evaluate(() => {
        const Game = (window as any).Game;
        if (Game?.router?.navigate) {
          Game.router.navigate('quest/assist', { trigger: true });
        } else {
          window.location.hash = '#quest/assist';
        }
      }).catch(() => null);
      await logNormalDelay(1500, 0.15);

      // Check if popRestartQuest intercepted navigation
      const restartInfo = await this.page.evaluate(() => {
        const pop = document.querySelector(
          '.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual'
        ) as HTMLElement;
        if (!pop) return null;
        const text = pop.innerText || '';
        if (!text.includes('in progress') && !text.includes('Resume Quests')) return null;
        return text;
      }).catch(() => null);

      if (restartInfo) {
        const clicked = await this.page.evaluate(() => {
          const pop = document.querySelector(
            '.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual'
          ) as HTMLElement;
          const okBtn = pop?.querySelector('.btn-usual-ok, .btn-resume') as HTMLElement;
          if (okBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(okBtn).trigger('tap');
            okBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (clicked) {
          await logNormalDelay(1500, 0.15);
          await (this.workflow as any).waitForBattleToMount(12000);
          return await this.resolveAndClearActiveRaid(restartInfo, options);
        }
      }

      // Switch to Recent / Joined tab (#tab-multi)
      await (this.workflow as any).switchToRecentJoinedTab().catch(() => null);
      await logNormalDelay(1000, 0.15);

      // Scan cards for Self-Hosted raid ("You started this raid battle." / data-raid-type="0")
      const hostedCard = await this.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll(
          '#prt-multi-list .btn-multi-raid, .cnt-quest-multi .btn-multi-raid, #prt-multi-list .lis-raid, .cnt-quest-multi .lis-raid'
        )) as HTMLElement[];

        for (const card of cards) {
          if (card.offsetParent === null) continue;
          const text = card.innerText || '';
          const raidType = card.getAttribute('data-raid-type') || card.dataset?.raidType;

          const isSelfHosted =
            text.includes('You started this raid battle') ||
            text.includes('あなたが開始した') ||
            raidType === '0';

          if (isSelfHosted) {
            let raidId = card.getAttribute('data-raid-id') || card.dataset?.raidId || '';
            if (!raidId) {
              const href = card.getAttribute('data-href') || card.getAttribute('href') || '';
              const m = href.match(/\d{8,}/);
              if (m) raidId = m[0];
            }
            const nameEl = card.querySelector(
              '.txt-quest-name, .prt-quest-name, .txt-name, .txt-title, .prt-raid-name'
            ) as HTMLElement;
            const questName = nameEl?.innerText?.trim() || text.split('\n')[0].trim();
            return { raidId, questName };
          }
        }
        return null;
      }).catch(() => null);

      if (hostedCard && hostedCard.raidId) {
        console.log(`\n========================================================================`);
        console.log(`[DailyHost:Scanner] ⚠️ Active hosted raid found on Recent tab: "${hostedCard.questName}" (ID: ${hostedCard.raidId})`);
        console.log(`[DailyHost:Scanner] Navigating into battle #raid_multi/${hostedCard.raidId} to clear it...`);
        console.log(`========================================================================\n`);

        const cardClicked = await this.page.evaluate((id: string) => {
          const cards = Array.from(document.querySelectorAll(
            '#prt-multi-list .btn-multi-raid, .cnt-quest-multi .btn-multi-raid, #prt-multi-list .lis-raid, .cnt-quest-multi .lis-raid'
          )) as HTMLElement[];
          for (const card of cards) {
            const raidId = card.getAttribute('data-raid-id') || card.dataset?.raidId || '';
            const href = card.getAttribute('data-href') || card.getAttribute('href') || '';
            if (raidId === id || href.includes(id)) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(card).trigger('tap');
              card.click();
              return true;
            }
          }
          return false;
        }, hostedCard.raidId).catch(() => false);

        if (!cardClicked) {
          await this.page.evaluate((id: string) => {
            const Game = (window as any).Game;
            if (Game?.router?.navigate) {
              Game.router.navigate('raid_multi/' + id, { trigger: true });
            } else {
              window.location.hash = '#raid_multi/' + id;
            }
          }, hostedCard.raidId).catch(() => null);
        }

        await logNormalDelay(1500, 0.15);
        await (this.workflow as any).waitForBattleToMount(12000);
        return await this.resolveAndClearActiveRaid(hostedCard.questName, options);
      }

      // Clean return to #quest/multi/0 after inspect
      await this.page.evaluate(() => {
        const Game = (window as any).Game;
        if (Game?.router?.navigate) {
          Game.router.navigate('quest/multi/0', { trigger: true });
        } else {
          window.location.hash = '#quest/multi/0';
        }
      }).catch(() => null);
      await logNormalDelay(800, 0.15);

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resumes and completes an active raid battle until 100% victory confirmation.
   */
  private async resolveAndClearActiveRaid(
    modalText = '',
    options?: DailyHostExecutionOptions
  ): Promise<DailyRaidExecutionRecord> {
    const t0 = Date.now();

    // Match raid from catalog by name or id if found in modal text
    let matchedRaid: DailyRaidHostDefinition | undefined = undefined;
    const cleanModal = modalText.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const r of DAILY_HOST_CATALOG) {
      const cleanName = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanId = r.id.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanModal.includes(cleanName) || cleanName.includes(cleanModal) || cleanModal.includes(cleanId)) {
        matchedRaid = r;
        break;
      }
    }

    // Fallback: inspect quest_id from window.stage.pJsnData
    if (!matchedRaid) {
      const qId = await this.page.evaluate(() => (window as any).stage?.pJsnData?.quest_id).catch(() => null);
      if (qId) {
        matchedRaid = DAILY_HOST_CATALOG.find(r => r.questId === String(qId));
      }
    }

    const raidDef = matchedRaid || {
      id: 'active_raid',
      name: modalText || 'In-Progress Hosted Raid',
      category: 'hl' as DailyRaidCategory,
      stageId: '12061',
      questId: '0',
      chapterId: '0',
      dailyLimit: 1,
      apCost: 0
    };

    console.log(`[DailyHost:Scanner] 🛡️ Resolving active hosted raid: "${raidDef.name}"`);
    let combatOutcome = await this.combatRunner.executeHostedCombat(
      raidDef,
      options?.maxTurnsPerRaid ?? 60,
      options
    );

    if (combatOutcome.yieldedToAssist && combatOutcome.activeRaidId && this.interleaver) {
      combatOutcome = await this.interleaver.interleaveAssistWhileHostedRaidActive(
        raidDef,
        combatOutcome.activeRaidId,
        options || {}
      );
    } else {
      await this.combatRunner.confirmAndDismissBattleResult();
    }

    return {
      raid: raidDef,
      status: combatOutcome.isVictoryConfirmed ? 'CLEARED' : 'FAILED',
      turnsElapsed: combatOutcome.turnsElapsed,
      honorsEarned: combatOutcome.honorsEarned,
      durationMs: Date.now() - t0,
      message: `Resumed active host: ${combatOutcome.message}`,
      executedAt: new Date().toISOString()
    };
  }
}
