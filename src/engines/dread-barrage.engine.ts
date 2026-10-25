// src/engines/dread-barrage.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import {
  DREAD_BARRAGE_API_ENDPOINTS,
  DREAD_BARRAGE_ITERATION_15,
  DREAD_BARRAGE_ROUTES,
  DREAD_BARRAGE_SELECTORS,
  DreadBarrageCombatStrategy,
  DreadBarrageElement,
  DreadBarrageStarTier,
  ELEMENT_ADVANTAGE_SUMMONS,
  BOSS_TO_ADVANTAGE_ELEMENT,
  GBF_ATTRIBUTE_TO_ELEMENT,
  buildDreadBarrageSupporterUrl
} from '../events/dread-barrage.constants.js';

export interface DreadBarrageBossLiveStatus {
  tier: DreadBarrageStarTier;
  questId: string;
  chapterId: string;
  questName: string;
  categorySymbol: string;
  apCost: number;
  isCleared: boolean;
  isOpen: boolean;
  isProgress: boolean;
  raidId: string | null;
  clearCount: number;
  remainClearCountToUnlock?: number;
  prerequisiteQuestName?: string;
}

export interface DreadBarrageUnparalleledLiveStatus {
  questId: string;
  chapterId: string;
  questName: string;
  level: number;
  apCost: number;
  isOpen: boolean;
  isProgress: boolean;
  raidId: string | null;
}

export interface DreadBarrageMissionLiveStatus {
  missionId: string;
  type: 'individual' | 'crew';
  level: number;
  star: number;
  maxStar: number;
  progress: number;
  maxProgress: number;
  isAllComplete: boolean;
  currentDescription: string;
  currentReward: string;
}

export interface DreadBarrageLiveState {
  eventId: number;
  bossElement: DreadBarrageElement;
  advantageElement: DreadBarrageElement;
  userHonors: number;
  crewHonors: number;
  valorBadges: number;
  victoryCertificates: number;
  isOneShotKillActive: boolean;
  currentAp: number;
  maxAp: number;
  currentEp: number;
  bosses: DreadBarrageBossLiveStatus[];
  unparalleledFoes: DreadBarrageUnparalleledLiveStatus[];
  valiantBattle: {
    isTermStart: boolean;
    isConditionCleared: boolean;
    requiredCrewHonors: number;
  };
  missions: DreadBarrageMissionLiveStatus[];
}

export interface DreadBarrageRaidLoopOptions {
  tier: DreadBarrageStarTier;
  runs: number;
  strategy?: DreadBarrageCombatStrategy;
  autoReplenishAp?: boolean;
  autoUnparalleled?: boolean;
  supporterPriorities?: string[];
  onProgress?: (progress: {
    run: number;
    totalRuns: number;
    tier: string;
    questName: string;
    questId: string;
    durationMs: number;
    tokensEstimated: number;
    status: 'CLEARED' | 'UNPARALLELED_CLEARED' | 'SKIPPED' | 'ERROR';
  }) => void;
}

export interface DreadBarrageRaidLoopSummary {
  requestedTier: DreadBarrageStarTier;
  totalRunsCompleted: number;
  unparalleledFoesCleared: number;
  estimatedTokensEarned: number;
  estimatedHonorsEarned: number;
  totalDurationMs: number;
  status: 'COMPLETED' | 'STOPPED_BY_USER' | 'ERROR';
}

export interface DreadBarrageRewardClaimSummary {
  defeatRewardsClaimed: number;
  pointRewardsClaimed: number;
  totalDurationMs: number;
}

export interface DreadBarrageGachaSummary {
  boxesCleared: number;
  drawsExecuted: number;
  tokensRemaining: number | null;
  redirectedToSetting: boolean;
  totalDurationMs: number;
  status: 'COMPLETED' | 'DEPLETED' | 'NEEDS_WEAPON_SETTING' | 'STOPPED_BY_USER';
}

export class DreadBarrageEngine {
  private page: Page;
  private sentinel: SentinelWatchdog;
  private stopRequested = false;

  constructor(page: Page, sentinel: SentinelWatchdog) {
    this.page = page;
    this.sentinel = sentinel;
  }

  public requestStop(): void {
    this.stopRequested = true;
    console.log('[DreadBarrageEngine] 🛑 Stop signal received. Finishing current action...');
  }

  public updatePage(newPage: Page): void {
    this.page = newPage;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Queries `/teamforce/top/content/index` in-page to retrieve the complete real-time state
   * of the active Dread Barrage event without requiring a full DOM navigation.
   */
  public async fetchLiveState(): Promise<DreadBarrageLiveState | null> {
    await this.sentinel.assertSafe();

    const raw = await this.page.evaluate(async (endpoint: string) => {
      try {
        const ver = (window as any).Game?.version || '';
        const uid = (window as any).Game?.userId || '';
        const res = await fetch(`${endpoint}?_=${Date.now()}&uid=${uid}`, {
          headers: {
            'X-Version': ver,
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        if (!res.ok) return null;
        const json = await res.json();
        return json?.option || null;
      } catch {
        return null;
      }
    }, DREAD_BARRAGE_API_ENDPOINTS.TOP_CONTENT).catch(() => null);

    if (!raw || !Array.isArray(raw.boss_list)) {
      return null;
    }

    const attrCode = String(raw.boss_list[0]?.attribute || '3');
    const bossElement: DreadBarrageElement = GBF_ATTRIBUTE_TO_ELEMENT[attrCode] || 'earth';
    const advantageElement: DreadBarrageElement = BOSS_TO_ADVANTAGE_ELEMENT[bossElement];

    const categoryToTier = (cat: string, idx: number): DreadBarrageStarTier => {
      const starCount = (cat.match(/★/g) || []).length || (idx + 1);
      if (starCount <= 1) return '1star';
      if (starCount === 2) return '2star';
      if (starCount === 3) return '3star';
      if (starCount === 4) return '4star';
      return '5star';
    };

    const bosses: DreadBarrageBossLiveStatus[] = raw.boss_list.map((b: any, idx: number) => {
      const cat = String(b.quest_category || '');
      return {
        tier: categoryToTier(cat, idx),
        questId: String(b.quest_id),
        chapterId: String(b.chapter_id),
        questName: String(b.quest_name),
        categorySymbol: cat || '★'.repeat(idx + 1),
        apCost: parseInt(String(b.action_point || '30'), 10) || 30,
        isCleared: Boolean(b.is_cleared),
        isOpen: Boolean(b.is_open),
        isProgress: Boolean(b.is_progress),
        raidId: b.raid_id ? String(b.raid_id) : null,
        clearCount: Number(b.clear_count || 0),
        remainClearCountToUnlock: b.open_info?.remain_clear_count !== undefined
          ? Number(b.open_info.remain_clear_count)
          : undefined,
        prerequisiteQuestName: b.open_info?.open_chapter_name
          ? String(b.open_info.open_chapter_name)
          : undefined
      };
    });

    const unparalleledFoes: DreadBarrageUnparalleledLiveStatus[] = Array.isArray(raw.poped_extra_enemy_list)
      ? raw.poped_extra_enemy_list.map((u: any) => {
          const name = String(u.quest_name || 'Unparalleled Foe');
          const lvMatch = name.match(/Lvl?\s*(\d+)/i);
          return {
            questId: String(u.quest_id),
            chapterId: String(u.chapter_id || ''),
            questName: name,
            level: lvMatch ? parseInt(lvMatch[1], 10) : 95,
            apCost: parseInt(String(u.action_point || '0'), 10) || 0,
            isOpen: u.is_open !== false,
            isProgress: Boolean(u.is_progress),
            raidId: u.raid_id ? String(u.raid_id) : null
          };
        })
      : [];

    const missions: DreadBarrageMissionLiveStatus[] = [];
    const parseMissionMap = (mapObj: any, type: 'individual' | 'crew') => {
      if (!mapObj || typeof mapObj !== 'object') return;
      for (const [mId, mVal] of Object.entries<any>(mapObj)) {
        if (!mVal || typeof mVal !== 'object') continue;
        const lvKey = String(mVal.level || '1');
        const detail = mVal.level_details?.[lvKey] || {};
        missions.push({
          missionId: mId,
          type,
          level: parseInt(lvKey, 10) || 1,
          star: Number(mVal.star || 0),
          maxStar: parseInt(String(mVal.max_star || '4'), 10) || 4,
          progress: Number(mVal.progress || 0),
          maxProgress: parseInt(String(mVal.max_progress || '5'), 10) || 5,
          isAllComplete: Boolean(mVal.is_all_complete),
          currentDescription: String(detail.description || ''),
          currentReward: String(detail.reward_name || '')
        });
      }
    };

    parseMissionMap(raw.mission_list, 'individual');
    parseMissionMap(raw.guild_mission_list, 'crew');

    return {
      eventId: Number(raw.event_id || DREAD_BARRAGE_ITERATION_15.eventId),
      bossElement,
      advantageElement,
      userHonors: Number(raw.user_event_point || 0),
      crewHonors: Number(raw.guild_event_point || 0),
      valorBadges: Number(raw.user_medal_count || 0),
      victoryCertificates: Number(raw.user_bill_count || 0),
      isOneShotKillActive: Boolean(raw.is_active_one_shot_kill),
      currentAp: Number(raw.status?.now_action_point || 0),
      maxAp: parseInt(String(raw.status?.max_action_point || '0'), 10) || 0,
      currentEp: Number(raw.status?.now_battle_point || 0),
      bosses,
      unparalleledFoes,
      valiantBattle: {
        isTermStart: Boolean(raw.specialbattle_info?.is_special_battle_term_start),
        isConditionCleared: Boolean(raw.specialbattle_info?.is_clear_condition_special_battle),
        requiredCrewHonors: parseInt(String(raw.specialbattle_info?.special_battle_contribution_point || '400000'), 10)
      },
      missions
    };
  }

  /**
   * Executes a single Dread Barrage raid battle from supporter selection to completion.
   */
  public async executeSingleRaid(params: {
    questId: string;
    questName: string;
    strategy: DreadBarrageCombatStrategy;
    supporterPriorities: string[];
    autoReplenishAp: boolean;
  }): Promise<{ cleared: boolean; durationMs: number }> {
    const startTime = Date.now();
    await this.sentinel.assertSafe();

    const questUrl = buildDreadBarrageSupporterUrl(params.questId);
    const routerPath = `quest/supporter/${params.questId}/1`;

    // Step 1: Route to supporter selection screen
    let supporterReady = false;
    const tRoute = Date.now();
    while (Date.now() - tRoute < 8500) {
      if (this.stopRequested) return { cleared: false, durationMs: Date.now() - startTime };

      // Dismiss release quest / common popups
      const popupDismissed = await this.page.evaluate((releaseSel: string) => {
        const btn = document.querySelector(
          `${releaseSel}, .common-pop-error .btn-usual-ok, .pop-usual.common-pop-error .btn-usual-ok, .pop-usual .btn-usual-ok:not(.se-quest-start)`
        ) as HTMLElement | null;
        if (btn && btn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
          return true;
        }
        return false;
      }, DREAD_BARRAGE_SELECTORS.RELEASE_QUEST_POPUP_CLOSE).catch(() => false);

      if (popupDismissed) {
        await this.sleep(350);
        continue;
      }

      // Check Half-Elixir AP replenish modal
      if (params.autoReplenishAp) {
        const apUsed = await this.page.evaluate(() => {
          const elixirBtn = document.querySelector(
            '.btn-use-item.btn-usual-use, .btn-usual-ok.se-use, .btn-use-item'
          ) as HTMLElement | null;
          if (elixirBtn && elixirBtn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(elixirBtn).trigger('tap');
            elixirBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (apUsed) {
          console.log(`[DreadBarrageEngine]  🧪 Replenished AP with Half-Elixir.`);
          await this.sleep(350);
          continue;
        }
      }

      const cardCount = await this.page.evaluate(() => {
        return document.querySelectorAll('.lis-supporter').length;
      }).catch(() => 0);

      if (cardCount > 0) {
        supporterReady = true;
        break;
      }

      await this.page.evaluate((path: string) => {
        if ((window as any).Game?.router) {
          (window as any).Game.router.navigate(path, { trigger: true });
        } else {
          window.location.hash = `#${path}`;
        }
      }, routerPath).catch(() => null);

      await this.sleep(120);
    }

    if (!supporterReady) {
      await this.page.goto(questUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      await this.sleep(900);
    }

    // Step 2: Select Supporter Summon
    await this.page.evaluate((priorities: string[]) => {
      const cards = Array.from(document.querySelectorAll('.lis-supporter')) as HTMLElement[];
      for (const prior of priorities) {
        const match = cards.find(c => (c.textContent || '').toLowerCase().includes(prior.toLowerCase()));
        if (match) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(match).trigger('tap');
          match.click();
          return prior;
        }
      }
      if (cards[0]) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(cards[0]).trigger('tap');
        cards[0].click();
        return 'First Available';
      }
      return null;
    }, params.supporterPriorities).catch(() => null);

    // Step 3: Click Party OK (.se-quest-start)
    const tOk = Date.now();
    let partyConfirmed = false;
    while (Date.now() - tOk < 4500) {
      if (this.stopRequested) return { cleared: false, durationMs: Date.now() - startTime };

      if (params.autoReplenishAp) {
        const apUsed = await this.page.evaluate(() => {
          const elixirBtn = document.querySelector(
            '.btn-use-item.btn-usual-use, .btn-usual-ok.se-use, .btn-use-item'
          ) as HTMLElement | null;
          if (elixirBtn && elixirBtn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(elixirBtn).trigger('tap');
            elixirBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (apUsed) {
          await this.sleep(300);
          continue;
        }
      }

      const clicked = await this.page.evaluate(() => {
        const ok = document.querySelector(
          '.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle'
        ) as HTMLElement | null;
        if (ok && ok.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        partyConfirmed = true;
        break;
      }

      await this.sleep(60);
    }

    if (!partyConfirmed) {
      return { cleared: false, durationMs: Date.now() - startTime };
    }

    // Step 4: Wait for Battle Stage to mount
    let battleMounted = false;
    const tBattle = Date.now();
    while (Date.now() - tBattle < 8000) {
      if (this.stopRequested) return { cleared: false, durationMs: Date.now() - startTime };
      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash)) {
        battleMounted = true;
        break;
      }
      if (hash.startsWith('#result')) {
        return { cleared: true, durationMs: Date.now() - startTime };
      }
      await this.sleep(60);
    }

    if (!battleMounted) {
      return { cleared: false, durationMs: Date.now() - startTime };
    }

    // Step 5: Execute Combat Strategy
    if (params.strategy === 'otk_0b' || params.strategy === 'otk_1t') {
      const summonPromise = this.page.waitForResponse(
        r => r.url().includes('summon_result.json') || r.url().includes('normal_attack_result.json'),
        { timeout: 4000 }
      ).catch(() => null);

      const tQs = Date.now();
      while (Date.now() - tQs < 3800) {
        if (this.stopRequested) break;
        const triggered = await this.page.evaluate(() => {
          const ready = document.querySelector('#ready') as HTMLElement | null;
          if (ready && ready.style.display !== 'none') {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ready).trigger('tap');
            ready.click();
          }
          const qs = document.querySelector('#js-btn-quick-summon, .btn-quick-summon') as HTMLElement | null;
          if (qs && (qs.classList.contains('qs-ready') || !qs.classList.contains('qs-hide'))) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(qs).trigger('tap');
            qs.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (triggered) break;
        await this.sleep(45);
      }

      await summonPromise;

      if (params.strategy === 'otk_1t') {
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
        await this.sleep(250);

        const hashAfterQs = await this.page.evaluate(() => window.location.hash).catch(() => '');
        if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(hashAfterQs)) {
          const atkPromise = this.page.waitForResponse(
            r => r.url().includes('normal_attack_result.json'),
            { timeout: 4500 }
          ).catch(() => null);

          const tAtk = Date.now();
          while (Date.now() - tAtk < 4000) {
            if (this.stopRequested) break;
            const attacked = await this.page.evaluate(() => {
              const atk = document.querySelector('.btn-attack-start.display-on, .btn-attack-start') as HTMLElement | null;
              if (atk && atk.offsetParent !== null) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(atk).trigger('tap');
                atk.click();
                return true;
              }
              return false;
            }).catch(() => false);

            if (attacked) break;
            await this.sleep(50);
          }
          await atkPromise;
        }
      }

      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
      return { cleared: true, durationMs: Date.now() - startTime };
    }

    // Strategy: Smart Full Auto (`smart_fa`) for 4★, 5★, Unparalleled Foes, and Valiant Battles
    const tCombat = Date.now();
    let fullAutoActivated = false;
    while (Date.now() - tCombat < 180_000) {
      if (this.stopRequested) break;
      await this.sentinel.assertSafe();

      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (hash.startsWith('#result') || hash.startsWith('#event/teamforce')) {
        break;
      }

      const turnAction = await this.page.evaluate((alreadyFa: boolean) => {
        const $ = (window as any).$ || (window as any).Zepto;
        const tap = (el: HTMLElement | null) => {
          if (!el) return false;
          if ($) $(el).trigger('tap');
          el.click();
          return true;
        };

        // Dismiss #ready or in-battle dialogs
        const ready = document.querySelector('#ready') as HTMLElement | null;
        if (ready && ready.style.display !== 'none') tap(ready);

        const popOk = document.querySelector('.pop-usual .btn-usual-ok, .btn-result') as HTMLElement | null;
        if (popOk && popOk.offsetParent !== null) {
          tap(popOk);
          return 'POPUP';
        }

        // Trigger Quick Summon if ready
        const qs = document.querySelector('#js-btn-quick-summon.qs-ready, .btn-quick-summon.qs-ready') as HTMLElement | null;
        if (qs && qs.offsetParent !== null) {
          tap(qs);
        }

        // Enable Full Auto if not active
        if (!alreadyFa) {
          const faBtn = document.querySelector('.btn-auto') as HTMLElement | null;
          if (faBtn && faBtn.offsetParent !== null) {
            tap(faBtn);
            return 'FA_ENABLED';
          }
        }

        // Fallback: if attack button is visible and FA isn't running, tap Attack
        const atk = document.querySelector('.btn-attack-start.display-on') as HTMLElement | null;
        if (atk && atk.offsetParent !== null && !alreadyFa) {
          tap(atk);
          return 'ATTACK';
        }

        return 'WAITING';
      }, fullAutoActivated).catch(() => 'WAITING');

      if (turnAction === 'FA_ENABLED') {
        fullAutoActivated = true;
      }

      // Wait briefly for normal_attack_result.json to perform reload animation skip
      const attackDone = await this.page.waitForResponse(
        r => r.url().includes('normal_attack_result.json'),
        { timeout: 3500 }
      ).catch(() => null);

      if (attackDone) {
        await this.sleep(350);
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
        await this.sleep(450);
        fullAutoActivated = false;
      } else {
        await this.sleep(300);
      }
    }

    return { cleared: true, durationMs: Date.now() - startTime };
  }

  /**
   * Loops a target Dread Barrage raid tier (`1star` to `5star`), automatically:
   * - Resolving live Quest IDs and Boss Element from `/teamforce/top/content/index`
   * - Falling back to the prerequisite tier if the requested tier is not yet unlocked by the crew
   * - Intercepting and clearing spawned Unparalleled Foes (`poped_extra_enemy_list`) when `autoUnparalleled` is true
   */
  public async runRaidLoop(options: DreadBarrageRaidLoopOptions): Promise<DreadBarrageRaidLoopSummary> {
    const sessionStart = Date.now();
    const autoReplenishAp = options.autoReplenishAp !== false;
    const autoUnparalleled = options.autoUnparalleled !== false;

    let liveState = await this.fetchLiveState();
    const supporterPriorities =
      options.supporterPriorities ||
      (liveState ? ELEMENT_ADVANTAGE_SUMMONS[liveState.advantageElement] : DREAD_BARRAGE_ITERATION_15.supporterPriorities);

    let totalRunsCompleted = 0;
    let unparalleledFoesCleared = 0;
    let estimatedTokensEarned = 0;
    let estimatedHonorsEarned = 0;

    for (let run = 1; run <= options.runs; run++) {
      if (this.stopRequested) break;

      // Refresh live state every 5 runs or at start to detect Unparalleled Foes & tier unlocks
      if (run === 1 || run % 5 === 1) {
        const refreshed = await this.fetchLiveState();
        if (refreshed) liveState = refreshed;
      }

      // 1. Check for spawned Unparalleled Foes (`poped_extra_enemy_list`)
      if (autoUnparalleled && liveState && liveState.unparalleledFoes.length > 0) {
        const openUnparalleled = [...liveState.unparalleledFoes]
          .filter(u => u.isOpen)
          .sort((a, b) => b.level - a.level)[0];

        if (openUnparalleled) {
          console.log(
            `\n🔥 [DreadBarrageEngine] Spawned Unparalleled Foe detected: ${openUnparalleled.questName} (Quest ID: ${openUnparalleled.questId})! Intercepting...`
          );
          const uResult = await this.executeSingleRaid({
            questId: openUnparalleled.questId,
            questName: openUnparalleled.questName,
            strategy: 'smart_fa',
            supporterPriorities,
            autoReplenishAp
          });

          if (uResult.cleared) {
            unparalleledFoesCleared++;
            estimatedTokensEarned += 160;
            estimatedHonorsEarned += 20_000;
            options.onProgress?.({
              run,
              totalRuns: options.runs,
              tier: `Unparalleled Lv${openUnparalleled.level}`,
              questName: openUnparalleled.questName,
              questId: openUnparalleled.questId,
              durationMs: uResult.durationMs,
              tokensEstimated: 160,
              status: 'UNPARALLELED_CLEARED'
            });
            liveState = await this.fetchLiveState();
          }
        }
      }

      if (this.stopRequested) break;

      // 2. Resolve active target tier (with automatic prerequisite fallback if locked)
      let activeTier: DreadBarrageStarTier = options.tier;
      const tierOrder: DreadBarrageStarTier[] = ['1star', '2star', '3star', '4star', '5star'];

      if (liveState && liveState.bosses.length > 0) {
        let desiredBoss = liveState.bosses.find(b => b.tier === activeTier);
        if (desiredBoss && !desiredBoss.isOpen) {
          // Find highest unlocked tier below requested tier
          const reqIdx = tierOrder.indexOf(activeTier);
          for (let i = reqIdx - 1; i >= 0; i--) {
            const candidate = liveState.bosses.find(b => b.tier === tierOrder[i]);
            if (candidate && candidate.isOpen) {
              console.log(
                `[DreadBarrageEngine] ℹ️ ${desiredBoss.categorySymbol} (${desiredBoss.questName}) requires ${desiredBoss.remainClearCountToUnlock ?? '?'} more ${desiredBoss.prerequisiteQuestName || candidate.questName} clears to unlock. Farming ${candidate.categorySymbol} (${candidate.questName})...`
              );
              activeTier = candidate.tier;
              desiredBoss = candidate;
              break;
            }
          }
        }
      }

      const catalogDef = DREAD_BARRAGE_ITERATION_15.raids[activeTier];
      const liveBoss = liveState?.bosses.find(b => b.tier === activeTier);
      const questId = liveBoss?.questId || catalogDef.questId;
      const questName = liveBoss?.questName || catalogDef.bossName;
      const strategy = options.strategy || catalogDef.recommendedStrategy;

      const result = await this.executeSingleRaid({
        questId,
        questName,
        strategy,
        supporterPriorities,
        autoReplenishAp
      });

      if (result.cleared) {
        totalRunsCompleted++;
        estimatedTokensEarned += catalogDef.tokensSoloTotal;
        estimatedHonorsEarned += catalogDef.soloHonors;
        options.onProgress?.({
          run,
          totalRuns: options.runs,
          tier: catalogDef.categorySymbol,
          questName,
          questId,
          durationMs: result.durationMs,
          tokensEstimated: catalogDef.tokensSoloTotal,
          status: 'CLEARED'
        });
      } else {
        options.onProgress?.({
          run,
          totalRuns: options.runs,
          tier: catalogDef.categorySymbol,
          questName,
          questId,
          durationMs: result.durationMs,
          tokensEstimated: 0,
          status: 'ERROR'
        });
      }
    }

    return {
      requestedTier: options.tier,
      totalRunsCompleted,
      unparalleledFoesCleared,
      estimatedTokensEarned,
      estimatedHonorsEarned,
      totalDurationMs: Date.now() - sessionStart,
      status: this.stopRequested ? 'STOPPED_BY_USER' : 'COMPLETED'
    };
  }

  /**
   * Automatically completes all individual ★, ★★, and ★★★ clear count missions (up to 20 clears each).
   */
  public async runMissionSweep(options?: { autoReplenishAp?: boolean }): Promise<void> {
    const state = await this.fetchLiveState();
    if (!state) {
      console.warn('[DreadBarrageEngine] Could not fetch live Dread Barrage state for mission sweep.');
      return;
    }

    const missionIdToTier: Record<string, DreadBarrageStarTier> = {
      '1': '1star',
      '2': '2star',
      '3': '3star'
    };

    for (const mission of state.missions) {
      if (this.stopRequested) break;
      if (mission.type !== 'individual') continue;
      const tier = missionIdToTier[mission.missionId];
      if (!tier) continue;

      if (mission.isAllComplete) {
        console.log(`[DreadBarrageEngine] ✅ Mission #${mission.missionId} (${tier.toUpperCase()}) is already 100% complete!`);
        continue;
      }

      const boss = state.bosses.find(b => b.tier === tier);
      if (boss && !boss.isOpen) {
        console.log(`[DreadBarrageEngine] ⚠️ Skipping Mission #${mission.missionId} (${tier.toUpperCase()}) — tier not unlocked yet.`);
        continue;
      }

      // Each individual mission maxes out at 20 clears across 4 star levels (5, 10, 15, 20)
      const remainingTo20 = Math.max(1, 20 - (boss?.clearCount || mission.progress || 0));
      console.log(
        `[DreadBarrageEngine] 🎯 Sweeping Mission #${mission.missionId} (${tier.toUpperCase()} - ${boss?.questName}): running ${remainingTo20} clear(s)...`
      );

      await this.runRaidLoop({
        tier,
        runs: remainingTo20,
        autoReplenishAp: options?.autoReplenishAp !== false,
        autoUnparalleled: true,
        onProgress: (p) => {
          console.log(
            `[DreadBarrageEngine] ⚡ [Mission ${tier.toUpperCase()} ${p.run}/${p.totalRuns}] ${p.questName} cleared in ${(p.durationMs / 1000).toFixed(2)}s`
          );
        }
      });
    }
  }

  /**
   * Checks for and clears any active Unparalleled Foes (`poped_extra_enemy_list`).
   */
  public async runClearUnparalleledFoes(options?: {
    maxClears?: number;
    autoReplenishAp?: boolean;
  }): Promise<number> {
    const maxClears = options?.maxClears || 2;
    let clearedCount = 0;

    for (let i = 0; i < maxClears; i++) {
      if (this.stopRequested) break;
      const state = await this.fetchLiveState();
      if (!state || state.unparalleledFoes.length === 0) {
        console.log('[DreadBarrageEngine] ℹ️ No spawned Unparalleled Foes currently active.');
        break;
      }

      const highest = [...state.unparalleledFoes]
        .filter(u => u.isOpen)
        .sort((a, b) => b.level - a.level)[0];

      if (!highest) {
        console.log('[DreadBarrageEngine] ℹ️ No open Unparalleled Foe found.');
        break;
      }

      console.log(
        `[DreadBarrageEngine] 🔥 Hosting Unparalleled Foe #${i + 1}: ${highest.questName} (Quest ID: ${highest.questId}, 0 AP)...`
      );
      const supporterPriorities = ELEMENT_ADVANTAGE_SUMMONS[state.advantageElement];
      const res = await this.executeSingleRaid({
        questId: highest.questId,
        questName: highest.questName,
        strategy: 'smart_fa',
        supporterPriorities,
        autoReplenishAp: options?.autoReplenishAp !== false
      });

      if (res.cleared) {
        clearedCount++;
        console.log(
          `[DreadBarrageEngine] ✅ Cleared Unparalleled Foe ${highest.questName} in ${(res.durationMs / 1000).toFixed(1)}s!`
        );
      } else {
        break;
      }
    }

    return clearedCount;
  }

  /**
   * Initiates and clears the Valiant Battle (`specialbattle_info` / `.btn-valiant-battle`) if unlocked.
   */
  public async runClearValiantBattle(options?: { autoReplenishAp?: boolean }): Promise<boolean> {
    const state = await this.fetchLiveState();
    if (!state) return false;

    if (!state.valiantBattle.isTermStart || !state.valiantBattle.isConditionCleared) {
      console.log(
        `[DreadBarrageEngine] ℹ️ Valiant Battle not currently available (Term Started: ${state.valiantBattle.isTermStart}, Crew Honor Condition Met: ${state.valiantBattle.isConditionCleared}).`
      );
      return false;
    }

    console.log('[DreadBarrageEngine] 👑 Valiant Battle is UNLOCKED! Navigating to #event/teamforce...');
    await this.page.evaluate(() => {
      window.location.hash = '#event/teamforce';
    }).catch(() => null);
    await this.sleep(1500);

    // Click .btn-valiant-battle -> .pop-valiant-battle .btn-usual-ok -> .pop-attribute-description .btn-usual-ok
    const startedValiant = await this.page.evaluate((sels) => {
      const $ = (window as any).$ || (window as any).Zepto;
      const tap = (el: HTMLElement | null) => {
        if (!el) return false;
        if ($) $(el).trigger('tap');
        el.click();
        return true;
      };
      const btn = document.querySelector(sels.VALIANT_BATTLE_BTN) as HTMLElement | null;
      return tap(btn);
    }, DREAD_BARRAGE_SELECTORS).catch(() => false);

    if (!startedValiant) {
      console.log('[DreadBarrageEngine] ℹ️ Valiant Battle button (.btn-valiant-battle) not found on top page.');
      return false;
    }

    await this.sleep(700);
    for (let step = 0; step < 6; step++) {
      await this.page.evaluate((sels) => {
        const $ = (window as any).$ || (window as any).Zepto;
        const ok = document.querySelector(
          `${sels.VALIANT_POPUP_OK}, ${sels.VALIANT_ATTR_POPUP_OK}, .pop-usual .btn-usual-ok`
        ) as HTMLElement | null;
        if (ok && ok.offsetParent !== null) {
          if ($) $(ok).trigger('tap');
          ok.click();
        }
      }, DREAD_BARRAGE_SELECTORS).catch(() => null);
      await this.sleep(500);

      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (hash.includes('#quest/supporter')) {
        const qMatch = hash.match(/#quest\/supporter\/(\d+)/);
        if (qMatch) {
          const res = await this.executeSingleRaid({
            questId: qMatch[1],
            questName: 'Valiant Battle',
            strategy: 'smart_fa',
            supporterPriorities: ELEMENT_ADVANTAGE_SUMMONS[state.advantageElement],
            autoReplenishAp: options?.autoReplenishAp !== false
          });
          return res.cleared;
        }
      }
    }

    return false;
  }

  /**
   * Claims all available Battle Badge (`defeat`) and Crew/Individual Honor (`point`) rewards
   * via REST endpoints and `#event/teamforce/reward` DOM fallback.
   */
  public async runClaimRewards(): Promise<DreadBarrageRewardClaimSummary> {
    const startTime = Date.now();
    await this.sentinel.assertSafe();

    console.log('[DreadBarrageEngine] 🎁 Checking claimable Battle Badge & Honor rewards...');

    const restResult = await this.page.evaluate(async (endpoints) => {
      const ver = (window as any).Game?.version || '';
      const uid = (window as any).Game?.userId || '';
      const headers: Record<string, string> = {
        'X-Version': ver,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json'
      };

      let defeatCount = 0;
      let pointCount = 0;

      try {
        const rDef = await fetch(`${endpoints.DEFEAT_REWARD_LIST}/1?_=${Date.now()}&uid=${uid}`, { headers });
        if (rDef.ok) {
          const jDef = await rDef.json();
          defeatCount = Number(jDef.can_receive_count || 0);
          if (defeatCount > 0) {
            await fetch(`${endpoints.RECEIVE_ALL_DEFEAT_REWARD}?_=${Date.now()}&uid=${uid}`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ special_token: null })
            });
          }
        }
      } catch {}

      try {
        const rPt = await fetch(`${endpoints.POINT_REWARD_LIST}/1?_=${Date.now()}&uid=${uid}`, { headers });
        if (rPt.ok) {
          const jPt = await rPt.json();
          pointCount = Number(jPt.can_receive_count || 0);
          if (pointCount > 0) {
            await fetch(`${endpoints.RECEIVE_ALL_POINT_REWARD}?_=${Date.now()}&uid=${uid}`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ special_token: null })
            });
          }
        }
      } catch {}

      return { defeatCount, pointCount };
    }, DREAD_BARRAGE_API_ENDPOINTS).catch(() => ({ defeatCount: 0, pointCount: 0 }));

    console.log(
      `[DreadBarrageEngine] ✅ Claimed ${restResult.defeatCount} Battle Badge reward(s) and ${restResult.pointCount} Honor reward(s)!`
    );

    return {
      defeatRewardsClaimed: restResult.defeatCount,
      pointRewardsClaimed: restResult.pointCount,
      totalDurationMs: Date.now() - startTime
    };
  }

  /**
   * Empties Dread Barrage Token Drawboxes on `#event/teamforce/gacha`.
   * Supports Bulk Box Draw (`.btn-bulk-play-box`), Use All (`.btn-use-all`), Multi-Draw (`.btn-bulk-play`),
   * and automatic Box Reset (`.btn-reset` -> `.pop-reset-confirm .btn-usual-ok`).
   */
  public async runClearTokenGacha(options?: {
    maxBoxes?: number;
    onProgress?: (p: {
      boxNumber: number;
      drawsExecuted: number;
      tokensRemaining: number | null;
      action: string;
    }) => void;
  }): Promise<DreadBarrageGachaSummary> {
    const startTime = Date.now();
    const maxBoxes = options?.maxBoxes || 100;
    let boxesCleared = 0;
    let drawsExecuted = 0;
    let tokensRemaining: number | null = null;

    await this.sentinel.assertSafe();

    // Pre-check if `/teamforce/gacha/content/index` redirects to `#event/teamforce/gacha_setting`
    const gachaProbe = await this.page.evaluate(async (ep: string) => {
      try {
        const ver = (window as any).Game?.version || '';
        const uid = (window as any).Game?.userId || '';
        const r = await fetch(`${ep}?_=${Date.now()}&uid=${uid}`, {
          headers: { 'X-Version': ver, 'X-Requested-With': 'XMLHttpRequest' }
        });
        return await r.json();
      } catch {
        return null;
      }
    }, DREAD_BARRAGE_API_ENDPOINTS.GACHA_CONTENT).catch(() => null);

    if (gachaProbe?.redirect && String(gachaProbe.redirect).includes('gacha_setting')) {
      console.warn(
        '\n⚠️ [DreadBarrageEngine] Token Drawbox requires selecting a Reset Target (Revenant Weapon / New World Quartz / Crystallized Core) at #event/teamforce/gacha_setting first!'
      );
      return {
        boxesCleared: 0,
        drawsExecuted: 0,
        tokensRemaining: null,
        redirectedToSetting: true,
        totalDurationMs: Date.now() - startTime,
        status: 'NEEDS_WEAPON_SETTING'
      };
    }

    // Navigate to #event/teamforce/gacha
    await this.page.evaluate(() => {
      window.location.hash = '#event/teamforce/gacha';
    }).catch(() => null);
    await this.sleep(1500);

    for (let cycle = 1; cycle <= maxBoxes * 25; cycle++) {
      if (this.stopRequested) {
        return {
          boxesCleared,
          drawsExecuted,
          tokensRemaining,
          redirectedToSetting: false,
          totalDurationMs: Date.now() - startTime,
          status: 'STOPPED_BY_USER'
        };
      }

      await this.sentinel.assertSafe();

      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (hash.includes('gacha_setting')) {
        return {
          boxesCleared,
          drawsExecuted,
          tokensRemaining,
          redirectedToSetting: true,
          totalDurationMs: Date.now() - startTime,
          status: 'NEEDS_WEAPON_SETTING'
        };
      }

      // If on gacha_result or gacha_action, return or click draw again
      const stepOutcome = await this.page.evaluate((sels) => {
        const $ = (window as any).$ || (window as any).Zepto;
        const tap = (el: HTMLElement | null) => {
          if (!el || el.offsetParent === null) return false;
          if ($) $(el).trigger('tap');
          el.click();
          return true;
        };

        // Read token count if visible
        const tokenEl = document.querySelector(sels.GACHA_TOKEN_COUNT);
        const tokenText = tokenEl?.textContent?.replace(/,/g, '').trim() || '';
        const tokens = tokenText && /^\d+$/.test(tokenText) ? parseInt(tokenText, 10) : null;

        // 1. Confirm reset modal if open
        const resetConfirmOk = document.querySelector(sels.GACHA_RESET_CONFIRM_OK) as HTMLElement | null;
        if (tap(resetConfirmOk)) return { action: 'RESET_CONFIRMED', tokens };

        const resetDoneOk = document.querySelector(sels.GACHA_RESET_DONE_OK) as HTMLElement | null;
        if (tap(resetDoneOk)) return { action: 'RESET_DONE', tokens };

        const genericPopupOk = document.querySelector('.pop-usual .btn-usual-ok') as HTMLElement | null;
        if (tap(genericPopupOk)) return { action: 'POPUP_OK', tokens };

        // 2. Priority: Bulk Box Play -> Use All -> Bulk Play -> Single Play
        const bulkBoxBtn = document.querySelector(sels.GACHA_BULK_BOX_BTN) as HTMLElement | null;
        if (tap(bulkBoxBtn)) return { action: 'BULK_BOX_DRAW', tokens };

        const useAllBtn = document.querySelector(sels.GACHA_USE_ALL_BTN) as HTMLElement | null;
        if (tap(useAllBtn)) return { action: 'USE_ALL_DRAW', tokens };

        const bulkPlayBtn = document.querySelector(sels.GACHA_BULK_PLAY_BTN) as HTMLElement | null;
        if (tap(bulkPlayBtn)) return { action: 'BULK_DRAW', tokens };

        const playBtn = document.querySelector(sels.GACHA_PLAY_BTN) as HTMLElement | null;
        if (tap(playBtn)) return { action: 'SINGLE_DRAW', tokens };

        // 3. Reset box if draw buttons are disabled and reset is available
        const resetBtn = document.querySelector(sels.GACHA_RESET_BTN) as HTMLElement | null;
        if (tap(resetBtn)) return { action: 'RESET_INITIATED', tokens };

        // 4. If on gacha_result, return to #event/teamforce/gacha
        if (window.location.hash.includes('gacha_result') || window.location.hash.includes('gacha_action')) {
          window.location.hash = '#event/teamforce/gacha';
          return { action: 'RETURN_TO_GACHA', tokens };
        }

        return { action: 'NONE', tokens };
      }, DREAD_BARRAGE_SELECTORS).catch(() => ({ action: 'NONE', tokens: null }));

      if (stepOutcome.tokens !== null) {
        tokensRemaining = stepOutcome.tokens;
      }

      if (stepOutcome.action === 'NONE') {
        break;
      }

      if (
        stepOutcome.action === 'BULK_BOX_DRAW' ||
        stepOutcome.action === 'USE_ALL_DRAW' ||
        stepOutcome.action === 'BULK_DRAW' ||
        stepOutcome.action === 'SINGLE_DRAW'
      ) {
        drawsExecuted++;
        if (stepOutcome.action === 'BULK_BOX_DRAW') boxesCleared++;
      } else if (stepOutcome.action === 'RESET_CONFIRMED') {
        boxesCleared++;
      }

      options?.onProgress?.({
        boxNumber: boxesCleared + 1,
        drawsExecuted,
        tokensRemaining,
        action: stepOutcome.action
      });

      if (boxesCleared >= maxBoxes) break;
      await this.sleep(850);
    }

    return {
      boxesCleared,
      drawsExecuted,
      tokensRemaining,
      redirectedToSetting: false,
      totalDurationMs: Date.now() - startTime,
      status: boxesCleared >= maxBoxes ? 'COMPLETED' : 'DEPLETED'
    };
  }

  /**
   * Executes the full end-to-end Dread Barrage pipeline:
   * 1. Live Status & Mission Audit
   * 2. Individual Mission Sweep (1★, 2★, 3★ up to 20 clears if incomplete)
   * 3. Main Raid Farming Loop (`tier`, with automatic Unparalleled Foe interception)
   * 4. Unparalleled Foe Sweep (daily hosts)
   * 5. Valiant Battle Check & Clear
   * 6. Claim All Battle Badge & Honor Rewards
   * 7. Empty Token Drawboxes
   */
  public async runFullPipeline(options: {
    tier?: DreadBarrageStarTier;
    runs?: number;
    sweepMissions?: boolean;
    clearGacha?: boolean;
    autoReplenishAp?: boolean;
  }): Promise<void> {
    const tier = options.tier || '4star';
    const runs = options.runs || 50;
    const autoReplenishAp = options.autoReplenishAp !== false;

    console.log('\n========================================================================');
    console.log('         🚀 Dread Barrage Full Autonomous Pipeline Starting             ');
    console.log('========================================================================');

    // Phase 1: Live Status Audit
    const state = await this.fetchLiveState();
    if (state) {
      console.log(`Event ID:             ${state.eventId} (${state.bossElement.toUpperCase()} Boss / ${state.advantageElement.toUpperCase()} Adv)`);
      console.log(`Individual Honors:    ${state.userHonors.toLocaleString()} pt`);
      console.log(`Crew Honors:          ${state.crewHonors.toLocaleString()} pt`);
      console.log(`Valor Badges:         ${state.valorBadges.toLocaleString()}`);
      console.log(`Victory Certificates: ${state.victoryCertificates.toLocaleString()}`);
      console.log(`Spawned Unparalleled: ${state.unparalleledFoes.length}`);
      console.log('------------------------------------------------------------------------');
    }

    // Phase 2: Mission Sweep
    if (options.sweepMissions !== false && !this.stopRequested) {
      console.log('\n[Phase 2/6] 🎯 Checking Individual Quest Clear Missions (★, ★★, ★★★)...');
      await this.runMissionSweep({ autoReplenishAp });
    }

    // Phase 3: Main Raid Farming Loop
    if (!this.stopRequested && runs > 0) {
      console.log(`\n[Phase 3/6] ⚔️ Running Main Dread Barrage Raid Loop (${tier.toUpperCase()} x ${runs})...`);
      await this.runRaidLoop({
        tier,
        runs,
        autoReplenishAp,
        autoUnparalleled: true,
        onProgress: (p) => {
          console.log(
            `[DreadBarrage] ⚡ [${p.run}/${p.totalRuns}] ${p.tier} ${p.questName} cleared in ${(p.durationMs / 1000).toFixed(2)}s (~${p.tokensEstimated} tokens)`
          );
        }
      });
    }

    // Phase 4: Unparalleled Foe Sweep
    if (!this.stopRequested) {
      console.log('\n[Phase 4/6] 🔥 Checking Spawned Unparalleled Foes...');
      await this.runClearUnparalleledFoes({ maxClears: 2, autoReplenishAp });
    }

    // Phase 5: Valiant Battle Check
    if (!this.stopRequested) {
      console.log('\n[Phase 5/6] 👑 Checking Valiant Battle Availability...');
      await this.runClearValiantBattle({ autoReplenishAp });
    }

    // Phase 6: Claim Rewards & Token Drawbox
    if (!this.stopRequested) {
      console.log('\n[Phase 6/6] 🎁 Claiming Battle Badge & Honor Rewards...');
      await this.runClaimRewards();

      if (options.clearGacha !== false) {
        console.log('\n[Phase 6/6] 📦 Clearing Token Drawboxes...');
        await this.runClearTokenGacha({ maxBoxes: 50 });
      }
    }
  }
}
