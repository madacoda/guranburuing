// src/cli/solve-captcha.ts
import puppeteer from 'puppeteer-core';
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { SentinelWatchdog } from '../sentinel-watchdog.js';

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const codeArg = process.argv[2];
  const port = process.env.CDP_PORT || 9222;

  console.log('========================================================================');
  console.log('             Granblue Fantasy CAPTCHA Solver Assistant                  ');
  console.log('========================================================================\n');

  console.log(`[CaptchaSolver] Connecting to browser on CDP port ${port}...`);
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` }).catch(() => null);
  if (!browser) {
    console.error(`❌ Could not connect to browser on port ${port}. Ensure Chrome/Iron is running.`);
    process.exit(1);
  }

  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('granbluefantasy.jp'));
  if (!page) {
    console.error('❌ No active Granblue Fantasy tab found.');
    process.exit(1);
  }

  const sentinel = new SentinelWatchdog(page);
  const isCaptcha = await sentinel.inspectForVerification();
  if (!isCaptcha) {
    console.log('✅ No CAPTCHA / Access Verification challenge is currently visible on screen!');
    process.exit(0);
  }

  // Save current captcha image crop
  const capDir = path.resolve(process.cwd(), 'artifacts/captures');
  if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
  const cropPath = path.resolve(capDir, 'captcha-active.png');
  const imgEl = await page.$('img.image[src*="c/i"], img.image, .prt-c-a-i-input img, .pop-usual img');
  if (imgEl) {
    await imgEl.screenshot({ path: cropPath }).catch(() => null);
    console.log(`📸 CAPTCHA Image saved to: ${cropPath}\n`);
  }

  let codeToSubmit = codeArg;
  if (!codeToSubmit) {
    console.log('👉 A verification puzzle is blocking your game.');
    if (fs.existsSync(cropPath)) {
      console.log(`👉 Inspect the cropped image: ${cropPath}`);
    }
    codeToSubmit = await promptUser('Enter the verification text characters (or press Enter to cancel): ');
  }

  if (!codeToSubmit) {
    console.log('Operation cancelled by user.');
    process.exit(0);
  }

  console.log(`\nSubmitting code "${codeToSubmit}" to game...`);
  const success = await sentinel.submitCaptchaCode(codeToSubmit);
  if (success) {
    console.log('\n🎉 Verification successful! The challenge modal has been cleared.');
  } else {
    console.error('\n❌ Verification could not be cleared. Please check the code or solve in browser window.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
