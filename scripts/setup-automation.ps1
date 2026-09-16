$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "rakuten-credentials.xml"

function Read-ClipboardValue {
    param([string]$Label)

    Read-Host "Copy $Label from Rakuten, then press Enter" | Out-Null
    $value = (Get-Clipboard -Raw).Trim()

    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Could not read $Label from the clipboard."
    }

    return $value
}

Write-Host ""
Write-Host "Rakuten API credentials will be encrypted for this Windows user."
Write-Host ""

$applicationId = Read-ClipboardValue "Application ID"
if ($applicationId -notmatch "^[0-9A-Fa-f-]{36}$") {
    throw "Check the Application ID format."
}

$accessKey = Read-ClipboardValue "Access key"
if ($accessKey -notmatch "^pk_[!-~]+$") {
    throw "The Access key contains spaces or unsupported characters."
}

$affiliateId = Read-ClipboardValue "Affiliate ID"
if ($affiliateId -notmatch "^[!-~]+$") {
    throw "The Affiliate ID contains spaces or unsupported characters."
}

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

[pscustomobject]@{
    ApplicationId = ConvertTo-SecureString $applicationId -AsPlainText -Force
    AccessKey      = ConvertTo-SecureString $accessKey -AsPlainText -Force
    AffiliateId    = ConvertTo-SecureString $affiliateId -AsPlainText -Force
} | Export-Clixml -Path $configPath -Force

$applicationId = $null
$accessKey = $null
$affiliateId = $null
[GC]::Collect()

Write-Host ""
Write-Host "Credentials saved. Starting a test update."
Write-Host ""

& (Join-Path $PSScriptRoot "update-site.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Test update completed."
