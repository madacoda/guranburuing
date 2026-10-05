# scripts/copy-cookies.ps1
$profiles = @(
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Default",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile 1",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile 10",
    "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile 3"
)

foreach ($p in $profiles) {
    $cookiePath = "$p\Network\Cookies"
    if (Test-Path $cookiePath) {
        $pName = Split-Path $p -Leaf
        $dst = "data\cookies_$pName.db"
        $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
        $srcStream = [System.IO.File]::Open($cookiePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
        $dstStream = [System.IO.File]::Create($dst)
        $srcStream.CopyTo($dstStream)
        $srcStream.Close()
        $dstStream.Close()
        Write-Host "Copied $pName to $dst"
    }
}
