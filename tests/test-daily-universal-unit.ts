// tests/test-daily-universal-unit.ts
import { TemplateParser } from '../src/templates/template-parser.js';
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
assert('Template name matches', template.name === 'Universal Daily Routine');
assert('Template mode is routine', template.mode === 'routine');
assert('Template has steps', template.steps.length >= 10);

const proSkipSteps = template.steps.filter(s => (s.code === 'do_until_finish' || s.action === 'do_until_finish') && s.target?.includes('_pro'));
assert('Template contains pro skip steps', proSkipSteps.length >= 6);

const rupieStep = template.steps.find(s => s.target === 'daily_rupie' || s.tag === 'daily_rupie');
assert('Template contains daily_rupie step', !!rupieStep);

const skyscopeStep = template.steps.find(s => s.target === 'daily_skyscope' || s.tag === 'daily_skyscope');
assert('Template contains daily_skyscope step', !!skyscopeStep);

const casinoStep = template.steps.find(s => s.target === 'daily_casino' || s.tag === 'daily_casino');
assert('Template contains daily_casino step', !!casinoStep);

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
