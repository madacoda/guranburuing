// tests/test-headless-session.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { getSpeedProfile } from '../src/human-motor.js';

console.log('=====================================================');
console.log('      GBF Headless Session & Speed Diagnostic        ');
console.log('=====================================================');

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log(`\n[Diagnostic] Connected to Browser via CDP`);
console.log(`[Diagnostic] Page URL: ${page.url()}`);
console.log(`[Diagnostic] Page Title: ${await page.title()}`);
console.log(`[Diagnostic] Active Speed Profile: ${getSpeedProfile().toUpperCase()}`);

// 1. Check Anti-Detection Flags
const antiDetection = await page.evaluate(() => {
  return {
    webdriver: (navigator as any).webdriver,
    userAgent: navigator.userAgent,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    hasWebGL: !!window.WebGLRenderingContext,
  };
});
console.log('\n[Diagnostic] Anti-Detection & Fingerprint Status:');
console.log(`- navigator.webdriver: ${antiDetection.webdriver} ${antiDetection.webdriver ? '❌ (FLAGGED)' : '✅ (CLEAN / HIDDEN)'}`);
console.log(`- WebGL Available: ${antiDetection.hasWebGL ? '✅ (YES)' : '❌ (NO)'}`);
console.log(`- Hardware Concurrency: ${antiDetection.hardwareConcurrency} cores`);

// 2. Check Cookie & Auth Persistence
const cookies = await page.cookies();
const gbfCookies = cookies.filter(c => c.domain.includes('granbluefantasy') || c.domain.includes('mbga'));
console.log(`\n[Diagnostic] Cookies & Auth Status:`);
console.log(`- Total Cookies: ${cookies.length}`);
console.log(`- GBF/Mobage Cookies: ${gbfCookies.length}`);
for (const c of gbfCookies) {
  console.log(`  * ${c.domain}: ${c.name} (Length: ${c.value?.length || 0})`);
}

const hasMidship = gbfCookies.some(c => c.name === 'midship' && c.value);
const hasGbtk = gbfCookies.some(c => c.name === 'access_gbtk' && c.value);

if (hasMidship || hasGbtk) {
  console.log('🎉 Cookie & Session Authentication: VALID & ACTIVE!');
} else {
  console.warn('⚠️ Warning: Primary session cookies (midship/access_gbtk) not found.');
}

// 3. Check Screencast Frame Capability
console.log('\n[Diagnostic] Verifying CDP Screencast Streaming...');
const session = await page.target().createCDPSession();
let frameReceived = false;

session.on('Page.screencastFrame', async ({ sessionId, data }) => {
  frameReceived = true;
  await session.send('Page.screencastFrameAck', { sessionId });
  console.log(`✅ Screencast frame captured successfully! Base64 payload length: ${data.length} bytes`);
});

await session.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 50,
  maxWidth: 480,
  everyNthFrame: 1
});

// Wait up to 3 seconds for at least one frame
for (let i = 0; i < 15; i++) {
  if (frameReceived) break;
  await new Promise(r => setTimeout(r, 200));
}

await session.send('Page.stopScreencast');
await session.detach();

if (frameReceived) {
  console.log('🎉 Screencast verification: PASS (Mobile Companion PWA will stream perfectly in Headless)');
} else {
  console.warn('⚠️ Screencast frame not received within timeout.');
}

console.log('\n=====================================================');
console.log('                 Diagnostic Complete                 ');
console.log('=====================================================\n');

await browser.disconnect();
process.exit(0);
