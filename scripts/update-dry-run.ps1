param([ValidateSet(20, 50, 100)][int]$TargetProductCount)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$started = [System.Diagnostics.Stopwatch]::StartNew()
$exitCode = 1
$credentialNames = @("RAKUTEN_APPLICATION_ID", "RAKUTEN_ACCESS_KEY", "RAKUTEN_AFFILIATE_ID", "YAHOO_CLIENT_ID", "YAHOO_AFFILIATE_ID", "KEEPA_API_KEY", "AMAZON_ASSOCIATE_TAG", "DRY_RUN_HISTORY_PATH", "NODE_OPTIONS", "NODE_DEBUG", "TARGET_PRODUCT_COUNT")

try {
    # Discard inherited credentials/options; only saved encrypted credentials are used.
    foreach ($name in $credentialNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    $configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
    $rakuten = Import-Clixml -LiteralPath (Join-Path $configDirectory "rakuten-credentials.xml")
    $yahoo = Import-Clixml -LiteralPath (Join-Path $configDirectory "yahoo-credentials.xml")
    $env:RAKUTEN_APPLICATION_ID = [System.Net.NetworkCredential]::new("", $rakuten.ApplicationId).Password
    $env:RAKUTEN_ACCESS_KEY = [System.Net.NetworkCredential]::new("", $rakuten.AccessKey).Password
    $env:YAHOO_CLIENT_ID = [System.Net.NetworkCredential]::new("", $yahoo.ClientId).Password
    # Keepa is deliberately never loaded or enabled in dry-run.
    if ($TargetProductCount) { $env:TARGET_PRODUCT_COUNT = [string]$TargetProductCount }
    $env:DRY_RUN_HISTORY_PATH = Join-Path $configDirectory "price-history.json"
    # No transcript, logging, Git commands, pull, or publication entry point.
    & node (Join-Path $PSScriptRoot "run-update-dry-run.mjs")
    $exitCode = $LASTEXITCODE
}
catch {
    # Never render the original exception or decrypted values.
    Write-Output "取得商品数：未完了（保存済み認証情報または実行環境を確認してください）"
    Write-Output "比較成立商品数：未完了"
    Write-Output "Yahoo追加商品数：未完了"
    Write-Output "Yahoo追加出品数：未完了"
    Write-Output "Yahoo除外理由ごとの件数：未完了"
    Write-Output "保留商品数：未完了"
    Write-Output ("実行時間：" + $started.Elapsed.TotalSeconds.ToString("F1") + "秒")
}
finally {
    foreach ($name in $credentialNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    $rakuten = $null
    $yahoo = $null
    $keepa = $null
}
exit $exitCode
