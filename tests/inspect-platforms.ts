import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;

  const authButtons = await page.evaluate(() => {
    const container = document.querySelector('.prt-select-auth, #mobage-game-container');
    if (!container) return 'No container';
    const platforms = Array.from(document.querySelectorAll('.btn-auth-platform, [data-platform], [class*="auth"]'));
    return platforms.map(p => ({
      className: p.className,
      dataAttrs: (p as HTMLElement).dataset,
      innerHTML: p.innerHTML,
      rect: p.getBoundingClientRect()
    }));
  });

  console.log('Platforms:', JSON.stringify(authButtons, null, 2));
  await cdp.disconnect();
}
main().catch(console.error);
