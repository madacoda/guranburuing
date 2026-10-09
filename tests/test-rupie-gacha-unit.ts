// tests/test-rupie-gacha-unit.ts
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { TemplateParser } from '../src/templates/template-parser.js';

console.log('========================================================================');
console.log('             Rupie Gacha Automation Logic Unit Test Suite               ');
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
// Test 1: Daily Catalog Verification (Rupie & Ennead Pro)
// -----------------------------------------------------------------------------
console.log('[Test 1] Daily Catalog Resolution for daily_rupie & daily_ennead_pro...');
const template = TemplateParser.loadTemplate('daily-universal');

class MockPage {
  public urlStr = 'https://game.granbluefantasy.jp/#gacha/normal';
  public url() { return this.urlStr; }
  public on() {}
  public off() {}
  public async setViewport() {}
  public async evaluate(fn: any, ...args: any[]) { return fn(...args); }
  public async waitForSelector() { return null; }
  public async waitForFunction() { return true; }
  public async $() { return null; }
}

const mockPage = new MockPage() as any;
const mockSentinel = { assertSafe: async () => true, updatePage: () => {} } as any;
const engine = new UniversalWorkflowEngine(mockPage, mockSentinel, template, 'acc1');

const rupieTask = (engine as any).getDailyCatalogTask('daily_rupie');
assert('Resolves daily_rupie task from data/index.json', !!rupieTask);
assert('Category is gacha', rupieTask?.category === 'gacha');
assert('pageUrl points to #gacha/normal', rupieTask?.pageUrl?.includes('#gacha/normal'));
assert('Selector includes .btn-lupi', rupieTask?.selector?.includes('.btn-lupi'));

const enneadTask = (engine as any).getDailyCatalogTask('daily_ennead_pro');
assert('Resolves daily_ennead_pro task from data/index.json', !!enneadTask);
assert('Ennead category is pro_skip', enneadTask?.category === 'pro_skip');
assert('Ennead chapterId is 30532 and questId is 305321', enneadTask?.chapterId === '30532' && enneadTask?.questId === '305321');
assert('Ennead proChapterId is 30583', enneadTask?.proChapterId === '30583');

// -----------------------------------------------------------------------------
// Test 2: .btn-lupi Detection on #gacha/normal
// -----------------------------------------------------------------------------
console.log('\n[Test 2] .btn-lupi Detection & Evaluation on #gacha/normal...');

function evaluateBtnLupi(element: {
  className?: string;
  dataId?: string;
  dataCount?: string;
  hasCount0?: boolean;
  hasCount1?: boolean;
  text?: string;
  gachaText?: string;
  pageText?: string;
}) {
  // If button is found:
  if (element.className) {
    const isCompleted =
      element.className.includes('disable') ||
      element.className.includes('is-completed') ||
      element.className.includes('btn-disable') ||
      element.dataCount === '0' ||
      (element.hasCount0 && !element.hasCount1 && element.dataCount !== '100') ||
      (element.text || '').includes('本日分終了');

    if (isCompleted) {
      return { status: 'already_drawn', reason: 'button_disabled_or_zero_count' };
    }

    return { status: 'clicked', label: '100-Draw Rupie (.btn-lupi)' };
  }

  // If button not found, check container text
  const gText = element.gachaText || '';
  if (
    gText.includes('本日分終了') ||
    gText.includes('0/100回') ||
    gText.includes('上限に達しました')
  ) {
    return { status: 'already_drawn', reason: 'gacha_container_completion_text' };
  }

  return { status: 'not_found', reason: 'btn_lupi_missing' };
}

// Case A: Active 100-draw button: <div class="btn-lupi multi free" data-id="6002" data-count="100">
// Note: Even if page has "100/100" (e.g. AP 100/100 or 100 draws available), active button MUST trigger clicked!
const activeLupi = evaluateBtnLupi({
  className: 'btn-lupi multi free',
  dataId: '6002',
  dataCount: '100',
  hasCount1: true,
  hasCount0: true,
  pageText: 'AP 100/100 Available: 100/100'
});
assert('Active .btn-lupi[data-count="100"] triggers clicked even with 100/100 page text', activeLupi.status === 'clicked');

// Case B: Drawn 100-draw button (disabled or count 0)
const completedLupi = evaluateBtnLupi({
  className: 'btn-lupi multi disable',
  dataId: '6002',
  dataCount: '0',
  hasCount0: true,
  hasCount1: false
});
assert('Completed .btn-lupi evaluates to already_drawn', completedLupi.status === 'already_drawn');

// Case C: Missing button with gacha container completion text
const completedContainerLupi = evaluateBtnLupi({
  className: '',
  gachaText: '本日分終了 (Daily limit reached)'
});
assert('Missing button with 本日分終了 evaluates to already_drawn', completedContainerLupi.status === 'already_drawn');

// Case D: Missing button (not on page yet / loading)
const missingLupi = evaluateBtnLupi({
  className: '',
  gachaText: 'Loading gacha container...'
});
assert('Missing .btn-lupi during load evaluates to not_found (avoids false-positive)', missingLupi.status === 'not_found');

// -----------------------------------------------------------------------------
// Test 3: Template Steps Verification (daily-universal)
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Verifying daily-universal steps for Ennead and Rupie...');
const loadedTemplate = TemplateParser.loadTemplate('daily-universal');
const enneadStep = loadedTemplate.steps.find(s => s.target === 'daily_ennead_pro' || s.tag === 'daily_ennead_pro');
assert('Template has daily_ennead_pro step', !!enneadStep);

const gachaNavStep = loadedTemplate.steps.find(s => s.target?.includes('#gacha/normal'));
assert('Template navigates to https://game.granbluefantasy.jp/#gacha/normal', !!gachaNavStep);

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
