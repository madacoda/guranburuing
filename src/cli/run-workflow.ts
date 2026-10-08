// src/cli/run-workflow.ts
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { TemplateParser } from '../templates/template-parser.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';
import { AccountConfig } from '../types/account.types.js';
import { WorkflowTemplate } from '../types/workflow.types.js';

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function handleValidateCommand(targetTemplate?: string): void {
  console.log('\n========================================================================');
  console.log('             Granblue Fantasy Workflow Template Validator               ');
  console.log('========================================================================\n');

  const templatesToValidate = targetTemplate
    ? [targetTemplate]
    : TemplateParser.listAvailableTemplates();

  if (templatesToValidate.length === 0) {
    console.log('No templates found in templates/ directory.');
    process.exit(0);
  }

  let hasError = false;
  for (const tName of templatesToValidate) {
    try {
      const tmpl = TemplateParser.loadTemplate(tName);
      console.log(`✅ [VALID] "${tName}"`);
      console.log(`   Name:         ${tmpl.name}`);
      console.log(`   Quest URL:    ${tmpl.questUrl}`);
      console.log(`   Speed:        ${tmpl.speedProfile || 'fast'}`);
      console.log(`   Steps:        ${tmpl.steps.length}`);
      console.log(`   Pipeline:     ${tmpl.steps.map(s => s.code || s.action).join(' -> ')}`);
      if (tmpl.targetScore) console.log(`   Target Score: ${tmpl.targetScore.toLocaleString()} pt`);
      if (tmpl.raidSlots) console.log(`   Raid Slots:   [${tmpl.raidSlots.join(', ')}]`);
      console.log('');
    } catch (err: any) {
      console.error(`❌ [INVALID] "${tName}":`);
      console.error(`   ${err.message}\n`);
      hasError = true;
    }
  }

  if (hasError) {
    console.error('Validation completed with errors.');
    process.exit(1);
  } else {
    console.log(`🎉 All ${templatesToValidate.length} template(s) verified 100% compliant with Gold Industry Standard!\n`);
    process.exit(0);
  }
}

function handleDryRun(template: WorkflowTemplate): void {
  console.log('\n========================================================================');
  console.log(`      DRY-RUN EXECUTION PLAN: ${template.name}`);
  console.log('========================================================================');
  console.log(`Quest Target:         ${template.questUrl}`);
  console.log(`Speed Profile:        ${template.speedProfile || 'fast'}`);
  console.log(`Default Runs:         ${template.defaultRuns || 100}`);
  console.log(`Auto Half-Elixir:     ${template.autoElixir !== false}`);
  console.log(`Auto Soul-Berry:      ${template.autoBerry !== false}`);
  if (template.targetScore) console.log(`Blue Chest Threshold: ${template.targetScore.toLocaleString()} pt`);
  if (template.raidSlots) console.log(`Assist Raid Slots:    [${template.raidSlots.join(', ')}]`);
  console.log(`Total Steps:          ${template.steps.length}`);
  console.log('------------------------------------------------------------------------');
  console.log('Compiled Step Pipeline:');

  template.steps.forEach((step, idx) => {
    const code = step.code || step.action;
    let extra = '';
    if (step.character && step.skill) extra += ` (C${step.character}S${step.skill}${step.targetCharacter ? ` on C${step.targetCharacter}` : ''})`;
    if (step.slot) extra += ` (Slot ${step.slot})`;
    if (step.target) extra += ` (Target: ${step.target})`;
    if (step.enemyIndex) extra += ` (Enemy: ${step.enemyIndex})`;
    if (step.potionType) extra += ` (Potion: ${step.potionType})`;
    if (step.repeatCount) extra += ` (${step.repeatCount}x loops: ${step.subSteps?.map(s => s.code).join(' -> ')})`;
    if (step.targetScore) extra += ` (Threshold: ${step.targetScore.toLocaleString()} pt)`;
    if (step.waitForNetwork) extra += ` [awaiting ${step.waitForNetwork}]`;
    if (step.delayAfterMs) extra += ` [+${step.delayAfterMs}ms delay]`;
    console.log(`  [Step ${idx + 1}] ${step.name || code} -> ${code}${extra}`);
  });

  console.log('========================================================================');
  console.log('Dry-run complete. Template structure is fully valid and ready for execution.\n');
  process.exit(0);
}

function handleExportDsl(templateName: string): void {
  const tmpl = TemplateParser.loadTemplate(templateName);
  const dslContent = TemplateParser.serializeToDsl(tmpl);
  const outPath = path.resolve(process.cwd(), 'templates', `${templateName}.dsl`);
  fs.writeFileSync(outPath, dslContent, 'utf-8');
  console.log(`\n✅ Exported DSL template to: ${outPath}`);
  console.log('\n--- DSL Content ---');
  console.log(dslContent);
  process.exit(0);
}

function handleExportJson(templateName: string): void {
  const tmpl = TemplateParser.loadTemplate(templateName);
  const jsonContent = TemplateParser.serializeToJson(tmpl, true);
  const outPath = path.resolve(process.cwd(), 'templates', `${templateName}.json`);
  fs.writeFileSync(outPath, jsonContent, 'utf-8');
  console.log(`\n✅ Exported JSON template to: ${outPath}`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);
  const positionalArgs = args.filter(a => !a.startsWith('--'));

  // Command: --validate
  if (args.includes('--validate') || args.includes('-v')) {
    const valIdx = args.findIndex(a => a === '--validate' || a === '-v');
    const target = args[valIdx + 1] && !args[valIdx + 1].startsWith('-') ? args[valIdx + 1] : undefined;
    handleValidateCommand(target);
    return;
  }

  // Command: --export-dsl [template]
  if (args.includes('--export-dsl')) {
    const idx = args.indexOf('--export-dsl');
    const target = args[idx + 1] || 'gw-meat-light';
    handleExportDsl(target);
    return;
  }

  // Command: --export-json [template]
  if (args.includes('--export-json')) {
    const idx = args.indexOf('--export-json');
    const target = args[idx + 1] || 'gw-meat-light';
    handleExportJson(target);
    return;
  }

  // Command: --dry-run [template]
  const accounts = AccountRegistry.loadAccounts();

  // Command: --dry-run [template]
  if (args.includes('--dry-run')) {
    const tmplIndex = args.indexOf('--template');
    let targetTemplateName = tmplIndex !== -1 && args[tmplIndex + 1] ? args[tmplIndex + 1] : undefined;
    if (!targetTemplateName) {
      const pos = positionalArgs.find(a => isNaN(Number(a)) && !accounts.some(acc => acc.id.toLowerCase() === a.toLowerCase()));
      if (pos) targetTemplateName = pos;
    }
    targetTemplateName = targetTemplateName || 'gw-meat-light';
    const template = TemplateParser.loadTemplate(targetTemplateName);
    handleDryRun(template);
    return;
  }

  let isHeadless = args.includes('--headless')
    ? true
    : args.includes('--windowed') || args.includes('--headful')
    ? false
    : true; // Default to headless

  let targetAccountId: string | undefined;
  let targetTemplateName: string | undefined;
  let targetRuns: number | undefined;

  // Check explicit flags
  const accIndex = args.indexOf('--account');
  if (accIndex !== -1 && args[accIndex + 1]) targetAccountId = args[accIndex + 1];

  const tmplIndex = args.indexOf('--template');
  if (tmplIndex !== -1 && args[tmplIndex + 1]) targetTemplateName = args[tmplIndex + 1];

  const runsIndex = args.indexOf('--runs') !== -1 ? args.indexOf('--runs') : args.indexOf('-n');
  if (runsIndex !== -1 && args[runsIndex + 1]) targetRuns = parseInt(args[runsIndex + 1], 10);

  // Parse positional arguments: [account] [template] [runs]
  for (const pos of positionalArgs) {
    if (accounts.some(a => a.id.toLowerCase() === pos.toLowerCase())) {
      targetAccountId = pos.toLowerCase();
    } else if (!isNaN(Number(pos))) {
      targetRuns = parseInt(pos, 10);
    } else if (!targetTemplateName) {
      targetTemplateName = pos;
    }
  }

  // Interactive Selection if account is missing
  if (!targetAccountId) {
    if (accounts.length === 1 || !process.stdin.isTTY) {
      targetAccountId = accounts[0].id;
    } else {
      console.log('\n========================================================================');
      console.log('                   Select Granblue Fantasy Account                      ');
      console.log('========================================================================');
      accounts.forEach((acc, idx) => {
        console.log(`  [${idx + 1}] ${acc.name} (${acc.id}) - Port: ${acc.cdpPort} | Profile: ${acc.profileDir}`);
      });
      console.log('========================================================================');
      const selection = await promptUser('Choose account number [1]: ');
      const selIdx = parseInt(selection || '1', 10) - 1;
      targetAccountId = accounts[selIdx]?.id || accounts[0].id;
    }
  }

  const account = AccountRegistry.getAccountById(targetAccountId);
  if (!account) {
    console.error(`[WorkflowRunner] Account "${targetAccountId}" not found in accounts.config.json.`);
    process.exit(1);
  }

  // Interactive Selection if template is missing
  const availableTemplates = TemplateParser.listAvailableTemplates();
  if (!targetTemplateName) {
    if (availableTemplates.length === 1 || !process.stdin.isTTY) {
      targetTemplateName = availableTemplates[0];
    } else if (availableTemplates.length === 0) {
      console.error('[WorkflowRunner] No templates found in templates/ directory.');
      process.exit(1);
    } else {
      console.log('\n========================================================================');
      console.log('                   Select Automation Workflow Template                  ');
      console.log('========================================================================');
      availableTemplates.forEach((t, idx) => {
        console.log(`  [${idx + 1}] ${t}`);
      });
      console.log('========================================================================');
      const selection = await promptUser('Choose template number [1]: ');
      const selIdx = parseInt(selection || '1', 10) - 1;
      targetTemplateName = availableTemplates[selIdx] || availableTemplates[0];
    }
  }

  // Load and parse template
  const template = TemplateParser.loadTemplate(targetTemplateName);

  // Command: --dry-run
  if (args.includes('--dry-run')) {
    handleDryRun(template);
    return;
  }

  // Runs prompt if not passed - enforce at least 500 for farming/raid workflows
  if (!targetRuns) {
    const isSpecialShort = template.name.toLowerCase().includes('daily') ||
                           template.name.toLowerCase().includes('fate') ||
                           template.name.toLowerCase().includes('story');
    if (isSpecialShort) {
      targetRuns = template.defaultRuns || 1;
    } else {
      targetRuns = Math.max(500, template.defaultRuns || 500);
    }
  }

  console.log(`\n========================================================================`);
  console.log(`        Universal Granblue Fantasy Workflow Runner                      `);
  console.log(`========================================================================`);
  console.log(`Account:             ${account.name} (${account.id})`);
  console.log(`CDP Port:            ${account.cdpPort}`);
  console.log(`Profile Directory:   ${account.profileDir}`);
  console.log(`Workflow Template:   ${template.name}`);
  console.log(`Target Runs:         ${targetRuns}`);
  console.log(`Browser Mode:        ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Visible GUI)'}`);
  console.log(`========================================================================\n`);

  // Connect to Chrome/Iron
  const cdpManager = new CdpConnectionManager();
  const { browser, page } = await cdpManager.connectWithRetry(6, 2000, isHeadless, {
    cdpPort: account.cdpPort,
    profileDir: account.profileDir,
    proxy: account.proxy
  });

  // Verify authentication status on #profile
  const profile = await AccountAuthManager.ensureAuthenticated(page, account);
  if (!profile) {
    console.error(`[WorkflowRunner] Account [${account.name}] could not be authenticated. Aborting.`);
    await cdpManager.disconnect();
    process.exit(1);
  }

  console.log(`[WorkflowRunner] ✅ Verified In-Game Identity: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})\n`);

  const sentinel = new SentinelWatchdog(page);

  const engine = new UniversalWorkflowEngine(page, sentinel, template, account.id);
  await engine.ensureViewportAndMobile();

  cdpManager.onReconnect((newPage) => {
    sentinel.updatePage(newPage);
    engine.updatePage(newPage);
  });

  // Graceful Ctrl+C handling
  let isStopping = false;
  process.on('SIGINT', async () => {
    if (isStopping) {
      console.log('\n[WorkflowRunner] Force quitting immediately...');
      process.exit(0);
    }
    isStopping = true;
    console.log('\n[WorkflowRunner] ⚠️ Ctrl+C detected. Finishing current run and saving stats...');
    engine.requestStop();
  });

  try {
    await engine.runLoop({ runs: targetRuns });
  } finally {
    await cdpManager.disconnect();
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[WorkflowRunner] Fatal error:', err);
  process.exit(1);
});
