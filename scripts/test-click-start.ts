import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const page = pages[0];

  const clicked = await page.evaluate(() => {
    const startBtn = document.querySelector('.btn-usual-ok.se-quest-start, .btn-start, #start') as HTMLElement;
    if (startBtn && startBtn.offsetParent !== null) {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(startBtn).trigger('tap');
      startBtn.click();
      return true;
    }
    return false;
  });

  console.log('Clicked start:', clicked);
  await new Promise(r => setTimeout(r, 3000));
  console.log('Current URL after start:', page.url());

  await browser.disconnect();
}

main().catch(console.error);
