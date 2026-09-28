// tests/check-session.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Connected to Chrome!');
console.log('Page URL:', page.url());
console.log('Page Title:', await page.title());

const cookies = await page.cookies();
console.log('Total Cookies Found:', cookies.length);
const gbfCookies = cookies.filter(c => c.domain.includes('granbluefantasy') || c.domain.includes('mbga'));
console.log('GBF/Mobage Cookies count:', gbfCookies.length);
for (const c of gbfCookies) {
  console.log(`- ${c.domain}: ${c.name} (${c.value ? 'has_value' : 'empty'})`);
}

// Save screenshot
await page.screenshot({ path: 'scratch/screen.png' });
console.log('Saved screenshot to scratch/screen.png');

// Check if #mypage elements or login elements exist
const content = await page.content();
if (content.includes('prt-user-info') || content.includes('cnt-mypage') || content.includes('btn-mypage')) {
  console.log('🎉 Account state: LOGGED IN (#mypage detected)!');
} else if (content.includes('btn-login') || content.includes('login_auth')) {
  console.log('⚠️ Account state: Login screen detected.');
} else {
  console.log('ℹ️ Page loaded content length:', content.length);
}

// Try navigating hash to #mypage
console.log('Attempting hash navigation to #mypage...');
await page.evaluate(() => { window.location.hash = '#mypage'; });
await new Promise(r => setTimeout(r, 3000));
console.log('URL after attempting #mypage:', page.url());
await page.screenshot({ path: 'scratch/screen-mypage.png' });

await browser.disconnect();
process.exit(0);
