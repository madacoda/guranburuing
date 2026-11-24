// tests/test-cdp-raf-fps.ts
import assert from 'assert';
import { config } from '../src/config.js';
import { CdpConnectionManager } from '../src/cdp-connection.js';

console.log('========================================================================');
console.log('      CDP Headless rAF FPS & Tab Recycle Optimization Unit Tests        ');
console.log('========================================================================\n');

// 1. Default local config must preserve 60 FPS native rAF
console.log('1. Checking default HEADLESS_RAF_FPS on current environment...');
if (!config.isProduction) {
  assert.strictEqual(
    config.HEADLESS_RAF_FPS,
    60,
    `Expected local HEADLESS_RAF_FPS=60, got ${config.HEADLESS_RAF_FPS}`
  );
  console.log(`   ✅ Local HEADLESS_RAF_FPS=${config.HEADLESS_RAF_FPS} (native 60Hz rAF preserved)`);
} else {
  assert.strictEqual(config.HEADLESS_RAF_FPS, 15, `Expected production HEADLESS_RAF_FPS=15, got ${config.HEADLESS_RAF_FPS}`);
  console.log(`   ✅ Production HEADLESS_RAF_FPS=${config.HEADLESS_RAF_FPS}`);
}

// 2. 15 FPS script throttles rAF (~67ms frame target) + retains sprite/canvas/CSS diets
console.log('\n2. Validating buildPageDietScript(15)...');
const script15 = CdpConnectionManager.buildPageDietScript(15);
assert(script15.includes('window.requestAnimationFrame = function(cb)'), '15fps script must override requestAnimationFrame');
assert(script15.includes('67 - Math.max(0, now - lastRafMs)'), '15fps script must target 67ms frame budget');
assert(script15.includes('window.__gbfRafTargetFps = 15'), '15fps script must record target FPS');
assert(script15.includes('window.__gbfRafThrottled15Fps = true'), '15fps script must keep legacy 15fps marker');
assert(script15.includes('__gbfLayer2SpriteDietInstalled'), '15fps script must include sprite 1x1 GIF diet');
assert(script15.includes('__gbf_canvas_throttler_installed__'), '15fps script must include 1-FPS Canvas/WebGL paint gate');
console.log('   ✅ 15fps script verified (67ms frame cap + sprite/canvas/CSS diet)');

// 3. 30 FPS script throttles rAF (~33ms frame target) + retains sprite/canvas/CSS diets
console.log('\n3. Validating buildPageDietScript(30)...');
const script30 = CdpConnectionManager.buildPageDietScript(30);
assert(script30.includes('window.requestAnimationFrame = function(cb)'), '30fps script must override requestAnimationFrame');
assert(script30.includes('33 - Math.max(0, now - lastRafMs)'), '30fps script must target 33ms frame budget');
assert(script30.includes('window.__gbfRafTargetFps = 30'), '30fps script must record target FPS=30');
assert(!script30.includes('__gbfRafThrottled15Fps = true'), '30fps script must not set 15fps flag');
assert(script30.includes('__gbfLayer2SpriteDietInstalled'), '30fps script must include sprite 1x1 GIF diet');
assert(script30.includes('__gbf_canvas_throttler_installed__'), '30fps script must include 1-FPS Canvas/WebGL paint gate');
console.log('   ✅ 30fps script verified (33ms frame cap + sprite/canvas/CSS diet)');

// 4. 60 FPS and 0 FPS omit requestAnimationFrame override while preserving sprite/canvas/CSS diets
console.log('\n4. Validating buildPageDietScript(60) and buildPageDietScript(0)...');
for (const fps of [60, 0]) {
  const script = CdpConnectionManager.buildPageDietScript(fps);
  assert(!script.includes('window.requestAnimationFrame = function'), `${fps}fps script must NOT override window.requestAnimationFrame`);
  assert(script.includes('window.__gbfRafTargetFps = 60'), `${fps}fps script must mark 60Hz target`);
  assert(script.includes('gbf-headless-cpu-diet'), `${fps}fps script must keep CSS animation suppressor`);
  assert(script.includes('__gbfLayer2SpriteDietInstalled'), `${fps}fps script must keep 1x1 sprite GIF diet`);
  assert(script.includes('__gbf_canvas_throttler_installed__'), `${fps}fps script must keep 1-FPS Canvas/WebGL paint gate`);
}
console.log('   ✅ 60fps / 0fps scripts preserve native rAF while keeping sprite, canvas, and CSS diets');

// 5. Mocked recycleTab() must call optimizePageEnvironment BEFORE goto() when lastIsHeadless=true and fire reconnectListeners
console.log('\n5. Validating recycleTab() applies optimizePageEnvironment before goto() in headless mode...');
const callOrder: string[] = [];
const evaluatedNewDocScripts: string[] = [];
const cdpCommands: string[] = [];

const makeMockPage = (urlStr: string) => ({
  url: () => urlStr,
  isClosed: () => false,
  target: () => ({}),
  close: async () => undefined,
  evaluate: async (fnOrStr: any) => {
    if (typeof fnOrStr === 'function') {
      callOrder.push('page.evaluate(fn)');
    } else {
      callOrder.push('page.evaluate(diet)');
    }
    return null;
  },
  evaluateOnNewDocument: async (script: string) => {
    callOrder.push('evaluateOnNewDocument');
    evaluatedNewDocScripts.push(script);
  },
  goto: async (dest: string) => {
    callOrder.push(`goto:${dest}`);
    return null;
  },
  _client: () => ({
    send: async (method: string) => {
      cdpCommands.push(method);
      callOrder.push(`cdp:${method}`);
    }
  })
});

const oldMockPage = makeMockPage('https://game.granbluefantasy.jp/#quest/supporter/980701/1/0/10116');
const newMockPage = makeMockPage('https://game.granbluefantasy.jp/#quest/supporter/980701/1/0/10116');

const cdp = new CdpConnectionManager();
(cdp as any).lastIsHeadless = true;
(cdp as any).gbfPage = oldMockPage;
(cdp as any).browser = {
  connected: true,
  newPage: async () => {
    callOrder.push('browser.newPage');
    return newMockPage;
  }
};

let reconnectFiredWithNewPage = false;
cdp.onReconnect((p) => {
  callOrder.push('onReconnect');
  reconnectFiredWithNewPage = p === newMockPage;
});

const origOptimize = cdp.optimizePageEnvironment.bind(cdp);
cdp.optimizePageEnvironment = async (p: any, opts?: any) => {
  callOrder.push('optimizePageEnvironment');
  return await origOptimize(p, opts);
};

const recycled = await cdp.recycleTab('https://game.granbluefantasy.jp/#quest/supporter/980701/1/0/10116');
assert.strictEqual(recycled, newMockPage, 'recycleTab should return the fresh page');
assert(reconnectFiredWithNewPage, 'onReconnect listener must fire with the fresh recycled page');

const optIdx = callOrder.indexOf('optimizePageEnvironment');
const gotoIdx = callOrder.findIndex(c => c.startsWith('goto:'));
const reconnectIdx = callOrder.indexOf('onReconnect');
assert(optIdx !== -1, 'optimizePageEnvironment must be called in recycleTab when lastIsHeadless=true');
assert(gotoIdx !== -1, 'newPage.goto must be called in recycleTab');
assert(optIdx < gotoIdx, `optimizePageEnvironment (idx ${optIdx}) must run BEFORE newPage.goto (idx ${gotoIdx}); order=${callOrder.join(' -> ')}`);
assert(reconnectIdx > gotoIdx, `onReconnect (idx ${reconnectIdx}) must fire after goto (idx ${gotoIdx})`);
assert(cdpCommands.includes('Network.setBlockedURLs'), 'CDP Network.setBlockedURLs must run in headless mode');
const dietScripts = evaluatedNewDocScripts.filter(s => s.includes('__gbf_canvas_throttler_installed__'));
assert.strictEqual(dietScripts.length, 1, 'evaluateOnNewDocument should register the diet script once on fresh tab');

console.log(`   ✅ recycleTab() call order verified: ${callOrder.join(' -> ')}`);

console.log('\n========================================================================');
console.log('🎉 ALL CDP HEADLESS RAF FPS & RECYCLE UNIT TESTS PASSED (5/5)');
console.log('========================================================================\n');
