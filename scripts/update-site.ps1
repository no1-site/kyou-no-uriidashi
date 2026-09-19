param(
    [switch]$ShutdownWhenNoUser
)

$ErrorActionPreference = "Stop"

$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$configPath = Join-Path $configDirectory "rakuten-credentials.xml"
$yahooConfigPath = Join-Path $configDirectory "yahoo-credentials.xml"
$keepaConfigPath = Join-Path $configDirectory "keepa-credentials.xml"
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

    if (Test-Path $keepaConfigPath) {
        $keepaSettings = Import-Clixml -Path $keepaConfigPath
        $env:KEEPA_API_KEY = Reveal-SecureValue $keepaSettings.ApiKey
    }

    Write-UpdateLog "Starting update."

    $currentBranch = & $gitExecutable -C $repositoryPath branch --show-current
    if ($LASTEXITCODE -ne 0 -or $currentBranch -ne "main") {
        throw "Automatic publication requires main; no files were updated."
    }
    $workingChanges = & $gitExecutable -C $repositoryPath status --porcelain
    if ($LASTEXITCODE -ne 0 -or $workingChanges) {
        throw "Automatic publication requires a clean working tree and index."
    }
    if (Test-Path (Join-Path $repositoryPath ".local\update.lock")) {
        throw "An update is running or was interrupted. Inspect .local/update.lock before retrying."
    }

    & $gitExecutable -C $repositoryPath pull --ff-only |
        Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "Could not pull the latest files from GitHub."
    }

    $env:UPDATE_GIT_PATH = $gitExecutable
    & node (Join-Path $repositoryPath "scripts\run-update.mjs") |
        Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "Staged update or publication failed. Inspect the update result before retrying."
    }
    Write-UpdateLog "Product data was sent to GitHub and local history was confirmed."
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
    Remove-Item Env:UPDATE_GIT_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:YAHOO_CLIENT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:YAHOO_AFFILIATE_ID -ErrorAction SilentlyContinue
    Remove-Item Env:KEEPA_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:AMAZON_ASSOCIATE_TAG -ErrorAction SilentlyContinue

    if ($ShutdownWhenNoUser) {
        $activeUser = (Get-CimInstance Win32_ComputerSystem).UserName
        if ([string]::IsNullOrWhiteSpace($activeUser)) {
            Write-UpdateLog "No interactive user is logged in. Shutting down in two minutes."
            Start-Process shutdown.exe -ArgumentList @("/s", "/t", "120", "/c", "Automatic site update completed.") -WindowStyle Hidden
        }
    }
}

exit $exitCode
