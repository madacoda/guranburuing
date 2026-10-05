import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const { page } = await cdp.connectWithRetry(1, 1000, true, { cdpPort: 9222, profileDir: '/var/www/acc1' });
  const gameData = await page.evaluate(() => {
    const G = (window as any).Game;
    return {
      userId: G?.userId,
      userName: G?.userName,
      version: G?.version,
      hasRouter: !!G?.router,
      hasView: !!G?.view,
      currentView: G?.view?.currentView?.id || G?.view?.currentView?.className,
      locationHash: window.location.hash,
      stage: !!(window as any).stage
    };
  });
  console.log('Game Data:', JSON.stringify(gameData, null, 2));
  await cdp.disconnect();
}

main().catch(console.error);
