param(
    [switch]$ShutdownWhenNoUser
)

$ErrorActionPreference = "Stop"

$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "rakuten-credentials.xml"
$yahooConfigPath = Join-Path $configDirectory "yahoo-credentials.xml"
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
        throw "Saved Rakuten credentials were not found. Run setup-automation.ps1 first."
    }

    $gitSearchPath = Join-Path $env:LOCALAPPDATA "GitHubDesktop\app-*\resources\app\git\cmd\git.exe"
    $gitExecutable = Get-ChildItem -Path $gitSearchPath -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName

    if (-not $gitExecutable) {
        throw "Git included with GitHub Desktop was not found."
    }

    $settings = Import-Clixml -Path $configPath
    $env:RAKUTEN_APPLICATION_ID = Reveal-SecureValue $settings.ApplicationId
    $env:RAKUTEN_ACCESS_KEY = Reveal-SecureValue $settings.AccessKey
    $env:RAKUTEN_AFFILIATE_ID = Reveal-SecureValue $settings.AffiliateId
    $env:RAKUTEN_HISTORY_PATH = Join-Path $configDirectory "price-history.json"

    if (Test-Path $yahooConfigPath) {
        $yahooSettings = Import-Clixml -Path $yahooConfigPath
        $env:YAHOO_CLIENT_ID = Reveal-SecureValue $yahooSettings.ClientId
    }

    Write-UpdateLog "Starting update."

    & $gitExecutable -C $repositoryPath pull --ff-only |
        Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "Could not pull the latest files from GitHub."
    }

    & node --dns-result-order=ipv4first (Join-Path $repositoryPath "scripts\fetch-rakuten.mjs") |
        Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "Could not fetch Rakuten products."
    }

    if ($env:YAHOO_CLIENT_ID) {
        & node --dns-result-order=ipv4first (Join-Path $repositoryPath "scripts\\fetch-yahoo.mjs") |
            Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) {
            throw "Could not fetch Yahoo! Shopping products."
        }
    }
    else {
        Write-UpdateLog "Yahoo! Shopping Client ID not configured; skipping Yahoo comparison."
    }

    & $gitExecutable -C $repositoryPath config user.name "no1-site"
    & $gitExecutable -C $repositoryPath config user.email "no1-site@users.noreply.github.com"
    & $gitExecutable -C $repositoryPath add products.json

    & $gitExecutable -C $repositoryPath diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-UpdateLog "No product data changes."
    }
    else {
        $japanTimeZone = [TimeZoneInfo]::FindSystemTimeZoneById("Tokyo Standard Time")
        $japanNow = [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $japanTimeZone)
        $commitMessage = "Update market products " + $japanNow.ToString("yyyy-MM-dd HH:mm")

        & $gitExecutable -C $repositoryPath commit -m $commitMessage |
            Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) {
            throw "Could not commit product data."
        }

        & $gitExecutable -C $repositoryPath push origin HEAD |
            Tee-Object -FilePath $logPath -Append
        if ($LASTEXITCODE -ne 0) {
            throw "Could not push product data to GitHub."
        }

        Write-UpdateLog "Product data was sent to the site."
    }
}
catch {
    $exitCode = 1
    Write-UpdateLog ("ERROR: " + $_.Exception.Message)
}
finally {
    Remove-Item Env:RAKUTEN_APPLICATION_ID -ErrorAction SilentlyContinue
    Remove-Item Env:RAKUTEN_ACCESS_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:RAKUTEN_AFFILIATE_ID -ErrorAction SilentlyContinue
    Remove-Item Env:RAKUTEN_HISTORY_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:YAHOO_CLIENT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:YAHOO_AFFILIATE_ID -ErrorAction SilentlyContinue

    if ($ShutdownWhenNoUser) {
        $activeUser = (Get-CimInstance Win32_ComputerSystem).UserName
        if ([string]::IsNullOrWhiteSpace($activeUser)) {
            Write-UpdateLog "No interactive user is logged in. Shutting down in two minutes."
            Start-Process shutdown.exe -ArgumentList @("/s", "/t", "120", "/c", "Automatic site update completed.") -WindowStyle Hidden
        }
    }
}

exit $exitCode
