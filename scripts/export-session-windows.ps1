# scripts/export-session-windows.ps1
param(
    [string]$Account = "acc1",
    [string]$ProfileDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $ProfileDir) {
    $candidate1 = "$env:USERPROFILE\.gbf-profiles\$Account"
    $candidate2 = "$env:USERPROFILE\.gbf-chrome-profile"
    
    if (Test-Path $candidate1) {
        $ProfileDir = $candidate1
    } elseif (Test-Path $candidate2) {
        $ProfileDir = $candidate2
    } else {
        $ProfileDir = $candidate1
    }
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "    Exporting GBF Session & Cookies from Local Windows      " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Target Account:     $Account"
Write-Host "Profile Directory:  $ProfileDir"

if (Get-Command bun -ErrorAction SilentlyContinue) {
    Write-Host "[Export] Running exporter via Bun..." -ForegroundColor Green
    bun scripts/export-session.ts $Account
} else {
    Write-Host "[Export] Running exporter via tsx / node..." -ForegroundColor Green
    npx -y tsx scripts/export-session.ts $Account
}

$outputFile = "data\$Account-cookies.json"
if (Test-Path $outputFile) {
    # Copy JSON content to clipboard for easy pasting
    $content = Get-Content $outputFile -Raw
    Set-Clipboard -Value $content
    Write-Host "`n📋 Copied cookies JSON to clipboard!" -ForegroundColor Green
    Write-Host "👉 If you are using SSH / remote server, you can paste it directly or push via git." -ForegroundColor Cyan
}
