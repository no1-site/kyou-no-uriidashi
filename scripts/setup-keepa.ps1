$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "keepa-credentials.xml"

Write-Host ""
Write-Host "Keepa API key will be encrypted for this Windows user."
Write-Host ""
Read-Host "Copy the Keepa API key, then press Enter" | Out-Null
$apiKey = (Get-Clipboard -Raw).Trim()

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "Could not read the Keepa API key from the clipboard."
}

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

[pscustomobject]@{
    ApiKey = ConvertTo-SecureString $apiKey -AsPlainText -Force
} | Export-Clixml -Path $configPath -Force

$apiKey = $null
[GC]::Collect()

Write-Host ""
Write-Host "Keepa API key saved. Starting a test update."
Write-Host ""

& (Join-Path $PSScriptRoot "update-site.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Keepa / Amazon.co.jp test update completed."
