// tests/run-all.ts
import { spawn } from 'child_process';
import path from 'path';

interface TestSuite {
  name: string;
  file: string;
  description: string;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'Workflow Template Schema & Boundary Tests',
    file: 'tests/test-template-schema.ts',
    description: 'Zod validation, constraints, negative tests, and field aliasing'
  },
  {
    name: 'Advanced DSL Compiler & Round-Trip Serializer',
    file: 'tests/test-template-parser-advanced.ts',
    description: 'DSL lexer, repeat blocks, shorthand dialects, and DSL <-> JSON serialization'
  },
  {
    name: 'Universal Engine Unit & Telemetry Mock Tests',
    file: 'tests/test-universal-engine-unit.ts',
    description: 'State-aware input locks, repeat blocks, Gold Bar detection, and response listeners'
  },
  {
    name: 'Human Motor Biomechanical Math & Jitter Tests',
    file: 'tests/test-human-motor.ts',
    description: 'Gaussian distributions, Box-Muller transforms, and cubic Bézier trajectories'
  },
  {
    name: 'ProSkip Daily Engine State Logic Tests',
    file: 'tests/test-pro-skip-unit.ts',
    description: 'Daily Magna/Hard Pro skip modal reconciliation and AP handling'
  },
  {
    name: 'Raid Engine State Machine & Recovery Tests',
    file: 'tests/test-raid-engine-unit.ts',
    description: 'Raid join lifecycle, expired raid handling, and combat state transitions'
  },
  {
    name: 'Template Parser Backwards Compatibility Tests',
    file: 'tests/test-template-parser.ts',
    description: 'Legacy template format support and backwards-compatible parsing'
  },
  {
    name: 'Daily Universal Routine & Reconnect Logic Tests',
    file: 'tests/test-daily-universal-unit.ts',
    description: 'Universal daily sectors, catalog tags, and CDP reconnect page binding'
  },
  {
    name: 'Rupie Gacha Automation Logic Unit Tests',
    file: 'tests/test-rupie-gacha-unit.ts',
    description: '100-Draw Rupie Gacha tab detection, anti-false-positive evaluation, and execution'
  },
  {
    name: '3-Raid Backup Limit Detection & Recovery Tests',
    file: 'tests/test-raid-backup-limit.ts',
    description: '3-Raid limit modal detection, lingering active assist rejoining, sorting, and 5-battle milestone'
  }
];

interface TestResult {
  suite: TestSuite;
  passed: boolean;
  durationMs: number;
  output: string;
}

async function runSuite(suite: TestSuite): Promise<TestResult> {
  const t0 = Date.now();
  const filePath = path.resolve(process.cwd(), suite.file);

  return new Promise(resolve => {
    const isBun = typeof (process.versions as any).bun !== 'undefined';
    const spawnArgs = isBun ? [filePath] : ['--import', 'tsx', filePath];
    const proc = spawn(process.execPath, spawnArgs, {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test' }
    });

    let output = '';
    proc.stdout.on('data', data => { output += data.toString(); });
    proc.stderr.on('data', data => { output += data.toString(); });

    proc.on('close', code => {
      resolve({
        suite,
        passed: code === 0,
        durationMs: Date.now() - t0,
        output
      });
    });
  });
}

async function main() {
  console.log('\n========================================================================');
  console.log('       Granblue Fantasy Remote Controller - Unified Test Runner         ');
  console.log('========================================================================\n');

  const results: TestResult[] = [];
  let allPassed = true;

  for (let i = 0; i < TEST_SUITES.length; i++) {
    const suite = TEST_SUITES[i];
    process.stdout.write(`  [${i + 1}/${TEST_SUITES.length}] Running: ${suite.name}... `);

    const result = await runSuite(suite);
    results.push(result);

    if (result.passed) {
      console.log(`✅ PASS (${result.durationMs}ms)`);
    } else {
      console.log(`❌ FAIL (${result.durationMs}ms)`);
      allPassed = false;
    }
  }

  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n========================================================================');
  console.log('                       Test Execution Scorecard                         ');
  console.log('========================================================================');

  results.forEach((r, idx) => {
    const statusTag = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`  [${idx + 1}] ${statusTag} | ${r.suite.name.padEnd(46)} | ${(r.durationMs + 'ms').padStart(7)}`);
  });

  console.log('------------------------------------------------------------------------');
  console.log(`Total Suites: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount} | Total Time: ${(totalDuration / 1000).toFixed(2)}s`);

  if (!allPassed) {
    console.log('\n--- Failure Details ---');
    for (const r of results) {
      if (!r.passed) {
        console.error(`\n❌ [FAILED] ${r.suite.name}:`);
        console.error(r.output);
      }
    }
    console.log('========================================================================\n');
    process.exit(1);
  } else {
    console.log('Status:       🎉 ALL TEST SUITES PASSED (100% GOLD INDUSTRY STANDARD)');
    console.log('========================================================================\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[TestRunner] Fatal error:', err);
  process.exit(1);
});
