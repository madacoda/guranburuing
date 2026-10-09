import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { EVENT_177_DEFINITION, buildEventRaidUrl, EventRaidDifficulty } from '../events/event.constants.js';

interface CliOptions {
  accountId: string;
  targetRuns: number;
  difficulty: EventRaidDifficulty;
  isWindowed: boolean;
  autoElixir: boolean;
  autoHell: boolean;
  autoMeat: boolean;
}

function parseArgs(): CliOptions {
  const rawArgs = process.argv.slice(2);
  let accountId = 'acc1';
  let targetRuns = 500;
  let difficulty: EventRaidDifficulty = 'ex';
  let isWindowed = rawArgs.includes('--windowed');
  let autoElixir = !rawArgs.includes('--no-elixir');
  let autoHell = !rawArgs.includes('--no-hell');
  let autoMeat = rawArgs.includes('--auto-meat') || rawArgs.includes('--auto-vh');

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i].toLowerCase();
    if (arg === '--account' || arg === '-a') {
      if (rawArgs[i + 1]) accountId = rawArgs[i + 1];
    } else if (arg === '--runs' || arg === '-n') {
      if (rawArgs[i + 1]) targetRuns = parseInt(rawArgs[i + 1], 10);
    } else if (arg === '--diff' || arg === '-d') {
      if (rawArgs[i + 1] && ['vh', 'ex', 'hl', 'hell'].includes(rawArgs[i + 1])) {
        difficulty = rawArgs[i + 1] as EventRaidDifficulty;
      }
    } else if (arg.startsWith('acc')) {
      accountId = arg;
    } else if (['vh', 'ex', 'hl', 'hell', 'veryhard', 'extreme', 'impossible'].includes(arg)) {
      if (arg === 'veryhard') difficulty = 'vh';
      else if (arg === 'extreme') difficulty = 'ex';
      else if (arg === 'impossible') difficulty = 'hl';
      else difficulty = arg as EventRaidDifficulty;
    } else if (/^\d+$/.test(arg)) {
      targetRuns = parseInt(arg, 10);
    }
  }

  if (!targetRuns || targetRuns < 1) targetRuns = 500;

  return { accountId, targetRuns, difficulty, isWindowed, autoElixir, autoHell, autoMeat };
}

async function checkHostMeatCount(page: any, hostItemId: string): Promise<number> {
  return await page.evaluate((itemId: string) => {
    const items = Array.from(document.querySelectorAll('.prt-temporary-item .lis-temporary-item'));
    for (const it of items) {
      const img = it.querySelector('img') as HTMLImageElement;
      if (img && (img.src.includes(itemId) || img.alt === itemId)) {
        const txt = it.querySelector('.txt-possessed-item')?.textContent || '0';
        return parseInt(txt.trim(), 10) || 0;
      }
    }
    return -1;
  }, hostItemId).catch(() => -1);
}

async function main() {
  const { accountId, targetRuns, difficulty, isWindowed, autoElixir, autoHell, autoMeat } = parseArgs();
  const eventDef = EVENT_177_DEFINITION;
  const raidDef = eventDef.raids[difficulty] || eventDef.raids.ex;
  const questUrl = buildEventRaidUrl(difficulty, eventDef);
  const routerPath = questUrl.split('#')[1] || '';

  const hostCost = raidDef.consumedItemCount || 0;
  const hostItemId = raidDef.consumedItemId || eventDef.hostItemId;

  console.log(`\n========================================================================`);
  console.log(`      ⚡ Granblue Fantasy Autonomous Scenario Event Raid Looper         `);
  console.log(`========================================================================`);
  console.log(`Event:               ${eventDef.title} (${eventDef.rawId})`);
  console.log(`Difficulty:          ${difficulty.toUpperCase()} - ${raidDef.name}`);
  console.log(`Quest ID:            ${raidDef.questId}`);
  console.log(`Account:             ${accountId}`);
  console.log(`Target Runs:         ${targetRuns}`);
  console.log(`Quest URL:           ${questUrl}`);
  console.log(`Host Item Cost:      ${hostCost > 0 ? `${hostCost}x Item ${hostItemId}` : '0 (AP only)'}`);
  console.log(`Supporter Priority:  ${raidDef.supporterPriorities.join(' -> ')}`);
  console.log(`Auto AP Restore:     ${autoElixir ? 'ENABLED (Half-Elixir)' : 'DISABLED'}`);
  console.log(`Window Mode:         ${isWindowed ? 'HEADFUL' : 'HEADLESS'}`);
  console.log(`========================================================================\n`);

  let stopRequested = false;
  process.on('SIGINT', () => {
    console.log('\n[EventRaid] 🛑 Ctrl+C detected. Gracefully stopping after current run...');
    stopRequested = true;
  });

  const accountConfig = AccountRegistry.getAccountById(accountId);
  if (!accountConfig) {
    console.error(`[EventRaid] Account "${accountId}" not found in accounts.config.json.`);
    process.exit(1);
  }

  const cdpManager = new CdpConnectionManager();
  const { page } = await cdpManager.connectWithRetry(6, 2000, !isWindowed, {
    cdpPort: accountConfig.cdpPort,
    profileDir: accountConfig.profileDir,
    proxy: accountConfig.proxy
  });

  const sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  // Verify authentication
  const currentUrl = page.url();
  const playerName = accountConfig?.name || accountId;
  if (!currentUrl.includes('granbluefantasy.jp') || currentUrl.includes('#top') || currentUrl.includes('#login')) {
    const profile = await AccountAuthManager.ensureAuthenticated(page, accountConfig);
    console.log(`[EventRaid] ✅ Authenticated as player: ${profile?.name || playerName}`);
  } else {
    console.log(`[EventRaid] ✅ Active session verified for player: ${playerName}`);
  }

  // Pre-flight meat check for EX and HL
  if (hostCost > 0 && hostItemId) {
    console.log(`[EventRaid] Checking host item inventory for ${raidDef.name}...`);
    await page.evaluate((path) => {
      if ((window as any).Game?.router) {
        (window as any).Game.router.navigate(path, { trigger: true });
      }
    }, `event/${eventDef.rawId}`).catch(() => null);

    await new Promise(r => setTimeout(r, 1500));
    const meatCount = await checkHostMeatCount(page, hostItemId);

    if (meatCount >= 0) {
      console.log(`[EventRaid] Possessed Host Items (Meat): ${meatCount} (Cost per run: ${hostCost})`);
      if (meatCount < hostCost) {
        console.warn(`\n⚠️ [EventRaid] Insufficient Host Items!`);
        console.warn(`You currently have ${meatCount} host items, but ${raidDef.name} requires ${hostCost} per run.`);
        console.log(`👉 Please farm host items via Very Hard first (costs 0 meat, 20 AP):`);
        console.log(`   bun run event:raid:vh 20\n`);
        await cdpManager.disconnect();
        return;
      }
    }
  }

  let completedRuns = 0;
  let totalTokensEarned = 0;
  const tokenYield = difficulty === 'hl' ? 76 : (difficulty === 'ex' ? 56 : 22);
  const sessionStartTime = Date.now();

  for (let run = 1; run <= targetRuns; run++) {
    if (stopRequested) break;
    await sentinel.assertSafe();

    const runStartTime = Date.now();
    console.log(`------------------------------------------------------------------------`);
    console.log(`[${accountId}] [Run ${run}/${targetRuns}] Starting ${raidDef.name}...`);
    console.log(`------------------------------------------------------------------------`);

    // Step 1: Route to supporter selection screen
    let supporterReady = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (stopRequested) break;

      // Handle common error popup
      const errorDismissed = await page.evaluate(() => {
        const errOk = document.querySelector('.common-pop-error .btn-usual-ok, .pop-usual.common-pop-error .btn-usual-ok, .pop-usual .btn-usual-ok') as HTMLElement;
        if (errOk && errOk.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(errOk).trigger('tap');
          errOk.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (errorDismissed) {
        await new Promise(r => setTimeout(r, 400));
        continue;
      }

      // Check AP replenishment popup (Half-Elixir)
      if (autoElixir) {
        const apHandled = await page.evaluate(() => {
          const elixirBtn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use, .btn-use-item') as HTMLElement;
          if (elixirBtn && elixirBtn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(elixirBtn).trigger('tap');
            elixirBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (apHandled) {
          console.log(`[Run ${run}] AP replenished with Half-Elixir.`);
          await new Promise(r => setTimeout(r, 350));
          continue;
        }
      }

      // Check if supporter cards are mounted
      const cardCount = await page.evaluate(() => {
        return document.querySelectorAll('.lis-supporter').length;
      }).catch(() => 0);

      if (cardCount > 0) {
        supporterReady = true;
        break;
      }

      // Route via Game.router
      await page.evaluate((path) => {
        if ((window as any).Game?.router) {
          (window as any).Game.router.navigate(path, { trigger: true });
        }
      }, routerPath).catch(() => null);

      await new Promise(r => setTimeout(r, 100));
    }

    if (stopRequested) break;

    if (!supporterReady) {
      console.warn(`[Run ${run}] Supporter screen not ready, forcing page reload...`);
      await page.goto(questUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      await new Promise(r => setTimeout(r, 800));
    }

    // Step 2: Select Supporter Card by Priority
    const selectedSummon = await page.evaluate((priorities: string[]) => {
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
    }, raidDef.supporterPriorities).catch(() => null);

    console.log(`[Run ${run}] Selected Summon: ${selectedSummon || 'Default'}`);

    // Step 3: Deck Confirmation & Party Start (.se-quest-start)
    let okClicked = false;
    const tOk = Date.now();
    while (Date.now() - tOk < 4000) {
      if (stopRequested) break;

      // AP check
      if (autoElixir) {
        const apHandled = await page.evaluate(() => {
          const elixirBtn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use, .btn-use-item') as HTMLElement;
          if (elixirBtn && elixirBtn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(elixirBtn).trigger('tap');
            elixirBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (apHandled) {
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
      }

      // Check host item shortage modal
      const itemExhausted = await page.evaluate(() => {
        const pop = document.querySelector('.pop-usual, .pop-show');
        if (!pop) return false;
        const text = (pop as HTMLElement).innerText || '';
        return text.includes("don't have enough items") || text.includes('Shortage of items') || text.includes('トレジャーが足りません');
      }).catch(() => false);

      if (itemExhausted) {
        console.warn(`\n⚠️ [EventRaid] Host items (${eventDef.hostItemId}) exhausted! Cannot host ${raidDef.name}.`);
        console.log(`👉 Please farm host items via Very Hard: "bun run event:raid:vh 20"\n`);
        stopRequested = true;
        break;
      }

      // Dismiss network error popup if any
      const errorDismissed = await page.evaluate(() => {
        const errOk = document.querySelector('.common-pop-error .btn-usual-ok, .pop-usual.common-pop-error .btn-usual-ok') as HTMLElement;
        if (errOk && errOk.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(errOk).trigger('tap');
          errOk.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (errorDismissed) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // Click OK start button
      const clicked = await page.evaluate(() => {
        const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle') as HTMLElement;
        if (ok && ok.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (clicked) {
        okClicked = true;
        break;
      }

      await new Promise(r => setTimeout(r, 50));
    }

    if (stopRequested) break;

    // Step 4: Wait for Battle stage to mount
    let battleMounted = false;
    const tBattle = Date.now();
    while (Date.now() - tBattle < 7000) {
      if (stopRequested) break;
      const hash = await page.evaluate(() => window.location.hash).catch(() => '');
      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash)) {
        battleMounted = true;
        break;
      }
      await new Promise(r => setTimeout(r, 50));
    }

    if (!battleMounted) {
      console.warn(`[Run ${run}] Battle stage failed to mount within 7s. Moving to next run...`);
      continue;
    }

    // Step 5: Fast Quick Summon Trigger (under 1s)
    const summonPromise = page.waitForResponse(
      r => r.url().includes('summon_result.json') || r.url().includes('normal_attack_result.json'),
      { timeout: 3500 }
    ).catch(() => null);

    const tWaitQs = Date.now();
    let qsTriggered = false;
    while (Date.now() - tWaitQs < 3500) {
      if (stopRequested) break;

      qsTriggered = await page.evaluate(() => {
        // Tap ready overlay
        const ready = document.querySelector('#ready') as HTMLElement;
        if (ready && ready.style.display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ready).trigger('tap');
          ready.click();
        }

        const qs = document.querySelector('#js-btn-quick-summon, .btn-quick-summon') as HTMLElement;
        if (qs && (qs.classList.contains('qs-ready') || !qs.classList.contains('qs-hide'))) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(qs).trigger('tap');
          qs.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (qsTriggered) break;
      await new Promise(r => setTimeout(r, 40));
    }

    // Await server confirmation of combat action
    const summonRes = await summonPromise;

    // Step 6: Fast F5 Reload to skip victory sequence completely (~150ms)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);

    // Step 7: Seamlessly re-route to supporter URL
    await page.evaluate((path) => {
      if ((window as any).Game?.router) {
        (window as any).Game.router.navigate(path, { trigger: true });
      }
    }, routerPath).catch(() => null);

    completedRuns++;
    totalTokensEarned += tokenYield;
    const runElapsed = ((Date.now() - runStartTime) / 1000).toFixed(2);
    console.log(`⚡ [${accountId}] [Run ${run}] Cleared in ${runElapsed}s | Total Clears: ${completedRuns} (~${totalTokensEarned} Tokens)`);
  }

  const totalMinutes = ((Date.now() - sessionStartTime) / 60000).toFixed(1);
  const avgTime = completedRuns > 0 ? (((Date.now() - sessionStartTime) / 1000) / completedRuns).toFixed(2) : '0';

  console.log(`\n========================================================================`);
  console.log(`                 Event Raid Session Scorecard                           `);
  console.log(`========================================================================`);
  console.log(`Account:                 ${accountId} (${playerName})`);
  console.log(`Difficulty:              ${difficulty.toUpperCase()} - ${raidDef.name}`);
  console.log(`Total Battles Cleared:   ${completedRuns}`);
  console.log(`Average Time Per Clear:  ${avgTime}s`);
  console.log(`Est. Tokens Farmed:      ~${totalTokensEarned} Senka Tokens`);
  console.log(`Total Session Duration:  ${totalMinutes} minutes`);
  console.log(`========================================================================\n`);

  await cdpManager.disconnect();
}

main().catch(console.error);
