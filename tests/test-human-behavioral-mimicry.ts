// tests/test-human-behavioral-mimicry.ts
import fs from 'node:fs';
import path from 'node:path';
import { inventoryAuditorService, InventorySnapshot } from '../src/services/behavior/inventory-auditor.service.js';
import { monthlyShopRoutineService } from '../src/services/behavior/monthly-shop-routine.service.js';
import { HumanCadenceOrchestrator } from '../src/services/behavior/human-cadence-orchestrator.service.js';
import { COMMAND_WHITELIST, processRunnerService } from '../src/services/discord/process-runner.service.js';
import { discordCommandGatewayService } from '../src/services/discord/discord-command-gateway.service.js';
import { config } from '../src/config.js';

async function runTests() {
  console.log('🧪 Starting Human Behavioral Mimicry & Cadence Test Suite...\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      process.exitCode = 1;
    }
  }

  // 1. InventoryAuditorService Snapshot Persistence & Formatting
  {
    const sampleSnapshot: InventorySnapshot = {
      timestamp: '2026-10-14T15:30:00.000Z',
      jstDate: '2026-10-15',
      goldBars: 14,
      damascusIngots: 8,
      damascusCrystals: 42,
      halfElixirs: 6850,
      soulBerries: 34200,
      goldMoons: 145,
      silverMoons: 320,
      bronzeMoons: 1150
    };

    inventoryAuditorService.saveSnapshot(sampleSnapshot);
    const retrieved = inventoryAuditorService.getLatestSnapshot();
    assert(Boolean(retrieved), 'Successfully retrieves saved inventory snapshot');
    assert(retrieved?.goldBars === 14, 'Correctly stores Gold Bar count (14)');
    assert(retrieved?.halfElixirs === 6850, 'Correctly stores Half Elixir count (6850)');
    assert(retrieved?.goldMoons === 145, 'Correctly stores Gold Moon count (145)');

    const formatted = inventoryAuditorService.formatSnapshotForDiscord(sampleSnapshot);
    assert(formatted.includes('Gold Bricks (ヒヒイロカネ)'), 'Discord output contains Japanese/English Gold Brick title');
    assert(formatted.includes('14'), 'Discord output contains Gold Brick count');
    assert(formatted.includes('Half Elixirs'), 'Discord output contains Half Elixirs count');

    const mdPath = path.resolve('logs/inventory-audit.md');
    assert(fs.existsSync(mdPath), 'Inventory Markdown report generated at logs/inventory-audit.md');
    const mdContent = fs.readFileSync(mdPath, 'utf8');
    assert(mdContent.includes('ヒヒイロカネ') && mdContent.includes('6,850'), 'Markdown report contains structured table');
  }

  // 2. MonthlyShopRoutineService JST Date Logic & Idempotency
  {
    // Test JST 1st of month detection
    // 2026-10-01 06:00 JST -> True (after 05:00 JST)
    const oct1Date = new Date('2026-10-01T06:00:00+09:00');
    assert(monthlyShopRoutineService.constructor['isFirstDayOfMonthJst'](oct1Date), 'Detects 1st of month at 06:00 JST as true');

    // 2026-10-01 03:00 JST -> False (before 05:00 JST Cygames reset)
    const oct1EarlyDate = new Date('2026-10-01T03:00:00+09:00');
    assert(!monthlyShopRoutineService.constructor['isFirstDayOfMonthJst'](oct1EarlyDate), 'Detects 1st of month before 05:00 JST as false');

    // 2026-10-14 -> False
    const oct14Date = new Date('2026-10-14T15:00:00+09:00');
    assert(!monthlyShopRoutineService.constructor['isFirstDayOfMonthJst'](oct14Date), 'Detects mid-month day as false');

    const yearMonth = monthlyShopRoutineService.constructor['getCurrentYearMonthJst'](oct14Date);
    assert(yearMonth === '2026-10', `Returns correct JST year-month ("${yearMonth}")`);

    // State test
    monthlyShopRoutineService.saveState({
      lastExecutedMonth: '2026-10',
      lastExecutedAt: new Date().toISOString(),
      results: { casinoPotsExchanged: 100, casinoBerriesExchanged: 200, moonPotsExchanged: 0 }
    });
    const state = monthlyShopRoutineService.getState();
    assert(state.lastExecutedMonth === '2026-10', 'Correctly saves and retrieves monthly execution state');
    assert(!monthlyShopRoutineService.isDue(false), 'Correctly flags as NOT due when already executed this month');
    assert(monthlyShopRoutineService.isDue(true), 'Force flag overrides isDue check');
  }

  // 3. HumanCadenceOrchestrator Lifecycle & Stop Mechanism
  {
    // Mock minimal page object
    const mockPage: any = {
      url: () => 'https://game.granbluefantasy.jp/#mypage',
      goto: async () => {},
      evaluate: async () => {}
    };

    const orchestrator = new HumanCadenceOrchestrator(mockPage);
    assert(typeof orchestrator.runHumanCadenceLoop === 'function', 'Orchestrator exposes runHumanCadenceLoop');
    assert(typeof orchestrator.requestStop === 'function', 'Orchestrator exposes requestStop');

    orchestrator.requestStop();
    // With stop requested before loop, run returns immediately with 0 cycles
    const summary = await orchestrator.runHumanCadenceLoop({ totalCycles: 1 });
    assert(summary.cyclesCompleted === 0, 'Cleanly halts immediately when stopRequested is set');
  }

  // 4. Command Whitelist & Dispatcher Integration
  {
    assert(Boolean(COMMAND_WHITELIST['farm:human']), 'COMMAND_WHITELIST contains "farm:human" preset');
    assert(Boolean(COMMAND_WHITELIST['inventory']), 'COMMAND_WHITELIST contains "inventory" preset');

    const humanScript = path.resolve(COMMAND_WHITELIST['farm:human'].script);
    assert(fs.existsSync(humanScript), `Target file exists for farm:human: ${humanScript}`);

    const inventoryScript = path.resolve(COMMAND_WHITELIST['inventory'].script);
    assert(fs.existsSync(inventoryScript), `Target file exists for inventory: ${inventoryScript}`);

    const authUserId = config.DISCORD_USER_ID || '350293029825019915';
    const { discordDmRelay } = await import('../src/relay/discord-dm-relay.js');
    const origSend = discordDmRelay.sendMessage.bind(discordDmRelay);
    discordDmRelay.sendMessage = async (content: string) => {
      return { id: 'mock-inventory', content, author: { id: 'b', username: 'b' }, timestamp: '' };
    };

    // Operator sends /gbf inventory
    await discordCommandGatewayService.handleOperatorMessage({
      id: '888888888888888881',
      content: '/gbf inventory',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(true, 'Operator command "/gbf inventory" handled without error');
    discordDmRelay.sendMessage = origSend;
  }

  console.log(`\nHuman Behavioral Mimicry Tests: ${passed}/${total} passed.\n`);
  if (passed !== total) {
    throw new Error(`Human Behavioral Mimicry tests failed: ${passed}/${total}`);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
