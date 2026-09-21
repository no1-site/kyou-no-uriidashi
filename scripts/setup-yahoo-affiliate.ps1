$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "yahoo-credentials.xml"

if (-not (Test-Path $configPath)) {
    throw "Yahoo! Shopping Client ID is not configured. Run setup-yahoo.ps1 first."
}

Write-Host ""
Write-Host "Yahoo! Shopping affiliate settings will be encrypted for this Windows user."
Write-Host "Copy either the ValueCommerce Yahoo! Shopping referral URL or the URL-encoded affiliate_id value."
Write-Host "Do not paste it into this window."
Write-Host ""
Read-Host "After copying it to the clipboard, press Enter" | Out-Null

$clipboard = (Get-Clipboard -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($clipboard) -or $clipboard.Length -gt 2048) {
    throw "Could not read a valid Yahoo! affiliate value from the clipboard."
}

$affiliateId = $null
$decoded = $clipboard
try {
    if ($clipboard -match "%[0-9A-Fa-f]{2}") {
        $decoded = [System.Uri]::UnescapeDataString($clipboard)
    }
} catch {
    throw "Yahoo! affiliate value could not be decoded."
}

if ($decoded -notmatch "^https?://ck\.jp\.ap\.valuecommerce\.com/servlet/referral\?") {
    throw "The clipboard does not contain a ValueCommerce referral URL."
}
if ($decoded -notmatch "(^|[?&])sid=[^&]+" -or $decoded -notmatch "(^|[?&])pid=[^&]+") {
    throw "The ValueCommerce referral URL is missing sid or pid."
}
if ($decoded -notmatch "([?&])vc_url=") {
    $decoded += "&vc_url="
}
$affiliateId = $decoded

$settings = Import-Clixml -LiteralPath $configPath
if (-not $settings.ClientId) {
    throw "Saved Yahoo! Client ID is missing."
}

[pscustomobject]@{
    ClientId = $settings.ClientId
    AffiliateId = ConvertTo-SecureString $affiliateId -AsPlainText -Force
} | Export-Clixml -LiteralPath $configPath -Force

$affiliateId = $null
$clipboard = $null
$decoded = $null
$settings = $null
[GC]::Collect()

Write-Host ""
Write-Host "Yahoo! Shopping affiliate settings saved."
Write-Host "No production update was started."
