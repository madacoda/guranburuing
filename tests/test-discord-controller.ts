// tests/test-discord-controller.ts
import fs from 'fs';
import path from 'path';
import { processRunnerService, COMMAND_WHITELIST } from '../src/services/discord/process-runner.service.js';
import { discordCommandGatewayService } from '../src/services/discord/discord-command-gateway.service.js';
import { config } from '../src/config.js';

async function runTests() {
  console.log('🧪 Starting Discord Remote Controller Security Test Suite...\n');
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

  // 1. Whitelist Completeness
  const requiredPresets = [
    'daily',
    'daily:routine',
    'daily:host',
    'daily:skips',
    'gb-pbhl',
    'gb-akasha',
    'gb-go',
    'gb-farm',
    'leech:colossus',
    'leech:tiamat',
    'leech:leviathan',
    'leech:yggdrasil',
    'leech:luminiera',
    'leech:celeste',
    'goldbar',
    'fate'
  ];

  for (const preset of requiredPresets) {
    assert(Boolean(COMMAND_WHITELIST[preset]), `Whitelist contains preset: "${preset}"`);
  }

  // 2. Target File Existence for all presets
  for (const [key, preset] of Object.entries(COMMAND_WHITELIST)) {
    const fullPath = path.resolve(process.cwd(), preset.script);
    assert(fs.existsSync(fullPath), `Preset "${key}" targets existing script file: ${preset.script}`);
  }

  // 3. Security: Rejection of Unwhitelisted Commands
  {
    const attack1 = await processRunnerService.startCommand('rm -rf /');
    assert(!attack1.success, 'Rejects command injection attempt ("rm -rf /")');
    assert(attack1.message.includes('not in the authorized command whitelist'), 'Returns security rejection message');

    const attack2 = await processRunnerService.startCommand('curl');
    assert(!attack2.success, 'Rejects unmapped binary ("curl")');

    const attack3 = await processRunnerService.startCommand('powershell');
    assert(!attack3.success, 'Rejects shell attempt ("powershell")');
  }

  // 4. Concurrency Guard Verification
  {
    assert(!processRunnerService.isBusy(), 'Process runner initial state is NOT busy');
    const status = processRunnerService.getStatus();
    assert(!status.isBusy, 'Status reports idle state');
  }

  // 5. Message Authorization Filter
  {
    // Simulating message from unauthorized user
    const maliciousMsg = {
      id: '999999999999999999',
      content: '/run daily',
      author: {
        id: '123456789012345678', // Unauthorized random ID
        username: 'Attacker',
        bot: false
      },
      timestamp: new Date().toISOString()
    };

    // Should be silently dropped without launching any job
    await discordCommandGatewayService.handleOperatorMessage(maliciousMsg);
    assert(!processRunnerService.isBusy(), 'Silently discards command from unauthorized Discord user ID');
  }

  // 6. Bot Message Ignored Filter
  {
    const botMsg = {
      id: '888888888888888888',
      content: '/run daily',
      author: {
        id: config.DISCORD_USER_ID || '350293029825019915',
        username: 'BotSelf',
        bot: true // Bot flag set
      },
      timestamp: new Date().toISOString()
    };

    await discordCommandGatewayService.handleOperatorMessage(botMsg);
    assert(!processRunnerService.isBusy(), 'Discards message sent with bot flag');
  }

  console.log(`\nDiscord Remote Controller Tests: ${passed}/${total} passed.\n`);
  if (passed !== total) {
    throw new Error(`Discord Remote Controller tests failed: ${passed}/${total}`);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
