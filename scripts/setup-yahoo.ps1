$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "yahoo-credentials.xml"

Write-Host ""
Write-Host "Yahoo! Shopping Client ID will be encrypted for this Windows user."
Write-Host ""
Read-Host "Copy the Yahoo! Client ID, then press Enter" | Out-Null
$clientId = (Get-Clipboard -Raw).Trim()

if ([string]::IsNullOrWhiteSpace($clientId)) {
    throw "Could not read the Yahoo! Client ID from the clipboard."
}

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

[pscustomobject]@{
    ClientId = ConvertTo-SecureString $clientId -AsPlainText -Force
} | Export-Clixml -Path $configPath -Force

$clientId = $null
[GC]::Collect()

Write-Host ""
Write-Host "Yahoo! Client ID saved. Starting a test update."
Write-Host ""

& (Join-Path $PSScriptRoot "update-site.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Yahoo! Shopping test update completed."
