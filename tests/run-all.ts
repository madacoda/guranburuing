// tests/run-all.ts
import { spawn } from 'child_process';
import path from 'path';
import { DiscordDmRelay } from '../src/relay/discord-dm-relay.js';

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
  },
  {
    name: 'Event Engine & Scenario Story Unit Tests',
    file: 'tests/test-event-engine-unit.ts',
    description: 'Event ID resolution, story card scanning, cutscene skipping, and stop requests'
  },
  {
    name: 'Gold Bar Tracker & Battle URL Integration Tests',
    file: 'tests/test-gold-bar-tracker.ts',
    description: 'Item 20004 drop logging, battle log URL resolution, and Hall of Fame generation'
  },
  {
    name: 'CAPTCHA Detection & Safety Sentinel Tests',
    file: 'tests/test-captcha-detection.ts',
    description: 'Instant URL hash, external iframes, atomic DOM checks, false positive immunity, and network interception'
  },
  {
    name: 'Notification Deduplication & Anti-Spam Tests',
    file: 'tests/test-discord-dedupe.ts',
    description: 'Raid ID deduplication, active CAPTCHA prompt throttling, and single-dispatch guarantees'
  },
  {
    name: 'Raid Evaluator & Score-Based Decision Tests',
    file: 'tests/test-raid-evaluator-score.ts',
    description: 'Raid score ranking, sweet spot weighting (HP > 85%, players <= 2), burn rate penalties, and doomed raid disqualification'
  },
  {
    name: 'Session & Cookie Synchronization Tests',
    file: 'tests/test-session-sync.ts',
    description: 'Cookie sanitization, CDP Network.setCookies compliance, cross-platform path normalization, and token authentication'
  },
  {
    name: 'Discord Presence Multi-Template Tests',
    file: 'tests/test-presence-templates.ts',
    description: 'Work, trade, and GBF status formatting, trading quotes, project customisation, and mode switching'
  },
  {
    name: 'Arcarum: The World Template & AAP Engine Tests',
    file: 'tests/test-arcarum-theworld-template.ts',
    description: 'The World Zone Mundus quest start, AAP recovery modal, optimal skills, attack-wait-reload, and DSL round-trip'
  },
  {
    name: 'Granblue Fantasy Methodological Tactical Skills Tests',
    file: 'tests/test-tactical-skills-unit.ts',
    description: 'Field -> Debuff -> Buff -> Nuke ordering, conditional healing, and zero-latency cooldown checks'
  },
  {
    name: 'Proto Bahamut HL Universal Workflow & Shorthand DSL Tests',
    file: 'tests/test-pbhl-universal-workflow.ts',
    description: 'PBHL Fire burst rotation, named summon resolution, natural language DSL parsing, and round-trip validation'
  },
  {
    name: 'Magna 3 Leech & Fast Burst 6-Element Evaluator Unit Tests',
    file: 'tests/test-leech-evaluator.ts',
    description: 'Fast burst raid evaluation (HP <= 20%, players >= 3), 6-element Magna 3 primal supporter validation, and active assist limit recovery'
  },
  {
    name: 'Leviathan Mare Farm Evaluator & Adaptive Strategy Test Suite',
    file: 'tests/test-farm-evaluator.ts',
    description: 'Adaptive damage farm raid evaluation, high player density ("most joined") prioritization, lowest HP preference, and zero idle standby fallback'
  },
  {
    name: 'Raid Evaluator Parallel Multi-Condition & High-Performance Tests',
    file: 'tests/test-raid-evaluator-parallel.ts',
    description: 'Parallel condition checking, multi-slot concurrency, O(1) set lookups, disqualification bitmasks, and LRU cache'
  },
  {
    name: 'Daily Host Engine & 16-Raid Catalog Unit Tests',
    file: 'tests/test-daily-host.ts',
    description: 'High Level, Magna 3, and Six Dragons daily host verification, stage mappings, and material checks'
  },
  {
    name: 'Senior Gold Industry Standard Data Architecture & Catalog Tests',
    file: 'tests/test-data-catalog-architecture.ts',
    description: 'Modular data directory integrity, schema compliance, O(1) DataCatalogService lookups, and backwards compatibility'
  },
  {
    name: 'Backup Broadcast Scope Verification & 3-Min Cooldown Unit Tests',
    file: 'tests/test-backup-broadcast-cooldown.ts',
    description: 'Active="1" attribute preservation, Everyone/Friends/Crew checkboxes, 180s cooldown, and combat re-broadcasting'
  },
  {
    name: 'Dual-Track Assist Interleaving & Background Host Recheck Tests',
    file: 'tests/test-assist-interleaving.ts',
    description: 'Frontline wipeout/turn yield triage, assist farming interleaving, 180s cooldown re-broadcast, and slot reclamation'
  },
  {
    name: 'Failure Diagnostic Classifier & Critical Analysis Tests',
    file: 'tests/test-failure-analyzer.ts',
    description: 'Material deficit vs transient modal/network classification and non-retriable safeguards'
  },
  {
    name: 'Daily Reset Scheduler Daemon & JST Math Tests',
    file: 'tests/test-daily-scheduler.ts',
    description: 'JST reset calculation, anti-drift scheduling, advance notification, and time formatting'
  },
  {
    name: 'Discord Remote Controller Security & Whitelist Tests',
    file: 'tests/test-discord-controller.ts',
    description: 'User snowflake authorization, strict whitelist routing, injection prevention, and CDP concurrency lock'
  },
  {
    name: 'PBHL 0-Honors Bug Critical Verification & Regression Tests',
    file: 'tests/test-pbhl-zero-honor-fix.ts',
    description: 'Verify syncCurrentHonors result isolation, waitForCombatTurnResolution attack gating, and handleTapReady honors generation'
  },
  {
    name: 'Two-Way Discord CAPTCHA Relay & Anti-Deadlock Resolution Tests',
    file: 'tests/test-captcha-relay.ts',
    description: 'Verify single high-clarity viewport attachment, dual-layer Send button typing & click, and circular lock resolution'
  },
  {
    name: 'Proto Bahamut HL Precise Manual Skill Flow Tests',
    file: 'tests/test-pbhl-skill.ts',
    description: 'Verify tap_ready elimination, optional fallback flags, zero-honorGuard mode, and exact tactical skill/summon sequence'
  },
  {
    name: 'Arcarum Zone Mundus (Stage 10) Militis Bosses & Map Tests',
    file: 'tests/test-arcarum-mundus-militis.ts',
    description: 'Verify Prometheus, Morrigna, Ca Ong, and Gilgamesh Militis templates, URLs, DSL round-trip, and Stage 10 quest selection'
  },
  {
    name: 'Arcarum Zone Goliath (Stage 3) Bosses & Workflows Tests',
    file: 'tests/test-arcarum-stage-3-goliath.ts',
    description: 'Verify Goliath Triune, Avatar of Avarice, Goliath Keeper, Frenzied Howler templates, Stage 3 map routing, and presets'
  },
  {
    name: 'Fate Stories Engine & Routine Unit Tests',
    file: 'tests/test-fate-engine-unit.ts',
    description: 'Verify fate episode template schema, card filtering, quest skip uncheck, caution modal, cutscene skip, and routine loop integration'
  },
  {
    name: 'Multi-Part Story Scene Skip Engine Tests',
    file: 'tests/test-story-scene-multiskip.ts',
    description: 'Verify multi-scene cutscene sequence progression, branching dialogue choices, spoiler warning dismissal, and conflict auto-fix'
  },
  {
    name: 'Production vs Local Environment & Performance Architecture Tests',
    file: 'tests/test-production-environment.ts',
    description: 'Verify APP_ENV detection, SwiftShader 30fps cap, V8 1024MB heap, 512MB disk cache, 360x720 viewport, and audio auto-mute'
  },
  {
    name: 'Mobage OAuth Redirect & Cookie Replacement Tests',
    file: 'tests/test-mobage-redirect-sync.ts',
    description: 'Verify OAuth redirect URL detection, midship server sync wait, SP_GUEST purging, and multi-domain cookie replacement'
  },
  {
    name: 'Suspended Quest & Combat Resume Engine Tests',
    file: 'tests/test-resume-and-suspended-quest.ts',
    description: 'Verify popRestartQuest detection, multilingual suspended quest analysis, turn-aware combat resume, and boss name formatting'
  },
  {
    name: 'Arcarum Zone Joculator (Stage 7) Lady of Redemption Tests',
    file: 'tests/test-arcarum-stage-7-joculator.ts',
    description: 'Verify Lady of Redemption, Maiden of the Depths, Stage 7 templates, Paragon step equivalence, and Joculator presets'
  },
  {
    name: 'Duplicate Workflow Prevention & Canonical Alias Tests',
    file: 'tests/test-duplicate-workflows.ts',
    description: 'Verify 0 duplicate workflow pipelines on disk, canonical alias resolution, and Stage 3 / M3 disambiguation'
  },
  {
    name: 'Raid: The World (HL) Multi-Battle Template & DSL Tests',
    file: 'tests/test-raid-the-world-template.ts',
    description: 'Verify The World (HL) multi-battle assist raid template, Finder Tab 1, 10-step burst, random delay, and DSL round-trip'
  },
  {
    name: 'Raid: Dark Rapture (Hard) Multi-Battle Template & DSL Tests',
    file: 'tests/test-raid-dark-rapture-hard-template.ts',
    description: 'Verify Dark Rapture (Hard) / FaaHL assist raid template, Finder Tab 1, low HP & active player join filter, 8-step burst, and DSL round-trip'
  },
  {
    name: 'Raid: The Fallen Angel of Cunning (HL) Multi-Battle Template & DSL Tests',
    file: 'tests/test-raid-the-fallen-angel-of-cunning-template.ts',
    description: 'Verify The Fallen Angel of Cunning / Belial HL assist raid template, Finder Tab 1, low HP & active player join filter, 8-step burst, and DSL round-trip'
  },
  {
    name: 'Raid: Long Live the King (HL) Multi-Battle Template & DSL Tests',
    file: 'tests/test-raid-long-live-the-king-template.ts',
    description: 'Verify Long Live the King / Beelzebub HL assist raid template, Finder Tab 1, low HP & active player join filter, 8-step burst, and DSL round-trip'
  },
  {
    name: 'Finder Slot Configurator & Auto Set Raid Tests',
    file: 'tests/test-finder-slot-configurator.ts',
    description: 'Verify Search Raid Catalog, resolveSearchRaid resolver, autoSetRaid schema validation, and slot reconfigurator'
  },
  {
    name: 'Raid: Fediel (Impossible) Multi-Battle Template & DSL Tests',
    file: 'tests/test-raid-fediel-template.ts',
    description: 'Verify Fediel (Impossible) / Six Dragons assist raid template, Finder Tab 1, low HP & active player join filter, 8-step burst, and DSL round-trip'
  },
  {
    name: 'Raid: Wilnas (Impossible) Multi-Battle Template & DSL Tests',
    file: 'tests/test-raid-wilnas-template.ts',
    description: 'Verify Wilnas (Impossible) / Six Dragons assist raid template, Finder Tab 1, low HP & active player join filter, 8-step burst, and DSL round-trip'
  },
  {
    name: 'Arcarum Stage 7 (Xeno Cocytus Militis) Template & DSL Tests',
    file: 'tests/test-arcarum-xeno-cocytus.ts',
    description: 'Verify Xeno Cocytus Militis template, Quest 816131, Division 15, Paragon step equivalence, DSL round-trip, and Joculator presets'
  },
  {
    name: 'Arcarum Stage 6 (Xeno Ifrit Militis) Template & Screen Guard Tests',
    file: 'tests/test-arcarum-xeno-ifrit.ts',
    description: 'Verify Xeno Ifrit Militis template, Quest 815131, Division 14, pre-skill screen load guard, random wait, step equivalence, and Kalendae presets'
  },
  {
    name: 'Human Behavioral Mimicry & Account Cadence Tests',
    file: 'tests/test-human-behavioral-mimicry.ts',
    description: 'Verify inventory supply auditing, 1st-of-month shop reset detection, cadence lifecycle, and Discord operator integration'
  },
  {
    name: 'Standardized Gold Bar Rotations & 1.5M Honor Verification Tests',
    file: 'tests/test-gold-bar-standardized-rotations.ts',
    description: 'Verify gb-akasha, gb-pbhl, and gb-go step uniformity, 1.5M min honor threshold, and DSL round-trip fidelity'
  },
  {
    name: 'Mid-Execution Stoppage, Renderer Freeze Watchdog & Standby Mode Tests',
    file: 'tests/test-stoppage-and-captcha-safety.ts',
    description: 'Verify CDP renderer freeze watchdog, timeout cascade prevention, about:blank standby mode, and CAPTCHA non-logout safety'
  },
  {
    name: 'Magna 3 (Omega Rebirth) All-Element Farm Templates & Strategy Tests',
    file: 'tests/test-magna3-farm-templates.ts',
    description: 'Verify all 6 Magna 3 farm templates, schema validation, adaptive damage strategy, shorthand mapping, and Finder Slot 1 catalog integration'
  },
  {
    name: 'Shiny Slime Search (Very Hard) Workflow & Back Button Tests',
    file: 'tests/test-shiny-slime-search.ts',
    description: 'Verify shiny-slime-search template, quest 400151, back button action, shorthand DSL compiler, and alias resolution'
  },
  {
    name: 'Seofon (Impossible) / Siete HL 4M Honors & Readiness Auto-Checker Tests',
    file: 'tests/test-siete-4m-readiness.ts',
    description: 'Verify Siete 4M Honors party catalog, schema validation, 77.77M Emblema math, hard gates, substitute chains, and CLI/template integration'
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
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DISCORD_MAX_TEST_MESSAGES: process.env.DISCORD_MAX_TEST_MESSAGES || '1'
      }
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
  const wallStart = Date.now();
  const concurrency = Math.max(1, parseInt(process.env.TEST_CONCURRENCY || '6', 10) || 6);

  // Initialize test session counter (guarantees max 1 Discord message across all 51 suites)
  DiscordDmRelay.resetTestMessageCounter();
  process.env.DISCORD_MAX_TEST_MESSAGES = process.env.DISCORD_MAX_TEST_MESSAGES || '1';

  console.log('\n========================================================================');
  console.log('       Granblue Fantasy Remote Controller - Unified Test Runner         ');
  console.log(`       Parallel Worker Pool: ${concurrency} concurrent test workers            `);
  console.log('========================================================================\n');

  const results: TestResult[] = new Array(TEST_SUITES.length);
  let allPassed = true;
  let nextIdx = 0;
  let completedCount = 0;

  const runWorker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= TEST_SUITES.length) break;

      const suite = TEST_SUITES[idx];
      const result = await runSuite(suite);
      results[idx] = result;
      completedCount++;

      const statusIcon = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`  [${completedCount}/${TEST_SUITES.length}] ${statusIcon} (${result.durationMs}ms) - [#${idx + 1}] ${suite.name}`);

      if (!result.passed) {
        allPassed = false;
      }
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, TEST_SUITES.length) }, () => runWorker());
  await Promise.all(workers);

  const wallDurationMs = Date.now() - wallStart;
  const totalCpuDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
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
  console.log(
    `Total Suites: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount} | Wall Time: ${(wallDurationMs / 1000).toFixed(2)}s (CPU Time: ${(totalCpuDurationMs / 1000).toFixed(2)}s)`
  );

  if (!allPassed) {
    console.log('\n--- Failure Details ---');
    for (const r of results) {
      if (!r.passed) {
        console.error(`\n❌ [FAILED] ${r.suite.name}:`);
        console.error(r.output);
      }
    }
    console.log('========================================================================\n');
    DiscordDmRelay.resetTestMessageCounter();
    process.exit(1);
  } else {
    console.log('Status:       🎉 ALL TEST SUITES PASSED (100% GOLD INDUSTRY STANDARD)');
    console.log('========================================================================\n');
    DiscordDmRelay.resetTestMessageCounter();
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[TestRunner] Fatal error:', err);
  process.exit(1);
});
