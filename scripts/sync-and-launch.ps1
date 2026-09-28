# scripts/sync-and-launch.ps1
param(
    [switch]$Headless = $false
)

$ErrorActionPreference = "Stop"
$isHeadless = $Headless.IsPresent -or ($env:HEADLESS -eq "true") -or ($env:HEADLESS -eq "1")

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "       SRWare Iron Session Sync & CDP 9222 Launcher         " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Stop all running SRWare Iron processes
Write-Host "[Sync] Stopping any running SRWare Iron processes to unlock session files..." -ForegroundColor Yellow
$ironProcesses = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*SRWare Iron*" }
if ($ironProcesses) {
    foreach ($p in $ironProcesses) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[Sync] Terminated $($ironProcesses.Count) SRWare Iron process(es)." -ForegroundColor Yellow
}
Start-Sleep -Seconds 2

# 2. Source and Destination paths
$srcIronDir = "$env:LOCALAPPDATA\Chromium\User Data"
$dstUserDataDir = "$env:USERPROFILE\.gbf-iron-profile"
$targetProfile = "Default"
$browserExe = "C:\Program Files\SRWare Iron (64-Bit)\chrome.exe"
if (-not (Test-Path $browserExe)) {
    $browserExe = "C:\Program Files\SRWare Iron\chrome.exe"
}

if (-not (Test-Path "$srcIronDir\Default\Network\Cookies")) {
    Write-Error "Source cookies not found at $srcIronDir\Default\Network\Cookies"
    exit 1
}

Write-Host "[Sync] Syncing fresh session files from $srcIronDir..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$dstUserDataDir\Default" | Out-Null

if (Test-Path "$srcIronDir\Local State") {
    Copy-Item "$srcIronDir\Local State" "$dstUserDataDir\Local State" -Force
}
Copy-Item "$srcIronDir\Default\Preferences" "$dstUserDataDir\Default\Preferences" -Force -ErrorAction SilentlyContinue
Copy-Item "$srcIronDir\Default\Secure Preferences" "$dstUserDataDir\Default\Secure Preferences" -Force -ErrorAction SilentlyContinue
Copy-Item -Recurse "$srcIronDir\Default\Network" "$dstUserDataDir\Default\" -Force -ErrorAction SilentlyContinue
Copy-Item -Recurse "$srcIronDir\Default\Local Storage" "$dstUserDataDir\Default\" -Force -ErrorAction SilentlyContinue
Copy-Item -Recurse "$srcIronDir\Default\IndexedDB" "$dstUserDataDir\Default\" -Force -ErrorAction SilentlyContinue
Copy-Item -Recurse "$srcIronDir\Default\Session Storage" "$dstUserDataDir\Default\" -Force -ErrorAction SilentlyContinue

# Remove lockfiles
Remove-Item "$dstUserDataDir\SingletonLock" -Force -ErrorAction SilentlyContinue
Remove-Item "$dstUserDataDir\lockfile" -Force -ErrorAction SilentlyContinue
Remove-Item "$dstUserDataDir\Default\SingletonLock" -Force -ErrorAction SilentlyContinue
Remove-Item "$dstUserDataDir\Default\lockfile" -Force -ErrorAction SilentlyContinue

Write-Host "[Sync] Successfully copied cookies and session storage into $dstUserDataDir!" -ForegroundColor Green

# 3. Launch SRWare Iron with port 9222
$cdpPort = 9222
$targetUrl = "https://game.granbluefantasy.jp/#mypage"

$browserArgs = @(
    "--remote-debugging-port=$cdpPort",
    "--remote-allow-origins=*",
    "--user-data-dir=`"$dstUserDataDir`"",
    "--profile-directory=`"$targetProfile`"",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--window-size=480,960"
)

if ($isHeadless) {
    $browserArgs += @(
        "--headless=new",
        "--disable-blink-features=AutomationControlled"
    )
}

$browserArgs += "`"$targetUrl`""
$cmdLineArgs = $browserArgs -join " "
$fullCmdLine = "`"$browserExe`" $cmdLineArgs"

Write-Host "[Launcher] Starting SRWare Iron with CDP port $cdpPort..." -ForegroundColor Cyan
Write-Host "[Launcher] Mode: $(if ($isHeadless) { 'HEADLESS' } else { 'HEADFUL (Windowed)' })" -ForegroundColor $(if ($isHeadless) { 'Magenta' } else { 'Cyan' })

Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $fullCmdLine } | Out-Null

# Wait for port 9222
function Test-PortFast([int]$port, [int]$timeoutMs = 250) {
    try {
        $tcp = [System.Net.Sockets.TcpClient]::new()
        $ar = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
        $wait = $ar.AsyncWaitHandle.WaitOne($timeoutMs, $false)
        if ($wait -and $tcp.Connected) {
            $tcp.EndConnect($ar)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
        return $false
    } catch {
        return $false
    }
}

$retries = 25
while ($retries -gt 0) {
    Start-Sleep -Milliseconds 400
    if (Test-PortFast $cdpPort 200) {
        Write-Host "[Launcher] CDP port $cdpPort is now ACTIVE and ready for automation!" -ForegroundColor Green
        exit 0
    }
    $retries--
}

Write-Error "[Launcher] SRWare Iron launched but port $cdpPort did not respond in time."
exit 1
