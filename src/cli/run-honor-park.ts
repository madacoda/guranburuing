// src/cli/run-honor-park.ts
import { AccountRegistry } from '../auth/account-registry.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';
import { HonorParkService } from '../services/gw/honor-park.service.js';

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('-')));
  const positional = args.filter(a => !a.startsWith('-'));

  const isDryRun = flags.has('--plan') || flags.has('--dry-run') || flags.has('-p') || flags.has('-d');
  const isWindowed = flags.has('--windowed') || flags.has('-w');
  const forceHeadless = isWindowed ? false : flags.has('--headless') || flags.has('-h') ? true : undefined;

  let accountId = 'acc1';
  let targetHonors = 500_000_000;
  let offlineCurrentHonors: number | null = null;

  for (const arg of positional) {
    const cleanedNum = parseInt(arg.replace(/[,_]/g, ''), 10);
    if (!isNaN(cleanedNum) && cleanedNum >= 1_000_000) {
      if (targetHonors === 500_000_000 && cleanedNum !== 500_000_000) {
        targetHonors = cleanedNum;
      } else {
        offlineCurrentHonors = cleanedNum;
      }
    } else if (/^acc\d+$/i.test(arg)) {
      accountId = arg;
    }
  }

  const fromFlag = args.find(a => a.startsWith('--from='));
  if (fromFlag) {
    const val = parseInt(fromFlag.split('=')[1].replace(/[,_]/g, ''), 10);
    if (!isNaN(val)) offlineCurrentHonors = val;
  }

  const targetFlag = args.find(a => a.startsWith('--target='));
  if (targetFlag) {
    const val = parseInt(targetFlag.split('=')[1].replace(/[,_]/g, ''), 10);
    if (!isNaN(val)) targetHonors = val;
  }

  // Offline calculation mode if `--from=<honors>` is supplied with `--plan`
  if (isDryRun && offlineCurrentHonors !== null) {
    const plan = HonorParkService.solveOptimalPlan(offlineCurrentHonors, targetHonors);
    console.log('\n' + HonorParkService.formatPlanReport(plan) + '\n');
    process.exit(0);
  }

  const acc = AccountRegistry.getAccount(accountId);
  if (!acc) {
    console.error(`[HonorPark] Account "${accountId}" not found in AccountRegistry.`);
    process.exit(1);
  }
  const cdp = new CdpConnectionManager();
  const { browser, page } = await cdp.connectWithRetry(3, 2000, forceHeadless, {
    cdpPort: acc.cdpPort,
    profileDir: acc.profileDir,
    proxy: acc.proxy
  });

  try {
    const sentinel = new SentinelWatchdog(page);

    // 1. Read live Total Honors from #event/teamraid085
    let liveHonors = await HonorParkService.readLiveTotalHonors(page);
    const initialPlan = HonorParkService.solveOptimalPlan(liveHonors, targetHonors);
    console.log('\n' + HonorParkService.formatPlanReport(initialPlan) + '\n');

    if (isDryRun) {
      console.log('[HonorPark] Dry-run / Plan mode complete. Run without --plan to execute.');
      await browser.disconnect();
      process.exit(0);
    }

    if (initialPlan.gapHonors <= 0) {
      console.log(`[HonorPark] 🎉 Account [${accountId}] is already at ${liveHonors.toLocaleString()} pt (Target: ${targetHonors.toLocaleString()} pt).`);
      await browser.disconnect();
      process.exit(0);
    }

    if (!initialPlan.exactMatch) {
      console.warn(`[HonorPark] ⚠️ Warning: Target gap (${initialPlan.gapHonors.toLocaleString()} pt) has residual ${initialPlan.residualHonors} pt.`);
    }

    // 2. Closed-Loop Adaptive Execution:
    // After each quest phase (or chunk of 15 NM95 runs), re-read live Total Honors from #event/teamraid085
    // and re-solve the exact Diophantine plan so any drift or unclaimed raid is automatically compensated.
    const MAX_CHUNK_NM95 = 15;
    let iteration = 0;

    while (iteration < 30) {
      iteration++;
      liveHonors = await HonorParkService.readLiveTotalHonors(page);
      const remaining = targetHonors - liveHonors;

      if (remaining === 0) {
        console.log('\n================================================================================');
        console.log(`  🏆🎯 [HONOR PARK SUCCESS!] Parked at EXACTLY ${liveHonors.toLocaleString()} pt! 🎯🏆`);
        console.log('================================================================================\n');
        break;
      }

      if (remaining < 0) {
        console.error(`[HonorPark] ❌ Overshoot detected! Current: ${liveHonors.toLocaleString()} pt > Target: ${targetHonors.toLocaleString()} pt.`);
        break;
      }

      const plan = HonorParkService.solveOptimalPlan(liveHonors, targetHonors);
      if (plan.steps.length === 0) {
        console.log(`[HonorPark] No further valid quest steps for remaining ${remaining.toLocaleString()} pt.`);
        break;
      }

      const nextStep = plan.steps[0];
      const batchRuns =
        nextStep.quest.id === 'nm95_full'
          ? Math.min(nextStep.runs, MAX_CHUNK_NM95)
          : nextStep.runs;

      console.log(
        `\n[HonorPark] 🚀 Executing Phase: ${batchRuns}x ${nextStep.quest.name} (+${(batchRuns * nextStep.quest.honors).toLocaleString()} pt) | Current: ${liveHonors.toLocaleString()} -> Expected: ${(liveHonors + batchRuns * nextStep.quest.honors).toLocaleString()} pt`
      );

      // Guard against overshooting
      if (batchRuns * nextStep.quest.honors > remaining) {
        console.error(`[HonorPark] 🛡️ Safety Guard: Planned step (+${(batchRuns * nextStep.quest.honors).toLocaleString()} pt) exceeds remaining (${remaining.toLocaleString()} pt). Aborting.`);
        break;
      }

      const tmpl = HonorParkService.buildWorkflowTemplate(nextStep.quest, batchRuns);
      const engine = new UniversalWorkflowEngine(page, sentinel, tmpl, accountId);
      await engine.runLoop({ runs: batchRuns });
      engine.updatePage(page);
    }

    const finalHonors = await HonorParkService.readLiveTotalHonors(page);
    console.log(`[HonorPark] Final Verified Honors on #event/teamraid085: ${finalHonors.toLocaleString()} pt (Target: ${targetHonors.toLocaleString()} pt, Diff: ${finalHonors - targetHonors} pt)`);
  } finally {
    await browser.disconnect();
  }
}

main().catch(err => {
  console.error('[HonorPark] Fatal error:', err.message);
  process.exit(1);
});
