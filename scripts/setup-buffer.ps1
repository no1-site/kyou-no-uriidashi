$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "buffer-credentials.xml"

Write-Host ""
Write-Host "Buffer API key will be encrypted for this Windows user."
Write-Host ""
Read-Host "Copy the Buffer API key, then press Enter" | Out-Null
$apiKey = (Get-Clipboard -Raw).Trim()

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "Could not read the Buffer API key from the clipboard."
}

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

[pscustomobject]@{
    ApiKey = ConvertTo-SecureString $apiKey -AsPlainText -Force
} | Export-Clixml -Path $configPath -Force

$apiKey = $null
[GC]::Collect()

Write-Host ""
Write-Host "Buffer API key saved for this Windows user."
Write-Host "Daily updates will use it to queue X posts after product publication."
