// src/engines/universal/quest-navigation.service.ts
import { Page } from 'puppeteer-core';
import { UniversalContext } from './types.js';
import { MilestoneSweeperService } from './milestone-sweeper.service.js';
import { CombatResolutionService } from './combat-resolution.service.js';
import { ScreenDiagnosticService } from './screen-diagnostic.service.js';
import { humanizedClick, logNormalDelay } from '../../human-motor.js';
import { RaidEvaluator, RaidCandidate, RaidEvaluationOptions, RaidEvaluatorStrategy } from '../raid-evaluator.js';
import { discordPresence } from '../../relay/discord-presence.js';

export interface QuestNavigationDependencies {
  milestoneSweeper: MilestoneSweeperService;
  combatResolution: CombatResolutionService;
  screenDiagnostic: ScreenDiagnosticService;
  handleAapRecoveryModal?: (autoReplenish: boolean) => Promise<boolean>;
}

export class QuestNavigationService {
  constructor(
    private ctx: UniversalContext,
    private deps: QuestNavigationDependencies
  ) {}

  public get page(): Page {
    return this.ctx.page;
  }

  /**
   * Selects supporter and starts quest for standard, Replicard, or assist quests.
   */
  public async selectSupporterAndStartQuest(
    autoReplenishAp: boolean,
    autoReplenishEp: boolean,
    logPath = this.ctx.state.currentLogPath,
    currentRuns = this.ctx.state.totalCompletedRuns
  ): Promise<boolean> {
    const targetUrl = this.ctx.template.questUrl;

    if (this.ctx.template.stopOnCaptcha !== false) {
      await this.ctx.sentinel.assertSafe();
    }

    // Check if lingering in an actual unfinished battle or result screen
    const initHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isReplicard = this.deps.combatResolution.isReplicardWorkflow
      ? this.deps.combatResolution.isReplicardWorkflow()
      : (targetUrl.includes('replicard') ||
        targetUrl.includes('819131') || targetUrl.includes('815091') ||
        targetUrl.includes('816091') || targetUrl.includes('819141') ||
        targetUrl.includes('819151') || targetUrl.includes('819161') ||
        targetUrl.includes('819171') || targetUrl.includes('812111') ||
        targetUrl.includes('816071') || targetUrl.includes('816031') ||
        targetUrl.includes('816131') || targetUrl.includes('812051'));

    if (isReplicard && this.deps.combatResolution.waitForAndDismissReplicardStagePopups) {
      await this.deps.combatResolution.waitForAndDismissReplicardStagePopups(2500);
    }

    if (initHash.includes('result')) {
      console.log(`[${this.ctx.accountId}] Lingering result screen detected (${initHash}). Settling rewards and proceeding...`);
      await this.deps.combatResolution.handleConfirmResult();
      const targetHash = targetUrl.includes('#') ? '#' + targetUrl.split('#')[1] : targetUrl;
      await this.page.evaluate((h: string) => { window.location.hash = h; }, targetHash).catch(() => null);
      await logNormalDelay(600, 0.15);
    }

    const isCombatHash = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(initHash) || initHash.includes('replicard/battle');

    if (isCombatHash) {
      const battleEnded = await this.deps.combatResolution.isBattleEnded();
      if (battleEnded) {
        console.log(`[${this.ctx.accountId}] Concluded battle detected (${initHash}). Clearing dead combat state and navigating to quest start...`);
        await this.deps.combatResolution.handleConfirmResult();
        const targetHash = targetUrl.includes('#') ? '#' + targetUrl.split('#')[1] : targetUrl;
        await this.page.evaluate((h: string) => { window.location.hash = h; }, targetHash).catch(() => null);
        await logNormalDelay(600, 0.15);
      } else {
        const combatStatus = await this.page.evaluate(() => {
          const stage = (window as any).stage;
          const gStatus = stage?.gGameStatus;
          const pJsn = stage?.pJsnData;
          const turn = Number(pJsn?.turn || gStatus?.turn || 1);
          const boss = gStatus?.boss?.param?.[0] || pJsn?.boss?.param?.[0];
          const isDead = boss?.hp !== undefined && Number(boss.hp) <= 0;
          return { turn, isDead };
        }).catch(() => ({ turn: 1, isDead: false }));

        if (combatStatus.isDead) {
          console.log(`[${this.ctx.accountId}] Enemy already defeated in battle (${initHash}). Concluding result...`);
          await this.deps.combatResolution.handleConfirmResult();
          const targetHash = targetUrl.includes('#') ? '#' + targetUrl.split('#')[1] : targetUrl;
          await this.page.evaluate((h: string) => { window.location.hash = h; }, targetHash).catch(() => null);
          await logNormalDelay(600, 0.15);
        } else if (isReplicard && combatStatus.turn === 1) {
          console.log(`[${this.ctx.accountId}] [Replicard] Fresh active combat detected at Turn 1 (${initHash}). Starting combat pipeline directly...`);
          return true;
        } else {
          console.log(`[${this.ctx.accountId}] Lingering in-progress battle detected (${initHash} | Turn ${combatStatus.turn}). Auto-finishing to clear state for fresh workflow runs...`);
          await this.deps.combatResolution.resolveLingeringState();
        }
      }
    }

    // If targetUrl is an assist / raid finder URL
    if (targetUrl.includes('assist')) {
      const targetSlots = this.ctx.template.raidSlots || (this.ctx.template.raidSlot ? [this.ctx.template.raidSlot] : [4, 3, 2]);
      return await this.joinAssistRaidAndStartQuest(targetSlots, autoReplenishEp, logPath, currentRuns);
    }

    // Standard quest navigation
    const targetHash = targetUrl.split('#')[1] || '';
    const currentUrl = this.page.url();
    if (!currentUrl.includes(targetHash)) {
      await this.page.evaluate((hash: string) => {
        if (window.location.hash === '#' + hash) {
          window.location.reload();
        } else {
          window.location.hash = '#' + hash;
        }
      }, targetHash).catch(() => null);
      await logNormalDelay(350, 0.1);
    }

    const start = Date.now();
    while (Date.now() - start < 12000) {
      if (this.ctx.state.stopRequested) return false;

      if (this.ctx.template.stopOnCaptcha !== false) {
        await this.ctx.sentinel.assertSafe();
      }

      // Check if suspended quest in progress modal is open (.popRestartQuest)
      const hasRestartModal = await this.page.evaluate(() => {
        const pop = document.querySelector('.popRestartQuest, .pop-usual.pop-show, .pop-usual, #pop.popup-view-root');
        if (pop && (pop as HTMLElement).offsetParent !== null) {
          const txt = (pop.textContent || '').toLowerCase();
          if (
            txt.includes('in progress') ||
            txt.includes('progress') ||
            txt.includes('再開') ||
            txt.includes('続ける') ||
            txt.includes('中断') ||
            pop.classList.contains('popRestartQuest')
          ) {
            const okBtn = pop.querySelector('.btn-usual-ok, .btn-ok, .btn-settle') as HTMLElement;
            if (okBtn && okBtn.offsetParent !== null) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(okBtn).trigger('tap');
              okBtn.click();
              return true;
            }
          }
        }
        return false;
      }).catch(() => false);

      if (hasRestartModal) {
        console.log(`[${this.ctx.accountId}] [Resume] Suspended quest in progress modal detected (.popRestartQuest). Resuming battle...`);
        await this.deps.combatResolution.waitForBattleToMount(10000);
        const combatStatus = await this.page.evaluate(() => {
          const stage = (window as any).stage;
          const gStatus = stage?.gGameStatus;
          const pJsn = stage?.pJsnData;
          const turn = Number(pJsn?.turn || gStatus?.turn || 1);
          const boss = gStatus?.boss?.param?.[0] || pJsn?.boss?.param?.[0];
          const isDead = boss?.hp !== undefined && Number(boss.hp) <= 0;
          return { turn, isDead };
        }).catch(() => ({ turn: 1, isDead: false }));

        if (combatStatus.isDead || (await this.deps.combatResolution.isBattleEnded())) {
          console.log(`[${this.ctx.accountId}] [Resume] Resumed battle is already concluded. Settling results...`);
          await this.deps.combatResolution.handleConfirmResult();
          continue;
        }

        if (isReplicard && combatStatus.turn === 1) {
          console.log(`[${this.ctx.accountId}] [Resume] Resumed Replicard battle is at Turn 1. Starting combat pipeline directly.`);
          return true;
        }

        console.log(`[${this.ctx.accountId}] [Resume] Resumed battle is on Turn ${combatStatus.turn}. Resolving lingering battle to start fresh...`);
        await this.deps.combatResolution.resolveLingeringState();
        continue;
      }

      // Check if pending battle popup modal is currently displayed
      if (await this.deps.milestoneSweeper.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
        continue;
      }

      // Check Replicard AAP recovery modal before clicking start
      if (isReplicard && autoReplenishAp && this.deps.handleAapRecoveryModal) {
        const aapHandled = await this.deps.handleAapRecoveryModal(true);
        if (aapHandled) {
          await logNormalDelay(400, 0.1);
          continue;
        }
      }

      // 0. If on a Replicard stage map (e.g. #replicard/stage/10), find and click the target quest/defender!
      if (isReplicard) {
        const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
        if (curHash.includes('replicard/stage')) {
          const clickedQuest = await this.page.evaluate((targetQuestId?: string | number) => {
            // Priority 1: Exact questId match
            if (targetQuestId) {
              const btn = document.querySelector(`.btn-quest-list[data-quest-id="${targetQuestId}"], .prt-quest-list[data-quest-id="${targetQuestId}"]`) as HTMLElement;
              if (btn && btn.offsetParent !== null) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(btn).trigger('tap');
                btn.click();
                return true;
              }
            }

            // Priority 2: Defender quest (data-is-hell="1" or text containing Militis)
            const defenderBtn = document.querySelector('.btn-quest-list[data-is-hell="1"], .prt-quest-list[data-is-hell="1"]') as HTMLElement;
            if (defenderBtn && defenderBtn.offsetParent !== null) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(defenderBtn).trigger('tap');
              defenderBtn.click();
              return true;
            }

            // Priority 3: First available quest in division frame
            const anyQuest = document.querySelector('.prt-division-frame .btn-quest-list, .prt-division-frame .prt-quest-list') as HTMLElement;
            if (anyQuest && anyQuest.offsetParent !== null) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(anyQuest).trigger('tap');
              anyQuest.click();
              return true;
            }

            return false;
          }, this.ctx.template.questId).catch(() => false);

          if (clickedQuest) {
            console.log(`[${this.ctx.accountId}] [Replicard] Clicked quest on stage map (target: ${this.ctx.template.questId || 'Defender'}). Transitioning to deck supporter...`);
            await logNormalDelay(600, 0.15);
            continue;
          }
        }
      }

      // 1. Deck confirmation / Quest Start OK button (.btn-usual-ok.se-quest-start)
      const autoOk = await this.page.evaluate(() => {
        const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle, .btn-usual-ok') as HTMLElement;
        if (ok && ok.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (autoOk) {
        if (isReplicard && autoReplenishAp && this.deps.handleAapRecoveryModal) {
          await this.deps.handleAapRecoveryModal(true);
        }
        const mounted = await this.deps.combatResolution.waitForBattleToMount(12000);
        if (mounted) return true;
        if (await this.deps.milestoneSweeper.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
          continue;
        }
        if (isReplicard && autoReplenishAp && this.deps.handleAapRecoveryModal) {
          const aapAfter = await this.deps.handleAapRecoveryModal(true);
          if (aapAfter) continue;
        }
        return false;
      }

      // 2. AP replenishment popup
      if (autoReplenishAp) {
        const apHandled = await this.page.evaluate(() => {
          const elixirBtn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use') as HTMLElement;
          if (elixirBtn && elixirBtn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(elixirBtn).trigger('tap');
            elixirBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (apHandled) {
          await logNormalDelay(400, 0.1);
          continue;
        }
      }

      // 3. Supporter card selection
      const cardClicked = await this.page.evaluate((priorities: string[]) => {
        const cards = Array.from(document.querySelectorAll(
          '.prt-supporter-attribute.selected .lis-supporter, .prt-supporter-attribute .lis-supporter, .lis-supporter, .btn-supporter, .prt-supporter-detail'
        )) as HTMLElement[];
        const visibleCards = cards.filter(c => c.offsetParent !== null && c.getBoundingClientRect().height > 0);

        for (const p of priorities) {
          const match = visibleCards.find(c => (c.innerText || c.textContent || '').toLowerCase().includes(p.toLowerCase()));
          if (match) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(match).trigger('tap');
            match.click();
            return true;
          }
        }
        if (visibleCards.length > 0) {
          const first = visibleCards[0];
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(first).trigger('tap');
          first.click();
          return true;
        }
        return false;
      }, this.ctx.template.supporterPriority || ['Hades', 'Bahamut', 'Zeus', 'Lucifer', 'Kaguya']).catch(() => false);

      if (cardClicked) {
        await logNormalDelay(300, 0.1);
        const okClicked = await this.page.evaluate(() => {
          const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle, .btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (okClicked) {
          const mounted = await this.deps.combatResolution.waitForBattleToMount(12000);
          if (mounted) return true;
        }

        if (await this.deps.milestoneSweeper.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
          continue;
        }
        continue;
      }

      await new Promise(r => setTimeout(r, 150));
    }

    return false;
  }

  /**
   * Finds, joins, and starts a Backup Request raid from #quest/assist with multi-slot rotation.
   */
  public async joinAssistRaidAndStartQuest(
    slots: number | number[],
    autoReplenishEp: boolean,
    logPath = this.ctx.state.currentLogPath,
    currentRuns = this.ctx.state.totalCompletedRuns
  ): Promise<boolean> {
    const slotList = Array.isArray(slots) ? slots : [slots];

    // Check if pending battles limit modal is shown
    await this.deps.milestoneSweeper.detectAndHandlePendingBattleModal(logPath, currentRuns);

    // Navigate to #quest/assist if not already there
    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isOnAssistFinder = (currentHash === '#quest/assist' || currentHash === '#quest/assist/index') && !currentHash.includes('unclaimed');
    if (!isOnAssistFinder) {
      console.log('[Workflow] Navigating to Backup Requests (#quest/assist)...');
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
        this.page.evaluate(() => {
          window.location.href = 'https://game.granbluefantasy.jp/#quest/assist';
          window.location.reload();
        }).catch(() => null)
      ]);
      await logNormalDelay(1000, 0.15);
    }

    // Check lingering active raids badge prior to searching
    const lingeringCount = await this.deps.milestoneSweeper.getLingeringJoinedRaidCount();
    if (lingeringCount >= 3) {
      console.warn(`[Workflow] ⚠️ Active backup limit detected prior to search (${lingeringCount}/3 raids in progress).`);
      this.ctx.state.lastStartFailureWasRaidLimit = true;
      await this.deps.milestoneSweeper.resolveLingeringRaidLimit(logPath, currentRuns);
      return false;
    }

    // Switch to Finder tab (#tab-search)
    const finderTab = await this.page.waitForSelector('#tab-search, .btn-tabs#tab-search', { visible: true, timeout: 5000 }).catch(() => null);
    if (finderTab) {
      const isActive = await this.page.evaluate((el: any) => el.classList.contains('active'), finderTab);
      if (!isActive) {
        await humanizedClick(this.page, finderTab);
        await logNormalDelay(600, 0.15);
      }
    }

    // Scan slots for eligible candidate
    const t0 = Date.now();
    const maxSearchMs = 45000;
    let raidClicked = false;
    let slotCycleIndex = 0;

    while (Date.now() - t0 < maxSearchMs && !raidClicked && !this.ctx.state.stopRequested) {
      const currentSlot = slotList[slotCycleIndex % slotList.length];
      slotCycleIndex++;

      // 1. Activate the slot button (.btn-search-switch.slot${currentSlot})
      const slotBtn = await this.page.waitForSelector(`.btn-search-switch.slot${currentSlot}, [data-slot="${currentSlot}"].btn-search-switch`, { visible: true, timeout: 2500 }).catch(() => null);
      if (slotBtn) {
        const isSlotActive = await this.page.evaluate((el: any) => el.classList.contains('active'), slotBtn).catch(() => false);
        if (!isSlotActive) {
          console.log(`[Workflow] Switching to Slot ${currentSlot}...`);
          await humanizedClick(this.page, slotBtn);
          await logNormalDelay(600, 0.15);
          await this.page.waitForFunction((s: number) => {
            const btn = document.querySelector(`.btn-search-switch.slot${s}, [data-slot="${s}"].btn-search-switch`);
            const ajaxIdle = (window as any).$ ? (window as any).$.active === 0 : true;
            return btn?.classList.contains('active') && ajaxIdle;
          }, { timeout: 3500 }, currentSlot).catch(() => null);
          await logNormalDelay(300, 0.1);
        }
      }

      // Check full/ended raid popup
      await this.dismissFullOrEndedRaidPopup();

      // 2. Scan cards in #prt-search-list
      const rawCandidates: RaidCandidate[] = await this.page.evaluate((tmplName: string) => {
        const cards = Array.from(document.querySelectorAll('#prt-search-list .btn-multi-raid.lis-raid.search, #prt-search-list .btn-multi-raid, .lis-raid.search'));
        const lowerTmpl = (tmplName || '').toLowerCase();
        const isAkasha = lowerTmpl.includes('akasha');
        const isPbhl = lowerTmpl.includes('pbhl') || lowerTmpl.includes('proto bahamut');
        const isGo = lowerTmpl.includes('go') || lowerTmpl.includes('grand order');
        const isFaa = lowerTmpl.includes('dark rapture') || lowerTmpl.includes('lucilius') || lowerTmpl.includes('faahl') || lowerTmpl.includes('faa-hl');
        const isBelial = lowerTmpl.includes('belial') || lowerTmpl.includes('cunning') || lowerTmpl.includes('fallen angel');
        const isBubz = lowerTmpl.includes('king') || lowerTmpl.includes('beelzebub') || lowerTmpl.includes('bubz') || lowerTmpl.includes('bubs') || lowerTmpl.includes('new king');
        const isFediel = lowerTmpl.includes('fediel') || lowerTmpl.includes('フェディエル');
        const isWilnas = lowerTmpl.includes('wilnas') || lowerTmpl.includes('ウィルナス');

        return cards.map((c, i) => {
          const el = c as HTMLElement;
          if (el.offsetParent === null) return null;

          const titleEl = el.querySelector('.prt-raid-name, .txt-raid-name, .name, [class*="raid-name"]') as HTMLElement;
          const title = ((titleEl ? titleEl.innerText : el.innerText) || '').toLowerCase();
          const imgEl = el.querySelector('img') as HTMLImageElement;
          const imgSrc = imgEl?.src || '';

          // Validate target raid to prevent cross-slot contamination:
          if (isAkasha) {
            if (title.includes('wings of terror') || title.includes('proto bahamut') || title.includes('バハムート') || title.includes('peacemaker') || title.includes('グランデ') || imgSrc.includes('301061') || imgSrc.includes('305161')) {
              return null;
            }
          } else if (isPbhl) {
            if (title.includes('broken skies') || title.includes('akasha') || title.includes('アーカーシャ') || title.includes('peacemaker') || title.includes('グランデ') || imgSrc.includes('303251') || imgSrc.includes('305161')) {
              return null;
            }
          } else if (isGo) {
            if (title.includes('broken skies') || title.includes('akasha') || title.includes('wings of terror') || title.includes('bahamut') || imgSrc.includes('303251') || imgSrc.includes('301061')) {
              return null;
            }
          } else if (isFaa) {
            if (title.includes('wings of terror') || title.includes('proto bahamut') || title.includes('broken skies') || title.includes('akasha') || title.includes('peacemaker') || title.includes('the world') || title.includes('cunning') || title.includes('belial') || title.includes('king') || title.includes('beelzebub') || title.includes('fediel') || title.includes('wilnas') || imgSrc.includes('301061') || imgSrc.includes('303251') || imgSrc.includes('305161') || imgSrc.includes('305381') || imgSrc.includes('305141') || imgSrc.includes('305241') || imgSrc.includes('305191')) {
              return null;
            }
          } else if (isBelial) {
            if (title.includes('wings of terror') || title.includes('proto bahamut') || title.includes('broken skies') || title.includes('akasha') || title.includes('peacemaker') || title.includes('the world') || title.includes('dark rapture') || title.includes('lucilius') || title.includes('king') || title.includes('beelzebub') || title.includes('fediel') || title.includes('wilnas') || imgSrc.includes('301061') || imgSrc.includes('303251') || imgSrc.includes('305161') || imgSrc.includes('303041') || imgSrc.includes('305141') || imgSrc.includes('305241') || imgSrc.includes('305191')) {
              return null;
            }
          } else if (isBubz) {
            if (title.includes('wings of terror') || title.includes('proto bahamut') || title.includes('broken skies') || title.includes('akasha') || title.includes('peacemaker') || title.includes('the world') || title.includes('dark rapture') || title.includes('lucilius') || title.includes('cunning') || title.includes('belial') || title.includes('fediel') || title.includes('wilnas') || imgSrc.includes('301061') || imgSrc.includes('303251') || imgSrc.includes('305161') || imgSrc.includes('303041') || imgSrc.includes('305381') || imgSrc.includes('305241') || imgSrc.includes('305191')) {
              return null;
            }
          } else if (isFediel) {
            if (title.includes('wings of terror') || title.includes('proto bahamut') || title.includes('broken skies') || title.includes('akasha') || title.includes('peacemaker') || title.includes('the world') || title.includes('dark rapture') || title.includes('lucilius') || title.includes('cunning') || title.includes('belial') || title.includes('king') || title.includes('beelzebub') || title.includes('wilnas') || title.includes('wamdus') || title.includes('galleon') || title.includes('ewiyar') || title.includes('lu woh') || imgSrc.includes('301061') || imgSrc.includes('303251') || imgSrc.includes('305161') || imgSrc.includes('303041') || imgSrc.includes('305381') || imgSrc.includes('305141') || imgSrc.includes('305191')) {
              return null;
            }
          } else if (isWilnas) {
            if (title.includes('wings of terror') || title.includes('proto bahamut') || title.includes('broken skies') || title.includes('akasha') || title.includes('peacemaker') || title.includes('the world') || title.includes('dark rapture') || title.includes('lucilius') || title.includes('cunning') || title.includes('belial') || title.includes('king') || title.includes('beelzebub') || title.includes('fediel') || title.includes('wamdus') || title.includes('galleon') || title.includes('ewiyar') || title.includes('lu woh') || imgSrc.includes('301061') || imgSrc.includes('303251') || imgSrc.includes('305161') || imgSrc.includes('303041') || imgSrc.includes('305381') || imgSrc.includes('305141') || imgSrc.includes('305241')) {
              return null;
            }
          }

          const gauge = el.querySelector('.prt-raid-gauge-inner') as HTMLElement;
          const hpWidth = gauge?.style?.width || '0%';
          const hpPct = parseFloat(hpWidth) || 0;

          const playerEl = el.querySelector('.prt-flees-in') as HTMLElement;
          const playerText = playerEl ? (playerEl.innerText || '') : '';
          const match = playerText.match(/(\d+)\s*\/\s*(\d+)/);
          const players = match ? parseInt(match[1], 10) : 0;
          const maxPlayers = match ? parseInt(match[2], 10) : 30;

          const raidId = el.getAttribute('data-raid-id') || el.dataset?.raidId || '';
          const rect = el.getBoundingClientRect();

          return {
            index: i,
            raidId,
            hpPct,
            players,
            maxPlayers,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }).filter(Boolean) as any[];
      }, this.ctx.template.name).catch(() => []);

      // Prune dead raid IDs older than 2 minutes
      const now = Date.now();
      for (const [id, ts] of this.ctx.state.deadRaidIds.entries()) {
        if (now - ts > 120000) this.ctx.state.deadRaidIds.delete(id);
      }

      const isOtk = this.ctx.template.evaluatorStrategy === 'otk_burst' || this.ctx.template.evaluatorStrategy === 'leech';
      const isFarm = this.ctx.template.evaluatorStrategy === 'farm';
      const hasCustomHp = this.ctx.template.minHpPct !== undefined || this.ctx.template.maxHpPct !== undefined;
      const strategy: RaidEvaluatorStrategy = this.ctx.template.evaluatorStrategy
        || (isFarm ? 'farm' : (hasCustomHp && (this.ctx.template.maxHpPct ?? 100) <= 50 ? 'leech' : 'honor'));

      // If in farm mode or after initial search passes, enable adaptive degradation to pick best active raid
      const enableAdaptive = isFarm || this.ctx.template.adaptive === true || (this.ctx.template.adaptive !== false && Date.now() - t0 > 8000);

      const evalOptions: RaidEvaluationOptions = {
        strategy,
        minScore: this.ctx.template.minRaidScore ?? (isFarm ? RaidEvaluator.DEFAULT_FARM_MIN_SCORE : (hasCustomHp ? 0 : RaidEvaluator.DEFAULT_MIN_SCORE)),
        minHpPct: this.ctx.template.minHpPct ?? (isFarm ? 1 : (isOtk ? 1 : RaidEvaluator.DEFAULT_MIN_HP)),
        maxHpPct: this.ctx.template.maxHpPct ?? (isFarm ? RaidEvaluator.DEFAULT_FARM_MAX_HP : (isOtk ? RaidEvaluator.DEFAULT_OTK_MAX_HP : undefined)),
        minPlayers: this.ctx.template.minPlayers ?? (isFarm ? RaidEvaluator.DEFAULT_FARM_MIN_PLAYERS : (isOtk ? RaidEvaluator.DEFAULT_OTK_MIN_PLAYERS : 1)),
        maxPlayers: this.ctx.template.maxPlayers ?? (isFarm ? 29 : (isOtk ? 29 : RaidEvaluator.DEFAULT_MAX_PLAYERS)),
        deadRaidIds: this.ctx.state.deadRaidIds,
        useCache: true,
        adaptive: enableAdaptive
      };

      const selection = RaidEvaluator.selectBestCandidate(rawCandidates, evalOptions);
      const candidate = selection.best;

      if (candidate) {
        this.ctx.state.consecutiveEmptyRaidSearches = 0;
        this.ctx.state.currentRaidId = candidate.raidId || 'pending';
        this.ctx.sentinel?.setSessionContext?.({
          raidId: candidate.raidId,
          hpPct: candidate.hpPct,
          players: `${candidate.players}/${candidate.maxPlayers || 30}`
        });

        const adaptiveTag = candidate.reason?.includes('Adaptively') ? ' [ADAPTIVE SELECTION]' : '';
        console.log(`[Workflow] Selected Slot ${currentSlot} raid (ID: ${candidate.raidId || 'pending'}, Score: ${candidate.score} pt [Grade ${candidate.grade}], HP: ${candidate.hpPct}%, Players: ${candidate.players}/${candidate.maxPlayers || 30})${adaptiveTag}. Joining...`);

        const cardElements = await this.page.$$('#prt-search-list .btn-multi-raid.lis-raid.search, #prt-search-list .btn-multi-raid, .lis-raid.search');
        const targetCard = cardElements[candidate.index];
        if (targetCard) {
          await humanizedClick(this.page, targetCard);
        } else if (candidate.x && candidate.y) {
          await this.page.touchscreen.tap(candidate.x, candidate.y).catch(() => null);
        }

        // Await transition: either #quest/supporter_raid mounts OR a popup modal appears
        const transitionState = await this.waitForSupporterOrModal(10000);

        if (transitionState === 'FULL_OR_ENDED') {
          console.warn(`[Workflow] Raid ${candidate.raidId || ''} was already full or ended. Blacklisting and continuing search...`);
          if (candidate.raidId) {
            this.ctx.state.deadRaidIds.set(candidate.raidId, Date.now());
          }
          await this.dismissFullOrEndedRaidPopup();
          const refreshBtn = await this.page.$('.btn-search-refresh, .btn-post-key, .btn-refresh-list');
          if (refreshBtn) {
            await humanizedClick(this.page, refreshBtn);
            await logNormalDelay(800, 0.12);
          }
          if (Date.now() - t0 < maxSearchMs) {
            continue;
          }
          this.ctx.state.lastStartFailureWasRaidWait = true;
          return false;
        }

        if (transitionState === 'ACTIVE_RAID_LIMIT_3') {
          console.warn('[Workflow] ⚠️ Active raid limit reached (3 simultaneous battles in progress).');
          this.ctx.state.lastStartFailureWasRaidLimit = true;
          const resolved = await this.deps.milestoneSweeper.resolveLingeringRaidLimit(logPath, currentRuns);
          if (resolved && Date.now() - t0 < maxSearchMs && !this.ctx.state.stopRequested) {
            console.log('[Workflow] Returning directly to raid search after resolving lingering raids...');
            continue;
          }
          return false;
        }

        if (transitionState === 'PENDING_LIMIT') {
          console.warn('[Workflow] Pending battle limit reached. Clearing all unclaimed battles...');
          this.ctx.state.lastStartFailureWasMaintenance = true;
          await this.deps.milestoneSweeper.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
          if (Date.now() - t0 < maxSearchMs && !this.ctx.state.stopRequested) {
            console.log('[Workflow] Returning directly to raid search after clearing pending battles...');
            continue;
          }
          return false;
        }

        if (transitionState === 'DIRECT_COMBAT') {
          return await this.deps.combatResolution.waitForBattleToMount(12000);
        }

        if (transitionState === 'TIMEOUT') {
          console.warn('[Workflow] Supporter screen navigation timed out.');
          this.ctx.state.lastStartFailureWasRaidWait = true;
          return false;
        }

        raidClicked = true;
        break;
      } else {
        if (selection.nonViableCandidates.length > 0) {
          const top = selection.nonViableCandidates[0];
          console.log(`[Workflow] Slot ${currentSlot}: ${rawCandidates.length} raid(s) scanned, none meet viability score (Top: ${top.score || 0} pt [Grade ${top.grade || 'F'}, HP ${top.hpPct}%, ${top.players}/${top.maxPlayers} players] - ${top.reason}). Skipping...`);
        }

        // If all slots checked in this pass, click search refresh if available
        if (slotCycleIndex % slotList.length === 0) {
          const refreshBtn = await this.page.$('.btn-search-refresh, .btn-post-key, .btn-refresh-list');
          if (refreshBtn) {
            await humanizedClick(this.page, refreshBtn);
            await logNormalDelay(1000, 0.15);
          } else {
            await new Promise(r => setTimeout(r, 1000));
          }
        } else {
          await logNormalDelay(350, 0.1);
        }
      }
    }

    if (!raidClicked) {
      this.ctx.state.consecutiveEmptyRaidSearches++;
      this.ctx.state.lastStartFailureWasRaidWait = true;

      const isFarm = this.ctx.template.evaluatorStrategy === 'farm';
      const waitSeconds = isFarm
        ? (this.ctx.state.consecutiveEmptyRaidSearches === 1 ? 15 : 30)
        : (this.ctx.state.consecutiveEmptyRaidSearches === 1
            ? 60
            : this.ctx.state.consecutiveEmptyRaidSearches === 2
              ? 180
              : 300);

      console.log(`\n========================================================================`);
      console.log(`  ⏳ PATIENCE STANDBY MODE (Round #${this.ctx.state.consecutiveEmptyRaidSearches})`);
      console.log(`  No eligible raids found across slot(s) [${slotList.join(', ')}]`);
      console.log(`  Standby duration: ${waitSeconds}s (${Math.round(waitSeconds / 60)} min)`);
      console.log(`  Checking periodically every ${isFarm ? '5 seconds' : '5 minutes'} (will resume immediately if raids appear)`);
      console.log(`========================================================================\n`);

      const tStandbyStart = Date.now();
      const waitMs = waitSeconds * 1000;
      let lastCheckSec = 0;
      const checkIntervalSec = isFarm ? 5 : 20;

      while (Date.now() - tStandbyStart < waitMs && !this.ctx.state.stopRequested) {
        const elapsedSec = Math.floor((Date.now() - tStandbyStart) / 1000);
        const remainingSec = Math.max(0, waitSeconds - elapsedSec);

        // Update Discord Rich Presence
        discordPresence.updateStatus({
          raidName: this.ctx.template.name,
          goldBars: this.ctx.state.totalGoldBarsAccumulated,
          blueChests: this.ctx.state.totalBlueChestsAccumulated,
          status: `Standby (${remainingSec}s)`
        }, true);

        // Check for early raid arrival or pending battle completion periodically
        if (elapsedSec > 0 && elapsedSec % checkIntervalSec === 0 && elapsedSec !== lastCheckSec) {
          lastCheckSec = elapsedSec;
          console.log(`[Patience Standby] Standby active (${remainingSec}s remaining). Checking finder...`);
          const refreshBtn = await this.page.$('.btn-search-refresh, .btn-post-key, .btn-refresh-list');
          if (refreshBtn) {
            await humanizedClick(this.page, refreshBtn);
            await logNormalDelay(600, 0.1);
          }

          const hasCards = await this.page.evaluate(() => {
            const cards = document.querySelectorAll('#prt-search-list .btn-multi-raid.lis-raid.search, #prt-search-list .btn-multi-raid, .lis-raid.search');
            return Array.from(cards).some(c => (c as HTMLElement).offsetParent !== null);
          }).catch(() => false);

          if (hasCards) {
            console.log('[Patience Standby] 🌟 Fresh raids detected! Ending standby early and entering search...');
            break;
          }

          // Check if lingering raids cleared
          const lingering = await this.deps.milestoneSweeper.getLingeringJoinedRaidCount();
          if (lingering === 0) {
            const hasPending = await this.page.evaluate(() => {
              const badge = document.querySelector('.btn-unclaimed .prt-badge, .btn-unclaimed .ico-badge, .tab-unclaimed .ico-badge, [data-href*="unclaimed"] .ico-badge');
              return badge !== null && (badge as HTMLElement).offsetParent !== null;
            }).catch(() => false);
            if (hasPending) {
              console.log('[Patience Standby] Unclaimed battle results detected during standby. Claiming...');
              await this.deps.milestoneSweeper.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
            }
          }
        }

        await new Promise(r => setTimeout(r, 2000));
      }

      return false;
    }

    // 2. Select Supporter Summon by priority
    const suppSelected = await this.selectSupporterCard(this.ctx.template.supporterPriority || ['Hades', 'Bahamut', 'Zeus', 'Lucifer', 'Kaguya']);
    if (!suppSelected) {
      console.warn('[Workflow] Could not select supporter summon.');
      return false;
    }

    // 3. Confirm Party & Start Quest (handling Soul Berry EP replenishment if needed)
    return await this.confirmPartyAndStartRaid(autoReplenishEp, logPath, currentRuns);
  }

  /**
   * Waits for supporter screen to mount or detects blocking modal.
   */
  public async waitForSupporterOrModal(
    timeoutMs = 10000
  ): Promise<'SUPPORTER_READY' | 'FULL_OR_ENDED' | 'PENDING_LIMIT' | 'ACTIVE_RAID_LIMIT_3' | 'DIRECT_COMBAT' | 'TIMEOUT'> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.ctx.state.stopRequested) return 'TIMEOUT';

      const state = await this.page.evaluate(() => {
        const hash = window.location.hash;

        // 1. Direct combat hash
        if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash)) {
          return 'DIRECT_COMBAT';
        }

        // 2. Check for popups/modals (strictly inspect genuinely visible popups)
        const modal = document.querySelector('.pop-usual.pop-show, .pop-show, .pop-usual, .prt-popup-body') as HTMLElement;
        const isModalVisible = modal && modal.offsetParent !== null && (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function' || (() => {
          const style = window.getComputedStyle(modal);
          return style && style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
        })());

        if (isModalVisible && modal) {
          const rawText = modal.innerText || modal.textContent || '';
          const lowerText = rawText.toLowerCase();

          // A. Full or Ended Raid
          const isFullOrEnded = (
            lowerText.includes('already full') ||
            lowerText.includes('already ended') ||
            lowerText.includes('battle has ended') ||
            lowerText.includes('maximum number of participants') ||
            lowerText.includes('capacity') ||
            rawText.includes('定員に達している') ||
            rawText.includes('定員') ||
            rawText.includes('参戦人数') ||
            rawText.includes('参加人数') ||
            rawText.includes('終了') ||
            rawText.includes('解散') ||
            rawText.includes('すでに終了') ||
            rawText.includes('既に終了') ||
            rawText.includes('すでにバトルが終了')
          );
          if (isFullOrEnded) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close, .btn-close') as HTMLElement;
            if (ok) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(ok).trigger('tap');
              ok.click();
            }
            return 'FULL_OR_ENDED';
          }

          // B. Already Joined this battle
          const isAlreadyJoined = (
            lowerText.includes('already participating') ||
            rawText.includes('既に参戦中') ||
            rawText.includes('すでに参戦中')
          );
          if (isAlreadyJoined) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close, .btn-close') as HTMLElement;
            if (ok) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(ok).trigger('tap');
              ok.click();
            }
            return 'FULL_OR_ENDED';
          }

          // C. True 3-Raid Limit (strict multi-phrase matching)
          const isThreeRaidLimit = (
            lowerText.includes('three raid') ||
            lowerText.includes('up to three') ||
            lowerText.includes('provide backup in up to') ||
            lowerText.includes('only provide backup') ||
            lowerText.includes('3 battles') ||
            lowerText.includes('3 raid') ||
            lowerText.includes('participating in 3') ||
            lowerText.includes('more than 3') ||
            lowerText.includes('up to 3') ||
            rawText.includes('3件まで') ||
            rawText.includes('同時に参戦できる') ||
            (rawText.includes('3件') && (rawText.includes('マルチバトル') || rawText.includes('救援')))
          );
          if (isThreeRaidLimit) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
            if (ok) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(ok).trigger('tap');
              ok.click();
            }
            return 'ACTIVE_RAID_LIMIT_3';
          }

          // D. Unclaimed / Pending Battles Limit (5+ battles)
          const isPending = (
            lowerText.includes('pending') ||
            lowerText.includes('unclaimed') ||
            rawText.includes('未確認') ||
            lowerText.includes('five or more') ||
            rawText.includes('5件')
          );
          if (isPending) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
            if (ok) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(ok).trigger('tap');
              ok.click();
            }
            return 'PENDING_LIMIT';
          }
        }

        // 3. Supporter raid screen with cards mounted
        if (hash.includes('supporter_raid') || hash.includes('supporter')) {
          const suppCards = document.querySelectorAll('.btn-supporter, .lis-supporter, .prt-supporter-attribute .lis-supporter, .prt-supporter-detail');
          const hasVisibleCards = Array.from(suppCards).some(c => (c as HTMLElement).offsetParent !== null);
          if (hasVisibleCards) {
            return 'SUPPORTER_READY';
          }
        }

        return null;
      }).catch(() => null);

      if (state) return state as any;
      await new Promise(r => setTimeout(r, 150));
    }
    return 'TIMEOUT';
  }

  /**
   * Scans and selects supporter summon card on #quest/supporter_raid by priority.
   */
  public async selectSupporterCard(priorities: string[]): Promise<boolean> {
    const cardSelected = await this.page.evaluate((priors: string[]) => {
      const cards = Array.from(document.querySelectorAll(
        '.btn-supporter, .lis-supporter, .prt-supporter-attribute .lis-supporter, .prt-supporter-detail'
      )) as HTMLElement[];

      const visibleCards = cards.filter(c => c.offsetParent !== null && c.getBoundingClientRect().height > 0);
      if (visibleCards.length === 0) return false;

      // 1. Match priorities
      for (const p of priors) {
        const match = visibleCards.find(c => (c.innerText || c.textContent || '').toLowerCase().includes(p.toLowerCase()));
        if (match) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(match).trigger('tap');
          match.click();
          return true;
        }
      }

      // 2. Fallback to first available supporter
      const first = visibleCards[0];
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(first).trigger('tap');
      first.click();
      return true;
    }, priorities).catch(() => false);

    if (cardSelected) {
      await logNormalDelay(400, 0.12);
      return true;
    }
    return false;
  }

  /**
   * Confirms party and clicks Quest Start OK button, handling Soul Berry EP replenishment if needed.
   */
  public async confirmPartyAndStartRaid(
    autoReplenishEp: boolean,
    logPath = this.ctx.state.currentLogPath,
    currentRuns = this.ctx.state.totalCompletedRuns
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if (this.ctx.state.stopRequested) return false;

      // Check if pending battle popup modal appeared during party confirmation
      if (await this.deps.milestoneSweeper.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
        this.ctx.state.lastStartFailureWasMaintenance = true;
        return false;
      }

      // 1. Check if direct combat already mounted
      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash)) {
        return await this.deps.combatResolution.waitForBattleToMount(12000);
      }

      // 2. Handle EP replenishment (Soul Berry) if modal appears
      const berryModal = await this.page.evaluate((replenish: boolean) => {
        const berryBtn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use') as HTMLElement;
        if (berryBtn && berryBtn.offsetParent !== null) {
          if (!replenish) return 'EP_DENIED';
          berryBtn.click();
          return 'BERRY_CLICKED';
        }
        return null;
      }, autoReplenishEp).catch(() => null);

      if (berryModal === 'EP_DENIED') {
        console.warn('[Workflow] EP depleted and autoReplenishEp is disabled.');
        return false;
      }
      if (berryModal === 'BERRY_CLICKED') {
        await logNormalDelay(350, 0.1);
        // Confirm Soul Berry usage in confirmation popup
        const confirmBerry = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 3000 }).catch(() => null);
        if (confirmBerry) {
          await humanizedClick(this.page, confirmBerry);
          await logNormalDelay(400, 0.1);
        }
        continue;
      }

      // 3. Click Quest Start OK button (.btn-usual-ok.se-quest-start)
      const startBtn = await this.page.waitForSelector(
        '.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle',
        { visible: true, timeout: 1500 }
      ).catch(() => null);

      if (startBtn) {
        await humanizedClick(this.page, startBtn);
        await startBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          el.click();
        }).catch(() => null);

        const mounted = await this.deps.combatResolution.waitForBattleToMount(12000);
        if (mounted) return true;
        if (await this.deps.milestoneSweeper.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
          this.ctx.state.lastStartFailureWasMaintenance = true;
          return false;
        }
        return false;
      }

      // Check full/ended raid modal
      if (await this.dismissFullOrEndedRaidPopup()) {
        console.warn('[Workflow] Raid was full or ended during party confirmation.');
        this.ctx.state.lastStartFailureWasMaintenance = true;
        return false;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    return false;
  }

  /**
   * Closes the "Raid was full or already ended" pop-usual dialog.
   */
  public async dismissFullOrEndedRaidPopup(): Promise<boolean> {
    return await this.deps.screenDiagnostic.dismissFullOrEndedRaidPopup();
  }

  /**
   * Intelligently waits for at least one active raid slot to free up when the 3-raid limit is hit.
   */
  public async waitForActiveRaidSlot(maxWaitSec = 90): Promise<boolean> {
    return await this.deps.milestoneSweeper.performPassiveWaitCycle(
      this.ctx.template.logPath || 'logs/workflow.md',
      0
    );
  }
}
