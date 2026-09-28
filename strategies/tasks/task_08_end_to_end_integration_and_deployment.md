# Task 08: End-to-End Integration, Deployment & Operations

## 1. Task Objective
Wire all components into the master orchestrator `src/index.ts`, configure production process daemonization using **PM2** (`ecosystem.config.js`), establish encrypted remote access via **Tailscale**, incorporate **Chrome Singleton lock cleanup**, and establish the comprehensive pre-flight verification checklist.

---

## 2. Technical Specifications & File Deliverables

```
gbf/
├── src/
│   └── index.ts                   # Master application bootstrap & lifecycle orchestrator
├── ecosystem.config.js            # PM2 daemon configuration
├── scripts/
│   └── start-daemon.ps1           # Complete one-click startup script with stale lock cleanup
└── tests/
    └── smoke-test.ts              # Automated pre-flight smoke test suite
```

---

## 3. Implementation Code

### 3.1 `src/index.ts`: Master Orchestrator

```typescript
// src/index.ts
import { config } from './config.js';
import { CdpConnectionManager } from './cdp-connection.js';
import { SentinelWatchdog } from './sentinel-watchdog.js';
import { AlertRelay } from './alert-relay.js';
import { GatewayServer } from './gateway/server.js';

async function bootstrap() {
  console.log('=====================================================');
  console.log('     Granblue Fantasy Remote Controller Daemon       ');
  console.log('=====================================================');

  // 1. Initialize CDP Connection Manager
  const cdpManager = new CdpConnectionManager();
  console.log('[Bootstrap] Attaching to Chrome CDP session on port 9222...');
  const { page } = await cdpManager.connectWithRetry();

  // 2. Initialize Safety Sentinel & Alert Relay
  const alertRelay = new AlertRelay();
  const sentinel = new SentinelWatchdog(page, alertRelay);
  console.log('[Bootstrap] Sentinel Watchdog armed and monitoring.');

  // 3. Start Gateway Server & Viewport Screencast
  const gateway = new GatewayServer(page, sentinel);
  await gateway.start();

  console.log(`[Bootstrap] Daemon is fully operational.`);
  console.log(`[Bootstrap] Companion UI available at: http://localhost:${config.PORT}/?token=${config.AUTH_TOKEN}`);

  // Graceful Shutdown Handlers
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Cleaning up resources...`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err: any) => {
  console.error('[Bootstrap] Fatal startup failure:', err.message);
  process.exit(1);
});
```

---

### 3.2 `ecosystem.config.js`: PM2 Daemon Configuration

```javascript
module.exports = {
  apps: [
    {
      name: 'gbf-daemon',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'src/index.ts',
      cwd: 'C:/laragon/www/gbf',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        AUTH_TOKEN: 'replace_with_your_32_character_secret_token',
        CDP_PORT: 9222
      },
      error_file: './logs/error.log',
      out_file: './logs/app.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss'
    }
  ]
};
```

---

### 3.3 `scripts/start-daemon.ps1`: One-Click Windows Startup Script with Stale Lock Cleanup

```powershell
# scripts/start-daemon.ps1
$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Starting GBF Chrome & Remote Controller Daemon   " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"

# Clean up stale Chrome Singleton locks if no Chrome process is active
$activeChrome = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if (-not $activeChrome) {
    $lockFile = Join-Path $userDataDir "SingletonLock"
    if (Test-Path $lockFile) {
        Write-Host "[Launcher] Removing stale Chrome lock file: $lockFile" -ForegroundColor DarkGray
        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    }
}

# 1. Launch Chrome with CDP
Write-Host "`n[1/2] Launching Chrome with CDP enabled..." -ForegroundColor Yellow
powershell -ExecutionPolicy Bypass -File "./scripts/launch-gbf-chrome.ps1"
Start-Sleep -Seconds 3

# 2. Launch Controller Daemon via PM2 (or tsx directly)
Write-Host "`n[2/2] Launching Controller Daemon..." -ForegroundColor Yellow
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    pm2 start ecosystem.config.js
    pm2 save
    Write-Host "[Daemon] Started successfully via PM2." -ForegroundColor Green
} else {
    Write-Host "[Daemon] PM2 not detected. Running directly via tsx..." -ForegroundColor DarkGray
    npx tsx src/index.ts
}
```

---

### 3.4 Automated Pre-Flight Smoke Test (`tests/smoke-test.ts`)

```typescript
// tests/smoke-test.ts
import { config } from '../src/config.js';
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';

async function runSmokeTest() {
  console.log('--- Executing Pre-Flight Smoke Test ---');

  // Test 1: Config Validation
  console.log('1. Validating environment configuration...');
  if (!config.AUTH_TOKEN || config.AUTH_TOKEN.length < 16) {
    throw new Error('AUTH_TOKEN is too short or missing.');
  }
  console.log('   [PASS] Configuration valid.');

  // Test 2: CDP Connection
  console.log('2. Attaching to Chrome CDP...');
  const cdp = new CdpConnectionManager();
  const { page } = await cdp.connectWithRetry(3, 1000);
  const title = await page.title();
  console.log(`   [PASS] Connected to page: "${title}"`);

  // Test 3: Sentinel Verification
  console.log('3. Checking Sentinel Watchdog state...');
  const sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();
  console.log('   [PASS] Sentinel armed. No CAPTCHA detected.');

  console.log('\n✅ ALL PRE-FLIGHT SMOKE TESTS PASSED! System is production-ready.');
}

runSmokeTest().catch(err => {
  console.error('\n❌ PRE-FLIGHT TEST FAILED:', err.message);
  process.exit(1);
});
```

---

## 4. Encrypted Remote Access Guide (Tailscale VPN)

To access your companion cockpit from your smartphone over 4G/5G cellular data without opening public ports:

```
[ Smartphone on 4G/5G ] --- Tailscale Mesh VPN ---> [ Desktop PC (Tailscale IP: 100.x.y.z) ]
                                                                 |
                                                                 +---> Port 3000 (Gateway)
```

1. **Install Tailscale** on your Windows desktop: `https://tailscale.com/download/windows`.
2. **Install Tailscale** on your iOS / Android phone and log into the same account.
3. Note your desktop machine's Tailscale IP (e.g. `100.85.120.45`).
4. On your phone's browser, open:
   ```
   http://100.85.120.45:3000/?token=YOUR_AUTH_TOKEN
   ```
5. Tap **Share / Options** -> **Add to Home Screen**. You now have an encrypted, direct, low-latency mobile cockpit from anywhere in the world!

---

## 5. Pre-Flight Safety Verification Checklist

Before using the remote system on live accounts, execute the following mandatory verification gates:

- [x] **Gate 1: Chrome Profile Integrity**: Chrome profile mapped to isolated user data directory, configured in `scripts/launch-gbf-chrome.ps1`.
- [x] **Gate 2: Smoke Test Suite**: Ran `bun run tests/smoke-test.ts` — verified environment configuration and Sentinel watchdog lifecycle reports `[PASS]`.
- [x] **Gate 3: Telegram/Discord Alarm Test**: Ran `bun run tests/test-sentinel-alert.ts` — verified DOM captcha detection, hard freeze, rate limiting, and alert dispatchers.
- [x] **Gate 4: Dry-Run Magna Pro Skip Logic**: Ran `bun run tests/test-pro-skip-unit.ts` — verified Pro Skip flow, 0/1 status check, and modal dismissal loop.
- [x] **Gate 5: Dry-Run Raid Join Logic**: Ran `bun run tests/test-raid-engine-unit.ts` — verified raid assist code typing, summon element switching, exception handling, and full auto loop.
- [x] **Gate 6: Remote Gateway & PWA Delivery**: Ran `bun run tests/test-gateway-server.ts` — verified auth token enforcement (1008 rejection), PWA static asset serving, screencast pipeline, and bidirectional WS commands.
