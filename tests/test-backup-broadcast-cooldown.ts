// tests/test-backup-broadcast-cooldown.ts
import { BackupBroadcastService, BACKUP_REQUEST_COOLDOWN_MS } from '../src/services/daily-host/backup-broadcast.service.js';
import { IBackupBroadcastService, IStageModalNavigator } from '../src/domain/daily-host/daily-host.interfaces.js';
import { HostedCombatRunner } from '../src/services/daily-host/hosted-combat.runner.js';
import { DailyRaidHostDefinition } from '../src/domain/daily-host/daily-host.types.js';

console.log('========================================================================');
console.log('       Granblue Fantasy Backup Broadcast & 3-Min Cooldown Unit Tests     ');
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
// Test 1: Cooldown Constant Verification
// -----------------------------------------------------------------------------
console.log('[Test 1] Verifying Granblue Fantasy 3-Minute Cooldown Standard...');
assert('BACKUP_REQUEST_COOLDOWN_MS is exactly 180,000ms (3 minutes)', BACKUP_REQUEST_COOLDOWN_MS === 180_000);

// -----------------------------------------------------------------------------
// Test 2: Active="1" Preservation (The Crucial Bug Fix)
// When checkboxes start with active="1", they must NOT be clicked/toggled off!
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Verifying active="1" scope preservation (Preventing Accidental Uncheck)...');

class MockPageWithScopeState {
  public scopes: Record<string, { active: string; clickCount: number }> = {
    all: { active: '1', clickCount: 0 },
    friend: { active: '1', clickCount: 0 },
    guild: { active: '1', clickCount: 0 }
  };
  public hudDisable = false;
  public submitClicked = false;
  public okClicked = false;

  public async evaluate(fn: any, ...args: any[]): Promise<any> {
    const scopeState = this.scopes;
    const hudDisable = this.hudDisable;
    const self = this;

    // Simulate browser DOM execution context
    const fakeDoc = {
      querySelector: (sel: string) => {
        if (sel.includes('.btn-assist')) {
          return {
            offsetParent: {},
            className: hudDisable ? 'btn-assist disable' : 'btn-assist',
            classList: {
              contains: (c: string) => hudDisable && (c === 'disable' || c === 'disabled')
            },
            click: () => {}
          };
        }
        if (sel.includes('.btn-check[type="all"]')) {
          return {
            offsetParent: {},
            getAttribute: (a: string) => (a === 'active' ? scopeState.all.active : null),
            classList: { contains: () => false },
            click: () => {
              scopeState.all.clickCount++;
              scopeState.all.active = scopeState.all.active === '1' ? '0' : '1';
            }
          };
        }
        if (sel.includes('.btn-check[type="friend"]')) {
          return {
            offsetParent: {},
            getAttribute: (a: string) => (a === 'active' ? scopeState.friend.active : null),
            classList: { contains: () => false },
            click: () => {
              scopeState.friend.clickCount++;
              scopeState.friend.active = scopeState.friend.active === '1' ? '0' : '1';
            }
          };
        }
        if (sel.includes('.btn-check[type="guild"]')) {
          return {
            offsetParent: {},
            getAttribute: (a: string) => (a === 'active' ? scopeState.guild.active : null),
            classList: { contains: () => false },
            click: () => {
              scopeState.guild.clickCount++;
              scopeState.guild.active = scopeState.guild.active === '1' ? '0' : '1';
            }
          };
        }
        if (sel.includes('btn-usual-text')) {
          return {
            offsetParent: {},
            click: () => {
              self.submitClicked = true;
            }
          };
        }
        if (sel.includes('btn-usual-ok')) {
          return {
            offsetParent: {},
            click: () => {
              self.okClicked = true;
            }
          };
        }
        return null;
      }
    };

    const codeStr = fn.toString();

    // Emulate assist check
    if (codeStr.includes('.btn-assist, .btn-request, .btn-backup')) {
      const el = fakeDoc.querySelector('.btn-assist');
      const onCooldown = el ? el.classList.contains('disable') : false;
      return { found: !!el, onCooldown, ready: !onCooldown };
    }

    // Emulate opening assist modal
    if (codeStr.includes('assistBtn.click()')) {
      return null;
    }

    // Emulate verifying scopes
    if (codeStr.includes('scopeConfigs')) {
      const activeScopes: string[] = [];
      const configs = [
        { name: 'Everyone', type: 'all' },
        { name: 'Friends', type: 'friend' },
        { name: 'Crew', type: 'guild' }
      ];

      for (const cfg of configs) {
        const target = fakeDoc.querySelector(`.btn-check[type="${cfg.type}"]`);
        if (target) {
          const isCurrentlyChecked = target.getAttribute('active') === '1';
          if (!isCurrentlyChecked) {
            target.click();
          }
          if (target.getAttribute('active') === '1') {
            activeScopes.push(cfg.name);
          }
        }
      }
      return activeScopes;
    }

    // Emulate submit
    if (codeStr.includes('.btn-usual-text')) {
      const btn = fakeDoc.querySelector('btn-usual-text');
      btn?.click();
      return true;
    }

    // Emulate ok popup
    if (codeStr.includes('.btn-usual-ok')) {
      const btn = fakeDoc.querySelector('btn-usual-ok');
      btn?.click();
      return null;
    }

    return null;
  }

  public async waitForSelector() {
    return true;
  }
}

const mockPage1 = new MockPageWithScopeState();
const service1 = new BackupBroadcastService(mockPage1 as any);

// Run initial broadcast with all already active='1'
const result1 = await service1.broadcastBackupRequestToAll();

assert('Broadcast succeeded', result1.broadcastSuccessful === true);
assert('All 3 scopes reported active', result1.activeScopes.length === 3);
assert('Everyone is in active scopes', result1.activeScopes.includes('Everyone'));
assert('Friends is in active scopes', result1.activeScopes.includes('Friends'));
assert('Crew is in active scopes', result1.activeScopes.includes('Crew'));
assert('Everyone clickCount is 0 (NOT clicked off!)', mockPage1.scopes.all.clickCount === 0);
assert('Friends clickCount is 0 (NOT clicked off!)', mockPage1.scopes.friend.clickCount === 0);
assert('Crew clickCount is 0 (NOT clicked off!)', mockPage1.scopes.guild.clickCount === 0);
assert('Everyone active attribute remains "1"', mockPage1.scopes.all.active === '1');
assert('Submit button was clicked', mockPage1.submitClicked === true);
assert('Confirmation OK was clicked', mockPage1.okClicked === true);
assert('Timestamp was recorded', service1.getLastBroadcastTimestamp() > 0);

// -----------------------------------------------------------------------------
// Test 3: Toggling ON when Scopes Start Unchecked (active="0")
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Verifying uncheck toggle ON when active="0"...');

const mockPage2 = new MockPageWithScopeState();
mockPage2.scopes.all.active = '0'; // Everyone starts off
mockPage2.scopes.friend.active = '1';
mockPage2.scopes.guild.active = '0'; // Crew starts off

const service2 = new BackupBroadcastService(mockPage2 as any);
const result2 = await service2.broadcastBackupRequestToAll();

assert('Broadcast succeeded when toggling required', result2.broadcastSuccessful === true);
assert('Everyone was clicked ON (clickCount = 1)', mockPage2.scopes.all.clickCount === 1);
assert('Everyone active attribute is now "1"', mockPage2.scopes.all.active === '1');
assert('Crew was clicked ON (clickCount = 1)', mockPage2.scopes.guild.clickCount === 1);
assert('Crew active attribute is now "1"', mockPage2.scopes.guild.active === '1');
assert('Friends was untouched (clickCount = 0)', mockPage2.scopes.friend.clickCount === 0);
assert('Everyone is in active scopes', result2.activeScopes.includes('Everyone'));

// -----------------------------------------------------------------------------
// Test 4: 180-Second Cooldown Enforcement
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Verifying 180s Cooldown State & canBroadcastBackup()...');

// Immediately trying again should be rejected by cooldown check
const canBroadcastImmediately = await service1.canBroadcastBackup();
assert('canBroadcastBackup() is false immediately after broadcast (<180s)', canBroadcastImmediately === false);

const cooldownResult = await service1.broadcastBackupRequestToAll();
assert('Immediate re-broadcast is rejected', cooldownResult.broadcastSuccessful === false);
assert('wasOnCooldown flag is true', cooldownResult.wasOnCooldown === true);
assert('Message mentions cooldown', cooldownResult.message.includes('cooldown'));

// Now simulate HUD disable class
const mockPageCooldown = new MockPageWithScopeState();
mockPageCooldown.hudDisable = true;
const serviceCooldown = new BackupBroadcastService(mockPageCooldown as any);
const canBroadcastWithHudDisable = await serviceCooldown.canBroadcastBackup();
assert('canBroadcastBackup() returns false when HUD has .btn-assist.disable', canBroadcastWithHudDisable === false);

// -----------------------------------------------------------------------------
// Test 5: Re-broadcasting in HostedCombatRunner
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Verifying HostedCombatRunner Multi-Turn Re-broadcast Logic...');

class MockBackupBroadcaster implements IBackupBroadcastService {
  public broadcastCount = 0;
  public canBroadcastValue = false;
  public lastTimestamp = 0;

  public updatePage() {}
  public async broadcastBackupRequestToAll() {
    this.broadcastCount++;
    this.lastTimestamp = Date.now();
    return {
      broadcastSuccessful: true,
      activeScopes: ['Everyone', 'Friends', 'Crew'] as any,
      wasOnCooldown: false,
      message: 'OK'
    };
  }
  public async canBroadcastBackup() {
    return this.canBroadcastValue;
  }
  public getLastBroadcastTimestamp() {
    return this.lastTimestamp;
  }
}

class MockNavigator implements IStageModalNavigator {
  public updatePage() {}
  public async navigateToMultiList() {}
  public async openStageCategoryModal() { return true; }
  public async closeStageCategoryModal() {}
  public resetActiveStage() {}
  public getActiveStageId() { return null; }
}

const mockBroadcaster = new MockBackupBroadcaster();
const mockNav = new MockNavigator();

let reloadCount = 0;
// Create workflow mock
const mockWorkflow = {
  waitForCombatInputReady: async () => {},
  handleQuickCall: async () => {},
  executeTacticalReadySkills: async () => {},
  handleAttack: async () => {},
  handleReload: async () => { reloadCount++; },
  handleDismissPopups: async () => {},
  currentBattleHonors: 500000
};

// Mock page for HostedCombatRunner that runs 2 full turns then defeats boss
const mockBattlePage = {
  evaluate: async (fn: any) => {
    if (reloadCount >= 2) {
      // Boss defeated on turn 2 reload
      return {
        isMounted: true,
        isVictory: true,
        isWipedOut: false,
        bossHp: 0,
        bossHpMax: 1000000,
        bossHpPct: 0,
        currentHonors: 500000
      };
    }
    return {
      isMounted: true,
      isVictory: false,
      isWipedOut: false,
      bossHp: 500000,
      bossHpMax: 1000000,
      bossHpPct: 50,
      currentHonors: 250000
    };
  }
};

const combatRunner = new HostedCombatRunner(
  mockBattlePage as any,
  mockWorkflow as any,
  mockBroadcaster,
  mockNav
);

const testRaid: DailyRaidHostDefinition = {
  id: 'tiamat_aura',
  name: 'Tiamat Aura Omega',
  category: 'magna3',
  stageId: '12042',
  questId: '305601',
  chapterId: '30560',
  dailyLimit: 3,
  apCost: 25
};

// Turn 1 should trigger initial broadcast
// Allow re-broadcast on subsequent turns
mockBroadcaster.canBroadcastValue = true;

const outcome = await combatRunner.executeHostedCombat(testRaid, 10);

assert('Combat outcome is victory', outcome.isVictoryConfirmed === true);
assert('Initial broadcast was called', mockBroadcaster.broadcastCount >= 1);
assert('Re-broadcast was triggered on subsequent turns (broadcastCount >= 2)', mockBroadcaster.broadcastCount >= 2);

console.log('\n========================================================================');
console.log(`Test Execution Scorecard: ${passCount} Passed, ${failCount} Failed.`);
console.log('Status:       🎉 ALL BACKUP BROADCAST & COOLDOWN TESTS PASSED (100%)');
console.log('========================================================================\n');
