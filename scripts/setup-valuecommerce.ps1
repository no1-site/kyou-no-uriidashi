$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "valuecommerce-credentials.xml"

Write-Host ""
Write-Host "ValueCommerce Product API credentials will be encrypted for this Windows user."
Write-Host "In ValueCommerce, first partner with Web Service compatible advertisers and note their EC codes."
Write-Host ""

Read-Host "Copy the ValueCommerce Product API token, then press Enter" | Out-Null
$token = (Get-Clipboard -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -gt 256) {
    throw "Check the ValueCommerce token."
}

$codes = (Read-Host "Enter allowed EC codes separated by commas").Trim()
$parsedCodes = $codes.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if (-not $parsedCodes.Count -or ($parsedCodes | Where-Object { $_ -notmatch "^[A-Za-z0-9]+$" })) {
    throw "Check the EC code list."
}

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
[pscustomobject]@{
    Token = ConvertTo-SecureString $token -AsPlainText -Force
    AllowedEcCodes = ($parsedCodes -join ",")
} | Export-Clixml -Path $configPath -Force

$token = $null
[GC]::Collect()

Write-Host ""
Write-Host "ValueCommerce credentials saved. They will be used on the next update."
