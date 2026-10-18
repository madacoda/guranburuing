# scripts/vps-browser.ps1
# Interactive Remote Mirror for VPS Granblue Fantasy Browser
# Allows you to view, click, type, log in, and solve CAPTCHAs directly on the VPS!

param(
    [string]$VpsHost = $(
        $target = if ($env:VPS_HOST) { $env:VPS_HOST } elseif ($env:VPS_IP) { $env:VPS_IP } else { $null }
        if (-not $target -and (Test-Path ".env")) {
            Get-Content ".env" | ForEach-Object {
                if ($_ -match "^\s*VPS_IP\s*=\s*(.+)$") { $target = $matches[1].Trim().Trim('"').Trim("'") }
                if ($_ -match "^\s*VPS_HOST\s*=\s*(.+)$") { $target = $matches[1].Trim().Trim('"').Trim("'") }
            }
        }
        if ($target) { $target } else { "localhost" }
    ),
    [string]$User = $(
        $u = if ($env:VPS_USER) { $env:VPS_USER } else { $null }
        if (-not $u -and (Test-Path ".env")) {
            Get-Content ".env" | ForEach-Object {
                if ($_ -match "^\s*VPS_USER\s*=\s*(.+)$") { $u = $matches[1].Trim().Trim('"').Trim("'") }
            }
        }
        if ($u) { $u } else { "root" }
    ),
    [int]$RemotePort = 9222,
    [int]$LocalPort = 9222
)

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "       Granblue Fantasy Remote VPS Browser Mirror & Login Tool          " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Target VPS:        $User@$VpsHost"
Write-Host "Remote Port:       $RemotePort"
Write-Host "Local Tunnel Port: $LocalPort"
Write-Host "========================================================================`n"

# 1. Check if local port is already in use
$localInUse = $false
try {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    $ar = $tcp.BeginConnect("127.0.0.1", $LocalPort, $null, $null)
    if ($ar.AsyncWaitHandle.WaitOne(300, $false) -and $tcp.Connected) {
        $tcp.EndConnect($ar)
        $localInUse = $true
    }
    $tcp.Close()
} catch {}

if ($localInUse) {
    Write-Host "[Tunnel] Port $LocalPort is already active. Checking if it connects to VPS Chrome..." -ForegroundColor Yellow
} else {
    Write-Host "[Tunnel] Establishing secure SSH tunnel to VPS Chrome on port $RemotePort..." -ForegroundColor Cyan
    $tunnelJob = Start-Process ssh -ArgumentList "-N -L ${LocalPort}:127.0.0.1:${RemotePort} ${User}@${VpsHost}" -PassThru -NoNewWindow
    Start-Sleep -Seconds 2
}

# 2. Query DevTools version from the tunnel
Write-Host "[CDP] Querying active pages on http://127.0.0.1:$LocalPort/json/list..." -ForegroundColor Cyan
try {
    $res = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/json/list" -TimeoutSec 3 -ErrorAction Stop
    $gbfPage = $res | Where-Object { $_.url -like "*granbluefantasy.jp*" } | Select-Object -First 1

    if ($gbfPage) {
        Write-Host "`n✅ Found active Granblue Fantasy tab on VPS!" -ForegroundColor Green
        Write-Host "   Title: $($gbfPage.title)"
        Write-Host "   URL:   $($gbfPage.url)"
        Write-Host "========================================================================" -ForegroundColor Green
        Write-Host "👉 OPTION 1 (Easiest - One Click):" -ForegroundColor Yellow
        Write-Host "   Open local Chrome and go to:"
        Write-Host "   chrome://inspect" -ForegroundColor White
        Write-Host "   Ensure 'localhost:$LocalPort' is enabled in Configure, then click 'inspect'."
        Write-Host "`n👉 OPTION 2 (Direct Web Inspector):" -ForegroundColor Yellow
        Write-Host "   $($gbfPage.devtoolsFrontendUrl)" -ForegroundColor White
        Write-Host "========================================================================`n"
    } else {
        Write-Host "⚠️ No Granblue Fantasy tab open yet. Navigate to chrome://inspect to open one." -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠️ Tunnel is connecting or starting up. Opening chrome://inspect..." -ForegroundColor Yellow
}

# 3. Launch local Chrome directly to chrome://inspect
$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$localChrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($localChrome) {
    Write-Host "🚀 Launching local Chrome to chrome://inspect..." -ForegroundColor Green
    Start-Process $localChrome -ArgumentList "chrome://inspect"
} else {
    Write-Host "👉 Open your browser to: chrome://inspect" -ForegroundColor Cyan
}

Write-Host "`nPress Ctrl+C when finished with manual login/captcha solving to close tunnel." -ForegroundColor DarkGray
while ($true) {
    Start-Sleep -Seconds 5
}
