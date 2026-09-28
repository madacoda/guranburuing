# scripts/launch-native-iron.ps1
$ErrorActionPreference = "Stop"

Write-Host "[Launcher] Terminating running Iron processes..." -ForegroundColor Yellow
$procs = Get-Process chrome -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    try {
        if ($p.Path -like "*SRWare Iron*") {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}
Start-Sleep -Seconds 2

$browserExe = "C:\Program Files\SRWare Iron (64-Bit)\chrome.exe"
if (-not (Test-Path $browserExe)) {
    $browserExe = "C:\Program Files\SRWare Iron\chrome.exe"
}

$cdpPort = 9222
$targetUrl = "https://game.granbluefantasy.jp/#mypage"

$browserArgs = @(
    "--remote-debugging-port=$cdpPort",
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=520,960",
    "`"$targetUrl`""
)

$cmdLineArgs = $browserArgs -join " "
$fullCmdLine = "`"$browserExe`" $cmdLineArgs"

Write-Host "[Launcher] Launching native SRWare Iron on port $cdpPort..." -ForegroundColor Cyan
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $fullCmdLine } | Out-Null

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
        Write-Host "[Launcher] Native SRWare Iron is ACTIVE on port $cdpPort!" -ForegroundColor Green
        exit 0
    }
    $retries--
}

Write-Error "[Launcher] Failed to connect to CDP port $cdpPort."
exit 1
