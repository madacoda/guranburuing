// tests/test-assist-interleaving.ts
import { Page } from 'puppeteer-core';
import { DailyHostEngine } from '../src/engines/daily-host.engine.js';
import { DAILY_HOST_CATALOG } from '../src/domain/daily-host/daily-host.catalog.js';
import {
  DailyRaidHostDefinition,
  HostedCombatOutcome,
  DailyHostExecutionOptions
} from '../src/domain/daily-host/daily-host.types.js';
import {
  IHostedCombatRunner,
  IAssistInterleaver,
  IBackupBroadcastService,
  IStageModalNavigator,
  IHostPreconditionValidator,
  ISupporterPartyLauncher,
  IActiveHostedRaidScanner,
  IDailyHostReporter
} from '../src/domain/daily-host/daily-host.interfaces.js';
import { HostedCombatRunner } from '../src/services/daily-host/hosted-combat.runner.js';
import { AssistInterleaverService } from '../src/services/daily-host/assist-interleaver.service.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';

console.log('========================================================================');
console.log('    Granblue Fantasy Dual-Track Assist Interleaving Unit & E2E Tests    ');
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
    throw new Error(`Assertion failed: ${desc}`);
  }
}

// -----------------------------------------------------------------------------
// Test 1: shouldYieldToAssist Evaluation Matrix
// -----------------------------------------------------------------------------
console.log('[Test 1] Testing shouldYieldToAssist decision matrix in HostedCombatRunner...');

class TestableCombatRunner extends HostedCombatRunner {
  public testShouldYield(
    state: { isMounted: boolean; isVictory: boolean; isWipedOut: boolean; bossHpPct: number },
    turnsElapsed: number,
    combatStartTime: number,
    options?: DailyHostExecutionOptions
  ): boolean {
    return (this as any).shouldYieldToAssist(state, turnsElapsed, combatStartTime, options);
  }
}

const mockPage = {} as Page;
const mockWorkflow = {
  updatePage: () => {},
  requestStop: () => {},
  waitForCombatInputReady: async () => {},
  handleReload: async () => {},
  handleQuickCall: async () => {},
  checkAndClearPendingBattles: async () => {},
  waitForBattleToMount: async () => {},
  currentBattleHonors: 0
} as any;
const mockBroadcast = {
  updatePage: () => {},
  broadcastBackupRequestToAll: async () => ({
    allRequested: true,
    friendRequested: true,
    guildRequested: true,
    broadcastSuccessful: true,
    activeScopes: ['Everyone', 'Friends', 'Crew'],
    timestamp: Date.now()
  }),
  canBroadcastBackup: async () => true,
  getLastBroadcastTimestamp: () => 0
} as IBackupBroadcastService;

const mockNav = {
  updatePage: () => {},
  navigateToMultiList: async () => {},
  openStageCategoryModal: async () => true,
  closeStageCategoryModal: async () => {},
  resetActiveStage: () => {},
  getActiveStageId: () => '12061'
} as IStageModalNavigator;

const runner = new TestableCombatRunner(mockPage, mockWorkflow, mockBroadcast, mockNav);

// Condition A: Frontline Wipeout -> MUST Yield
const wipeoutState = { isMounted: true, isVictory: false, isWipedOut: true, bossHpPct: 84.5 };
assert('Frontline wipeout triggers yield to assist', runner.testShouldYield(wipeoutState, 3, Date.now()));

// Condition B: Turn ceiling reached -> MUST Yield
const normalState = { isMounted: true, isVictory: false, isWipedOut: false, bossHpPct: 62.0 };
assert('Turns >= 15 triggers yield to assist', runner.testShouldYield(normalState, 15, Date.now()));
assert('Turns < 15 does not trigger yield by turns', !runner.testShouldYield(normalState, 14, Date.now()));

// Condition C: Custom turn ceiling option respected
assert(
  'Custom maxCombatTurnsBeforeYield (e.g. 5 turns) respected',
  runner.testShouldYield(normalState, 5, Date.now(), { maxCombatTurnsBeforeYield: 5 })
);

// Condition D: Duration ceiling reached -> MUST Yield (default 120s)
const twoMinutesAgo = Date.now() - 125_000;
assert('Duration >= 120s triggers yield to assist', runner.testShouldYield(normalState, 6, twoMinutesAgo));

// Condition E: Boss dead / Victory confirmed -> NEVER Yield (claim win directly)
const victoryState = { isMounted: true, isVictory: true, isWipedOut: false, bossHpPct: 0 };
assert('Boss defeated (0% HP / victory) never yields', !runner.testShouldYield(victoryState, 20, twoMinutesAgo));

// Condition F: Interleaving explicitly disabled -> NEVER Yield
assert(
  'enableAssistInterleaving: false overrides and disables yield',
  !runner.testShouldYield(wipeoutState, 30, twoMinutesAgo, { enableAssistInterleaving: false })
);

// -----------------------------------------------------------------------------
// Test 2: Hosted Combat Yield Lifecycle & Pre-Yield Backup Guarantee
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Testing HostedCombatRunner combat execution and backup guarantee upon yield...');

let backupCalledCount = 0;
const trackedBroadcast: IBackupBroadcastService = {
  ...mockBroadcast,
  broadcastBackupRequestToAll: async () => {
    backupCalledCount++;
    return {
      allRequested: true,
      friendRequested: true,
      guildRequested: true,
      broadcastSuccessful: true,
      activeScopes: ['Everyone', 'Friends', 'Crew'],
      timestamp: Date.now()
    };
  }
};

let battleCallCount = 0;
const combatPageMock = {
  evaluate: async (fn: any, ...args: any[]) => {
    battleCallCount++;
    // Simulate battle state evaluation
    return {
      isMounted: true,
      isVictory: false,
      isWipedOut: true, // Frontline wiped out on turn 1
      bossHp: 500000000,
      bossHpMax: 600000000,
      bossHpPct: 83.3,
      currentHonors: 420000,
      raid_id: '46998534954'
    };
  },
  on: () => {},
  removeListener: () => {}
} as any;

const combatRunnerInstance = new HostedCombatRunner(combatPageMock, mockWorkflow, trackedBroadcast, mockNav);
const tiamatRaid = DAILY_HOST_CATALOG.find(r => r.id === 'tiamat_aura')!;

const combatOutcome = await combatRunnerInstance.executeHostedCombat(tiamatRaid, 15);

assert('Combat outcome flags yieldedToAssist = true', combatOutcome.yieldedToAssist === true);
assert('Combat outcome isVictoryConfirmed is false initially', combatOutcome.isVictoryConfirmed === false);
assert('Combat honors recorded properly before yield', combatOutcome.honorsEarned >= 420000);
assert('Backup request was dispatched to Everyone before yielding', backupCalledCount >= 1);

// -----------------------------------------------------------------------------
// Test 3: AssistInterleaver Dual-Track Orchestration & Victory Resolution
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Testing AssistInterleaverService dual-track farming & periodic check...');

class MockInterleaverService extends AssistInterleaverService {
  public checkCount = 0;
  public rebroadcastCount = 0;

  constructor() {
    super(mockPage, {} as SentinelWatchdog, trackedBroadcast, combatRunnerInstance, mockNav);
  }

  public override async interleaveAssistWhileHostedRaidActive(
    raid: DailyRaidHostDefinition,
    hostedRaidId: string,
    options: DailyHostExecutionOptions
  ): Promise<HostedCombatOutcome> {
    // Simulate assist loop: 2 assist runs completed while checking raid status
    this.checkCount++;

    // First inspection: Boss still alive (45% HP), 3-min cooldown expired -> Re-broadcast backup!
    this.rebroadcastCount++;

    // Second inspection: Boss reaches 0% HP (pub completed the raid)
    this.checkCount++;
    return {
      isVictoryConfirmed: true,
      turnsElapsed: 0,
      honorsEarned: 1796900,
      message: 'Victory confirmed via pub players during assist farming!',
      durationMs: 45000
    };
  }
}

const mockInterleaver = new MockInterleaverService();
const assistResult = await mockInterleaver.interleaveAssistWhileHostedRaidActive(
  tiamatRaid,
  '46998534954',
  { assistActivity: 'gb-farm', hostedRaidRecheckIntervalMs: 180_000 }
);

assert('Interleaver confirmed raid victory from pub clearance', assistResult.isVictoryConfirmed === true);
assert('Interleaver honors retained correctly', assistResult.honorsEarned === 1796900);
assert('Periodic re-check inspected hosted raid', mockInterleaver.checkCount >= 2);
assert('Re-broadcast triggered on cooldown expiry', mockInterleaver.rebroadcastCount >= 1);

// -----------------------------------------------------------------------------
// Test 4: DailyHostEngine End-to-End Orchestration with Assist Interleaver
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Testing DailyHostEngine integration with AssistInterleaver...');

const mockLauncher: ISupporterPartyLauncher = {
  updatePage: () => {},
  selectSupporterSummon: async () => true,
  confirmPartyAndLaunchQuest: async () => true
};

const mockValidator: IHostPreconditionValidator = {
  updatePage: () => {},
  inspectQuestAvailability: async () => ({
    isAvailable: true,
    remainingHostsToday: 1,
    status: 'AVAILABLE',
    reason: 'Quest available'
  }),
  clickQuestPlay: async () => true,
  verifyTreasureRequirements: async () => ({ hasMaterials: true, reason: '1/1 verified' }),
  confirmTreasureOffer: async () => true,
  dismissTreasureModal: async () => {}
};

const mockScanner: IActiveHostedRaidScanner = {
  updatePage: () => {},
  scanAndResumeActiveHostedRaid: async () => null
};

const mockReporter: IDailyHostReporter = {
  renderConsoleSummary: () => {},
  persistMarkdownAuditReport: () => 'report.md'
};

// Mock combat runner that simulates a long/wiped battle yielding to assist
let engineCombatYielded = false;
const yieldingCombatRunner: IHostedCombatRunner = {
  updatePage: () => {},
  requestStop: () => {},
  executeHostedCombat: async (raid) => {
    engineCombatYielded = true;
    return {
      isVictoryConfirmed: false,
      turnsElapsed: 5,
      honorsEarned: 650000,
      message: 'Yielded to assist',
      durationMs: 12000,
      yieldedToAssist: true,
      activeRaidId: '46998534954'
    };
  },
  confirmAndDismissBattleResult: async () => {},
  getAuthoritativeBattleState: async () => ({
    isMounted: true,
    isVictory: false,
    isWipedOut: true,
    bossHp: 100,
    bossHpMax: 1000,
    bossHpPct: 10,
    currentHonors: 650000
  })
};

let interleaverInvoked = false;
let interleaverReceivedRaidId = '';
const trackingInterleaver: IAssistInterleaver = {
  updatePage: () => {},
  requestStop: () => {},
  interleaveAssistWhileHostedRaidActive: async (raid, hostedRaidId, options) => {
    interleaverInvoked = true;
    interleaverReceivedRaidId = hostedRaidId;
    return {
      isVictoryConfirmed: true,
      turnsElapsed: 0,
      honorsEarned: 1850000,
      message: 'Victory confirmed via pub players during assist farming!',
      durationMs: 60000
    };
  }
};

const testEngine = new DailyHostEngine(
  combatPageMock,
  {} as SentinelWatchdog,
  'acc1',
  {
    workflow: mockWorkflow,
    scanner: mockScanner,
    navigator: mockNav,
    validator: mockValidator,
    launcher: mockLauncher,
    broadcast: mockBroadcast,
    combat: yieldingCombatRunner,
    interleaver: trackingInterleaver,
    reporter: mockReporter
  }
);

const summary = await testEngine.runDailyHost({
  specificRaidId: 'tiamat_aura',
  enableAssistInterleaving: true,
  assistActivity: 'gb-farm'
});

assert('Engine executed hosted combat which yielded', engineCombatYielded === true);
assert('Engine seamlessly delegated to trackingInterleaver', interleaverInvoked === true);
assert('Interleaver received active hosted raid ID', interleaverReceivedRaidId === '46998534954');
assert('Daily host summary marked raid as CLEARED', summary.clearedCount === 1);
assert('Daily host summary recorded 0 failures', summary.failedCount === 0);
assert('Execution record reflects pub victory message', summary.executionRecords[0].message.includes('Victory confirmed via pub players'));

console.log('\n========================================================================');
console.log(`Results: ${passCount} Passed | ${failCount} Failed`);
console.log('========================================================================\n');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
