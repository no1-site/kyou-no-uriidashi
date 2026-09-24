$ErrorActionPreference = "Stop"

$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configDirectory = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi"
$bufferConfigPath = Join-Path $configDirectory "buffer-credentials.xml"
$bufferStatePath = Join-Path $configDirectory "buffer-post-state.json"

function Reveal-SecureValue {
    param([Security.SecureString]$Value)
    return [System.Net.NetworkCredential]::new("", $Value).Password
}

try {
    if (-not (Test-Path $bufferConfigPath)) {
        throw "Saved Buffer credentials were not found."
    }

    $bufferSettings = Import-Clixml -Path $bufferConfigPath
    $env:BUFFER_API_KEY = Reveal-SecureValue $bufferSettings.ApiKey
    $env:BUFFER_STATE_PATH = $bufferStatePath

    & node (Join-Path $repositoryPath "scripts\generate-social-posts.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "SNS post candidate generation failed."
    }

    & node (Join-Path $repositoryPath "scripts\publish-social-posts.mjs")
    if ($LASTEXITCODE -ne 0) {
        throw "Buffer queue publication failed."
    }

    Write-Host ""
    Write-Host "SNS posts were added to the Buffer queue successfully."
}
finally {
    Remove-Item Env:BUFFER_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:BUFFER_STATE_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:BUFFER_CHANNEL_NAME -ErrorAction SilentlyContinue
}
