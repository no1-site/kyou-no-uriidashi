$ErrorActionPreference = "Stop"

$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "rakuten-credentials.xml"

function Read-ClipboardValue {
    param([string]$Label)

    Read-Host "$Label を楽天の画面でコピーしてから Enter"
    $value = (Get-Clipboard -Raw).Trim()

    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Label をクリップボードから読み取れませんでした。"
    }

    return $value
}

Write-Host ""
Write-Host "楽天APIの情報を、このWindowsユーザーだけが復号できる形式で保存します。"
Write-Host ""

$applicationId = Read-ClipboardValue "アプリケーションID"
if ($applicationId -notmatch "^[0-9A-Fa-f-]{36}$") {
    throw "アプリケーションIDの形式を確認してください。"
}

$accessKey = Read-ClipboardValue "Access key"
if ($accessKey -notmatch "^pk_[!-~]+$") {
    throw "Access keyに空白や改行が含まれているか、形式が正しくありません。"
}

$affiliateId = Read-ClipboardValue "アフィリエイトID"
if ($affiliateId -notmatch "^[!-~]+$") {
    throw "アフィリエイトIDに空白や改行が含まれています。"
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
Write-Host "保存できました。楽天APIの値は画面やリポジトリには表示されません。"
Write-Host "続けて自動更新の動作確認を開始します。"
Write-Host ""

& (Join-Path $PSScriptRoot "update-site.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "動作確認が完了しました。"
