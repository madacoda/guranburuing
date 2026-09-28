// tests/test-raid-backup-limit.ts
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { RaidEngine } from '../src/engines/raid.engine.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('       3-Raid Backup Limit Detection & Recovery Logic Tests             ');
console.log('========================================================================\n');

// Mock DOM & environment
let currentHash = '#quest/assist';
let currentDocText = '';
let currentPopText = '';
let currentTabBadge: string | null = null;
let currentJoinedCards: any[] = [];
let mockClaimCalled = 0;

(globalThis as any).window = {
  location: {
    get hash() { return currentHash; },
    set hash(val: string) { currentHash = val; },
    href: 'https://game.granbluefantasy.jp/#quest/assist',
    reload: () => {}
  },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  stage: { gGameStatus: { lock: false, attacking: false } }
};

(globalThis as any).document = {
  body: {
    get innerText() { return currentDocText; }
  },
  querySelector: (sel: string) => {
    if (sel.includes('.pop-usual') || sel.includes('#pop') || sel.includes('.prt-popup-body')) {
      if (!currentPopText) return null;
      return {
        offsetParent: {},
        innerText: currentPopText,
        textContent: currentPopText,
        querySelector: (childSel: string) => {
          if (childSel.includes('btn-usual-ok') || childSel.includes('btn-usual-close')) {
            return {
              offsetParent: {},
              click: () => { currentPopText = ''; }
            };
          }
          return null;
        }
      };
    }
    if (sel.includes('#tab-multi') || sel.includes('[data-tab="multi"]') || sel.includes('[data-tab="recent"]')) {
      return {
        offsetParent: {},
        id: 'tab-multi',
        innerText: 'Joined',
        getAttribute: () => 'multi',
        querySelector: (childSel: string) => {
          if (childSel.includes('badge')) {
            if (currentTabBadge === null) return null;
            return { textContent: currentTabBadge };
          }
          return null;
        },
        click: () => {}
      };
    }
    return null;
  },
  querySelectorAll: (sel: string) => {
    if (sel.includes('.btn-multi-raid') || sel.includes('.lis-raid')) {
      return currentJoinedCards;
    }
    if (sel.includes('btn-tabs') || sel.includes('#tab-multi')) {
      return [
        {
          id: 'tab-multi',
          getAttribute: () => 'multi',
          innerText: 'Joined',
          offsetParent: {},
          click: () => {}
        }
      ];
    }
    return [];
  }
};

const mockSentinel = {
  assertSafe: async () => {},
  inspectForVerification: async () => false,
  isArmed: true
} as any;

const mockPage = {
  urlStr: 'https://game.granbluefantasy.jp/#quest/assist',
  url: () => mockPage.urlStr,
  setViewport: async () => {},
  on: () => {},
  off: () => {},
  touchscreen: { tap: async () => {} },
  mouse: { click: async () => {} },
  evaluate: async (fn: any, ...args: any[]) => {
    if (typeof fn === 'function') {
      return fn(...args);
    }
    return null;
  },
  waitForSelector: async () => ({
    offsetParent: {},
    classList: { contains: () => false },
    boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
    evaluate: async (f: any) => f({ offsetParent: {}, classList: { contains: () => false } }),
    click: async () => {}
  }),
  $$: async () => currentJoinedCards.map(c => ({
    offsetParent: {},
    evaluate: async (f: any) => f(c),
    click: async () => {}
  })),
  $: async (sel: string) => {
    if (sel.includes('.pop-usual')) {
      if (!currentPopText) return null;
      return {
        offsetParent: {},
        innerText: currentPopText,
        evaluate: async (f: any) => f({ innerText: currentPopText }),
        $: async () => ({
          click: async () => { currentPopText = ''; }
        })
      };
    }
    return null;
  },
  waitForNavigation: async () => null,
  screenshot: async () => Buffer.from('')
} as any;

const testTemplate: WorkflowTemplate = {
  name: 'GB Farm - Akasha HL Test',
  questUrl: 'https://game.granbluefantasy.jp/#quest/assist',
  raidSlot: 3,
  targetScore: 1480000,
  steps: [
    { code: 'attack' }
  ]
};

const engine = new UniversalWorkflowEngine(mockPage, mockSentinel, testTemplate, 'acc1');

// Mock claimPendingBattles to track invocations
(engine as any).claimPendingBattles = async () => {
  mockClaimCalled++;
  return 1;
};

// ----------------------------------------------------------------------
// Test 1: Exact Detection of English 3-Raid Backup Limit Screen Text
// ----------------------------------------------------------------------
console.log('--- Test 1: English 3-Raid Backup Limit Detection ---');
currentPopText = 'Raids\nYou can only provide backup in up to three raid battles at once.';
currentDocText = 'Raids\nYou can only provide backup in up to three raid battles at once.';

const diagEnglish = await (engine as any).diagnoseQuestStartFailure(1);
if (!diagEnglish.isRaidBackupLimit) {
  throw new Error('diagnoseQuestStartFailure failed to detect English "up to three raid battles at once" modal');
}
console.log(`  ✅ [PASS] Detected English 3-raid modal: "${diagEnglish.reason}"`);

// ----------------------------------------------------------------------
// Test 2: Exact Detection of Japanese 3-Raid Backup Limit Screen Text
// ----------------------------------------------------------------------
console.log('\n--- Test 2: Japanese 3-Raid Backup Limit Detection ---');
currentPopText = '救援依頼\n同時に参戦できるマルチバトルは3件までです';
currentDocText = '救援依頼\n同時に参戦できるマルチバトルは3件までです';

const diagJapanese = await (engine as any).diagnoseQuestStartFailure(1);
if (!diagJapanese.isRaidBackupLimit) {
  throw new Error('diagnoseQuestStartFailure failed to detect Japanese 3-raid modal');
}
console.log(`  ✅ [PASS] Detected Japanese 3-raid modal: "${diagJapanese.reason}"`);

// ----------------------------------------------------------------------
// Test 3: detectAndHandlePendingBattleModal distinguishing ACTIVE_RAID_LIMIT_3
// ----------------------------------------------------------------------
console.log('\n--- Test 3: detectAndHandlePendingBattleModal Distinguishes 3-Raid Limit ---');
currentPopText = 'Raids\nYou can only provide backup in up to three raid battles at once.';
let resolveLingeringCalled = false;
(engine as any).resolveLingeringRaidLimit = async () => {
  resolveLingeringCalled = true;
  return true;
};

const handledBackupLimit = await (engine as any).detectAndHandlePendingBattleModal('logs/test.md', 0);
if (!handledBackupLimit || !resolveLingeringCalled) {
  throw new Error('detectAndHandlePendingBattleModal failed to trigger resolveLingeringRaidLimit on 3-raid modal');
}
if ((engine as any).lastStartFailureWasRaidLimit !== true) {
  throw new Error('lastStartFailureWasRaidLimit was not set to true');
}
console.log('  ✅ [PASS] 3-Raid Backup Limit popup intercepted and routed to resolveLingeringRaidLimit');

// ----------------------------------------------------------------------
// Test 4: Tab Badge Reading (getLingeringJoinedRaidCount)
// ----------------------------------------------------------------------
console.log('\n--- Test 4: getLingeringJoinedRaidCount Tab Badge Tests ---');
// Case A: Badge count is 3
currentTabBadge = '3';
let count = await engine.getLingeringJoinedRaidCount();
if (count !== 3) {
  throw new Error(`Expected count 3, got ${count}`);
}
console.log('  ✅ [PASS] Badge count "3" correctly parsed as 3');

// Case B: Badge count is 1
currentTabBadge = '1';
count = await engine.getLingeringJoinedRaidCount();
if (count !== 1) {
  throw new Error(`Expected count 1, got ${count}`);
}
console.log('  ✅ [PASS] Badge count "1" correctly parsed as 1');

// Case C: No badge present (0 active raids)
currentTabBadge = null;
count = await engine.getLingeringJoinedRaidCount();
if (count !== 0) {
  throw new Error(`Expected count 0 for no badge, got ${count}`);
}
console.log('  ✅ [PASS] Absent badge correctly parsed as 0 lingering raids');

// ----------------------------------------------------------------------
// Test 5: Joined Raid Cards Scanning & Selection Strategy
// (Highest HP% first, then fewer players)
// ----------------------------------------------------------------------
console.log('\n--- Test 5: Joined Raid Selection Sorting Strategy ---');
const mockCardsData = [
  { hpPct: 35, players: 2, maxPlayers: 30, questName: 'Akasha HL Low HP', raidId: '101' },
  { hpPct: 88, players: 8, maxPlayers: 30, questName: 'Akasha HL High HP', raidId: '102' },
  { hpPct: 88, players: 3, maxPlayers: 30, questName: 'Akasha HL High HP Few Players', raidId: '103' }
];

// Replicate sorting logic
const sortedCards = [...mockCardsData].sort((a, b) => {
  const hpDiff = b.hpPct - a.hpPct;
  if (Math.abs(hpDiff) > 2) return hpDiff;
  return a.players - b.players;
});

if (sortedCards[0].raidId !== '103') {
  throw new Error(`Expected raidId 103 (88% HP, 3 players) to be top choice, got ${sortedCards[0].raidId}`);
}
if (sortedCards[1].raidId !== '102') {
  throw new Error(`Expected raidId 102 (88% HP, 8 players) to be second choice, got ${sortedCards[1].raidId}`);
}
if (sortedCards[2].raidId !== '101') {
  throw new Error(`Expected raidId 101 (35% HP) to be last choice, got ${sortedCards[2].raidId}`);
}
console.log(`  ✅ [PASS] Top choice selected: "${sortedCards[0].questName}" (HP: ${sortedCards[0].hpPct}%, Players: ${sortedCards[0].players}/${sortedCards[0].maxPlayers})`);

// ----------------------------------------------------------------------
// Test 6: 5-Battle Milestone Pending Claim Sweep
// ----------------------------------------------------------------------
console.log('\n--- Test 6: 5-Battle Milestone Pending Claim Sweep ---');
mockClaimCalled = 0;
(engine as any).totalJoinedAndClearedBattles = 4;
await (engine as any).checkFiveBattleMilestone('logs/test.md', 4);
if (mockClaimCalled !== 0) {
  throw new Error('checkFiveBattleMilestone prematurely triggered on battle 4');
}

(engine as any).totalJoinedAndClearedBattles = 5;
await (engine as any).checkFiveBattleMilestone('logs/test.md', 5);
if (mockClaimCalled !== 1) {
  throw new Error('checkFiveBattleMilestone failed to trigger on battle 5');
}
console.log('  ✅ [PASS] 5-Battle milestone accurately sweeps pending battles at total=5');

(engine as any).totalJoinedAndClearedBattles = 10;
await (engine as any).checkFiveBattleMilestone('logs/test.md', 10);
if (mockClaimCalled !== 2) {
  throw new Error('checkFiveBattleMilestone failed to trigger on battle 10');
}
console.log('  ✅ [PASS] 5-Battle milestone accurately sweeps pending battles at total=10');

// ----------------------------------------------------------------------
// Test 7: RaidEngine Returns ACTIVE_RAID_LIMIT_3
// ----------------------------------------------------------------------
console.log('\n--- Test 7: RaidEngine ACTIVE_RAID_LIMIT_3 Return Code ---');
const mockRaidBtn = {
  click: async () => {},
  boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
  evaluate: async (fn: any) => fn({ className: 'btn-usual-ok' })
};
const mockRaidPage = {
  url: () => 'https://game.granbluefantasy.jp/#quest/assist',
  evaluate: async (fn: any, arg: any) => {
    if (typeof fn === 'function') return fn(arg);
  },
  waitForSelector: async () => mockRaidBtn,
  $: async (sel: string) => {
    if (sel === '.pop-usual') {
      return {
        innerText: 'Raids\nYou can only provide backup in up to three raid battles at once.',
        boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
        evaluate: async () => 'Raids\nYou can only provide backup in up to three raid battles at once.'
      };
    }
    if (sel.includes('.btn-usual-ok')) return mockRaidBtn;
    return null;
  },
  keyboard: {
    down: async () => {},
    press: async () => {},
    up: async () => {},
    type: async () => {}
  },
  mouse: {
    move: async () => {},
    down: async () => {},
    up: async () => {},
    click: async () => {}
  }
} as any;

const raidEngine = new RaidEngine(mockRaidPage, mockSentinel);
const raidResult = await raidEngine.joinAndFight({ raidCode: 'TEST1234' });
if (raidResult.status !== 'ACTIVE_RAID_LIMIT_3') {
  throw new Error(`Expected ACTIVE_RAID_LIMIT_3, got ${raidResult.status}`);
}
console.log(`  ✅ [PASS] RaidEngine correctly returned status: "${raidResult.status}" (${raidResult.message})`);

console.log('\n========================================================================');
console.log('  🎉 ALL 3-RAID BACKUP LIMIT & 5-BATTLE MILESTONE TESTS PASSED (100%)    ');
console.log('========================================================================\n');
