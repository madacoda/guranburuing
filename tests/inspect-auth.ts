import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  console.log('Connecting/launching acc1 on port 9222...');
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;
  console.log('Current URL:', page.url());

  // If not on #authentication, navigate to #authentication
  if (!page.url().includes('authentication')) {
    console.log('Navigating to https://game.granbluefantasy.jp/#authentication ...');
    await page.evaluate(() => {
      window.location.href = 'https://game.granbluefantasy.jp/#authentication';
    });
    await new Promise(r => setTimeout(r, 4000));
    console.log('URL after navigation:', page.url());
  }

  const data = await page.evaluate(() => {
    const list: any[] = [];
    const elements = document.querySelectorAll('a, button, div, span, img');
    for (const el of Array.from(elements)) {
      const cls = el.className || '';
      const text = (el as HTMLElement).innerText?.trim() || '';
      const id = el.id || '';
      const href = (el as any).href || '';
      const alt = (el as any).alt || '';
      const full = `${cls} ${text} ${id} ${href} ${alt}`.toLowerCase();
      if (full.includes('mobage') || full.includes('mbga') || full.includes('auth') || full.includes('login') || full.includes('dmm') || full.includes('gree')) {
        list.push({
          tag: el.tagName,
          id,
          cls,
          text: text.slice(0, 50),
          href,
          alt,
          visible: (el as HTMLElement).offsetParent !== null
        });
      }
    }
    return {
      hash: window.location.hash,
      title: document.title,
      matches: list.slice(0, 30)
    };
  });

  console.log('Auth elements:', JSON.stringify(data, null, 2));
  await page.screenshot({ path: 'scratch-auth-state.png' });
  console.log('Screenshot saved to scratch-auth-state.png');
  await cdp.disconnect();
}

main().catch(console.error);
