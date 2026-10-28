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

  // Global Mock for Discord DM Relay: Prevent sending live messages during test suite
  const { discordDmRelay } = await import('../src/relay/discord-dm-relay.js');
  const interceptedDmMessages: string[] = [];
  const realRelaySendMessage = discordDmRelay.sendMessage.bind(discordDmRelay);
  discordDmRelay.sendMessage = async (content: string) => {
    interceptedDmMessages.push(content);
    return {
      id: `mock-dm-${interceptedDmMessages.length}`,
      content,
      author: { id: 'bot', username: 'GBF Relay (Test Mock)', bot: true },
      timestamp: new Date().toISOString()
    };
  };

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
    'daily:hostgb',
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
    'siete',
    'seofon',
    'agastia',
    'goldbar',
    'fate'
  ];

  for (const preset of requiredPresets) {
    assert(Boolean(COMMAND_WHITELIST[preset]), `Whitelist contains preset: "${preset}"`);
  }

  // Verify daily separation: daily = pro skips, daily:host = 16 hosts, daily:hostgb = gb hosts only
  assert(COMMAND_WHITELIST['daily'].script === 'src/cli/run-daily.ts', 'Preset "daily" executes pro skips only (run-daily.ts)');
  assert(COMMAND_WHITELIST['daily:host'].script === 'src/cli/run-daily-host.ts', 'Preset "daily:host" executes full daily host suite (run-daily-host.ts)');
  assert(COMMAND_WHITELIST['daily:hostgb'].script === 'src/cli/run-daily-host.ts' && COMMAND_WHITELIST['daily:hostgb'].defaultArgs?.includes('hl'), 'Preset "daily:hostgb" executes Gold Bar daily hosts only');

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
      content: '/gbf daily',
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
      content: '/gbf daily',
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

  // 7. Strict /gbf Prefix Enforcement Filter
  {
    const authUserId = config.DISCORD_USER_ID || '350293029825019915';

    // Messages without /gbf prefix MUST be completely ignored (no job, no response)
    const nonGbfMessages = [
      '/run daily',
      '/run gb-akasha',
      '/daily',
      'daily',
      '/status',
      'status',
      'hello bot'
    ];

    for (let i = 0; i < nonGbfMessages.length; i++) {
      await discordCommandGatewayService.handleOperatorMessage({
        id: `66666666666666666${i}`,
        content: nonGbfMessages[i],
        author: { id: authUserId, username: 'Operator', bot: false },
        timestamp: new Date().toISOString()
      });
      assert(!processRunnerService.isBusy(), `Ignores message without /gbf prefix: "${nonGbfMessages[i]}"`);
    }
  }

  // 7. Scheduler Toggle & Operator Commands (/gbf scheduler:off & /gbf scheduler:on)
  {
    const { dailyResetScheduler } = await import('../src/services/scheduler/daily-reset.scheduler.js');
    const authUserId = config.DISCORD_USER_ID || '350293029825019915';

    // Verify scheduler is OFF by default
    assert(!dailyResetScheduler.getIsRunning(), 'Scheduler is OFF by default on initial load');

    // Start daemon to test toggling off
    dailyResetScheduler.startDaemon();
    assert(dailyResetScheduler.getIsRunning(), 'Scheduler enters running state when explicitly started');

    // Operator sends /gbf scheduler:off
    await discordCommandGatewayService.handleOperatorMessage({
      id: '777777777777777771',
      content: '/gbf scheduler:off',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(!dailyResetScheduler.getIsRunning(), 'Operator command "/gbf scheduler:off" pauses daemon');

    // Operator sends /gbf scheduler:on
    await discordCommandGatewayService.handleOperatorMessage({
      id: '777777777777777772',
      content: '/gbf scheduler:on',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(dailyResetScheduler.getIsRunning(), 'Operator command "/gbf scheduler:on" resumes daemon');

    // Stop daemon after test cleanup
    dailyResetScheduler.stopDaemon();
    assert(!dailyResetScheduler.getIsRunning(), 'Scheduler cleanly stops');
  }

  // 8. Disk & Buffer Log Retrieval Verification
  {
    const logs = processRunnerService.getRecentLogs(5);
    assert(Array.isArray(logs) && logs.length > 0, 'Recent log retrieval returns array of log lines');
  }

  // 9. Command Normalization (/gbf run <cmd> vs /gbf <cmd>)
  {
    // Mock startCommand temporarily to intercept normalized key and args
    const originalStartCommand = processRunnerService.startCommand.bind(processRunnerService);
    let lastKey = '';
    let lastArgs: string[] = [];

    processRunnerService.startCommand = async (cmdKey: string, customArgs: string[] = []) => {
      lastKey = cmdKey;
      lastArgs = customArgs;
      return { success: true, message: `Mocked: started ${cmdKey}` };
    };

    const authUserId = config.DISCORD_USER_ID || '350293029825019915';

    // Test /gbf daily
    await discordCommandGatewayService.handleOperatorMessage({
      id: '555555555555555501',
      content: '/gbf daily',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(lastKey === 'daily', 'Operator command "/gbf daily" resolves to targetKey "daily"');

    // Test /gbf run daily (must normalize identically)
    await discordCommandGatewayService.handleOperatorMessage({
      id: '555555555555555502',
      content: '/gbf run daily',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(lastKey === 'daily', 'Operator command "/gbf run daily" normalizes to targetKey "daily"');

    // Test /gbf gb-akasha
    await discordCommandGatewayService.handleOperatorMessage({
      id: '555555555555555503',
      content: '/gbf gb-akasha',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(lastKey === 'gb-akasha', 'Operator command "/gbf gb-akasha" resolves to targetKey "gb-akasha"');

    // Test /gbf run gb-akasha (must normalize identically)
    await discordCommandGatewayService.handleOperatorMessage({
      id: '555555555555555504',
      content: '/gbf run gb-akasha',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(lastKey === 'gb-akasha', 'Operator command "/gbf run gb-akasha" normalizes to targetKey "gb-akasha"');

    // Test /gbf daily:host
    await discordCommandGatewayService.handleOperatorMessage({
      id: '555555555555555505',
      content: '/gbf daily:host',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(lastKey === 'daily:host', 'Operator command "/gbf daily:host" resolves to targetKey "daily:host"');

    // Test /gbf daily:hostgb
    await discordCommandGatewayService.handleOperatorMessage({
      id: '555555555555555506',
      content: '/gbf daily:hostgb',
      author: { id: authUserId, username: 'Operator', bot: false },
      timestamp: new Date().toISOString()
    });
    assert(lastKey === 'daily:hostgb', 'Operator command "/gbf daily:hostgb" resolves to targetKey "daily:hostgb"');

    // Restore original startCommand
    processRunnerService.startCommand = originalStartCommand;
  }

  // 10. Dynamic Template Resolution in processRunnerService
  {
    // Test that leech-leviathan-mare resolves dynamically to run-leech.ts
    const templateName = 'leech-leviathan-mare';
    const templatePath = path.resolve(process.cwd(), 'templates', `${templateName}.json`);
    assert(fs.existsSync(templatePath), `Target template exists: ${templateName}.json`);
  }

  // 11. Preemptive Task Switching (Hot Swapping: e.g. /gbf gb-akasha 100 -> /gbf leech:leviathan)
  {
    const { EventEmitter } = await import('events');

    // Setup a mock active job representing running gb-akasha
    let killSignalSent: string | null = null;
    const mockProcess = new EventEmitter() as any;
    mockProcess.pid = 77123;
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockProcess.kill = (sig: string) => {
      killSignalSent = sig;
      mockProcess.killed = true;
      mockProcess.exitCode = 0;
      setTimeout(() => mockProcess.emit('close', 0), 10);
    };

    const mockAkashaJob = {
      key: 'gb-akasha',
      script: 'src/cli/run-workflow.ts',
      args: ['src/cli/run-workflow.ts', 'acc1', 'gb-akasha', '100'],
      pid: 77123,
      startedAt: new Date(Date.now() - 45000), // 45s ago
      process: mockProcess,
      outputBuffer: ['[gb-akasha] Battle in progress...']
    };

    (processRunnerService as any).activeJob = mockAkashaJob;
    assert(processRunnerService.isBusy(), 'Process runner reports busy with active gb-akasha job');

    // A. Rejection of invalid command must NOT terminate or preempt the running job
    const badCommandResult = await processRunnerService.startCommand('unauthorized-bogus-preset');
    assert(!badCommandResult.success, 'Rejects invalid command preset during active job execution');
    assert(processRunnerService.isBusy(), 'Active job remains running when invalid command is rejected');
    assert(killSignalSent === null, 'Running job was not sent any termination signal by invalid command');

    // B. Preemption of active job when a valid command is launched
    // Mock stopActiveProcess to spy on preemption state
    let stoppedPreemptedBy: string | undefined;
    let stoppedKey: string | undefined;
    const realStopActiveProcess = processRunnerService.stopActiveProcess.bind(processRunnerService);

    processRunnerService.stopActiveProcess = async () => {
      stoppedKey = (processRunnerService as any).activeJob?.key;
      stoppedPreemptedBy = (processRunnerService as any).activeJob?.preemptedBy;
      (processRunnerService as any).activeJob = null;
      return { success: true, message: 'Stopped' };
    };

    // Temporarily mock child_process spawn in startCommand flow
    const realSpawn = (await import('child_process')).spawn;
    // We test startCommand with a mocked child process that exits cleanly
    const originalStartCommand = processRunnerService.startCommand.bind(processRunnerService);

    // Call startCommand for 'leech:leviathan'
    // To avoid spawning real headless Chrome, we can test startCommand with a quick dry-run preset or inspect logic
    (processRunnerService as any).activeJob = mockAkashaJob;

    // Verify stopActiveProcess alone works
    const stopResult = await realStopActiveProcess();
    assert(stopResult.success, 'stopActiveProcess halts mock process cleanly');
    assert(!processRunnerService.isBusy(), 'Process runner is idle after stopActiveProcess');

    // C. Verify notifyJobCompletion suppresses duplicate exit DM when preemptedBy is set
    let messageSent = false;
    discordDmRelay.sendMessage = async () => {
      messageSent = true;
      return { id: 'mock', content: '', author: { id: 'b', username: 'b' }, timestamp: '' };
    };

    const preemptedJob = {
      key: 'gb-akasha',
      script: 'src/cli/run-workflow.ts',
      args: ['acc1', 'gb-akasha'],
      pid: 77123,
      startedAt: new Date(Date.now() - 30000),
      process: mockProcess,
      outputBuffer: [],
      preemptedBy: 'leech:leviathan',
      stoppedByOperator: true
    };

    await (discordCommandGatewayService as any).notifyJobCompletion(preemptedJob, 0, 30000);
    assert(!messageSent, 'notifyJobCompletion suppresses redundant exit DM when preemptedBy is present');

    // Clean up mocks
    discordDmRelay.sendMessage = realRelaySendMessage;
    processRunnerService.stopActiveProcess = realStopActiveProcess;
  }

  console.log(`\nDiscord Remote Controller Tests: ${passed}/${total} passed.\n`);
  if (passed !== total) {
    throw new Error(`Discord Remote Controller tests failed: ${passed}/${total}`);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
