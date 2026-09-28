import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;

  const info = await page.evaluate(() => {
    const ok = document.querySelector('.btn-ok');
    const zeptoEvents = (window as any).$ ? (window as any).$._data?.(ok, 'events') : null;
    
    // Look at Game or Backbone view
    const view = (window as any).Game?.view || (window as any).stage;
    return {
      okHtml: ok?.outerHTML,
      okClass: ok?.className,
      zeptoEvents: zeptoEvents ? Object.keys(zeptoEvents) : null,
      href: (ok as any)?.href
    };
  });
  console.log('OK Handler Info:', info);

  // Check network requests or window.open when clicked
  page.on('request', req => console.log('REQ:', req.url()));
  page.on('response', res => console.log('RESP:', res.url(), res.status()));
  page.on('popup', pop => console.log('POPUP DETECTED:', pop.url()));

  console.log('Dispatching tap to .btn-ok...');
  await page.evaluate(() => {
    const ok = document.querySelector('.btn-ok') as HTMLElement;
    if (ok) {
      // Dispatch both touchstart, touchend, tap, click
      const touchObj = new Touch({
        identifier: Date.now(),
        target: ok,
        clientX: 230,
        clientY: 187
      });
      const touchEvent = new TouchEvent('touchend', {
        touches: [],
        targetTouches: [],
        changedTouches: [touchObj],
        bubbles: true,
        cancelable: true
      });
      ok.dispatchEvent(touchEvent);
      (window as any).$?.(ok).trigger('tap');
      ok.click();
    }
  });

  await new Promise(r => setTimeout(r, 4000));
  console.log('Page URL now:', page.url());
  await page.screenshot({ path: 'scratch-after-touch-event.png' });

  await cdp.disconnect();
}
main().catch(console.error);
