# scripts/stop-presence-daemon.ps1

# Terminate any running set-presence background processes
$existing = Get-CimInstance Win32_Process -Filter "name = 'bun.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*set-presence.ts*" }
foreach ($p in $existing) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

# Clear presence from Discord
bun scripts/clear-discord-presence.ts

Write-Host "`n🛑 Discord Presence background daemon stopped and presence cleared." -ForegroundColor Yellow
