# scripts/launch-gbf-chrome.ps1
param(
    [switch]$Headless = $false,
    [int]$Port = 0,
    [string]$CustomUserDataDir = "",
    [string]$Proxy = "",
    [string]$Profile = ""
)

$ErrorActionPreference = "Stop"

$isHeadless = $Headless.IsPresent -or ($env:HEADLESS -eq "true") -or ($env:HEADLESS -eq "1")
$defaultProfile = if ($Profile) { $Profile } elseif ($env:CHROME_PROFILE) { $env:CHROME_PROFILE } else { "Default" }

$browserCandidates = @(
    @{ Name = "SRWare Iron (64-Bit)"; Exe = "C:\Program Files\SRWare Iron (64-Bit)\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-iron-profile"; Profile = "Default"; IsDedicated = $false },
    @{ Name = "SRWare Iron"; Exe = "C:\Program Files\SRWare Iron\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-iron-profile"; Profile = "Default"; IsDedicated = $false },
    @{ Name = "SRWare Iron (x86)"; Exe = "C:\Program Files (x86)\SRWare Iron\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-iron-profile"; Profile = "Default"; IsDedicated = $false },
    @{ Name = "Google Chrome"; Exe = "C:\Program Files\Google\Chrome\Application\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-chrome-profile"; Profile = $defaultProfile; IsDedicated = $false },
    @{ Name = "Google Chrome (x86)"; Exe = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-chrome-profile"; Profile = $defaultProfile; IsDedicated = $false },
    @{ Name = "Google Chrome (User)"; Exe = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-chrome-profile"; Profile = $defaultProfile; IsDedicated = $false }
)

$selectedBrowser = $browserCandidates | Where-Object { Test-Path $_.Exe } | Select-Object -First 1

if (-not $selectedBrowser) {
    Write-Error "No compatible browser (SRWare Iron or Google Chrome) found in standard paths."
    exit 1
}

$browserExe = $selectedBrowser.Exe
$isCustomProfile = ($CustomUserDataDir -ne "")
$userDataDir = if ($isCustomProfile) { [System.IO.Path]::GetFullPath($CustomUserDataDir) } else { [System.IO.Path]::GetFullPath($selectedBrowser.UserDataDir) }
$targetProfile = $selectedBrowser.Profile
$cdpPort = if ($Port -gt 0) { $Port } else { 9222 }
$targetUrl = "https://game.granbluefantasy.jp/#mypage"

# Ensure user data dir exists
if (-not (Test-Path $userDataDir)) {
    New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
}

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

# Check if CDP port is already listening
if (Test-PortFast $cdpPort) {
    $runningProcs = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*remote-debugging-port=$cdpPort*" }
    if ($runningProcs) {
        $firstProc = $runningProcs | Select-Object -First 1
        $currentIsHeadless = ($firstProc.CommandLine -like "*--headless*")
        if (($isHeadless -and $currentIsHeadless) -or (-not $isHeadless -and -not $currentIsHeadless)) {
            Write-Host "[Launcher] Browser ($($selectedBrowser.Name)) is ALREADY running on port $cdpPort in $(if ($isHeadless) { 'HEADLESS' } else { 'WINDOWED' }) mode." -ForegroundColor Green
            exit 0
        } else {
            Write-Host "[Launcher] Running browser mode mismatch (Requested: $(if ($isHeadless) { 'HEADLESS' } else { 'WINDOWED' }), Current: $(if ($currentIsHeadless) { 'HEADLESS' } else { 'WINDOWED' }))." -ForegroundColor Yellow
            Write-Host "[Launcher] Terminating running browser on port $cdpPort to switch to $(if ($isHeadless) { 'HEADLESS' } else { 'WINDOWED' }) mode..." -ForegroundColor Cyan
            foreach ($p in $runningProcs) {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            }
            Start-Sleep -Milliseconds 800
        }
    } else {
        Write-Host "[Launcher] Port $cdpPort is open but no matching process found." -ForegroundColor Yellow
        exit 0
    }
}

# Clean up stale processes specifically tied to THIS profile without active CDP
$normalizedTargetDir = ($userDataDir -replace '\\', '/').TrimEnd('/')
$staleAutomationProcs = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $procCmd = ($_.CommandLine -replace '\\', '/')
    $procCmd -like "*$normalizedTargetDir*" -and $procCmd -notlike "*remote-debugging-port=$cdpPort*"
}
if ($staleAutomationProcs) {
    Write-Host "[Launcher] Cleaning up stale automation browser processes for profile ($userDataDir)..." -ForegroundColor Cyan
    foreach ($p in $staleAutomationProcs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 600
}

# Session synchronization: ONLY for default single-profile runner, NEVER overwrite explicit isolated account profiles
if (-not $isCustomProfile) {
    $srcIronDir = "$env:LOCALAPPDATA\Chromium\User Data"
    if ($selectedBrowser.Name -like "*Iron*" -and $userDataDir -ne $srcIronDir) {
        if (Test-Path "$srcIronDir\Default\Network\Cookies") {
            $dstCookie = "$userDataDir\Default\Network\Cookies"
            if (-not (Test-Path $dstCookie) -or ((Get-Item "$srcIronDir\Default\Network\Cookies").LastWriteTime -gt (Get-Item $dstCookie).LastWriteTime)) {
                Write-Host "[Launcher] Syncing latest authenticated session from SRWare Iron..." -ForegroundColor Cyan
                New-Item -ItemType Directory -Force -Path "$userDataDir\Default" | Out-Null
                if (Test-Path "$srcIronDir\Local State") {
                    Copy-Item "$srcIronDir\Local State" "$userDataDir\Local State" -Force
                }
                Copy-Item "$srcIronDir\Default\Preferences" "$userDataDir\Default\Preferences" -Force -ErrorAction SilentlyContinue
                Copy-Item "$srcIronDir\Default\Secure Preferences" "$userDataDir\Default\Secure Preferences" -Force -ErrorAction SilentlyContinue
                Copy-Item -Recurse "$srcIronDir\Default\Network" "$userDataDir\Default\" -Force -ErrorAction SilentlyContinue
                Copy-Item -Recurse "$srcIronDir\Default\Local Storage" "$userDataDir\Default\" -Force -ErrorAction SilentlyContinue
                Copy-Item -Recurse "$srcIronDir\Default\IndexedDB" "$userDataDir\Default\" -Force -ErrorAction SilentlyContinue
                Copy-Item -Recurse "$srcIronDir\Default\Session Storage" "$userDataDir\Default\" -Force -ErrorAction SilentlyContinue
                Write-Host "[Launcher] Session sync complete." -ForegroundColor Green
            }
        }
    } elseif (-not $selectedBrowser.IsDedicated) {
        $srcUserDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"
        if (Test-Path "$srcUserDataDir\$targetProfile") {
            Write-Host "[Launcher] Syncing latest session & cookies from $targetProfile..." -ForegroundColor Cyan
            New-Item -ItemType Directory -Force -Path "$userDataDir\$targetProfile" | Out-Null
            if (Test-Path "$srcUserDataDir\Local State") {
                Copy-Item "$srcUserDataDir\Local State" "$userDataDir\Local State" -Force
            }
            Copy-Item "$srcUserDataDir\$targetProfile\Preferences" "$userDataDir\$targetProfile\Preferences" -Force -ErrorAction SilentlyContinue
            Copy-Item "$srcUserDataDir\$targetProfile\Secure Preferences" "$userDataDir\$targetProfile\Secure Preferences" -Force -ErrorAction SilentlyContinue
            Copy-Item -Recurse "$srcUserDataDir\$targetProfile\Network" "$userDataDir\$targetProfile\" -Force -ErrorAction SilentlyContinue
            Copy-Item -Recurse "$srcUserDataDir\$targetProfile\Local Storage" "$userDataDir\$targetProfile\" -Force -ErrorAction SilentlyContinue
            Copy-Item -Recurse "$srcUserDataDir\$targetProfile\IndexedDB" "$userDataDir\$targetProfile\" -Force -ErrorAction SilentlyContinue
            Copy-Item -Recurse "$srcUserDataDir\$targetProfile\Session Storage" "$userDataDir\$targetProfile\" -Force -ErrorAction SilentlyContinue
            Write-Host "[Launcher] Session sync from $targetProfile complete." -ForegroundColor Green
        }
    }
}

# Clean up stale locks if any
$lockFile1 = Join-Path $userDataDir "SingletonLock"
$lockFile2 = Join-Path "$userDataDir\$targetProfile" "SingletonLock"
$lockFile3 = Join-Path $userDataDir "lockfile"
if (Test-Path $lockFile1) { Remove-Item $lockFile1 -Force -ErrorAction SilentlyContinue }
if (Test-Path $lockFile2) { Remove-Item $lockFile2 -Force -ErrorAction SilentlyContinue }
if (Test-Path $lockFile3) { Remove-Item $lockFile3 -Force -ErrorAction SilentlyContinue }

Write-Host "[Launcher] Starting $($selectedBrowser.Name) with CDP on port $cdpPort..." -ForegroundColor Cyan
Write-Host "[Launcher] Mode: $(if ($isHeadless) { 'HEADLESS (--headless=new)' } else { 'HEADFUL (Windowed)' })" -ForegroundColor $(if ($isHeadless) { 'Magenta' } else { 'Cyan' })
Write-Host "[Launcher] Profile Directory: $targetProfile in $userDataDir" -ForegroundColor DarkGray

$browserArgs = @(
    "--remote-debugging-port=$cdpPort",
    "--remote-allow-origins=*",
    "--user-data-dir=`"$userDataDir`"",
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

if ($Proxy -ne "") {
    $browserArgs += "--proxy-server=`"$Proxy`""
}

$browserArgs += "`"$targetUrl`""

$cmdLineArgs = $browserArgs -join " "
$fullCmdLine = "`"$browserExe`" $cmdLineArgs"
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $fullCmdLine } | Out-Null

# Await port availability
$retries = 25
while ($retries -gt 0) {
    Start-Sleep -Milliseconds 400
    if (Test-PortFast $cdpPort 200) {
        Write-Host "[Launcher] CDP port $cdpPort is now ACTIVE and ready for automation!" -ForegroundColor Green
        exit 0
    }
    $retries--
}

Write-Error "[Launcher] $($selectedBrowser.Name) launched but port $cdpPort did not respond in time."
exit 1
