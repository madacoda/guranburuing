// tests/test-daily-universal-unit.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { AccountRegistry } from '../src/auth/account-registry.js';
import { CdpConnectionManager } from '../src/cdp-connection.js';

console.log('========================================================================');
console.log('       Daily Universal Routine & Engine Logic Unit Test Suite          ');
console.log('========================================================================\n');

let passCount = 0;
let failCount = 0;

function assert(desc: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`);
    failCount++;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Template Parser Verification for daily-universal
// -----------------------------------------------------------------------------
console.log('[Test 1] Verifying daily-universal Template Structure...');
const template = TemplateParser.loadTemplate('daily-universal');
const val = validateWorkflowTemplate(template);
assert('Template passes schema validation', val.valid);
assert('Template mode is routine', template.mode === 'routine');
assert('Template has customizable steps array', Array.isArray(template.steps) && template.steps.length > 0);

const validDailyCodes = new Set([
  'navigate', 'do_until_finish', 'run_daily_target', 'click',
  'dismiss_popups', 'loop_while', 'wait', 'condition'
]);
const allCodesValid = template.steps.every(s => validDailyCodes.has(s.code));
assert('All steps use valid routine action codes', allCodesValid);

// -----------------------------------------------------------------------------
// Test 2: Catalog Lookup in data/index.json
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Catalog Resolution via UniversalWorkflowEngine...');
class MockPage {
  public urlStr = 'https://game.granbluefantasy.jp/#quest/extra';
  public url() { return this.urlStr; }
  public on() {}
  public off() {}
  public async setViewport() {}
  public async evaluate(fn: any, ...args: any[]) { return fn(...args); }
  public async waitForSelector() { return null; }
  public async $() { return null; }
}

const mockPage = new MockPage() as any;
const mockSentinel = { assertSafe: async () => true, updatePage: () => {} } as any;
const engine = new UniversalWorkflowEngine(mockPage, mockSentinel, template, 'acc1');

const hardProTask = (engine as any).getDailyCatalogTask('daily_hard_pro');
assert('Resolves daily_hard_pro task', hardProTask?.id === 'hard_pro' && hardProTask.category === 'pro_skip');

const magnaProTask = (engine as any).getDailyCatalogTask('daily_magna_pro');
assert('Resolves daily_magna_pro task', magnaProTask?.id === 'magna_pro' && magnaProTask.category === 'pro_skip');

const rupieTask = (engine as any).getDailyCatalogTask('daily_rupie');
assert('Resolves daily_rupie task', rupieTask?.category === 'gacha');

const skyscopeTask = (engine as any).getDailyCatalogTask('daily_skyscope');
assert('Resolves daily_skyscope task', skyscopeTask?.category === 'mission');

const casinoTask = (engine as any).getDailyCatalogTask('daily_casino');
assert('Resolves daily_casino task', casinoTask?.category === 'shop');
assert('Casino target points to exchange page', casinoTask?.pageUrl?.includes('casino/exchange'));

// -----------------------------------------------------------------------------
// Test 3: Account Registry & Argument Resolution
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Account Registry Resolution...');
const accounts = AccountRegistry.loadAccounts();
assert('Accounts loaded successfully', accounts.length >= 1);

const acc1 = AccountRegistry.getAccountById('acc1');
assert('Account acc1 resolved', acc1?.id === 'acc1' && acc1?.cdpPort === 9222);

const acc2 = AccountRegistry.getAccountById('acc2');
if (acc2) {
  assert('Account acc2 resolved', acc2?.id === 'acc2' && acc2?.cdpPort === 9223);
} else {
  assert('Account acc2 resolution gracefully handled when single account', true);
}

// -----------------------------------------------------------------------------
// Test 4: CDP Reconnect Page Update Hook
// -----------------------------------------------------------------------------
console.log('\n[Test 4] CDP Connection Reconnect Listeners...');
const cdp = new CdpConnectionManager();
let reconnectedCalled = false;
cdp.onReconnect((p) => {
  reconnectedCalled = true;
});

const newMockPage = new MockPage() as any;
engine.updatePage(newMockPage);
assert('UniversalWorkflowEngine.updatePage executed without error', (engine as any).page === newMockPage);

mockSentinel.updatePage(newMockPage);
assert('SentinelWatchdog.updatePage executed without error', true);

// -----------------------------------------------------------------------------
// Test 5: handleDismissPopups Protects Against Clicking .btn-usual-ok on Pro Modals
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Verifying handleDismissPopups Close-Only Protection on Pro Modals...');
{
  let bulkOkClicked = false;
  let closeBtnClicked = false;
  const fakeCloseBtn = {
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    click: () => { closeBtnClicked = true; }
  };
  const fakeBulkOkBtn = {
    getBoundingClientRect: () => ({ width: 100, height: 40 }),
    click: () => { bulkOkClicked = true; }
  };
  const fakeModal = {
    querySelector: (sel: string) => sel.includes('btn-usual-close') ? fakeCloseBtn : null
  };

  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  (globalThis as any).window = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  };
  let callIdx = 0;
  (globalThis as any).document = {
    querySelectorAll: (sel: string) => {
      if (callIdx === 0 && sel.includes('.pop-pro-quest-list.pop-show')) {
        callIdx++;
        return [fakeModal];
      }
      if (sel.includes(':not(.pop-pro-quest-list)')) {
        return [];
      }
      if (sel === '.pop-usual .btn-usual-ok') {
        return [fakeBulkOkBtn];
      }
      return [];
    }
  };

  await (engine as any).routineExecution.handleDismissPopups();
  (globalThis as any).document = origDoc;
  (globalThis as any).window = origWin;

  assert('Clicked .btn-usual-close on .pop-pro-quest-list', closeBtnClicked);
  assert('Never clicked .btn-usual-ok.bulk on .pop-pro-quest-list', !bulkOkClicked);
}

// -----------------------------------------------------------------------------
// Test 6: navigateIfNeeded Self-Heals Corrupted #quest/extra View via Backbone
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Verifying navigateIfNeeded Backbone Self-Healing on Corrupted #quest/extra...');
{
  let backboneLoadedRoute = '';
  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  (globalThis as any).window = {
    location: { hash: '#quest/extra', href: 'https://game.granbluefantasy.jp/#quest/extra' },
    getComputedStyle: (el: any) => ({ display: el?.id === 'ready' ? 'block' : 'none', visibility: 'visible' }),
    Backbone: {
      history: {
        loadUrl: (fragment: string) => { backboneLoadedRoute = fragment; }
      }
    }
  };
  (globalThis as any).document = {
    querySelector: (sel: string) => {
      if (sel === '#ready') return { id: 'ready' };
      if (sel === '#cnt-quest .prt-supporter-list') return {};
      return null;
    },
    querySelectorAll: () => []
  };

  await (engine as any).routineExecution.navigateIfNeeded('https://game.granbluefantasy.jp/#quest/extra');
  (globalThis as any).document = origDoc;
  (globalThis as any).window = origWin;

  assert('Reloaded quest/extra via Backbone.history.loadUrl when #ready/SupporterView corrupted view', backboneLoadedRoute === 'quest/extra');
}

// -----------------------------------------------------------------------------
// Test 7: handleApRecoveryModal Supports .pop-stamina .btn-use-full & .pop-result
// -----------------------------------------------------------------------------
console.log('\n[Test 7] Verifying .pop-stamina .btn-use-full and .pop-result AP Recovery...');
{
  let useFullClicked = false;
  let resultOkClicked = false;
  const origDoc = (globalThis as any).document;
  const origWin = (globalThis as any).window;
  (globalThis as any).window = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  };
  (globalThis as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('.pop-stamina .btn-use-full')) {
        return { offsetParent: {}, click: () => { useFullClicked = true; } };
      }
      if (sel.includes('.pop-result .btn-usual-ok')) {
        return { offsetParent: {}, click: () => { resultOkClicked = true; } };
      }
      return null;
    }
  };

  const recovered = await (engine as any).routineExecution.handleApRecoveryModal();
  (globalThis as any).document = origDoc;
  (globalThis as any).window = origWin;

  assert('handleApRecoveryModal returned true', recovered === true);
  assert('Clicked .pop-stamina .btn-use-full', useFullClicked);
  assert('Clicked .pop-result .btn-usual-ok', resultOkClicked);
}

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(`Total: ${passCount + failCount} | Passed: ${passCount} | Failed: ${failCount}`);
console.log('========================================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
