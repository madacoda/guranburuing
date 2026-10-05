# scripts/decrypt-chrome-cookie.ps1
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Core

$localStatePath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Local State"
$cookieDbPath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Network\Cookies"

if (-not (Test-Path $localStatePath)) {
    Write-Error "Local State not found at $localStatePath"
    exit 1
}

# 1. Get Master Key
$localState = Get-Content $localStatePath -Raw | ConvertFrom-Json
$encryptedKeyB64 = $localState.os_crypt.encrypted_key
$encryptedKeyBytes = [Convert]::FromBase64String($encryptedKeyB64)
# Strip leading 'DPAPI' prefix (5 bytes)
$dpapiBytes = $encryptedKeyBytes[5..($encryptedKeyBytes.Length - 1)]
$masterKey = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $dpapiBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)

# 2. Copy Cookie DB and WAL/SHM with FileShare.ReadWrite so it works even if Chrome is open
$tempDb = Join-Path $PSScriptRoot "..\data\temp_extract_chrome.db"

function Copy-LockedFile($src, $dst) {
    if (Test-Path $src) {
        $srcStream = [System.IO.File]::Open($src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $dstStream = [System.IO.File]::Open($dst, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        $srcStream.CopyTo($dstStream)
        $srcStream.Close()
        $dstStream.Close()
    }
}

Copy-LockedFile $cookieDbPath $tempDb
Copy-LockedFile "$cookieDbPath-wal" "$tempDb-wal"
Copy-LockedFile "$cookieDbPath-shm" "$tempDb-shm"

Write-Output ([Convert]::ToBase64String($masterKey))
