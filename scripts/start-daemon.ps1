# scripts/start-daemon.ps1
$ErrorActionPreference = "Stop"

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "   Starting GBF Chrome & Remote Controller Daemon   " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$dedicatedProfileDir = "$env:USERPROFILE\.gbf-chrome-profile"

# Clean up stale Chrome Singleton locks if no Chrome process is active
$activeChrome = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
if (-not $activeChrome) {
    $lockFile = Join-Path $dedicatedProfileDir "SingletonLock"
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
