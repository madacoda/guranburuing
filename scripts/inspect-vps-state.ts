import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const [page] = await browser.pages();
  console.log('Current URL:', page.url());
  
  const client = await page.target().createCDPSession();
  const cookies = await client.send('Network.getCookies');
  console.log('Total browser cookies:', cookies.cookies.length);
  const midship = cookies.cookies.filter(c => c.name === 'midship');
  console.log('midship cookies:', JSON.stringify(midship.map(c => ({ domain: c.domain, val: c.value.slice(0, 20), exp: c.expires }))));

  // Check if page responds to simple evaluate
  try {
    const res = await Promise.race([
      page.evaluate(() => ({
        location: window.location.href,
        hasGame: !!(window as any).Game,
        hasUserId: !!(window as any).Game?.userId,
        title: document.title
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate timeout 5s')), 5000))
    ]);
    console.log('Evaluate result:', JSON.stringify(res, null, 2));
  } catch (e: any) {
    console.log('Evaluate failed:', e.message);
  }

  process.exit(0);
}

main().catch(console.error);
