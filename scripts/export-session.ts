// scripts/export-session.ts
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
const accountId = args.find(a => !a.startsWith('-')) || 'acc1';
const isWindows = process.platform === 'win32';

// Resolve profile directory
let profileDir = '';
if (isWindows) {
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\YOUR_USER';
  const candidate1 = path.join(userProfile, '.gbf-profiles', accountId);
  const candidate2 = path.join('C:\\Users\\YOUR_USER\\.gbf-profiles', accountId);
  const candidate3 = path.join(userProfile, '.gbf-chrome-profile');

  if (fs.existsSync(candidate1)) profileDir = candidate1;
  else if (fs.existsSync(candidate2)) profileDir = candidate2;
  else if (fs.existsSync(candidate3)) profileDir = candidate3;
  else profileDir = candidate1;
} else {
  profileDir = `/var/www/${accountId}`;
}

const cdpPort = 9222;
const outputDir = path.resolve(process.cwd(), 'data');
const outputFile = path.join(outputDir, `${accountId}-cookies.json`);

console.log('========================================================================');
console.log(`        Granblue Fantasy Local Cookie & Session Exporter               `);
console.log(`               Account: [${accountId}]                                `);
console.log('========================================================================');
console.log(`Operating System:   ${process.platform}`);
console.log(`Profile Directory:  ${profileDir}`);
console.log(`Output Target:      ${outputFile}`);
console.log('========================================================================\n');

function findChromePath(): string {
  if (isWindows) {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files\\SRWare Iron (64-Bit)\\chrome.exe',
      'C:\\Program Files\\SRWare Iron\\chrome.exe'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'chrome.exe';
  } else {
    const candidates = [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'google-chrome';
  }
}

async function main() {
  const chromeExe = findChromePath();
  console.log(`[Export] Using browser executable: ${chromeExe}`);

  // Check if Chrome is already listening on port 9222
  let alreadyRunning = false;
  try {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) alreadyRunning = true;
  } catch {}

  let chromeProcess: any = null;
  if (!alreadyRunning) {
    console.log(`[Export] Launching browser on port ${cdpPort} with user profile...`);
    const chromeArgs = [
      `--remote-debugging-port=${cdpPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      'https://game.granbluefantasy.jp/#profile'
    ];

    chromeProcess = spawn(chromeExe, chromeArgs, {
      detached: true,
      stdio: 'ignore'
    });

    // Wait for CDP to be responsive
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(500) });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
    }

    if (!ready) {
      throw new Error(`Failed to connect to browser on port ${cdpPort} after launch.`);
    }
  } else {
    console.log(`[Export] Connecting to already running browser on port ${cdpPort}...`);
  }

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}` });
  const pages = await browser.pages();
  const page = pages[0] || (await browser.newPage());

  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');

  console.log(`[Export] Total cookies found in profile: ${cookies.length}`);

  // Filter relevant game & auth cookies
  const relevantCookies = cookies.filter(c => {
    const domain = (c.domain || '').toLowerCase();
    return (
      domain.includes('granbluefantasy.jp') ||
      domain.includes('mbga.jp') ||
      domain.includes('mobage.jp') ||
      domain.includes('dmm.com')
    );
  });

  console.log(`[Export] GBF / Mobage / Auth cookies extracted: ${relevantCookies.length}`);

  const hasMidship = relevantCookies.some(c => c.name === 'midship');
  const hasGbtk = relevantCookies.some(c => c.name === 'access_gbtk');
  const hasMobage = relevantCookies.some(c => c.domain.includes('mobage') || c.domain.includes('mbga'));

  console.log(`  - Has 'midship' (GBF Session):    ${hasMidship ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Has 'access_gbtk' (GBF Token):   ${hasGbtk ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Has Mobage Auth Session:       ${hasMobage ? '✅ YES' : '❌ NO'}`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save to file
  fs.writeFileSync(outputFile, JSON.stringify(relevantCookies, null, 2), 'utf-8');
  console.log(`\n🎉 SUCCESS: Cookies successfully exported to:\n   ${outputFile}`);

  await browser.disconnect();

  if (chromeProcess && chromeProcess.pid) {
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', String(chromeProcess.pid), '/f', '/t']);
      } else {
        process.kill(-chromeProcess.pid);
      }
    } catch {}
  }
}

main().catch(err => {
  console.error('\n❌ Exporter Error:', err.message);
  process.exit(1);
});
