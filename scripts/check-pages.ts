import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  console.log('Pages count:', pages.length);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    console.log(`[${i}] URL: ${p.url()} | Title: ${await p.title().catch(() => 'error')}`);
  }
  process.exit(0);
}

main().catch(console.error);
