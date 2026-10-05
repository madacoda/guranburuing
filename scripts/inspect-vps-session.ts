// scripts/inspect-vps-session.ts
import puppeteer from 'puppeteer-core';
import fs from 'fs';

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const pages = await browser.pages();
  const page = pages.find(p => !p.url().startsWith('chrome://')) || pages[0];

  // Enable request & response interception/logging
  const client = await page.target().createCDPSession();
  
  console.log('Navigating to https://game.granbluefantasy.jp/#mypage ...');
  await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'networkidle2', timeout: 15000 }).catch(e => console.log('Goto notice:', e.message));

  await new Promise(r => setTimeout(r, 4000));

  const url = page.url();
  const title = await page.title();
  console.log('Current URL:', url);
  console.log('Page Title:', title);

  const evaluation = await page.evaluate(() => {
    const Game = (window as any).Game;
    const bodyText = document.body ? document.body.innerText.slice(0, 500) : '';
    const startBtn = document.querySelector('#start, .btn-start, [data-location-href="start"]');
    const loginBtn = document.querySelector('#login-auth, .btn-login, [data-location-href="authentication"]');
    const mypage = document.querySelector('.cnt-mypage, .prt-user-info');
    
    return {
      hash: window.location.hash,
      hasGame: !!Game,
      userId: Game?.userId || null,
      userName: Game?.userName || null,
      hasStartBtn: !!startBtn,
      hasLoginBtn: !!loginBtn,
      hasMypage: !!mypage,
      previewText: bodyText.replace(/\s+/g, ' ')
    };
  }).catch(e => ({ error: e.message }));

  console.log('Page Evaluation:', JSON.stringify(evaluation, null, 2));

  // Take screenshot
  await page.screenshot({ path: '/var/www/guranburuing/data/session-screenshot.png' }).catch(() => null);
  console.log('Saved screenshot to /var/www/guranburuing/data/session-screenshot.png');

  await browser.disconnect();
}

main().catch(console.error);
