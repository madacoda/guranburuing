// src/cli/set-presence.ts
import fs from 'fs';
import path from 'path';
import { discordPresence, PresenceMode } from '../relay/discord-presence.js';
import { TRADING_QUOTES, loadPresenceConfig, savePresenceConfig } from '../relay/presence-templates.js';
import { DropLogger } from '../engines/drop-logger.js';

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter(a => a.startsWith('-')));
const positional = rawArgs.filter(a => !a.startsWith('-'));
const command = (positional[0] || 'status').toLowerCase();
const isOnce = flags.has('--once') || flags.has('--no-hold');

function updateEnvPresence(enabled: boolean, mode?: string, project?: string): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  let content = fs.readFileSync(envPath, 'utf-8');

  // Update DISCORD_PRESENCE_ENABLED
  if (/^DISCORD_PRESENCE_ENABLED=/m.test(content)) {
    content = content.replace(/^DISCORD_PRESENCE_ENABLED=.*/m, `DISCORD_PRESENCE_ENABLED=${enabled}`);
  } else {
    content += `\nDISCORD_PRESENCE_ENABLED=${enabled}`;
  }

  // Update DISCORD_PRESENCE_MODE if provided
  if (mode) {
    if (/^DISCORD_PRESENCE_MODE=/m.test(content)) {
      content = content.replace(/^DISCORD_PRESENCE_MODE=.*/m, `DISCORD_PRESENCE_MODE=${mode}`);
    } else {
      content += `\nDISCORD_PRESENCE_MODE=${mode}`;
    }
  }

  // Update DISCORD_PRESENCE_PROJECT if provided
  if (project) {
    if (/^DISCORD_PRESENCE_PROJECT=/m.test(content)) {
      content = content.replace(/^DISCORD_PRESENCE_PROJECT=.*/m, `DISCORD_PRESENCE_PROJECT="${project}"`);
    } else {
      content += `\nDISCORD_PRESENCE_PROJECT="${project}"`;
    }
  }

  fs.writeFileSync(envPath, content, 'utf-8');
}

function printUsage(): void {
  console.log('========================================================================');
  console.log('           Discord Presence Template Switcher & Controller              ');
  console.log('========================================================================');
  console.log('Usage: bun run presence <mode> [options]\n');
  console.log('Available Templates:');
  console.log('  1. work   - "Working on Every Hero" (custom project & task)');
  console.log('              bun run presence work [projectName] [taskDetails]');
  console.log('              Example: bun run presence work "Every Hero" "Building Battle V2 APIs"');
  console.log('');
  console.log('  2. trade  - Quotes about trading & risk discipline');
  console.log('              bun run presence trade [customQuote]');
  console.log('              Example: bun run presence trade "Cut your losses quickly, let your winners run."');
  console.log('');
  console.log('  3. gbf    - Granblue Fantasy live battle & raid drop telemetry');
  console.log('              bun run presence gbf');
  console.log('');
  console.log('Control Commands:');
  console.log('  status    - View current active template & presence preview');
  console.log('  clear     - Stop and wipe active Discord presence (alias: stop)');
  console.log('  --once    - Update config and exit without holding connection open');
  console.log('========================================================================\n');
}

async function main() {
  if (['help', '--help', '-h'].includes(command)) {
    printUsage();
    process.exit(0);
  }

  // 1. CLEAR / STOP Command
  if (command === 'clear' || command === 'stop') {
    console.log('Stopping active Discord presence...');
    updateEnvPresence(false);
    discordPresence.shutdown();

    // Run clear utility
    const clearScript = path.resolve('scripts/clear-discord-presence.ts');
    const { spawnSync } = await import('child_process');
    spawnSync('bun', [clearScript], { stdio: 'inherit' });
    console.log('\n🛑 Discord presence stopped and disabled in .env.');
    process.exit(0);
  }

  // 2. STATUS Command
  if (command === 'status') {
    const saved = loadPresenceConfig();
    console.log('========================================================================');
    console.log('                     Current Discord Presence Status                    ');
    console.log('========================================================================');
    console.log(`Active Template:   [${saved.mode.toUpperCase()}]`);
    if (saved.mode === 'work') {
      console.log(`Project:           ${saved.project || 'Every Hero'}`);
      if (saved.task) console.log(`Task:              ${saved.task}`);
    } else if (saved.mode === 'trade') {
      console.log(`Quote:             ${saved.quote || 'Randomized / Cycling'}`);
    }
    console.log(`Enabled in .env:   ${process.env.DISCORD_PRESENCE_ENABLED !== 'false' ? '✅ YES' : '❌ NO'}`);

    const preview = discordPresence.formatActivityData({});
    console.log('\n--- Activity Preview ---');
    console.log(`• Name:    "${preview.name}"`);
    console.log(`• Details: "${preview.details}"`);
    console.log(`• State:   "${preview.state}"`);
    console.log('========================================================================\n');
    process.exit(0);
  }

  // Validate mode
  const validModes: PresenceMode[] = ['work', 'trade', 'gbf'];
  if (!validModes.includes(command as PresenceMode)) {
    console.error(`❌ Unknown presence template: "${command}"\n`);
    printUsage();
    process.exit(1);
  }

  const mode = command as PresenceMode;
  let project = 'Every Hero';
  let task: string | undefined;
  let quote: string | undefined;

  // WORK Template
  if (mode === 'work') {
    project = positional[1] || 'Every Hero';
    task = positional[2] || `Working hard on ${project}`;
    console.log(`\n💼 Switching Discord Presence to [WORK] Template:`);
    console.log(`   Project: "${project}"`);
    console.log(`   Task:    "${task}"`);
  }

  // TRADE Template
  else if (mode === 'trade') {
    if (positional[1]) {
      quote = positional.slice(1).join(' ').replace(/^["']|["']$/g, '');
    } else {
      const rand = TRADING_QUOTES[Math.floor(Math.random() * TRADING_QUOTES.length)];
      quote = rand.quote;
    }
    console.log(`\n📈 Switching Discord Presence to [TRADE] Template:`);
    console.log(`   Quote: "${quote}"`);
  }

  // GBF Template
  else if (mode === 'gbf') {
    console.log(`\n⚔️ Switching Discord Presence to [GBF] Live Automation Template...`);
    try {
      const akashaLog = path.resolve('logs/gb-akasha.md');
      if (fs.existsSync(akashaLog)) {
        const logger = new DropLogger(akashaLog, 'Akasha HL');
        const stats = logger.getStats();
        const lastRec = logger.getLastRecord();
        discordPresence.updateStatus({
          raidName: 'Akasha',
          runNumber: stats.totalBattles,
          goldBars: stats.goldBars,
          goldBarsToday: stats.goldBarsToday,
          goldBarsSession: 0,
          blueChests: stats.blueChests,
          dryStreak: stats.currentDryStreak,
          dryStreakMode: stats.dryStreakMode,
          honors: lastRec?.honors || 0,
          status: 'In Combat',
        }, false);
      }
    } catch {}
  }

  // Enable in .env & save config
  updateEnvPresence(true, mode, project);
  process.env.DISCORD_PRESENCE_ENABLED = 'true';

  discordPresence.setMode(mode, {
    project,
    task,
    quote
  }, true);

  const formatted = discordPresence.formatActivityData({});

  console.log('\n========================================================================');
  console.log(`🎉 SUCCESS: Discord Presence updated to [${mode.toUpperCase()}] template!`);
  console.log('========================================================================');
  console.log(`• Status Name: "${formatted.name}"`);
  console.log(`• Details:     "${formatted.details}"`);
  console.log(`• State:       "${formatted.state}"`);
  console.log('========================================================================\n');

  if (isOnce) {
    console.log('✅ Configuration saved. Exiting (--once).');
    await new Promise(r => setTimeout(r, 2000));
    process.exit(0);
  }

  console.log('📡 Live Discord Presence connection is ACTIVE!');
  console.log('💡 Keep this running in your terminal to maintain your Discord status.');
  console.log('   (Press Ctrl+C to stop, or run "bun run presence:bg" to run in background)\n');

  const cleanup = () => {
    console.log('\n🛑 Stopping presence and exiting...');
    discordPresence.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep heartbeat alive
  setInterval(() => {}, 30000);
}

main().catch(err => {
  console.error('Error setting presence:', err);
  process.exit(1);
});
