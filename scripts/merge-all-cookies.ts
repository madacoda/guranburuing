// scripts/merge-all-cookies.ts
import fs from 'fs';
import path from 'path';

const ironFile = path.resolve('data', 'iron-cookies.json');
const acc1File = path.resolve('data', 'acc1-cookies.json');

const ironCookies = fs.existsSync(ironFile) ? JSON.parse(fs.readFileSync(ironFile, 'utf-8')) : [];
const acc1Cookies = fs.existsSync(acc1File) ? JSON.parse(fs.readFileSync(acc1File, 'utf-8')) : [];

console.log(`Iron cookies: ${ironCookies.length}, Acc1 cookies: ${acc1Cookies.length}`);

// Combine cookies: acc1 takes priority for game cookies, iron provides Mobage auth tokens
const cookieMap = new Map<string, any>();

function addCookie(c: any) {
  if (!c.name || !c.value) return;
  // Ignore garbled binary cookies
  if (c.value.includes('\ufffd') || c.value.includes('\x00')) return;

  const domains = [c.domain];
  if (c.domain.includes('mbga.jp') || c.domain.includes('mobage.jp')) {
    domains.push('.mbga.jp', '.sp.mbga.jp', 'sp.mbga.jp', 'connect.mobage.jp', '.mobage.jp');
  }
  if (c.domain.includes('granbluefantasy.jp')) {
    domains.push('.granbluefantasy.jp', '.game.granbluefantasy.jp', 'game.granbluefantasy.jp');
  }

  for (const dom of new Set(domains)) {
    const key = `${dom}:${c.name}:${c.path || '/'}`;
    cookieMap.set(key, {
      name: c.name,
      value: c.value,
      domain: dom,
      path: c.path || '/',
      secure: typeof c.secure === 'boolean' ? c.secure : false,
      httpOnly: typeof c.httpOnly === 'boolean' ? c.httpOnly : false,
      sameSite: c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : undefined,
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : undefined
    });
  }
}

// 1. Add Iron cookies (Mobage auth session)
for (const c of ironCookies) addCookie(c);

// 2. Add Acc1 cookies (Fresh game cookies take priority)
for (const c of acc1Cookies) addCookie(c);

const merged = Array.from(cookieMap.values());
console.log(`Total merged and mirrored cookies: ${merged.length}`);

// Write back to acc1-cookies.json
fs.writeFileSync(acc1File, JSON.stringify(merged, null, 2), 'utf-8');
console.log(`Saved merged cookies to: ${acc1File}`);
