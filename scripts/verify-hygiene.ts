// scripts/verify-hygiene.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface Violation {
  file: string;
  line: number;
  category: string;
  snippet: string;
}

const FORBIDDEN_FILE_PATTERNS = [
  /^accounts\.config\.json$/,
  /^\.env$/,
  /^\.env\.local$/,
  /^scratch\//,
  /^data\/accounts\/(?!(\.gitkeep)$)/,
  /data\/.*-cookies\.json$/,
  /.*-cookies\.json$/,
  /\.db$/,
  /\.sqlite$/,
  /\.pem$/,
  /\.key$/
];

const CONTENT_CHECKS = [
  {
    name: 'Hardcoded Personal Windows Path',
    regex: /C:[/\\]Users[/\\](?!YOUR_USER\b)[A-Za-z0-9_.-]+(?=[/\\])/i,
    description: 'Path contains local personal user profile directory'
  },
  {
    name: 'Real Non-Example Email',
    regex: /(?<!https?:\/\/[^/]*?)[a-zA-Z0-9._%+-]+@(?!(?:[a-zA-Z0-9_-]+\.)*example\.(?:com|org|net)|users\.noreply\.github\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    description: 'Exposed real email address (use @example.com for placeholders)'
  },
  {
    name: 'Discord Webhook URL',
    regex: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
    description: 'Hardcoded Discord Webhook with secret token'
  },
  {
    name: 'Telegram Bot Token',
    regex: /bot[0-9]{8,10}:[a-zA-Z0-9_-]{35}/,
    description: 'Hardcoded Telegram Bot API authentication token'
  },
  {
    name: 'Private Cryptographic Key',
    regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    description: 'Private RSA/EC cryptographic key material'
  }
];

function getTrackedFiles(): string[] {
  try {
    const stdout = execSync('git ls-files', { encoding: 'utf-8' });
    return stdout
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);
  } catch (err) {
    console.error('[Hygiene] Failed to list git tracked files:', err);
    process.exit(1);
  }
}

function verifyGitIgnoreRules(): string[] {
  const issues: string[] = [];
  const gitignorePath = path.resolve(process.cwd(), '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return ['Missing .gitignore file in root!'];
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  const requiredPatterns = [
    'accounts.config.json',
    '.env',
    'node_modules/',
    'scratch/',
    'artifacts/*',
    'logs/*'
  ];

  for (const pattern of requiredPatterns) {
    if (!content.includes(pattern)) {
      issues.push(`Pattern "${pattern}" missing from .gitignore`);
    }
  }

  return issues;
}

function main() {
  console.log('\n========================================================================');
  console.log('       Granblue Fantasy Suite - Gold Standard Security & Hygiene Gate   ');
  console.log('========================================================================\n');

  const violations: Violation[] = [];
  const trackedFiles = getTrackedFiles();

  console.log(`[Hygiene] Auditing ${trackedFiles.length} tracked files in git index...`);

  // 1. Verify GitIgnore Integrity
  const gitIgnoreIssues = verifyGitIgnoreRules();
  if (gitIgnoreIssues.length > 0) {
    console.error('❌ .gitignore policy violations found:');
    gitIgnoreIssues.forEach(iss => console.error(`  - ${iss}`));
    process.exit(1);
  }
  console.log('✅ .gitignore policy verified compliant.');

  // 2. Verify No Forbidden Files Tracked
  for (const file of trackedFiles) {
    for (const pattern of FORBIDDEN_FILE_PATTERNS) {
      if (pattern.test(file)) {
        violations.push({
          file,
          line: 0,
          category: 'Forbidden Tracked File',
          snippet: `File matches prohibited pattern: ${pattern.toString()}`
        });
      }
    }
  }

  // 3. Scan Tracked File Contents for Secrets & Personal Info
  const skipExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.lock']);

  for (const file of trackedFiles) {
    const ext = path.extname(file).toLowerCase();
    if (skipExtensions.has(ext)) continue;

    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];

      // Skip comment exclusions or known benign lines
      for (const check of CONTENT_CHECKS) {
        if (check.regex.test(lineText)) {
          // Allow git config or harmless instructions
          if (file.includes('verify-hygiene.ts')) continue;
          if (file.endsWith('runtime.md') && lineText.includes('example.com')) continue;

          violations.push({
            file,
            line: i + 1,
            category: check.name,
            snippet: lineText.trim().slice(0, 80)
          });
        }
      }
    }
  }

  // 4. Report Results
  console.log('\n========================================================================');
  console.log('                       Security Audit Scorecard                         ');
  console.log('========================================================================');

  if (violations.length > 0) {
    console.error(`\n❌ [FAILED] Found ${violations.length} hygiene/security violation(s):\n`);
    for (const v of violations) {
      console.error(`  🚨 [${v.category}] at ${v.file}:${v.line}`);
      console.error(`     Snippet: "${v.snippet}"\n`);
    }
    console.log('========================================================================\n');
    process.exit(1);
  }

  console.log(`Audited Files: ${trackedFiles.length}`);
  console.log('Violations:    0 (Zero Credentials, Zero Personal Paths, Zero Leaks)');
  console.log('Status:        🛡️ 100% GOLD INDUSTRY STANDARD COMPLIANT');
  console.log('========================================================================\n');
  process.exit(0);
}

main();
