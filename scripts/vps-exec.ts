#!/usr/bin/env bun
// scripts/vps-exec.ts
import { spawnSync } from 'child_process';
import { config } from '../src/config.js';

const action = process.argv[2]?.toLowerCase() || 'status';

const vpsIp = process.env.VPS_IP || process.env.VPS_HOST || null;
const vpsUser = process.env.VPS_USER || 'root';

if (!vpsIp) {
  console.error('\n❌ [vps-exec] VPS_IP or VPS_HOST is not configured in .env\n');
  process.exit(1);
}

console.log('========================================================================');
console.log('            🛡️ Granblue Fantasy Cloud VPS Controller                    ');
console.log('========================================================================');
console.log(`Target VPS:   ${vpsUser}@${vpsIp}`);
console.log(`Action:       ${action.toUpperCase()}`);
console.log('========================================================================\n');

function runSsh(remoteCmd: string): string {
  const res = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', `${vpsUser}@${vpsIp}`, remoteCmd], {
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'pipe']
  });
  if (res.stdout) console.log(res.stdout);
  if (res.stderr) console.error(res.stderr);
  return res.stdout || '';
}

switch (action) {
  case 'stop': {
    console.log('[vps-exec] 🛑 Halting PM2 gbf-controller and saving state...');
    const out = runSsh('pm2 stop gbf-controller; pkill -9 -f "run-daily-host" 2>/dev/null; pm2 save; pm2 status');
    console.log(out);
    console.log('✅ VPS controller and scheduler daemon stopped successfully.\n');
    break;
  }

  case 'start': {
    console.log('[vps-exec] 🚀 Launching PM2 gbf-controller and saving state...');
    const out = runSsh('pm2 start /var/www/guranburuing/ecosystem.config.cjs && pm2 save && pm2 status');
    console.log(out);
    console.log('✅ VPS controller launched successfully.\n');
    break;
  }

  case 'restart': {
    console.log('[vps-exec] 🔄 Restarting PM2 gbf-controller...');
    const out = runSsh('pm2 restart gbf-controller && pm2 status');
    console.log(out);
    break;
  }

  case 'logs': {
    const lines = process.argv[3] || '50';
    console.log(`[vps-exec] 📜 Fetching last ${lines} lines of PM2 logs...`);
    const out = runSsh(`pm2 logs gbf-controller --lines ${lines} --nostream`);
    console.log(out);
    break;
  }

  case 'status':
  default: {
    console.log('[vps-exec] 📊 Querying PM2 status & process telemetry...');
    const out = runSsh('pm2 status; echo "=== ACTIVE AUTOMATION PROCESSES ==="; ps aux | grep -E "bun|node" | grep -v grep || echo "None"');
    console.log(out);
    break;
  }
}
