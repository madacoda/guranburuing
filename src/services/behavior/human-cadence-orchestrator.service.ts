// src/services/behavior/human-cadence-orchestrator.service.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';
import { logNormalDelay, sampleGaussian } from '../../human-motor.js';
import { FarmEngine, FarmSummary } from '../../engines/farm.engine.js';
import { inventoryAuditorService, InventorySnapshot } from './inventory-auditor.service.js';
import { monthlyShopRoutineService } from './monthly-shop-routine.service.js';
import { discordPresence } from '../../relay/discord-presence.js';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';

export interface HumanCadenceOptions {
  totalCycles?: number; // Default: 3 cycles (approx. 2.5 - 3.5 hours)
  gbRaidsPerCycle?: number; // Default: 15 - 25 raids
  leechRaidsPerCycle?: number; // Default: 2 - 4 raids
  minRestMinutes?: number; // Default: 5 minutes
  maxRestMinutes?: number; // Default: 15 minutes
  auditInventoryEveryNCycles?: number; // Default: 1 (every cycle)
  autoMonthlyShop?: boolean; // Default: true
}

export interface HumanCadenceSummary {
  cyclesCompleted: number;
  totalGbRaids: number;
  totalLeechRaids: number;
  totalGoldBars: number;
  inventorySnapshot?: InventorySnapshot;
  durationMs: number;
}

/**
 * Human Cadence Orchestrator Service.
 * Implements Principle 15 (Human Behavioral Mimicry & Anti-Detection):
 * - Cycles between high-priority Gold Bar farming (PBHL, Akasha, GO HL)
 * - Interleaves casual random raid leeching (Magna 3, Six Dragons) to disperse traffic signatures
 * - Conducts periodic in-game inventory audits (#item) for Gold Bars and Elixirs
 * - Enforces realistic human rest periods and fatigue curves
 * - Triggers 1st-of-the-month shop exchanges autonomously
 */
export class HumanCadenceOrchestrator {
  private stopRequested = false;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog = new SentinelWatchdog(page)
  ) {}

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Runs the complete human-like multi-cycle automation loop.
   */
  public async runHumanCadenceLoop(options: HumanCadenceOptions = {}): Promise<HumanCadenceSummary> {
    const totalCycles = options.totalCycles ?? 3;
    const gbRaidsPerCycle = options.gbRaidsPerCycle ?? 18;
    const leechRaidsPerCycle = options.leechRaidsPerCycle ?? 3;
    const minRestMin = options.minRestMinutes ?? 5;
    const maxRestMin = options.maxRestMinutes ?? 12;
    const autoMonthly = options.autoMonthlyShop ?? true;

    const startTime = Date.now();
    let totalGbRaids = 0;
    let totalLeechRaids = 0;
    let totalGoldBars = 0;
    let cyclesCompleted = 0;
    let finalSnapshot: InventorySnapshot | undefined;

    if (this.stopRequested) {
      console.log('[HumanCadence] Stop already requested before start. Aborting loop.');
      return {
        cyclesCompleted: 0,
        totalGbRaids: 0,
        totalLeechRaids: 0,
        totalGoldBars: 0,
        durationMs: 0
      };
    }

    console.log('\n========================================================================');
    console.log('       🛡️ Granblue Fantasy - Human Behavioral Cadence Orchestrator      ');
    console.log('========================================================================');
    console.log(`Cycles Planned:         ${totalCycles}`);
    console.log(`GB Farming Target:      ~${gbRaidsPerCycle} raids per cycle (PBHL / Akasha / GO)`);
    console.log(`Casual Leech Target:    ~${leechRaidsPerCycle} raids per cycle (Magna 3 / Dragons)`);
    console.log(`Natural Rest Gaps:      ${minRestMin}m – ${maxRestMin}m between cycles`);
    console.log(`Inventory Auditing:     Enabled (Auditing #item every cycle)`);
    console.log(`Monthly Shop Check:     ${autoMonthly ? 'Active (Auto-checks 1st of month)' : 'Disabled'}`);
    console.log('========================================================================\n');

    // 0. Initial Monthly Shop Check
    if (autoMonthly && monthlyShopRoutineService.isDue()) {
      console.log('[HumanCadence] 📅 1st of month detected! Executing monthly shop trade pass...');
      try {
        await monthlyShopRoutineService.executeMonthlyRoutine(this.page);
      } catch (err: any) {
        console.warn(`[HumanCadence] Monthly shop check warning: ${err.message}`);
      }
    }

    for (let c = 1; c <= totalCycles; c++) {
      if (this.stopRequested) {
        console.log('\n[HumanCadence] 🛑 Stop requested. Halting human cadence loop.');
        break;
      }

      console.log(`\n========================================================================`);
      console.log(`▶️ STARTING CADENCE CYCLE [${c}/${totalCycles}]`);
      console.log(`========================================================================`);

      // ------------------------------------------------------------------
      // PHASE 1: Priority Gold Bar Farming Burst (PBHL, Akasha, GO HL)
      // ------------------------------------------------------------------
      console.log(`\n[HumanCadence] 🌟 Phase 1: Priority Gold Bar Hunting (${gbRaidsPerCycle} raids)...`);
      discordPresence.updateStatus({
        status: 'In Combat',
        task: `Cycle ${c}/${totalCycles} - Farming Gold Bar Raids`
      });

      try {
        const farmEngine = new FarmEngine(this.page, this.sentinel);
        const farmResult = await farmEngine.runFarmLoop({
          runs: gbRaidsPerCycle,
          autoReplenishEp: true,
          minBatchClaim: 3,
          maxBatchClaim: 5
        });

        totalGbRaids += farmResult.totalRunsCompleted;
        totalGoldBars += farmResult.totalGoldBars;
        console.log(`[HumanCadence] Phase 1 finished: ${farmResult.totalRunsCompleted} GB raids completed.`);
      } catch (err: any) {
        console.warn(`[HumanCadence] Error during GB farming phase: ${err.message}`);
      }

      if (this.stopRequested) break;

      // ------------------------------------------------------------------
      // PHASE 2: Casual Variety & Leech Interlude (Magna 3, Six Dragons)
      // ------------------------------------------------------------------
      console.log(`\n[HumanCadence] 🫐 Phase 2: Casual Leech Interlude (${leechRaidsPerCycle} raids)...`);
      discordPresence.updateStatus({
        status: 'Searching',
        task: `Cycle ${c}/${totalCycles} - Casual Leeching & EP Burn`
      });

      try {
        // Human-like natural browsing transition: navigate to #mypage first
        await this.page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await logNormalDelay(1200, 0.2);

        // Run casual leech loop
        const leechCount = await this.executeCasualLeechPass(leechRaidsPerCycle);
        totalLeechRaids += leechCount;
        console.log(`[HumanCadence] Phase 2 finished: ${leechCount} casual leech raids completed.`);
      } catch (err: any) {
        console.warn(`[HumanCadence] Leech interlude warning: ${err.message}`);
      }

      if (this.stopRequested) break;

      // ------------------------------------------------------------------
      // PHASE 3: Inventory & Supply Audit (#item)
      // ------------------------------------------------------------------
      console.log('\n[HumanCadence] 📦 Phase 3: Auditing In-Game Supplies (#item)...');
      try {
        const auditResult = await inventoryAuditorService.auditSupplies(this.page);
        if (auditResult.success) {
          finalSnapshot = auditResult.snapshot;
        }
      } catch (err: any) {
        console.warn(`[HumanCadence] Inventory audit warning: ${err.message}`);
      }

      cyclesCompleted++;

      // ------------------------------------------------------------------
      // PHASE 4: Natural Rest Gap & Fatigue Cool-Down
      // ------------------------------------------------------------------
      if (c < totalCycles && !this.stopRequested) {
        const restDurationMs = (Math.floor(Math.random() * (maxRestMin - minRestMin + 1)) + minRestMin) * 60 * 1000;
        const restMinStr = (restDurationMs / 60000).toFixed(1);
        console.log(`\n[HumanCadence] ☕ Phase 4: Taking natural player break (${restMinStr} minutes)...`);

        discordPresence.updateStatus({
          status: 'Idle',
          task: `Player Break (${restMinStr}m rest gap)`
        });

        // Park on #mypage while resting
        try {
          await this.page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch {}

        // Sleep with periodic wake check
        const sleepStart = Date.now();
        while (Date.now() - sleepStart < restDurationMs && !this.stopRequested) {
          await new Promise(r => setTimeout(r, 2000));
        }

        console.log('[HumanCadence] ⚡ Break complete! Resuming play with fresh motor baseline.');
      }
    }

    const durationMs = Date.now() - startTime;
    const durationMin = (durationMs / 60000).toFixed(1);

    console.log('\n========================================================================');
    console.log('🎉 HUMAN BEHAVIORAL CADENCE SESSION FINISHED');
    console.log('========================================================================');
    console.log(`Cycles Completed:    ${cyclesCompleted}/${totalCycles}`);
    console.log(`Total GB Raids:      ${totalGbRaids}`);
    console.log(`Total Leech Raids:   ${totalLeechRaids}`);
    console.log(`Total Gold Bars:     ${totalGoldBars}`);
    console.log(`Session Duration:    ${durationMin} minutes`);
    if (finalSnapshot) {
      console.log(`Current Gold Bricks: ${finalSnapshot.goldBars}`);
      console.log(`Current Half Elixirs: ${finalSnapshot.halfElixirs.toLocaleString()}`);
    }
    console.log('========================================================================\n');

    return {
      cyclesCompleted,
      totalGbRaids,
      totalLeechRaids,
      totalGoldBars,
      inventorySnapshot: finalSnapshot,
      durationMs
    };
  }

  /**
   * Executes casual leeching of dying assist raids (e.g. Magna 3 or Six Dragons) from #quest/assist.
   */
  private async executeCasualLeechPass(count: number): Promise<number> {
    let completed = 0;
    for (let i = 0; i < count; i++) {
      if (this.stopRequested) break;

      try {
        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await logNormalDelay(1000, 0.2);

        // Look for any dying raid (HP <= 25%) in assist list
        const clicked = await this.page.evaluate(() => {
          const $ = (window as any).$ || (window as any).Zepto;
          const candidates = document.querySelectorAll('.prt-raid-thumbnail, .lis-raid, .btn-multi-raid');
          for (const c of candidates) {
            const hpText = (c.querySelector('.prt-raid-gauge, .prt-hp-per, .txt-hp')?.textContent || '').replace('%', '').trim();
            const hp = parseInt(hpText, 10);
            if (!isNaN(hp) && hp <= 30 && hp > 0) {
              const btn = c.querySelector('.btn-raid-start, .btn-unclaimed') as HTMLElement || c as HTMLElement;
              if (btn) {
                if ($) $(btn).trigger('tap');
                btn.click();
                return true;
              }
            }
          }
          return false;
        });

        if (clicked) {
          completed++;
          await logNormalDelay(2500, 0.2);
        } else {
          // If no dying raids found, break early
          break;
        }
      } catch {
        break;
      }
    }
    return completed;
  }
}
