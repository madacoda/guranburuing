# Task 01: Environment Scaffolding, Chrome CDP Launcher & Connection Manager

## 1. Task Objective
Establish the project foundation, configure TypeScript and runtime dependencies, create the automated Windows launch scripts for Google Chrome with remote debugging, and implement the resilient Chrome DevTools Protocol (CDP) connection manager.

---

## 2. Technical Specifications & File Deliverables

```
gbf/
├── package.json                   # Project manifests and scripts
├── tsconfig.json                  # Strict TypeScript compiler options
├── .env.example                   # Environment configuration template
├── scripts/
│   ├── launch-gbf-chrome.ps1      # PowerShell launcher with conflict check and CDP flags
│   └── launch-gbf-chrome.bat      # Batch launcher fallback
└── src/
    ├── config.ts                  # Zod-validated environment config
    └── cdp-connection.ts          # Resilient Puppeteer-core CDP manager
```

---

## 3. Step-by-Step Implementation Instructions

### Step 1: Initialize Project & Dependencies
Configure `package.json` with strict type safety, modern ESM support, and Fastify static file serving:

```json
{
  "name": "gbf-remote-controller",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "launch:chrome": "powershell -ExecutionPolicy Bypass -File ./scripts/launch-gbf-chrome.ps1"
  },
  "dependencies": {
    "puppeteer-core": "^23.3.0",
    "fastify": "^4.28.1",
    "@fastify/websocket": "^10.0.1",
    "@fastify/cors": "^9.0.1",
    "@fastify/static": "^7.0.4",
    "zod": "^3.23.8",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.14.9",
    "tsx": "^4.16.2",
    "typescript": "^5.5.2"
  }
}
```

Configure `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

---

### Step 2: Battle-Tested Chrome Launcher Script (`scripts/launch-gbf-chrome.ps1`)

> [!IMPORTANT]
> **Production Gotchas Resolved in this Script**:
> 1. **`--remote-allow-origins=*`**: Mandatory since Chromium 111+ to prevent `403 Forbidden` WebSocket rejections.
> 2. **Singleton Conflict Detection**: If Chrome is already running normally without port 9222, launching Chrome will merely attach a tab to the non-debug process. This script detects if port 9222 is active, warns if a conflict exists, and offers an automatic clean restart.
> 3. **Background Throttling Disablement**: Passes flags preventing Chrome from throttling timers and WebSockets when minimized or in the background.

```powershell
# scripts/launch-gbf-chrome.ps1
$ErrorActionPreference = "Stop"

$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromeExe = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromeExe) {
    Write-Error "Google Chrome executable not found in standard paths."
    exit 1
}

$userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$cdpPort = 9222
$targetUrl = "https://game.granbluefantasy.jp/#mypage"

# Check if port 9222 is already listening
$portActive = $false
try {
    $conn = Test-NetConnection -ComputerName "127.0.0.1" -Port $cdpPort -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($conn) { $portActive = $true }
} catch {}

if ($portActive) {
    Write-Host "[Launcher] Chrome is ALREADY running with CDP on port $cdpPort." -ForegroundColor Green
    exit 0
}

# Check if Chrome is running WITHOUT debugging port
$chromeProcesses = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if ($chromeProcesses) {
    Write-Host "`n[Launcher] WARNING: Chrome is currently running WITHOUT the debugging port enabled!" -ForegroundColor Yellow
    Write-Host "[Launcher] To enable CDP, Chrome processes using the profile must be restarted." -ForegroundColor Yellow
    $response = Read-Host "Would you like to gracefully close Chrome and restart it with debugging enabled? (y/n)"
    if ($response -eq 'y' -or $response -eq 'Y') {
        Stop-Process -Name "chrome" -Force
        Start-Sleep -Seconds 2
    } else {
        Write-Host "[Launcher] Aborted. Please close Chrome manually and re-run this script." -ForegroundColor Red
        exit 1
    }
}

Write-Host "[Launcher] Starting Chrome with CDP on port $cdpPort..." -ForegroundColor Cyan
Write-Host "[Launcher] Profile Directory: $userDataDir" -ForegroundColor DarkGray

Start-Process -FilePath $chromeExe -ArgumentList @(
    "--remote-debugging-port=$cdpPort",
    "--remote-allow-origins=*",
    "--user-data-dir=`"$userDataDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=480,960",
    "`"$targetUrl`""
)

# Await port availability
$retries = 10
while ($retries -gt 0) {
    Start-Sleep -Milliseconds 800
    try {
        $conn = Test-NetConnection -ComputerName "127.0.0.1" -Port $cdpPort -InformationLevel Quiet -WarningAction SilentlyContinue
        if ($conn) {
            Write-Host "[Launcher] CDP port $cdpPort is now active and ready!" -ForegroundColor Green
            exit 0
        }
    } catch {}
    $retries--
}

Write-Error "[Launcher] Chrome launched but port $cdpPort did not respond in time."
exit 1
```

---

### Step 3: Implement Configuration Validator (`src/config.ts`)

```typescript
// src/config.ts
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  AUTH_TOKEN: z.string().min(16, 'AUTH_TOKEN must be at least 16 characters for security.'),
  CDP_PORT: z.coerce.number().default(9222),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export const config: AppConfig = ConfigSchema.parse({
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  AUTH_TOKEN: process.env.AUTH_TOKEN,
  CDP_PORT: process.env.CDP_PORT,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
});
```

---

### Step 4: Implement Resilient CDP Connection Manager (`src/cdp-connection.ts`)

```typescript
// src/cdp-connection.ts
import puppeteer, { Browser, Page } from 'puppeteer-core';
import { config } from './config.js';

export class CdpConnectionManager {
  private browser: Browser | null = null;
  private gbfPage: Page | null = null;
  private isConnecting = false;

  public async connectWithRetry(maxRetries = 5, retryDelayMs = 2000): Promise<{ browser: Browser; page: Page }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[CDP] Connecting to Chrome on port ${config.CDP_PORT} (Attempt ${attempt}/${maxRetries})...`);
        
        this.browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${config.CDP_PORT}`,
          defaultViewport: null, // Maintain genuine window dimensions
        });

        this.browser.on('disconnected', () => {
          console.warn('[CDP] Chrome connection severed! Triggering reconnect watchdog...');
          this.browser = null;
          this.gbfPage = null;
          this.reconnect();
        });

        // Locate active GBF tab
        const pages = await this.browser.pages();
        let targetPage = pages.find(p => p.url().includes('granbluefantasy.jp'));

        if (!targetPage) {
          console.log('[CDP] GBF tab not found in active browser. Opening https://game.granbluefantasy.jp/#mypage...');
          targetPage = await this.browser.newPage();
          await targetPage.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' });
        }

        this.gbfPage = targetPage;
        console.log(`[CDP] Connected successfully to page: ${await this.gbfPage.title()}`);
        return { browser: this.browser, page: this.gbfPage };

      } catch (err: any) {
        console.warn(`[CDP] Connection failed: ${err.message}. Retrying in ${retryDelayMs}ms...`);
        if (attempt === maxRetries) {
          throw new Error(`[CDP] Could not attach to Chrome on port ${config.CDP_PORT} after ${maxRetries} attempts.`);
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error('[CDP] Unexpected connection termination.');
  }

  private async reconnect(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    try {
      await this.connectWithRetry(10, 3000);
    } catch (e: any) {
      console.error('[CDP] Reconnect loop failed:', e.message);
    } finally {
      this.isConnecting = false;
    }
  }

  public getPage(): Page {
    if (!this.gbfPage) throw new Error('[CDP] No active GBF page attached.');
    return this.gbfPage;
  }

  public getBrowser(): Browser {
    if (!this.browser) throw new Error('[CDP] No active Browser attached.');
    return this.browser;
  }
}
```

---

## 4. Acceptance Criteria & Verification Protocol

1. **Launcher Verification**: Executing `./scripts/launch-gbf-chrome.ps1` correctly detects existing Chrome instances, starts Chrome with `--remote-allow-origins=*`, and verifies port 9222 is active.
2. **CDP Verification**: Accessing `http://127.0.0.1:9222/json` returns active JSON metadata containing the GBF tab.
3. **Connection Verification**: Running `npx tsx -e "new (require('./src/cdp-connection.js').CdpConnectionManager)().connectWithRetry()"` successfully binds to the running Chrome instance and outputs the page title without 403 Forbidden errors.
