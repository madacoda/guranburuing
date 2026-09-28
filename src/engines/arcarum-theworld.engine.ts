/**
 * @file arcarum-theworld.engine.ts
 * @description Automated combat engine for Arcarum / Replicard Sandbox: The World (Zone Mundus).
 * 
 * ### Key Features:
 * 1. **Replicard Quest Lifecycle**:
 *    - Direct entry at `#replicard/supporter/10/10/16/819131/25/0/25085`.
 *    - Automatic AAP (Arcarum Action Points) detection and replenishment.
 *    - Direct quest start handling via `.btn-usual-ok.se-quest-start`.
 * 
 * 2. **Omen Plain Damage Counter (Beelzebub Summon)**:
 *    - Scans DOM and combat telemetry for the omen: "Deal 1,000,000 plain damage"
 *      (無属性ダメージを1,000,000与える / 1,000,000 plain DMG).
 *    - Automatically identifies and calls Beelzebub summon to deal 3,000,000 plain damage,
 *      instantly canceling the omen.
 *    - F5 reload skips the summon cutscene.
 * 
 * 3. **Biomechanical Skill & Attack Execution**:
 *    - Dual-mode support: Full Auto (`full_auto`) or sequential Left-to-Right skills (`manual_skills`).
 *    - Natural human motor simulation: randomized delay, Gaussian spatial jitter, and reaction times.
 *    - Randomized direct attack: occasionally (~18% chance) skips skills and directly clicks attack.
 *    - Turn animation skip: 94% of turns reload (F5) right after attack dispatches,
 *      with a rare 6% chance to let the animation play naturally.
 * 
 * 4. **Sentinel Watchdog**:
 *    - Immediate detection and handling of GBF verification challenges (CAPTCHAs).
 * 
 * 5. **Battle Logging**:
 *    - Records battle duration, turns taken, drops, and run statistics to `logs/arcarum-theworld.md`.
 */

import { Page, HTTPResponse } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, randomDelay, logNormalDelay, humanReactionDelay } from '../human-motor.js';

export interface TheWorldOptions {
  /** Number of runs to execute (default: Infinity) */
  runs?: number;
  /** Automatically consume Half Elixir/Elixirs if AAP is depleted (default: true) */
  autoReplenishAap?: boolean;
  /** Combat execution mode: 'full_auto' | 'manual_skills' (default: 'full_auto') */
  mode?: 'full_auto' | 'manual_skills';
  /** Path to save run logs (default: 'logs/arcarum-theworld.md') */
  logPath?: string;
}

export interface TheWorldRunResult {
  runNumber: number;
  success: boolean;
  turnsElapsed: number;
  durationMs: number;
  itemsLooted: string[];
  message: string;
}

export interface TheWorldSummary {
  totalRunsCompleted: number;
  totalTurns: number;
  averageTurnsPerRun: string;
  totalDurationMs: number;
  logPath: string;
}

export class ArcarumTheWorldEngine {
  private stopRequested = false;
  private currentTurn = 1;
  private attackDispatched = false;
  private summonDispatched = false;
  private latestRewardData: any = null;
  private responseListenerInitialized = false;

  private readonly QUEST_URL = 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/16/819131/25/0/25085';

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog = new SentinelWatchdog(page)
  ) {}

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Main continuous loop for The World battle farming.
   */
  public async runTheWorldLoop(options: TheWorldOptions = {}): Promise<TheWorldSummary> {
    const {
      runs = Infinity,
      autoReplenishAap = true,
      mode = 'full_auto',
      logPath = 'logs/arcarum-theworld.md'
    } = options;

    const startTime = Date.now();
    let totalCompleted = 0;
    let totalTurns = 0;
    this.stopRequested = false;

    this.ensureLogDirExists(logPath);
    this.setupResponseListener();

    console.log(`\n========================================================================`);
    console.log(`           Arcarum: The World Automated Battle Hunter                   `);
    console.log(`                   (Zone Mundus / Quest 819131)                         `);
    console.log(`========================================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
    console.log(`Combat Mode:          ${mode === 'full_auto' ? 'Full Auto with Omen Counters' : 'Sequential Left-to-Right Skills'}`);
    console.log(`Auto Replenish AAP:   ${autoReplenishAap ? 'Enabled (Half Elixir / Elixir)' : 'Disabled'}`);
    console.log(`Omen Counter:         Beelzebub Summon on 1,000,000 Plain Damage Omen`);
    console.log(`Animation Skip:       Fast F5 reload on ~94% of attack turns (6% natural variance)`);
    console.log(`Log Destination:      ${logPath}`);
    console.log(`========================================================================\n`);

    while (totalCompleted < runs && !this.stopRequested) {
      const runNumber = totalCompleted + 1;
      const runStartTime = Date.now();

      console.log(`\n------------------------------------------------------------------------`);
      console.log(`[ArcarumTheWorld] [Run ${runNumber}] Initiating The World Battle...`);
      console.log(`------------------------------------------------------------------------`);

      await this.sentinel.assertSafe();

      // 1. Navigate to Replicard Supporter Screen & Start Quest
      const started = await this.startQuest(autoReplenishAap);
      if (!started) {
        if (this.stopRequested) break;
        console.warn(`[ArcarumTheWorld] [Run ${runNumber}] Failed to start quest. Retrying in 4s...`);
        await logNormalDelay(4000, 0.15);
        continue;
      }

      await this.sentinel.assertSafe();

      // 2. Execute Combat Turns until Boss is Defeated
      console.log(`[ArcarumTheWorld] [Run ${runNumber}] Entering combat stage...`);
      const combatResult = await this.executeCombatStage(runNumber, mode);

      if (!combatResult.success) {
        console.warn(`[ArcarumTheWorld] [Run ${runNumber}] Combat finished with status: ${combatResult.message}`);
      }

      // 3. Handle Result Screen & Log Loot
      const lootItems = await this.handleResultScreen();

      totalCompleted++;
      totalTurns += combatResult.turnsElapsed;

      const runElapsedSec = ((Date.now() - runStartTime) / 1000).toFixed(1);
      console.log(`[ArcarumTheWorld] [Run ${totalCompleted}] Cleared in ${runElapsedSec}s (${combatResult.turnsElapsed} turns) | Loot: ${lootItems.length > 0 ? lootItems.join(', ') : 'Collected'}`);

      // Append battle log
      await this.appendLogEntry(logPath, {
        runNumber: totalCompleted,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        turns: combatResult.turnsElapsed,
        durationSec: runElapsedSec,
        loot: lootItems
      });

      await logNormalDelay(1500, 0.15);
    }

    console.log(`\n[ArcarumTheWorld] Farming session concluded. Returning to #mypage...`);
    await this.page.evaluate(() => { window.location.hash = '#mypage'; }).catch(() => null);

    const totalDurationMs = Date.now() - startTime;
    return {
      totalRunsCompleted: totalCompleted,
      totalTurns,
      averageTurnsPerRun: totalCompleted > 0 ? (totalTurns / totalCompleted).toFixed(1) : '0',
      totalDurationMs,
      logPath
    };
  }

  /**
   * Navigates to the Replicard supporter screen, recovers AAP if needed, and clicks Quest Start.
   */
  private async startQuest(autoReplenishAap: boolean): Promise<boolean> {
    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');

    // If an in-progress battle is already active, resume combat directly
    if (currentHash.includes('raid') || currentHash.includes('battle')) {
      console.log('[ArcarumTheWorld] Active battle already in progress. Resuming combat stage directly...');
      return true;
    }

    // Dismiss any existing result screen before navigating
    if (currentHash.includes('result') || currentHash.includes('empty')) {
      const okBtn = await this.page.$('.btn-usual-ok, .btn-result-close, .btn-control.location-href');
      if (okBtn) {
        await humanizedClick(this.page, okBtn);
        await logNormalDelay(1000, 0.15);
      }
    }

    if (!currentHash.includes('replicard/supporter/10/10/16/819131')) {
      console.log('[ArcarumTheWorld] Navigating to The World supporter screen (#replicard/supporter/10/10/16/819131/25/0/25085)...');
      await this.page.goto(this.QUEST_URL, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1800, 0.15);
    }

    await this.sentinel.assertSafe();

    // Check for AAP recovery modal on entry
    await this.handleAapRecoveryModal(autoReplenishAap);

    // Wait for Quest Start button (.btn-usual-ok.se-quest-start)
    const questStartBtn = await this.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok', {
      visible: true,
      timeout: 10000
    }).catch(() => null);

    if (!questStartBtn) {
      console.warn('[ArcarumTheWorld] Quest Start button not found on supporter screen.');
      return false;
    }

    console.log('[ArcarumTheWorld] Clicking Quest Start...');
    await humanReactionDelay(300, 0.20);
    await humanizedClick(this.page, questStartBtn);
    await randomDelay(800, 1200);

    // Check if AAP modal popped up after clicking Quest Start
    await this.handleAapRecoveryModal(autoReplenishAap);

    return true;
  }

  /**
   * Detects and handles AAP (Arcarum Action Points) deficiency modal.
   */
  private async handleAapRecoveryModal(autoReplenishAap: boolean): Promise<boolean> {
    try {
      const isAapModal = await this.page.evaluate(() => {
        const pop = document.querySelector('.pop-usual');
        if (!pop) return false;
        const text = (pop as HTMLElement).innerText || '';
        return text.includes('AAP') || text.includes('回復') || text.includes('recover') || !!pop.querySelector('.btn-use-item');
      });

      if (!isAapModal) return false;

      console.log('[ArcarumTheWorld] AAP recovery modal detected.');
      if (!autoReplenishAap) {
        console.warn('[ArcarumTheWorld] AAP replenishment is disabled. Stopping run.');
        const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel');
        if (cancelBtn) await humanizedClick(this.page, cancelBtn);
        return false;
      }

      console.log('[ArcarumTheWorld] Consuming item to restore AAP...');
      const useItemBtn = await this.page.waitForSelector('.pop-usual .btn-use-item', { visible: true, timeout: 5000 }).catch(() => null);
      if (useItemBtn) {
        await humanReactionDelay(250, 0.18);
        await humanizedClick(this.page, useItemBtn);
        await randomDelay(700, 1000);

        const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 5000 }).catch(() => null);
        if (confirmBtn) {
          await humanReactionDelay(250, 0.18);
          await humanizedClick(this.page, confirmBtn);
          await logNormalDelay(1000, 0.15);
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Executes the turn-by-turn combat stage until The World is defeated.
   */
  private async executeCombatStage(runNumber: number, mode: 'full_auto' | 'manual_skills'): Promise<{ success: boolean; turnsElapsed: number; message: string }> {
    // 1. Wait for combat HUD
    console.log(`[ArcarumTheWorld] [Run ${runNumber}] Waiting for combat HUD...`);
    const hudReady = await this.waitForCombatHudReady(25000);
    if (!hudReady) {
      if (await this.isBattleEnded()) {
        return { success: true, turnsElapsed: 0, message: 'Battle completed before HUD mount.' };
      }
      return { success: false, turnsElapsed: 0, message: 'Timed out waiting for combat HUD.' };
    }

    let turnsIssued = 0;
    const maxTurns = 30; // Safety turn cap

    while (turnsIssued < maxTurns && !this.stopRequested) {
      await this.sentinel.assertSafe();

      // Check if battle already concluded
      if (await this.isBattleEnded()) {
        console.log(`[ArcarumTheWorld] [Run ${runNumber}] The World defeated! Proceeding to result...`);
        return { success: true, turnsElapsed: turnsIssued, message: 'Boss defeated.' };
      }

      // Dismiss any lingering popup (e.g. "This skill can't be used at this time")
      const isPopOkVisible = await this.page.evaluate(() => {
        const el = document.querySelector('.pop-usual .btn-usual-ok') as HTMLElement;
        return !!(el && el.offsetParent !== null);
      }).catch(() => false);
      if (isPopOkVisible) {
        const popOk = await this.page.$('.pop-usual .btn-usual-ok');
        if (popOk) {
          await humanizedClick(this.page, popOk);
          await randomDelay(400, 600);
        }
      }

      const turnBeforeAction = await this.getInGameTurn();
      if (turnsIssued > 0 && turnBeforeAction < this.currentTurn) {
        console.log(`[ArcarumTheWorld] [Run ${runNumber}] Turn counter reset from ${this.currentTurn} to ${turnBeforeAction}. Battle concluded!`);
        return { success: true, turnsElapsed: turnsIssued, message: 'Boss defeated.' };
      }
      this.currentTurn = turnBeforeAction;
      console.log(`\n[ArcarumTheWorld] [Run ${runNumber}] --- Turn ${this.currentTurn} ---`);

      // 2. Check for "Deal 1,000,000 plain damage" omen
      const omenActive = await this.isPlainDamageOmenActive();
      if (omenActive) {
        console.log(`⚠️ [ArcarumTheWorld] Omen detected: [Deal 1,000,000 Plain Damage]! Checking Beelzebub summon...`);
        const bubsSummoned = await this.executeBeelzebubSummon();
        if (bubsSummoned) {
          console.log(`🎉 [ArcarumTheWorld] Beelzebub summon cast! 3,000,000 Plain Damage dealt. Omen canceled!`);
          // Re-wait for combat HUD after F5 reload from summon
          await this.waitForCombatHudReady(15000);
          if (await this.isBattleEnded()) {
            return { success: true, turnsElapsed: turnsIssued + 1, message: 'Boss defeated by summon.' };
          }
        } else {
          console.log(`[ArcarumTheWorld] Beelzebub is on cooldown or unavailable. Proceeding with turn attacks...`);
        }
      }

      // 3. Decide turn action:
      // User requirement: "sometime just click attack (make randomize and humanize motor about this)"
      this.attackDispatched = false;
      const shouldJustAttack = Math.random() < 0.18; // 18% chance to bypass skills and just attack

      if (shouldJustAttack) {
        console.log(`[ArcarumTheWorld] Natural motor variance: Directly clicking Attack (skipping skills this turn)...`);
        await this.dispatchAttack();
      } else if (mode === 'manual_skills') {
        console.log(`[ArcarumTheWorld] Executing skills left-to-right (Characters 1 to 4)...`);
        await this.executeLeftToRightSkills();
        await this.dispatchAttack();
      } else {
        // Full Auto mode:
        console.log(`[ArcarumTheWorld] Activating Full Auto...`);
        await this.activateFullAutoOrAttack();
      }

      // Wait for attack to be dispatched (Full Auto queues skills first, then attacks)
      console.log(`[ArcarumTheWorld] Waiting for attack dispatch...`);
      await this.waitForAttackResolution(12000);
      turnsIssued++;

      // 4. Animation Skip Reload:
      // User requirement: "every click attack do f5 or reload to skip attack animation (very rarely do not, randomize this)"
      const shouldReloadToSkip = Math.random() < 0.94; // 94% reload, 6% natural playout

      if (shouldReloadToSkip) {
        console.log(`[ArcarumTheWorld] Reloading (F5) to skip attack animation...`);
        await this.page.evaluate(() => location.reload()).catch(() => null);

        // Wait for HUD or result screen after reload
        await this.waitForCombatHudReady(15000);
      } else {
        console.log(`[ArcarumTheWorld] Natural variance: Allowing attack animation to resolve without reload...`);
        await randomDelay(3000, 4500);
      }

      await randomDelay(400, 700);

      if (await this.isBattleEnded()) {
        console.log(`[ArcarumTheWorld] [Run ${runNumber}] The World defeated in ${turnsIssued} turns!`);
        return { success: true, turnsElapsed: turnsIssued, message: 'Boss defeated.' };
      }
    }

    return {
      success: turnsIssued > 0,
      turnsElapsed: turnsIssued,
      message: turnsIssued >= maxTurns ? 'Reached safety turn limit.' : 'Session stopped.'
    };
  }

  /**
   * Scans DOM and combat telemetry for the "Deal 1,000,000 plain damage" omen.
   */
  private async isPlainDamageOmenActive(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        // 1. Check DOM condition elements
        const omenContainers = document.querySelectorAll(
          '.prt-cancel-condition, .prt-condition-detail, .txt-condition, .prt-condition, .prt-special-motion, .pop-target-detail, .prt-boss-condition'
        );

        for (const el of Array.from(omenContainers)) {
          const text = (el as HTMLElement).innerText || '';
          const has1M = text.includes('1,000,000') || text.includes('1000000');
          const hasPlain = text.includes('plain') || text.includes('Plain') || text.includes('無属性');
          if (has1M && hasPlain) return true;
        }

        // 2. Check full page body text for omen phrases
        const bodyText = document.body ? document.body.innerText || '' : '';
        const regex1MPlain = /(?:1,?000,?000[\s\S]{0,40}(?:plain|無属性))|(?:(?:plain|無属性)[\s\S]{0,40}1,?000,?000)/i;
        if (regex1MPlain.test(bodyText)) {
          return true;
        }

        // 3. Check stage.gGameStatus.boss condition if available
        const stage = (window as any).stage;
        const boss = stage?.gGameStatus?.boss?.param?.[0] || stage?.pJsnData?.boss?.param?.[0];
        if (boss?.special_skill) {
          const specStr = JSON.stringify(boss.special_skill);
          if (regex1MPlain.test(specStr)) return true;
        }

        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Locates and calls Beelzebub summon, then F5 reloads to skip summon animation.
   */
  private async executeBeelzebubSummon(): Promise<boolean> {
    try {
      const bubsInfo = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const rawSummons = stage?.pJsnData?.summon || stage?.gGameStatus?.summon || {};
        const summonsList = Array.isArray(rawSummons) ? rawSummons : Object.values(rawSummons);

        let bubsIndex = -1;
        let isAvailable = false;

        summonsList.forEach((s: any, idx: number) => {
          const idStr = String(s?.id || '');
          const nameStr = String(s?.name || '');
          if (idStr === '2040408000' || nameStr.toLowerCase().includes('beelzebub') || nameStr.includes('ベルゼバブ')) {
            bubsIndex = idx;
            isAvailable = s?.available_flag === 1 || s?.available_flag === true || s?.recast === '0' || s?.recast === 0;
          }
        });

        // Also inspect DOM summon cards
        const summonEls = document.querySelectorAll('.lis-summon');
        summonEls.forEach((el, idx) => {
          const img = el.querySelector('img')?.getAttribute('src') || '';
          if (img.includes('2040408000')) {
            bubsIndex = idx;
            if (el.classList.contains('btn-summon-available') || el.classList.contains('on')) {
              isAvailable = true;
            }
          }
        });

        return { bubsIndex, isAvailable };
      });

      if (bubsInfo.bubsIndex === -1) {
        console.warn('[ArcarumTheWorld] Beelzebub summon not found in deck.');
        return false;
      }

      if (!bubsInfo.isAvailable) {
        console.log(`[ArcarumTheWorld] Beelzebub is present (Slot ${bubsInfo.bubsIndex}) but currently on cooldown.`);
        return false;
      }

      console.log(`[ArcarumTheWorld] Calling Beelzebub (Summon Slot ${bubsInfo.bubsIndex})...`);

      // Ensure summon palette is open
      const summonTab = await this.page.$('.prt-list-top.btn-command-summon:not(.summon-on)');
      if (summonTab) {
        await humanizedClick(this.page, summonTab);
        await randomDelay(300, 500);
      }

      // Click Beelzebub summon card
      const summonCards = await this.page.$$('.lis-summon');
      const bubsCard = summonCards[bubsInfo.bubsIndex];
      if (!bubsCard) {
        console.warn(`[ArcarumTheWorld] Beelzebub DOM card at index ${bubsInfo.bubsIndex} not found.`);
        return false;
      }

      await humanReactionDelay(280, 0.20);
      await humanizedClick(this.page, bubsCard);
      await randomDelay(600, 900);

      // Confirm Call if popup appears (.btn-usual-ok or .btn-call or .btn-summon-start)
      const callBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-call, .btn-summon-start, #pop .btn-usual-ok');
      if (callBtn) {
        await humanReactionDelay(250, 0.18);
        await humanizedClick(this.page, callBtn);
        await randomDelay(800, 1200);
      }

      // F5 reload to skip summon animation
      console.log('[ArcarumTheWorld] Beelzebub dispatched. F5 reloading to skip summon animation...');
      await this.page.evaluate(() => location.reload()).catch(() => null);
      await randomDelay(800, 1200);

      return true;
    } catch (err: any) {
      console.warn(`[ArcarumTheWorld] Notice during Beelzebub summon: ${err.message}`);
      return false;
    }
  }

  /**
   * Sequentially clicks available abilities for characters from left to right (Char 0 -> 1 -> 2 -> 3).
   */
  private async executeLeftToRightSkills(): Promise<void> {
    for (let charIndex = 0; charIndex < 4; charIndex++) {
      if (this.stopRequested) break;
      if (await this.isBattleEnded()) break;

      try {
        const charSelector = `.lis-character${charIndex}.btn-command-character, .lis-character${charIndex}`;
        const charEl = await this.page.$(charSelector);
        if (!charEl) continue;

        // Open character ability tray
        await humanReactionDelay(220, 0.18);
        await humanizedClick(this.page, charEl);
        await randomDelay(350, 550);

        // Click available skills one by one by fresh selector query
        for (let abilityNum = 1; abilityNum <= 4; abilityNum++) {
          if (this.stopRequested) break;
          if (await this.isBattleEnded()) break;

          try {
            const abilitySelector = `.ability-character-num-${charIndex + 1}-${abilityNum}:not(.btn-ability-unavailable):not(.empty)`;
            const isAvailable = await this.page.evaluate((sel: string) => {
              const el = document.querySelector(sel) as HTMLElement;
              return el && el.offsetParent !== null && !el.classList.contains('btn-ability-unavailable') && !el.classList.contains('empty');
            }, abilitySelector).catch(() => false);

            if (isAvailable) {
              const skillEl = await this.page.$(abilitySelector).catch(() => null);
              if (skillEl) {
                await humanReactionDelay(200, 0.18);
                await humanizedClick(this.page, skillEl);
                await randomDelay(700, 1100);

                // Check if single-target selection popup appeared
                const targetPopup = await this.page.$('.pop-usual .lis-character1, .pop-usual .btn-command-character, .pop-usual .btn-usual-ok').catch(() => null);
                if (targetPopup) {
                  await humanReactionDelay(220, 0.18);
                  await humanizedClick(this.page, targetPopup);
                  await randomDelay(600, 900);
                }
              }
            }
          } catch {
            // Ignore detached node during re-render
          }
        }

        // Close ability tray or return to main command
        const closeBtn = await this.page.$('.btn-command-back, .ico-back').catch(() => null);
        if (closeBtn) {
          await humanizedClick(this.page, closeBtn);
          await randomDelay(200, 350);
        }
      } catch {
        // Continue to next character
      }
    }

    // Final safety: ensure ability tray is closed and Attack button is exposed
    try {
      const isBackVisible = await this.page.evaluate(() => {
        const el = document.querySelector('.btn-command-back, .ico-back') as HTMLElement;
        return !!(el && el.offsetParent !== null);
      }).catch(() => false);
      if (isBackVisible) {
        const backBtn = await this.page.$('.btn-command-back, .ico-back');
        if (backBtn) {
          await humanizedClick(this.page, backBtn);
          await randomDelay(250, 400);
        }
      }
    } catch {}
  }

  /**
   * Activates Full Auto mode or falls back to Left-to-Right skill execution.
   */
  private async activateFullAutoOrAttack(): Promise<void> {
    try {
      const autoStatus = await this.page.evaluate(() => {
        const el = document.querySelector('.btn-auto');
        if (!el) return { exists: false, isActive: false };
        const isActive = el.classList.contains('active') || el.classList.contains('full');
        return { exists: true, isActive };
      }).catch(() => ({ exists: false, isActive: false }));

      if (autoStatus.exists) {
        if (autoStatus.isActive) {
          return;
        }
        const autoBtn = await this.page.$('.btn-auto');
        if (autoBtn) {
          await humanReactionDelay(250, 0.20);
          await humanizedClick(this.page, autoBtn);
          await randomDelay(800, 1200);
          const didActivate = await this.page.evaluate(() => {
            const el = document.querySelector('.btn-auto');
            return el ? el.classList.contains('active') || el.classList.contains('full') : false;
          }).catch(() => false);
          if (didActivate) {
            console.log('[ArcarumTheWorld] Full Auto engaged.');
            return;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[ArcarumTheWorld] Full Auto check notice: ${err?.message || err}. Falling back...`);
    }

    // Fallback: Execute skills left-to-right, then attack
    console.log('[ArcarumTheWorld] Using sequential Left-to-Right skills...');
    await this.executeLeftToRightSkills();
    await this.dispatchAttack();
  }

  /**
   * Dispatches Attack button click with biomechanical motor simulation.
   */
  private async dispatchAttack(): Promise<void> {
    let atkBtn = await this.page.waitForSelector('.btn-attack-start.display-on, .btn-attack.display-on, .btn-attack-start, .btn-attack', {
      visible: true,
      timeout: 4000
    }).catch(() => null);

    if (!atkBtn) {
      // If ability panel is open, click back to expose attack button
      const backBtn = await this.page.$('.btn-command-back, .ico-back');
      if (backBtn) {
        await humanizedClick(this.page, backBtn);
        await randomDelay(300, 500);
      }
      atkBtn = await this.page.waitForSelector('.btn-attack-start.display-on, .btn-attack.display-on, .btn-attack-start, .btn-attack', {
        visible: true,
        timeout: 4000
      }).catch(() => null);
    }

    if (atkBtn) {
      await humanReactionDelay(240, 0.20);
      await humanizedClick(this.page, atkBtn, { allowMultiClick: true, multiClickChance: 0.35 });
      console.log('[ArcarumTheWorld] Attack command issued.');
      await randomDelay(1000, 1400);
    }
  }

  /**
   * Waits for combat HUD elements to become ready.
   */
  private async waitForCombatHudReady(timeoutMs = 20000): Promise<boolean> {
    const start = Date.now();
    try {
      await this.page.waitForFunction(() => {
        const hasAtk = !!document.querySelector('.btn-attack-start.display-on, .btn-attack.display-on, .btn-attack-start, .btn-attack');
        const hasChara = !!document.querySelector('.lis-character0, .btn-command-character');
        const hasAuto = !!document.querySelector('.btn-auto');
        const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result, .prt-result-head');
        return (hasAtk && hasChara) || hasAuto || isRes;
      }, { timeout: timeoutMs });
      return true;
    } catch {
      return Date.now() - start < timeoutMs;
    }
  }

  /**
   * Checks if battle has concluded (result screen reached or boss HP <= 0).
   */
  private async isBattleEnded(): Promise<boolean> {
    try {
      const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (
        currentHash.includes('result') ||
        currentHash.includes('empty') ||
        currentHash.includes('supporter') ||
        currentHash.includes('stage') ||
        currentHash.includes('mypage')
      ) {
        return true;
      }

      if (!currentHash.includes('raid') && !currentHash.includes('battle')) {
        return true;
      }

      return await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;

        if (gStatus?.finish || gStatus?.win || gStatus?.lose || pJsn?.finish || pJsn?.is_clear) {
          return true;
        }

        const boss = gStatus?.boss?.param?.[0] || pJsn?.boss?.param?.[0];
        if (boss?.hp !== undefined && Number(boss.hp) <= 0) {
          return true;
        }

        const resultPop = document.querySelector('.pop-raid-result, .prt-result-head');
        if (resultPop && (resultPop as HTMLElement).offsetParent !== null) {
          return true;
        }

        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Handles result screen, logs drops, and dismisses result dialogs.
   */
  private async handleResultScreen(): Promise<string[]> {
    console.log('[ArcarumTheWorld] Inspecting result screen & drops...');

    // Wait for result screen if not already visible
    await this.page.waitForFunction(() => {
      const isResult = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result, .prt-result-head');
      const hasClose = !!document.querySelector('.btn-usual-ok, .btn-result-close, .btn-control.location-href');
      return isResult || hasClose;
    }, { timeout: 15000 }).catch(() => null);

    await randomDelay(1200, 1600);

    // Extract looted items
    const lootedItems: string[] = await this.page.evaluate(() => {
      const items: string[] = [];
      const itemEls = document.querySelectorAll('.prt-reward-list .lis-item, .lis-reward, .prt-item-list .lis-item, [data-item-name]');
      itemEls.forEach(el => {
        const name = el.getAttribute('data-item-name') || (el as HTMLElement).innerText || '';
        const clean = name.trim().replace(/\n+/g, ' ');
        if (clean && clean.length < 50 && !items.includes(clean)) {
          items.push(clean);
        }
      });
      return items;
    });

    // Dismiss result dialog
    const closeBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-result-close, .btn-usual-ok, .btn-control.location-href');
    if (closeBtn) {
      await humanReactionDelay(250, 0.20);
      await humanizedClick(this.page, closeBtn);
      await randomDelay(600, 900);
    }

    return lootedItems;
  }

  private async getInGameTurn(): Promise<number> {
    try {
      return await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const turn = stage?.gGameStatus?.turn;
        return typeof turn === 'number' ? turn : 1;
      });
    } catch {
      return 1;
    }
  }

  private async waitForAttackResolution(timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.attackDispatched) return true;
      if (await this.isBattleEnded()) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  private setupResponseListener(): void {
    if (this.responseListenerInitialized) return;
    this.responseListenerInitialized = true;

    this.page.on('response', async (res: HTTPResponse) => {
      try {
        const url = res.url();
        if (url.includes('normal_attack_result.json')) {
          this.attackDispatched = true;
        }
        if (url.includes('summon_result.json')) {
          this.summonDispatched = true;
        }
        if (url.includes('reward.json') || url.includes('result.json')) {
          if (res.status() === 200) {
            const data = await res.json().catch(() => null);
            if (data) this.latestRewardData = data;
          }
        }
      } catch {
        // Ignore network errors
      }
    });
  }

  private ensureLogDirExists(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      const header = `# Arcarum: The World Battle Log\n\n| Run # | Timestamp | Turns | Duration | Loot / Drops |\n| :---: | :---: | :---: | :---: | :--- |\n`;
      fs.writeFileSync(filePath, header, 'utf-8');
    }
  }

  private async appendLogEntry(
    logPath: string,
    entry: { runNumber: number; timestamp: string; turns: number; durationSec: string; loot: string[] }
  ): Promise<void> {
    try {
      const lootStr = entry.loot.length > 0 ? entry.loot.join(', ') : 'Cleared';
      const line = `| ${entry.runNumber} | ${entry.timestamp} | ${entry.turns} | ${entry.durationSec}s | ${lootStr} |\n`;
      await fs.promises.appendFile(logPath, line, 'utf-8');
    } catch (err: any) {
      console.error(`[ArcarumTheWorld] Failed to write to log file: ${err.message}`);
    }
  }
}
