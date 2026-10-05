import fs from 'fs';
import path from 'path';

function main() {
  const ironFile = path.resolve('data/iron-cookies.json');
  const acc1File = path.resolve('data/acc1-cookies.json');

  const ironCookies: any[] = JSON.parse(fs.readFileSync(ironFile, 'utf-8'));
  const acc1Cookies: any[] = JSON.parse(fs.readFileSync(acc1File, 'utf-8'));

  // Merge map keyed by domain:name:path
  const cookieMap = new Map<string, any>();

  for (const c of acc1Cookies) {
    const key = `${c.domain}:${c.name}:${c.path || '/'}`;
    cookieMap.set(key, c);
  }

  // Overwrite with fresh iron cookies
  for (const c of ironCookies) {
    // If it's dd_s corrupted by binary, skip
    if (c.name === '_dd_s' && typeof c.value === 'string' && c.value.includes('\ufffd')) continue;

    const base: any = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      expires: c.expires || Math.floor(Date.now() / 1000) + 365 * 86400
    };

    cookieMap.set(`${base.domain}:${base.name}:${base.path}`, base);

    // If midship, explicitly mirror across all 3 domains
    if (c.name === 'midship') {
      cookieMap.set(`game.granbluefantasy.jp:midship:/`, { ...base, domain: 'game.granbluefantasy.jp' });
      cookieMap.set(`.game.granbluefantasy.jp:midship:/`, { ...base, domain: '.game.granbluefantasy.jp' });
      cookieMap.set(`.granbluefantasy.jp:midship:/`, { ...base, domain: '.granbluefantasy.jp' });
    }

    // Mirror Mobage tokens
    if (c.domain && c.domain.includes('mobage.jp')) {
      cookieMap.set(`.mobage.jp:${base.name}:${base.path}`, { ...base, domain: '.mobage.jp' });
      cookieMap.set(`connect.mobage.jp:${base.name}:${base.path}`, { ...base, domain: 'connect.mobage.jp' });
      cookieMap.set(`.mbga.jp:${base.name}:${base.path}`, { ...base, domain: '.mbga.jp' });
    }
  }

  const merged = Array.from(cookieMap.values());
  fs.writeFileSync(acc1File, JSON.stringify(merged, null, 2), 'utf-8');
  console.log(`Successfully merged fresh Iron cookies into ${acc1File}. Total cookies: ${merged.length}`);
  
  const midship = merged.filter(x => x.name === 'midship');
  console.log('Active midship values:', midship.map(x => ({ domain: x.domain, val: x.value.slice(0, 30) })));
}

main();
