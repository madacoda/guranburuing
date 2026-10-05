# scripts/decrypt-iron.ps1
Add-Type -AssemblyName System.Security
Add-Type -AssemblyName System.Core

$localStatePath = "$env:LOCALAPPDATA\Chromium\User Data\Local State"
$cookieDbPath = "$env:LOCALAPPDATA\Chromium\User Data\Default\Network\Cookies"

if (-not (Test-Path $localStatePath) -or -not (Test-Path $cookieDbPath)) {
    Write-Error "Chromium files not found."
    exit 1
}

# 1. Master Key
$localState = Get-Content $localStatePath -Raw | ConvertFrom-Json
$encryptedKeyB64 = $localState.os_crypt.encrypted_key
$encryptedKeyBytes = [Convert]::FromBase64String($encryptedKeyB64)
$dpapiBytes = $encryptedKeyBytes[5..($encryptedKeyBytes.Length - 1)]
$masterKey = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $dpapiBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)

Write-Output ([Convert]::ToBase64String($masterKey))
