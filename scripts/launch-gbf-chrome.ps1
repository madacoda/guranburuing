# scripts/launch-gbf-chrome.ps1
param(
    [switch]$Headless = $false,
    [switch]$Windowed = $false,
    [switch]$Force = $false,
    [int]$Port = 0,
    [string]$CustomUserDataDir = "",
    [string]$Proxy = "",
    [string]$Profile = ""
)

$ErrorActionPreference = "Stop"

$isHeadless = if ($Windowed.IsPresent) {
    $false
} elseif ($Headless.IsPresent) {
    $true
} else {
    ($env:HEADLESS -eq "true") -or ($env:HEADLESS -eq "1")
}
$defaultProfile = if ($Profile) { $Profile } elseif ($env:CHROME_PROFILE) { $env:CHROME_PROFILE } else { "Default" }

$browserCandidates = @(
    @{ Name = "Google Chrome"; Exe = "C:\Program Files\Google\Chrome\Application\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-chrome-profile"; Profile = $defaultProfile; IsDedicated = $false },
    @{ Name = "Google Chrome (x86)"; Exe = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-chrome-profile"; Profile = $defaultProfile; IsDedicated = $false },
    @{ Name = "Google Chrome (User)"; Exe = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-chrome-profile"; Profile = $defaultProfile; IsDedicated = $false },
    @{ Name = "SRWare Iron (64-Bit)"; Exe = "C:\Program Files\SRWare Iron (64-Bit)\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-iron-profile"; Profile = "Default"; IsDedicated = $false },
    @{ Name = "SRWare Iron"; Exe = "C:\Program Files\SRWare Iron\chrome.exe"; UserDataDir = "$env:USERPROFILE\.gbf-iron-profile"; Profile = "Default"; IsDedicated = $false }
)

$selectedBrowser = $browserCandidates | Where-Object { Test-Path $_.Exe } | Select-Object -First 1

if (-not $selectedBrowser) {
    Write-Error "No compatible browser (SRWare Iron or Google Chrome) found in standard paths."
    exit 1
}

$browserExe = $selectedBrowser.Exe
$isCustomProfile = ($CustomUserDataDir -ne "")
$userDataDir = if ($isCustomProfile) {
    if ($CustomUserDataDir.StartsWith("~")) {
        $homeDir = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
        [System.IO.Path]::GetFullPath($homeDir + $CustomUserDataDir.Substring(1))
    } else {
        [System.IO.Path]::GetFullPath($CustomUserDataDir)
    }
} else {
    [System.IO.Path]::GetFullPath($selectedBrowser.UserDataDir)
}
$targetProfile = if ($Profile -ne "") { $Profile } else { $selectedBrowser.Profile }
if ($targetProfile -eq "Default") {
    if (Test-Path "$userDataDir\Profile 3\Network\Cookies") {
        Write-Host "[Launcher] Detected active session in 'Profile 3' ($userDataDir\Profile 3). Auto-selecting Profile 3." -ForegroundColor Cyan
        $targetProfile = "Profile 3"
    } elseif (Test-Path "$userDataDir\Profile 1\Network\Cookies") {
        Write-Host "[Launcher] Detected active session in 'Profile 1' ($userDataDir\Profile 1). Auto-selecting Profile 1." -ForegroundColor Cyan
        $targetProfile = "Profile 1"
    }
}
$cdpPort = if ($Port -gt 0) { $Port } else { 9222 }
$targetUrl = "https://game.granbluefantasy.jp/"

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

# Check if CDP port is already listening or force restart requested
if ($Force.IsPresent) {
    Write-Host "[Launcher] Force restart requested (-Force). Resetting port $cdpPort processes..." -ForegroundColor Yellow
    $procsToKill = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*remote-debugging-port=$cdpPort*" }
    foreach ($p in $procsToKill) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 600
} elseif (Test-PortFast $cdpPort) {
    $runningProcs = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*remote-debugging-port=$cdpPort*" }
    if ($runningProcs) {
        $firstProc = $runningProcs | Select-Object -First 1
        $currentIsHeadless = ($firstProc.CommandLine -like "*--headless*")
        if (($isHeadless -and $currentIsHeadless) -or (-not $isHeadless -and -not $currentIsHeadless)) {
            Write-Host "[Launcher] Browser ($($selectedBrowser.Name)) is ALREADY running on port $cdpPort in $(if ($isHeadless) { 'HEADLESS' } else { 'WINDOWED' }) mode." -ForegroundColor Green
            exit 0
        } elseif ($Windowed.IsPresent -and $currentIsHeadless) {
            Write-Host "[Launcher] Explicit -Windowed requested. Switching from headless to windowed mode..." -ForegroundColor Cyan
            foreach ($p in $runningProcs) {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            }
            Start-Sleep -Milliseconds 800
        } elseif ($Headless.IsPresent -and -not $currentIsHeadless) {
            Write-Host "[Launcher] Explicit -Headless requested. Switching from windowed to headless mode..." -ForegroundColor Cyan
            foreach ($p in $runningProcs) {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            }
            Start-Sleep -Milliseconds 800
        } else {
            Write-Host "[Launcher] Browser ($($selectedBrowser.Name)) is ALREADY running on port $cdpPort in $(if ($currentIsHeadless) { 'HEADLESS' } else { 'WINDOWED' }) mode. Reusing active session." -ForegroundColor Green
            exit 0
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

# Auto-configure Chrome profile preferences to allow third-party cookies for Mobage/DMM
$targetPrefFile = Join-Path "$userDataDir\$targetProfile" "Preferences"
if (Test-Path $targetPrefFile) {
    try {
        $prefObj = Get-Content $targetPrefFile -Raw | ConvertFrom-Json
        $prefMod = $false
        if (-not $prefObj.profile) {
            $prefObj | Add-Member -MemberType NoteProperty -Name "profile" -Value ([PSCustomObject]@{})
            $prefMod = $true
        }
        if ($prefObj.profile.cookie_controls_mode -ne 0) {
            $prefObj.profile | Add-Member -MemberType NoteProperty -Name "cookie_controls_mode" -Value 0 -Force
            $prefMod = $true
        }
        if (-not $prefObj.profile.default_content_setting_values) {
            $prefObj.profile | Add-Member -MemberType NoteProperty -Name "default_content_setting_values" -Value ([PSCustomObject]@{})
            $prefMod = $true
        }
        if ($prefObj.profile.default_content_setting_values.cookies -ne 1) {
            $prefObj.profile.default_content_setting_values | Add-Member -MemberType NoteProperty -Name "cookies" -Value 1 -Force
            $prefMod = $true
        }
        if (-not $prefObj.profile.content_settings) {
            $prefObj.profile | Add-Member -MemberType NoteProperty -Name "content_settings" -Value ([PSCustomObject]@{})
            $prefMod = $true
        }
        if (-not $prefObj.profile.content_settings.exceptions) {
            $prefObj.profile.content_settings | Add-Member -MemberType NoteProperty -Name "exceptions" -Value ([PSCustomObject]@{})
            $prefMod = $true
        }
        if (-not $prefObj.profile.content_settings.exceptions.cookies) {
            $prefObj.profile.content_settings.exceptions | Add-Member -MemberType NoteProperty -Name "cookies" -Value ([PSCustomObject]@{})
            $prefMod = $true
        }
        $allowedSites = @(
            "https://game.granbluefantasy.jp,*",
            "https://connect.mobage.jp,*",
            "https://sp.mbga.jp,*",
            "https://www.mbga.jp,*",
            "https://app.mobage.jp,*",
            "[*.]granbluefantasy.jp,*",
            "[*.]mobage.jp,*",
            "[*.]mbga.jp,*"
        )
        $nowMs = [string]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        foreach ($site in $allowedSites) {
            $settingObj = [PSCustomObject]@{
                expiration = "0"
                last_modified = $nowMs
                model = 0
                setting = 1
            }
            $prefObj.profile.content_settings.exceptions.cookies | Add-Member -MemberType NoteProperty -Name $site -Value $settingObj -Force
            $prefMod = $true
        }
        if ($prefMod) {
            $prefObj | ConvertTo-Json -Depth 32 -Compress | Set-Content $targetPrefFile -NoNewline
        }
    } catch {}
}

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
    "--test-third-party-cookie-phaseout=disabled",
    "--disable-features=Translate,OptimizationHints,MediaRouter,ForceThirdPartyCookieBlockingEnabled,ThirdPartyCookieDeprecationTrial,BlockThirdPartyCookies,ThirdPartyStoragePartitioning,TrackingProtection3pcd,PartitionedCookies",
    "--window-size=480,960",
    "--disk-cache-size=104857600"
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
