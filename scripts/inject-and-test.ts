// scripts/inject-and-test.ts
import puppeteer from 'puppeteer-core';
import { AccountRegistry } from '../src/auth/account-registry.js';
import { AccountAuthManager } from '../src/auth/account-auth.manager.js';
import { CdpConnectionManager } from '../src/cdp-connection.js';
import fs from 'fs';
import path from 'path';

async function main() {
  const rawMidship = "S:iOgV7O-YA_pZMWLUL5W14XO0s5L4vedBE2tT1mkycw8YHr2holm7dpPsYAXyKBgI3uvA24HANG9xB2Qbfbc2zyMu9AQghGnY3j4av2ShQRhnHd9Jio-nPXbe9JwImMwY4LaVX6cUkHLrwrtemOveb9FkTPSL4oas1vvt3t2CEv0xJjvN9kxZs12nHoaQ6hpdgmXdTKT7u6FnKygwAf3au7HeZ16RUIfPVcG5q1v9iBNyaw==";
  const encodedMidship = rawMidship.startsWith('S:') ? rawMidship.replace('S:', 'S%3A') : rawMidship;

  console.log('Testing raw midship:', rawMidship.slice(0, 30));
  console.log('Testing encoded midship:', encodedMidship.slice(0, 30));

  const account = AccountRegistry.getAccountById('acc1');
  if (!account) throw new Error('Account acc1 not found');

  const cdp = new CdpConnectionManager();
  console.log('Connecting to Chrome CDP...');
  const conn = await cdp.connectWithRetry(6, 2000, true, {
    cdpPort: account.cdpPort,
    profileDir: account.profileDir,
    proxy: account.proxy
  });

  const page = conn.page;
  const client = await page.target().createCDPSession();

  console.log('Clearing existing browser cookies...');
  await client.send('Network.clearBrowserCookies');

  const cookiesToSet = [
    {
      name: 'midship',
      value: encodedMidship,
      domain: '.game.granbluefantasy.jp',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
    },
    {
      name: 'midship',
      value: encodedMidship,
      domain: 'game.granbluefantasy.jp',
      path: '/',
      secure: true,
      httpOnly: true,
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
    }
  ];

  console.log('Injecting midship cookies via CDP...');
  await client.send('Network.setCookies', { cookies: cookiesToSet });

  // Save to data/acc1-cookies.json
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'acc1-cookies.json'), JSON.stringify(cookiesToSet, null, 2), 'utf-8');

  console.log('Navigating to https://game.granbluefantasy.jp/#profile ...');
  await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
  await new Promise(r => setTimeout(r, 4000));

  console.log('Landed on URL:', page.url());

  // Check Game state
  const state = await page.evaluate(() => {
    const Game = (window as any).Game;
    const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
    const rankEl = document.querySelector('.prt-rank-value');
    const idEl = document.querySelector('.prt-user-id, .txt-user-id');
    return {
      userId: Game?.userId || null,
      userName: Game?.userName || nameEl?.textContent?.trim() || null,
      rank: rankEl?.textContent?.trim() || null,
      id: idEl?.textContent?.trim() || null,
      hash: window.location.hash
    };
  }).catch(() => null);

  console.log('Page State:', JSON.stringify(state, null, 2));

  const profile = await AccountAuthManager.ensureAuthenticated(page, account);

  if (profile) {
    console.log('\n========================================================================');
    console.log(`🎉 SUCCESS: Connected & Authenticated to GBF!`);
    console.log(`   Player Name:      ${profile.name}`);
    console.log(`   Player Rank:      ${profile.rank}`);
    console.log(`   User ID:          ${profile.id}`);
    console.log('========================================================================\n');
  } else {
    console.log('Verification returned null. Trying raw midship...');
    await client.send('Network.clearBrowserCookies');
    const rawCookiesToSet = cookiesToSet.map(c => ({ ...c, value: rawMidship }));
    await client.send('Network.setCookies', { cookies: rawCookiesToSet });
    await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
    await new Promise(r => setTimeout(r, 4000));
    const retryProfile = await AccountAuthManager.ensureAuthenticated(page, account);
    console.log('Retry profile:', retryProfile);
  }

  await cdp.disconnect();
}

main().catch(console.error);
