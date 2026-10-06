# scripts/start-presence-daemon.ps1
param(
    [string]$Mode = "work",
    [string]$Project = "Every Hero",
    [string]$Task = ""
)

$targetArgs = @("src/cli/set-presence.ts", $Mode)
if ($Project) { $targetArgs += $Project }
if ($Task) { $targetArgs += $Task }

# Kill any existing set-presence background processes
$existing = Get-CimInstance Win32_Process -Filter "name = 'bun.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*set-presence.ts*" }
foreach ($p in $existing) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# Start detached background process
Start-Process -FilePath "bun" -ArgumentList $targetArgs -WindowStyle Hidden

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " 🚀 Discord Presence is now RUNNING IN THE BACKGROUND!                   " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " • Template: [$($Mode.ToUpper())]" -ForegroundColor White
Write-Host " • Project:  $Project" -ForegroundColor White
if ($Task) { Write-Host " • Task:     $Task" -ForegroundColor White }
Write-Host " • Status:   ACTIVE on Discord Gateway & Desktop IPC" -ForegroundColor Green
Write-Host "------------------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host " 💡 You do NOT need to keep any terminal window open." -ForegroundColor Gray
Write-Host " 👉 Run 'bun run presence:stop' anytime to turn it off." -ForegroundColor Yellow
Write-Host "========================================================================`n" -ForegroundColor Cyan
