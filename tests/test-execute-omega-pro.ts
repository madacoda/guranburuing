// tests/test-execute-omega-pro.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { logNormalDelay } from '../src/human-motor.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();
const sentinel = new SentinelWatchdog(page);

console.log('Navigating to #quest/extra...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2000));

// Open Pro modal
console.log('Opening .btn-pro-list modal...');
await page.evaluate(() => {
  const modal = document.querySelector('.pop-pro-quest-list.pop-show');
  if (!modal) {
    const btn = document.querySelector('.btn-pro-list, #js-pro-list-button .btn-pro-list') as HTMLElement;
    if (btn) {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(btn).trigger('tap');
      btn.click();
    }
  }
});
await page.waitForSelector('.pop-pro-quest-list.pop-show', { visible: true, timeout: 5000 });
await logNormalDelay(500, 0.15);

// Switch to tab "high" or "extra" where Omega Pro lives
console.log('Switching to High tab in Pro list modal...');
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.pop-pro-quest-list .btn-quest-type')) as HTMLElement[];
  const highTab = tabs.find(t => t.getAttribute('data-type') === 'high' || t.getAttribute('data-tab-no') === '1');
  if (highTab) {
    const $ = (window as any).$ || (window as any).Zepto;
    if ($) $(highTab).trigger('tap');
    highTab.click();
  }
});
await logNormalDelay(600, 0.15);

// Locate Omega Pro button (questId: 305441)
console.log('Locating Omega Pro (305441)...');
const omegaState = await page.evaluate(() => {
  const btn = document.querySelector('.pop-pro-quest-list .btn-set-quest[data-quest-id="305441"], .pop-pro-quest-list .btn-set-quest[data-chapter-id="30544"]') as HTMLElement;
  if (!btn) return { found: false };
  const limited = btn.getAttribute('data-limited_count');
  return {
    found: true,
    limitedCount: limited,
    isCleared: limited === '0' || btn.classList.contains('disable')
  };
});
console.log('Omega Pro State:', JSON.stringify(omegaState));

if (omegaState.found && !omegaState.isCleared) {
  console.log('Clicking Omega Pro .btn-set-quest...');
  await page.evaluate(() => {
    const btn = document.querySelector('.pop-pro-quest-list .btn-set-quest[data-quest-id="305441"], .pop-pro-quest-list .btn-set-quest[data-chapter-id="30544"]') as HTMLElement;
    if (btn) {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(btn).trigger('tap');
      btn.click();
    }
  });

  // Wait for confirmation modal
  console.log('Awaiting confirmation modal (.pop-pro-quest-skip)...');
  await page.waitForSelector('.pop-pro-quest-skip .btn-usual-ok', { visible: true, timeout: 6000 });
  await logNormalDelay(400, 0.15);

  // Click confirm
  console.log('Confirming skip dialog...');
  await page.evaluate(() => {
    const okBtn = document.querySelector('.pop-pro-quest-skip .btn-usual-ok') as HTMLElement;
    if (okBtn) {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(okBtn).trigger('tap');
      okBtn.click();
    }
  });

  // Await supporter screen (.se-quest-start)
  console.log('Awaiting supporter screen (.btn-usual-ok.se-quest-start)...');
  await page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start', { visible: true, timeout: 8000 });
  await logNormalDelay(500, 0.15);

  // Click final start button
  console.log('Clicking final start button (.se-quest-start)...');
  await page.evaluate(() => {
    const startBtn = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start') as HTMLElement;
    if (startBtn) {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(startBtn).trigger('tap');
      startBtn.click();
    }
  });

  // Wait for result screen
  console.log('Awaiting result resolution (#result_pro_quest_skip)...');
  await page.waitForFunction(() => {
    return window.location.hash.includes('result_pro_quest_skip') || !!document.querySelector('.pop-exp, .prt-result-head');
  }, { timeout: 10000 });

  console.log('🎉 OMEGA PRO SKIP CLEARED SUCCESSFULLY!');
  await logNormalDelay(1000, 0.2);

  // Dismiss popups
  console.log('Dismissing reward popups...');
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      const closeBtn = document.querySelector('.btn-result-close, .btn-usual-ok, .btn-usual-close') as HTMLElement;
      if (closeBtn) closeBtn.click();
    });
    await logNormalDelay(300, 0.15);
  }
}

await browser.disconnect();
process.exit(0);
