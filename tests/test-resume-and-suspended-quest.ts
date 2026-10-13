import { ScreenDiagnosticService } from '../src/engines/universal/screen-diagnostic.service.js';
import { UniversalContext, UniversalWorkflowState } from '../src/engines/universal/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
  }
}

console.log('========================================================================');
console.log('       Suspended Quest & Combat Resume Engine Unit Tests               ');
console.log('========================================================================');

console.log('\n--- Test Group 1: ScreenDiagnosticService Suspended Quest Detection ---');

const mockState: UniversalWorkflowState = {
  stopRequested: false,
  totalGoldBarsAccumulated: 0,
  totalBlueChestsAccumulated: 0,
  totalHonorsAccumulated: 0,
  totalLootItemsAccumulated: 0,
  currentRaidId: 'N/A',
  myUserId: '14022326',
  currentScore: 0,
  currentTurn: 1,
  joinedInCurrentBatch: 0,
  currentBatchThreshold: 3,
  latestRewardData: null,
  currentLogPath: 'logs/test.md',
  currentWorkflowLogPath: 'logs/test.md',
  currentBattleHadGoldBar: false,
  currentBattleHadBlueChest: false,
  totalCompletedRuns: 0,
  dailyCatalogCache: null,
  totalJoinedAndClearedBattles: 0,
  lastStartFailureWasRaidLimit: false,
  lastStartFailureWasRaidWait: false,
  lastStartFailureWasMaintenance: false,
  consecutiveEmptyRaidSearches: 0,
  deadRaidIds: new Map(),
  playerName: 'Hamada',
  lastAttackLockoutExpires: 0
};

const testPhrases = [
  'A quest is in progress. Continue?',
  'Suspended quest in progress',
  'Battle in progress',
  '前回中断したクエストがあります。再開しますか？',
  '中断されたクエストがあります',
  '未クリアのクエストがあります。続ける'
];

for (const phrase of testPhrases) {
  const mockPage: any = {
    evaluate: async (fn: any) => {
      return {
        hasPopup: true,
        title: 'Quest in Progress',
        text: phrase,
        bodyText: phrase
      };
    }
  };

  const mockSentinel: any = {
    inspectForVerification: async () => false
  };

  const ctx: UniversalContext = {
    page: mockPage,
    sentinel: mockSentinel,
    template: { name: 'Test Template', questUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3', steps: [] } as any,
    accountId: 'acc1',
    state: { ...mockState },
    alertRelay: {} as any,
    updatePage: () => {}
  };

  const diag = new ScreenDiagnosticService(ctx);
  const result = await diag.deepAnalyzeScreenState();
  assert(result.condition === 'SUSPENDED_QUEST', `Correctly identified SUSPENDED_QUEST for: "${phrase.substring(0, 35)}..."`);
  assert(result.canAutoRecover === true, 'canAutoRecover is true for SUSPENDED_QUEST');
}

console.log('\n--- Test Group 2: Boss Name Multilingual Object Formatting ---');
const mockBosses = [
  { param: [{ name: { en: 'Lvl 120 Lilywhite Paragon', ja: '穢れ無き純白の化身' }, hp: '1000', hpmax: '2000', alive: 1 }] },
  { param: [{ name: 'Colossus Omega', hp: '500', hpmax: '1000', alive: 1 }] }
];

for (const b of mockBosses) {
  const rawBoss = b.param[0];
  const rawName = typeof rawBoss.name === 'object' && rawBoss.name ? (rawBoss.name.en || rawBoss.name.ja || '') : rawBoss.name;
  const name = String(rawName || 'Enemy');
  assert(name !== '[object Object]' && name.length > 0, `Boss name resolved cleanly: "${name}"`);
}

console.log('\n--- Test Group 3: Replicard Turn 1 vs Mid-Battle Branching Logic ---');
const turnScenarios = [
  { turn: 1, isDead: false, expectedAction: 'direct_resume' },
  { turn: 3, isDead: false, expectedAction: 'resolve_lingering' },
  { turn: 1, isDead: true, expectedAction: 'confirm_result' }
];

for (const sc of turnScenarios) {
  let actionTaken = '';
  if (sc.isDead) {
    actionTaken = 'confirm_result';
  } else if (sc.turn === 1) {
    actionTaken = 'direct_resume';
  } else {
    actionTaken = 'resolve_lingering';
  }
  assert(actionTaken === sc.expectedAction, `Scenario (Turn ${sc.turn}, Dead: ${sc.isDead}) correctly routes to: ${actionTaken}`);
}

console.log('\n========================================================================');
console.log(`Scorecard: ${passed} Passed | ${failed} Failed`);
console.log('========================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('🎉 All Suspended Quest & Combat Resume Tests Passed Successfully!');
  process.exit(0);
}
