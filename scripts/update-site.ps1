param(
    [switch]$ShutdownWhenNoUser
)

$ErrorActionPreference = "Stop"

$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "rakuten-credentials.xml"
$logPath = Join-Path $configDirectory "update.log"

New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

function Write-UpdateLog {
    param([string]$Message)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Add-Content -Path $logPath -Value $line -Encoding UTF8
    Write-Host $line
}

function Reveal-SecureValue {
    param([Security.SecureString]$Value)

    return [System.Net.NetworkCredential]::new("", $Value).Password
}

$exitCode = 0

try {
    if (-not (Test-Path $configPath)) {
        throw "楽天APIの保存情報がありません。setup-automation.ps1を先に実行してください。"
    }

    $gitSearchPath = Join-Path $env:LOCALAPPDATA "GitHubDesktop\app-*\resources\app\git\cmd\git.exe"
    $gitExecutable = Get-ChildItem -Path $gitSearchPath -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName

    if (-not $gitExecutable) {
        throw "GitHub Desktopに含まれるGitが見つかりません。"
    }

    $settings = Import-Clixml -Path $configPath
    $env:RAKUTEN_APPLICATION_ID = Reveal-SecureValue $settings.ApplicationId
    $env:RAKUTEN_ACCESS_KEY = Reveal-SecureValue $settings.AccessKey
    $env:RAKUTEN_AFFILIATE_ID = Reveal-SecureValue $settings.AffiliateId

    Write-UpdateLog "更新を開始します。"

    & $gitExecutable -C $repositoryPath pull --ff-only 2>&1 |
        Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "GitHubから最新版を取得できませんでした。"
    }

    & node --dns-result-order=ipv4first (Join-Path $repositoryPath "scripts\fetch-rakuten.mjs") 2>&1 |
        Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "楽天の商品取得に失敗しました。"
    }

    & $gitExecutable -C $repositoryPath config user.name "no1-site"
    & $gitExecutable -C $repositoryPath config user.email "no1-site@users.noreply.github.com"
    & $gitExecutable -C $repositoryPath add products.json

    & $gitExecutable -C $repositoryPath diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-UpdateLog "商品データに変更はありませんでした。"
    }
    else {
        $japanTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById("Tokyo Standard Time")
        $japanNow = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $japanTimeZone)
        $commitMessage = "楽天商品を自動更新 " + $japanNow.ToString("yyyy-MM-dd HH:mm")

        & $gitExecutable -C $repositoryPath commit -m $commitMessage 2>&1 |
            Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) {
            throw "商品データを記録できませんでした。"
        }

        & $gitExecutable -C $repositoryPath push origin HEAD 2>&1 |
            Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) {
            throw "商品データをGitHubへ送信できませんでした。"
        }

        Write-UpdateLog "商品データをサイトへ送信しました。"
    }
}
catch {
    $exitCode = 1
    Write-UpdateLog ("エラー: " + $_.Exception.Message)
}
finally {
    Remove-Item Env:RAKUTEN_APPLICATION_ID -ErrorAction SilentlyContinue
    Remove-Item Env:RAKUTEN_ACCESS_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:RAKUTEN_AFFILIATE_ID -ErrorAction SilentlyContinue

    if ($ShutdownWhenNoUser) {
        $activeUser = (Get-CimInstance Win32_ComputerSystem).UserName
        if ([string]::IsNullOrWhiteSpace($activeUser)) {
            Write-UpdateLog "ログイン中の利用者がいないため、2分後に電源を切ります。"
            Start-Process shutdown.exe -ArgumentList @("/s", "/t", "120", "/c", "今日の売り出しの自動更新が完了しました。") -WindowStyle Hidden
        }
    }
}

exit $exitCode
