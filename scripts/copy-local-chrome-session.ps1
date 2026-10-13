# scripts/copy-local-chrome-session.ps1
# Copies authenticated Granblue Fantasy session from your normal local Google Chrome to the acc1 profile directory.

param(
    [string]$DestinationDir = "$env:USERPROFILE\.gbf-profiles\acc1"
)

$srcDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$srcDefault = Join-Path $srcDir "Default"
$srcLocalState = Join-Path $srcDir "Local State"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "       Granblue Fantasy Local Chrome Session Copy Utility              " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "Source:      $srcDefault"
Write-Host "Destination: $DestinationDir\Default"
Write-Host "========================================================================`n"

if (-not (Test-Path $srcDefault)) {
    Write-Error "Source Chrome profile ($srcDefault) not found."
    exit 1
}

# Check if normal Chrome is running
$chromeProcs = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeProcs) {
    Write-Host "⚠️ Please close Google Chrome completely before copying, so the database is unlocked." -ForegroundColor Yellow
    Write-Host "Press Enter once Chrome is closed..." -NoNewline
    Read-Host
}

# Re-check
$chromeProcs = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeProcs) {
    Write-Host "Terminating remaining background Chrome processes..." -ForegroundColor Yellow
    Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Ensure destination exists
$dstDefault = Join-Path $DestinationDir "Default"
New-Item -ItemType Directory -Force -Path $dstDefault | Out-Null

Write-Host "Copying Local State..." -ForegroundColor Cyan
if (Test-Path $srcLocalState) {
    Copy-Item $srcLocalState (Join-Path $DestinationDir "Local State") -Force
}

$itemsToCopy = @("Network", "Local Storage", "Session Storage", "IndexedDB", "Preferences", "Secure Preferences")
foreach ($item in $itemsToCopy) {
    $srcPath = Join-Path $srcDefault $item
    $dstPath = Join-Path $dstDefault $item
    if (Test-Path $srcPath) {
        Write-Host "Copying $item..." -ForegroundColor Cyan
        if (Test-Path $dstPath) {
            Remove-Item -Recurse -Force $dstPath -ErrorAction SilentlyContinue
        }
        Copy-Item -Recurse -Force $srcPath $dstPath
    }
}

Write-Host "`n✅ Successfully copied your active local Chrome session to $DestinationDir!" -ForegroundColor Green
Write-Host "👉 You can now run:" -ForegroundColor Yellow
Write-Host "   bun run account:setup acc1 --windowed" -ForegroundColor White
Write-Host "It will detect your active session on #mypage immediately with zero logins required!`n" -ForegroundColor Green
