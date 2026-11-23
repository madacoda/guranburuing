// src/services/gw/honor-park.service.ts
import { Page } from 'puppeteer-core';
import { WorkflowStep, WorkflowTemplate } from '../../types/workflow.types.js';
import { TemplateParser } from '../../templates/template-parser.js';

export interface GwHonorQuestDefinition {
  id: string;
  name: string;
  questId: string;
  questUrl: string;
  honors: number;
  apCost: number;
  baitCost: number;
  estimatedSec: number;
  isSolo: boolean;
  description: string;
  buildSteps: () => WorkflowStep[];
}

export interface HonorParkPlanStep {
  quest: GwHonorQuestDefinition;
  runs: number;
  totalHonors: number;
  totalAp: number;
  totalBait: number;
  estimatedSec: number;
  cumulativeHonorsAfter: number;
  remainingHonorsAfter: number;
}

export interface HonorParkPlan {
  currentHonors: number;
  targetHonors: number;
  gapHonors: number;
  exactMatch: boolean;
  residualHonors: number;
  totalRuns: number;
  totalAp: number;
  totalBait: number;
  totalEstimatedSec: number;
  steps: HonorParkPlanStep[];
}

const ZERO_BUTTON_STEPS: WorkflowStep[] = [
  {
    id: 'step_1',
    name: 'Tap Ready Screen',
    code: 'tap_ready',
    action: 'tap_ready',
    waitForNetwork: 'normal_attack_result.json'
  },
  {
    id: 'step_2',
    name: 'Confirm Attack',
    code: 'attack',
    action: 'attack',
    waitForNetwork: 'normal_attack_result.json'
  },
  {
    id: 'step_3',
    name: 'Instant Reload F5',
    code: 'reload',
    action: 'reload'
  },
  {
    id: 'step_4',
    name: 'Confirm Battle Result',
    code: 'confirm_result',
    action: 'confirm_result'
  }
];

const QUICK_CALL_ATTACK_STEPS: WorkflowStep[] = [
  {
    id: 'step_1',
    name: 'Quick Call Summon (+10 Honor)',
    code: 'quick_call',
    action: 'quick_call',
    waitForNetwork: 'summon_result.json'
  },
  {
    id: 'step_2',
    name: 'Reload F5 (Post-Summon Cancel)',
    code: 'reload',
    action: 'reload'
  },
  {
    id: 'step_3',
    name: 'Execute Attack',
    code: 'attack',
    action: 'attack',
    waitForNetwork: 'normal_attack_result.json'
  },
  {
    id: 'step_4',
    name: 'Reload F5 (Post-Attack Cancel)',
    code: 'reload',
    action: 'reload'
  },
  {
    id: 'step_5',
    name: 'Confirm Battle Result',
    code: 'confirm_result',
    action: 'confirm_result'
  }
];

function buildNm95Steps(includeQuickCall: boolean): WorkflowStep[] {
  try {
    const base = TemplateParser.loadTemplate('gw-nm95-dark');
    if (includeQuickCall) {
      return base.steps;
    }
    // Remove quick_call and its immediate post-summon reload so summon (+10 pt) is omitted
    const filtered: WorkflowStep[] = [];
    for (let i = 0; i < base.steps.length; i++) {
      const s = base.steps[i];
      const code = s.code || s.action;
      if (code === 'quick_call') {
        if (i + 1 < base.steps.length && (base.steps[i + 1].code === 'reload' || base.steps[i + 1].action === 'reload')) {
          i++;
        }
        continue;
      }
      filtered.push(s);
    }
    return filtered;
  } catch {
    return QUICK_CALL_ATTACK_STEPS;
  }
}

/**
 * Empirically verified Honor Catalog for Unite and Fight (#event/teamraid085).
 *
 * Server Honor Formula Breakdown (verified via live CDP packet & event total delta):
 * - Single Battles (data-type="3"):
 *   - Normal (980611, Yog-Sothoth, 20 AP):     4,000 pt (exact fixed integer)
 *   - Hard (980621, Yog-Sothoth, 25 AP):       8,000 pt (exact fixed integer)
 *   - Very Hard (980631, Mahisha, 30 AP):     21,400 pt (exact fixed integer)
 * - Multi Battles (data-type="1", 100% HP Solo OTK):
 *   - Extreme (980641, Supergigante, 30 AP):
 *     - 0-Button Attack:                      64,800 pt
 *     - Quick Call (+10 pt) + Attack:         64,810 pt
 *   - Extreme+ (980651, Supergigante, 30 AP):
 *     - 0-Button Attack:                     127,600 pt (126,000 HP + 1,600 Clear/MVP)
 *     - Quick Call (+10 pt) + Attack:        127,610 pt
 *   - Nightmare Lv90 (980671, Demeter, 30 AP, 5 Bait):
 *     - Quick Call (+10 pt) + Attack:        310,010 pt (305,000 HP + 5,000 Clear/MVP + 10 Summon)
 *   - Nightmare Lv95 (980681, Demeter, 40 AP, 10 Bait):
 *     - Full Rotation (C4S2 +375, QC +10):   910,385 pt (900,000 HP + 10,000 Clear/MVP + 375 Debuff + 10 Summon)
 *     - No-QC Rotation (C4S2 +375, no QC):   910,375 pt
 */
export const TEAMRAID085_HONOR_CATALOG: GwHonorQuestDefinition[] = [
  {
    id: 'nm95_full',
    name: 'Nightmare Lv95 (Full Rotation)',
    questId: '980681',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980681/1/0/10116',
    honors: 910385,
    apCost: 40,
    baitCost: 10,
    estimatedSec: 30,
    isSolo: false,
    description: '900,000 HP + 10,000 Clear + 375 C4S2 Debuff + 10 Quick Call',
    buildSteps: () => buildNm95Steps(true)
  },
  {
    id: 'nm90_qc',
    name: 'Nightmare Lv90 (Quick Call + Attack)',
    questId: '980671',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980671/1/0/10116',
    honors: 310010,
    apCost: 30,
    baitCost: 5,
    estimatedSec: 15,
    isSolo: false,
    description: '305,000 HP + 5,000 Clear + 10 Quick Call',
    buildSteps: () => QUICK_CALL_ATTACK_STEPS
  },
  {
    id: 'ex_plus_qc',
    name: 'Extreme+ (Quick Call + Attack)',
    questId: '980651',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980651/1/0',
    honors: 127610,
    apCost: 30,
    baitCost: 0,
    estimatedSec: 11,
    isSolo: false,
    description: '126,000 HP + 1,600 Clear + 10 Quick Call',
    buildSteps: () => QUICK_CALL_ATTACK_STEPS
  },
  {
    id: 'ex_plus',
    name: 'Extreme+ (0-Button Attack)',
    questId: '980651',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980651/1/0',
    honors: 127600,
    apCost: 30,
    baitCost: 0,
    estimatedSec: 8,
    isSolo: false,
    description: '126,000 HP + 1,600 Clear (0 skills)',
    buildSteps: () => ZERO_BUTTON_STEPS
  },
  {
    id: 'ex_qc',
    name: 'Extreme (Quick Call + Attack)',
    questId: '980641',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980641/1/0',
    honors: 64810,
    apCost: 30,
    baitCost: 0,
    estimatedSec: 11,
    isSolo: false,
    description: '64,800 Base + 10 Quick Call',
    buildSteps: () => QUICK_CALL_ATTACK_STEPS
  },
  {
    id: 'ex',
    name: 'Extreme (0-Button Attack)',
    questId: '980641',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980641/1/0',
    honors: 64800,
    apCost: 30,
    baitCost: 0,
    estimatedSec: 8,
    isSolo: false,
    description: '64,800 Base (0 skills)',
    buildSteps: () => ZERO_BUTTON_STEPS
  },
  {
    id: 'very_hard',
    name: 'Very Hard Solo (Mahisha)',
    questId: '980631',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980631/3',
    honors: 21400,
    apCost: 30,
    baitCost: 0,
    estimatedSec: 8,
    isSolo: true,
    description: 'Fixed 21,400 Solo Clear Honors',
    buildSteps: () => ZERO_BUTTON_STEPS
  },
  {
    id: 'hard',
    name: 'Hard Solo (Yog-Sothoth)',
    questId: '980621',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980621/3',
    honors: 8000,
    apCost: 25,
    baitCost: 0,
    estimatedSec: 8,
    isSolo: true,
    description: 'Fixed 8,000 Solo Clear Honors',
    buildSteps: () => ZERO_BUTTON_STEPS
  },
  {
    id: 'normal',
    name: 'Normal Solo (Yog-Sothoth)',
    questId: '980611',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980611/3',
    honors: 4000,
    apCost: 20,
    baitCost: 0,
    estimatedSec: 8,
    isSolo: true,
    description: 'Fixed 4,000 Solo Clear Honors',
    buildSteps: () => ZERO_BUTTON_STEPS
  }
];

export class HonorParkService {
  /**
   * Reads the authoritative Total Honors directly from #event/teamraid085.
   */
  public static async readLiveTotalHonors(page: Page, eventId = 'teamraid085'): Promise<number> {
    const curUrl = page.url();
    if (curUrl.includes(`#event/${eventId}`)) {
      await page.evaluate(() => {
        location.hash = '#mypage';
      }).catch(() => null);
      await new Promise(r => setTimeout(r, 750));
    }

    await page
      .goto(`https://game.granbluefantasy.jp/#event/${eventId}`, { waitUntil: 'domcontentloaded' })
      .catch(() => null);

    for (let i = 0; i < 25; i++) {
      await new Promise(r => setTimeout(r, 400));
      const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      const m = txt.match(/Honors[\s\S]{0,40}?Total[\s\S]{0,40}?([0-9,]+)/i);
      if (m && m[1]) {
        const val = parseInt(m[1].replace(/,/g, ''), 10);
        if (!isNaN(val) && val >= 0) {
          return val;
        }
      }
    }

    throw new Error(`Could not extract Total Honors from #event/${eventId}`);
  }

  /**
   * Solves the exact Diophantine / Minimum-Time Honor Parking problem:
   *   sum(runs_i * honors_i) = targetHonors - currentHonors
   *
   * Strategy:
   * 1. Bulk phase uses `nm95_full` (910,385 pt = -15 mod 200).
   * 2. Once remaining gap R <= ~4,500,000 pt (and R mod 200 is a multiple of 10),
   *    uses exact Dynamic Programming over the 200-multiple quests (`ex_plus` 127,600,
   *    `ex` 64,800, `very_hard` 21,400, `hard` 8,000, `normal` 4,000) plus `+10 mod 200`
   *    carriers (`nm90_qc` 310,010, `ex_plus_qc` 127,610, `ex_qc` 64,810) to achieve
   *    ZERO residual error in minimum total runs and execution time.
   */
  public static solveOptimalPlan(
    currentHonors: number,
    targetHonors = 500_000_000,
    catalog: GwHonorQuestDefinition[] = TEAMRAID085_HONOR_CATALOG
  ): HonorParkPlan {
    const gap = targetHonors - currentHonors;
    if (gap <= 0) {
      return {
        currentHonors,
        targetHonors,
        gapHonors: gap,
        exactMatch: gap === 0,
        residualHonors: gap,
        totalRuns: 0,
        totalAp: 0,
        totalBait: 0,
        totalEstimatedSec: 0,
        steps: []
      };
    }

    const byId = new Map<string, GwHonorQuestDefinition>(catalog.map(q => [q.id, q]));
    const qNm95 = byId.get('nm95_full')!;
    const qNm90Qc = byId.get('nm90_qc')!;
    const qExPlusQc = byId.get('ex_plus_qc')!;
    const qExPlus = byId.get('ex_plus')!;
    const qExQc = byId.get('ex_qc')!;
    const qEx = byId.get('ex')!;
    const qVh = byId.get('very_hard')!;
    const qHard = byId.get('hard')!;
    const qNormal = byId.get('normal')!;

    // Align closest reachable target <= gap that is divisible by 5
    const alignedGap = gap - (gap % 5);

    // Precompute minimum-run exact DP for any 200-multiple up to MAX_DP_UNITS (where 1 unit = 200 honors)
    // Max remainder we need to solve with 200-multiple quests is ~3,000,000 honors = 15,000 units of 200.
    const MAX_DP_HONORS = 3_200_000;
    const UNIT = 200;
    const maxUnits = Math.floor(MAX_DP_HONORS / UNIT);

    const mod200Quests: { quest: GwHonorQuestDefinition; units: number }[] = [
      { quest: qExPlus, units: qExPlus.honors / UNIT }, // 638
      { quest: qEx, units: qEx.honors / UNIT },         // 324
      { quest: qVh, units: qVh.honors / UNIT },         // 107
      { quest: qHard, units: qHard.honors / UNIT },     // 40
      { quest: qNormal, units: qNormal.honors / UNIT }  // 20
    ];

    // dpCost[u] = minimum estimated seconds (tie-broken by minimum runs) to form exactly u * 200 honors
    const INF = 1e15;
    const dpCost = new Float64Array(maxUnits + 1).fill(INF);
    const dpChoice = new Int32Array(maxUnits + 1).fill(-1);
    dpCost[0] = 0;

    for (let qIdx = 0; qIdx < mod200Quests.length; qIdx++) {
      const { quest, units } = mod200Quests[qIdx];
      // Weight: primary = number of runs * 1000 + estimatedSec (strictly minimizes run count, then duration)
      const stepWeight = 1000 + quest.estimatedSec;
      for (let u = units; u <= maxUnits; u++) {
        const cand = dpCost[u - units] + stepWeight;
        if (cand < dpCost[u]) {
          dpCost[u] = cand;
          dpChoice[u] = qIdx;
        }
      }
    }

    const maxNm95 = Math.floor(alignedGap / qNm95.honors);
    const minNm95 = Math.max(0, maxNm95 - 15);

    let bestTotalWeight = INF;
    let bestCounts: Map<string, number> | null = null;
    let bestAchievedHonors = 0;

    // Search over candidate NM95 run counts and candidate Quick-Call (+10 mod 200) carrier counts
    for (let n95 = maxNm95; n95 >= minNm95; n95--) {
      const remAfter95 = alignedGap - n95 * qNm95.honors;
      if (remAfter95 < 0) continue;

      // To make remaining honors divisible by 10, (remAfter95 % 10) must be 0.
      if (remAfter95 % 10 !== 0) continue;

      // How many (+10 mod 200) runs `kQc` do we need so that (remAfter95 - kQc * 10) is divisible by 200?
      // Since each QC carrier (`nm90_qc` = 310,010, `ex_plus_qc` = 127,610, `ex_qc` = 64,810) is === 10 (mod 200),
      // any combination of `n90Qc + nExPlusQc + nExQc = kQc` shifts the residue mod 200 by `10 * kQc`.
      const remMod200 = remAfter95 % 200;
      const minKQc = remMod200 === 0 ? 0 : remMod200 / 10; // in 0..19

      // Also allow using additional blocks of 20 QC runs if NM90_QC is faster for large remainders,
      // or simple NM90_QC decomposition. Here we test kQc = minKQc.
      const kQc = minKQc;

      // Distribute kQc across (n90Qc, nExPlusQc, nExQc) to maximize honor coverage without exceeding remAfter95
      for (let n90Qc = kQc; n90Qc >= 0; n90Qc--) {
        for (let nExPlusQc = kQc - n90Qc; nExPlusQc >= 0; nExPlusQc--) {
          const nExQc = kQc - n90Qc - nExPlusQc;
          const qcHonors =
            n90Qc * qNm90Qc.honors +
            nExPlusQc * qExPlusQc.honors +
            nExQc * qExQc.honors;

          const remFor200 = remAfter95 - qcHonors;
          if (remFor200 < 0 || remFor200 > MAX_DP_HONORS) continue;
          if (remFor200 % UNIT !== 0) continue;

          const u = remFor200 / UNIT;
          if (dpCost[u] >= INF) continue;

          const prefixWeight =
            n95 * (1000 + qNm95.estimatedSec) +
            n90Qc * (1000 + qNm90Qc.estimatedSec) +
            nExPlusQc * (1000 + qExPlusQc.estimatedSec) +
            nExQc * (1000 + qExQc.estimatedSec);

          const totalWeight = prefixWeight + dpCost[u];
          if (totalWeight < bestTotalWeight) {
            bestTotalWeight = totalWeight;
            const counts = new Map<string, number>();
            if (n95 > 0) counts.set(qNm95.id, n95);
            if (n90Qc > 0) counts.set(qNm90Qc.id, n90Qc);
            if (nExPlusQc > 0) counts.set(qExPlusQc.id, nExPlusQc);
            if (nExQc > 0) counts.set(qExQc.id, nExQc);

            let curU = u;
            while (curU > 0) {
              const idx = dpChoice[curU];
              if (idx < 0) break;
              const q = mod200Quests[idx].quest;
              counts.set(q.id, (counts.get(q.id) || 0) + 1);
              curU -= mod200Quests[idx].units;
            }

            bestCounts = counts;
            bestAchievedHonors = alignedGap;
          }
        }
      }
    }

    // Fallback greedy if gap is tiny and below Frobenius number (< ~40,000 pt)
    if (!bestCounts) {
      bestCounts = new Map<string, number>();
      let rem = alignedGap;
      for (const q of catalog) {
        if (rem >= q.honors) {
          const c = Math.floor(rem / q.honors);
          bestCounts.set(q.id, c);
          rem -= c * q.honors;
        }
      }
      bestAchievedHonors = alignedGap - rem;
    }

    // Build ordered steps from largest honor quest to smallest
    const steps: HonorParkPlanStep[] = [];
    let runningHonors = currentHonors;
    let totalRuns = 0;
    let totalAp = 0;
    let totalBait = 0;
    let totalEstimatedSec = 0;

    for (const q of catalog) {
      const runs = bestCounts.get(q.id) || 0;
      if (runs <= 0) continue;

      const stepHonors = runs * q.honors;
      const stepAp = runs * q.apCost;
      const stepBait = runs * q.baitCost;
      const stepSec = runs * q.estimatedSec;

      runningHonors += stepHonors;
      totalRuns += runs;
      totalAp += stepAp;
      totalBait += stepBait;
      totalEstimatedSec += stepSec;

      steps.push({
        quest: q,
        runs,
        totalHonors: stepHonors,
        totalAp: stepAp,
        totalBait: stepBait,
        estimatedSec: stepSec,
        cumulativeHonorsAfter: runningHonors,
        remainingHonorsAfter: targetHonors - runningHonors
      });
    }

    const residualHonors = targetHonors - runningHonors;

    return {
      currentHonors,
      targetHonors,
      gapHonors: gap,
      exactMatch: residualHonors === 0,
      residualHonors,
      totalRuns,
      totalAp,
      totalBait,
      totalEstimatedSec,
      steps
    };
  }

  /**
   * Builds a UniversalWorkflowEngine-compatible WorkflowTemplate for a specific HonorPark quest step.
   */
  public static buildWorkflowTemplate(quest: GwHonorQuestDefinition, runs: number): WorkflowTemplate {
    return {
      name: `GW Honor Park - ${quest.name}`,
      description: `Honor Parking Step: ${quest.name} (+${quest.honors.toLocaleString()} pt/run)`,
      mode: 'combat',
      questUrl: quest.questUrl,
      questId: quest.questId,
      element: 'Dark',
      isSolo: quest.isSolo,
      supporterPriority: ['Hades'],
      humanMotor: true,
      stopOnCaptcha: true,
      autoElixir: true,
      defaultRuns: runs,
      speedProfile: 'fast',
      steps: quest.buildSteps()
    };
  }

  /**
   * Formats an HonorParkPlan as a clean console / markdown table.
   */
  public static formatPlanReport(plan: HonorParkPlan): string {
    const mins = (plan.totalEstimatedSec / 60).toFixed(1);
    const lines: string[] = [
      '================================================================================',
      '               🎯 UNITE & FIGHT HONOR PARKING PLAN (#event/teamraid085)         ',
      '================================================================================',
      `Current Total Honors:   ${plan.currentHonors.toLocaleString()} pt`,
      `Target Parked Honors:   ${plan.targetHonors.toLocaleString()} pt`,
      `Exact Honors Needed:    +${plan.gapHonors.toLocaleString()} pt`,
      `Precision Status:       ${plan.exactMatch ? '✅ 100% EXACT MATCH (0 pt residual)' : `⚠️ Residual: ${plan.residualHonors.toLocaleString()} pt`}`,
      `Total Runs Required:    ${plan.totalRuns} runs (~${mins} min)`,
      `Total Resources:        ${plan.totalAp.toLocaleString()} AP | ${plan.totalBait.toLocaleString()} Bait Chunks`,
      '--------------------------------------------------------------------------------',
      `${'Phase / Quest'.padEnd(36)} | ${'Runs'.padStart(5)} | ${'Honor/Run'.padStart(11)} | ${'Stage Total'.padStart(13)} | ${'Honors After'.padStart(14)}`,
      '--------------------------------------------------------------------------------'
    ];

    for (const s of plan.steps) {
      lines.push(
        `${s.quest.name.padEnd(36)} | ${String(s.runs).padStart(5)} | +${s.quest.honors.toLocaleString().padStart(10)} | +${s.totalHonors.toLocaleString().padStart(12)} | ${s.cumulativeHonorsAfter.toLocaleString().padStart(14)}`
      );
    }

    lines.push('================================================================================');
    return lines.join('\n');
  }
}
