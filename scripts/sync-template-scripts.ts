// scripts/sync-template-scripts.ts
import fs from 'fs';
import path from 'path';

const PKG_PATH = path.resolve(process.cwd(), 'package.json');
const TEMPLATES_DIR = path.resolve(process.cwd(), 'templates');

function main() {
  if (!fs.existsSync(PKG_PATH) || !fs.existsSync(TEMPLATES_DIR)) {
    console.error('❌ package.json or templates/ directory not found.');
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  pkg.scripts = pkg.scripts || {};

  const templateFiles = fs.readdirSync(TEMPLATES_DIR);
  const templateNames = new Set<string>();

  for (const f of templateFiles) {
    if (f.endsWith('.json') || f.endsWith('.dsl') || f.endsWith('.yaml') || f.endsWith('.yml')) {
      const base = f.replace(/\.(json|dsl|yaml|yml)$/, '');
      templateNames.add(base);
    }
  }

  let addedCount = 0;
  for (const name of Array.from(templateNames).sort()) {
    const isLeech = name.startsWith('leech-') || name.startsWith('leech') || name.startsWith('otkraid-') || name.startsWith('otkraid');
    const runnerCmd = isLeech
      ? `bun src/cli/run-leech.ts ${name}`
      : `bun src/cli/run-workflow.ts ${name}`;
    const windowedCmd = `${runnerCmd} --windowed`;

    if (!pkg.scripts[name]) {
      pkg.scripts[name] = runnerCmd;
      console.log(`➕ Added script: "${name}" -> "${runnerCmd}"`);
      addedCount++;
    }

    const windowedKey = `${name}:windowed`;
    if (!pkg.scripts[windowedKey]) {
      pkg.scripts[windowedKey] = windowedCmd;
      console.log(`➕ Added script: "${windowedKey}" -> "${windowedCmd}"`);
      addedCount++;
    }
  }

  if (addedCount > 0) {
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(`\n🎉 Successfully synced ${addedCount} template script(s) to package.json!\n`);
  } else {
    console.log('\n✅ All template scripts in package.json are up-to-date!\n');
  }
}

main();
