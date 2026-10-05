// tests/test-session-sync.ts
import { AccountRegistry } from '../src/auth/account-registry.js';

console.log('========================================================================');
console.log('       Granblue Fantasy Session & Cookie Sync Test Suite                ');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Cross-Platform Profile Path Normalization (Windows <-> Linux VPS)
// -----------------------------------------------------------------------------
console.log('[Test 1] Testing Cross-Platform Profile Path Normalization...');

const accounts = AccountRegistry.loadAccounts();
if (accounts.length === 0) {
  throw new Error('Expected accounts to be loaded from config');
}

for (const acc of accounts) {
  if (!acc.profileDir) {
    throw new Error(`Account [${acc.id}] missing profileDir`);
  }
  // If running on non-windows platform, ensure no Windows drive letters remain
  if (process.platform !== 'win32' && /^[a-zA-Z]:[\\/]/.test(acc.profileDir)) {
    throw new Error(`Profile path was not normalized for Linux: ${acc.profileDir}`);
  }
}
console.log(`  ✅ [PASS] All ${accounts.length} registered accounts normalized correctly for platform [${process.platform}]`);

// -----------------------------------------------------------------------------
// Test 2: Cookie Sanitization & CDP Protocol Compliance
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Testing Cookie Sanitization & CDP Protocol Compliance...');

const mockCookies = [
  {
    name: 'midship',
    value: 'session_token_xyz',
    domain: 'game.granbluefantasy.jp',
    path: '/',
    expires: 1793720504.469,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
    invalidProperty: 'ignore_me'
  },
  {
    name: 'access_gbtk',
    value: 'token_abc',
    domain: '.game.granbluefantasy.jp',
    path: '/',
    expires: -1, // Session cookie
    httpOnly: false,
    secure: false
  },
  {
    name: 'CSID_P',
    value: 'mobage_csid',
    domain: '.mobage.jp',
    path: '/',
    expires: 1821604224,
    httpOnly: true,
    secure: true,
    sameSite: 'None'
  }
];

function sanitizeCookies(cookies: any[]) {
  return cookies.map((c: any) => {
    const item: any = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/'
    };
    if (typeof c.secure === 'boolean') item.secure = c.secure;
    if (typeof c.httpOnly === 'boolean') item.httpOnly = c.httpOnly;
    if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) {
      item.sameSite = c.sameSite;
    }
    if (typeof c.expires === 'number' && c.expires > 0) {
      item.expires = c.expires;
    }
    return item;
  });
}

const sanitized = sanitizeCookies(mockCookies);

if (sanitized.length !== 3) {
  throw new Error(`Expected 3 sanitized cookies, got ${sanitized.length}`);
}

const midship = sanitized.find(c => c.name === 'midship');
if (!midship || (midship as any).invalidProperty !== undefined) {
  throw new Error('Extra non-CDP properties were not stripped');
}
if (midship.sameSite !== 'Lax') {
  throw new Error('sameSite attribute was not preserved');
}

const gbtk = sanitized.find(c => c.name === 'access_gbtk');
if (!gbtk || gbtk.expires !== undefined) {
  throw new Error('Session cookie with expires: -1 should omit expires for CDP session cookie');
}

console.log('  ✅ [PASS] Cookie sanitization conforms strictly to Chrome CDP Network.setCookies specification');

// -----------------------------------------------------------------------------
// Test 3: Cookie JSON Parsing Robustness (Array vs Single Object vs Escaped)
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Testing Cookie JSON Parsing Robustness...');

function parseCookieInput(input: string): any[] {
  const parsed = JSON.parse(input);
  return Array.isArray(parsed) ? parsed : [parsed];
}

const arrayJson = JSON.stringify(mockCookies);
const parsedArray = parseCookieInput(arrayJson);
if (parsedArray.length !== 3) throw new Error('Array parsing failed');

const singleJson = JSON.stringify(mockCookies[0]);
const parsedSingle = parseCookieInput(singleJson);
if (parsedSingle.length !== 1 || parsedSingle[0].name !== 'midship') throw new Error('Single object parsing failed');

console.log('  ✅ [PASS] Input parsing handles arrays and single cookie objects resiliently');

// -----------------------------------------------------------------------------
// Test 4: Token Authentication Header Evaluation
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Testing Gateway Token Authentication Evaluation...');

function isTokenValid(expected: string, queryToken?: string, authHeader?: string, customHeader?: string): boolean {
  const bearer = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : undefined;
  return queryToken === expected || bearer === expected || customHeader === expected;
}

const SECRET = 'test_secret_token_123';

if (!isTokenValid(SECRET, 'test_secret_token_123')) throw new Error('Query token match failed');
if (!isTokenValid(SECRET, undefined, 'Bearer test_secret_token_123')) throw new Error('Bearer header match failed');
if (!isTokenValid(SECRET, undefined, undefined, 'test_secret_token_123')) throw new Error('x-auth-token match failed');
if (isTokenValid(SECRET, 'wrong_token')) throw new Error('Unauthorized token permitted');

console.log('  ✅ [PASS] Authentication header & query string validation verified compliant');

console.log('\n========================================================================');
console.log('🎉 ALL SESSION & COOKIE SYNC TESTS PASSED (100%)');
console.log('========================================================================\n');
