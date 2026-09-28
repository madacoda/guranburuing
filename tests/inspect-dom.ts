import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;

  const html = await page.evaluate(() => {
    const auth = document.querySelector('.prt-select-auth, #mobage-game-container');
    return auth?.outerHTML;
  });
  console.log('HTML:\n', html);

  await cdp.disconnect();
}
main().catch(console.error);
