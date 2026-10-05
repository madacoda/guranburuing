// scripts/apply-fresh-cookies.ts
import fs from 'fs';
import path from 'path';

const fresh = [
  {
    "domain": "game.granbluefantasy.jp",
    "expirationDate": 1793802170.953752,
    "hostOnly": true,
    "httpOnly": false,
    "name": "midship",
    "path": "/",
    "sameSite": null,
    "secure": false,
    "session": false,
    "storeId": null,
    "value": "S%3AWMNT0hkryDpGUt9d5YCRTx5DOpRFZ27fJWGJN3WBOf3kDy9lnfj-OSyz6LeqX8ruPiQIFqfWTr3Y6g-NgZnSSLdnDt0t_gUGbkcScjFE3XNomA7T2tWhyie52b8txQW012k-8Kd6szS_QgNa971NVVkgYmyb3RsmQ802g15qjpA7qpvhLvPYretPNg5x_0cim-x5g4Vgm5IBXXYKxACthpQEneFlnXvuTjtyiqd7WsX8jQ%3D%3D"
  },
  {
    "domain": "game.granbluefantasy.jp",
    "expirationDate": 1791211074,
    "hostOnly": true,
    "httpOnly": false,
    "name": "_dd_s",
    "path": "/",
    "sameSite": "strict",
    "secure": false,
    "session": false,
    "storeId": null,
    "value": "rum=0&expire=1791211064913"
  },
  {
    "domain": ".mobage.jp",
    "expirationDate": 1825769028.010694,
    "hostOnly": false,
    "httpOnly": false,
    "name": "CTID_P",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "f36c00c63cd96f9a3cd426743d7f9dd0694142e3"
  },
  {
    "domain": "connect.mobage.jp",
    "expirationDate": 1825770164.15853,
    "hostOnly": true,
    "httpOnly": false,
    "name": "REPLACE_SAMESITE",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": null,
    "value": "1"
  }
];

const targetPath = path.resolve('data', 'acc1-cookies.json');
let existing: any[] = [];
if (fs.existsSync(targetPath)) {
  try {
    existing = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
  } catch {}
}

const cookieMap = new Map<string, any>();

// Existing cookies first
for (const c of existing) {
  const k = `${c.domain}:${c.name}:${c.path || '/'}`;
  cookieMap.set(k, c);
}

// Fresh cookies overwrite
for (const c of fresh) {
  const domains = [c.domain];
  if (c.domain.includes('mobage.jp') || c.domain.includes('mbga.jp')) {
    domains.push('.mobage.jp', '.mbga.jp', 'connect.mobage.jp', 'sp.mbga.jp');
  }
  if (c.domain.includes('granbluefantasy.jp')) {
    domains.push('game.granbluefantasy.jp', '.game.granbluefantasy.jp', '.granbluefantasy.jp');
  }

  for (const dom of new Set(domains)) {
    const k = `${dom}:${c.name}:${c.path || '/'}`;
    cookieMap.set(k, {
      name: c.name,
      value: c.value,
      domain: dom,
      path: c.path || '/',
      secure: typeof c.secure === 'boolean' ? c.secure : false,
      httpOnly: typeof c.httpOnly === 'boolean' ? c.httpOnly : false,
      sameSite: c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : undefined,
      expires: typeof c.expirationDate === 'number' ? Math.floor(c.expirationDate) : undefined
    });
  }
}

const finalCookies = Array.from(cookieMap.values());
fs.writeFileSync(targetPath, JSON.stringify(finalCookies, null, 2), 'utf-8');
console.log(`Updated ${targetPath} with ${finalCookies.length} cookies.`);
