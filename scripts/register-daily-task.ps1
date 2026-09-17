$ErrorActionPreference = "Stop"

$taskName = "KyouNoUriidashi-DailyUpdate"
$updateScript = (Resolve-Path (Join-Path $PSScriptRoot "update-site.ps1")).Path
$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configPath = Join-Path $env:LOCALAPPDATA "KyouNoUriidashi\rakuten-credentials.xml"
$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

try {
    if (-not (Test-Path $configPath)) {
        throw "Rakuten credentials were not found. Run setup-automation.ps1 first."
    }

    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw "Node.js was not found. Install Node.js or add it to PATH first."
    }

    $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $updateScript + '"'

    $action = New-ScheduledTaskAction `
        -Execute $powerShell `
        -Argument $arguments `
        -WorkingDirectory $repositoryPath

    $trigger = New-ScheduledTaskTrigger -Daily -At "09:40"

    $principal = New-ScheduledTaskPrincipal `
        -UserId $account `
        -LogonType Interactive `
        -RunLevel Limited

    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

    $task = New-ScheduledTask `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description "Update Rakuten products and publish Kyou no Uriidashi every day at 09:40."

    Register-ScheduledTask `
        -TaskName $taskName `
        -InputObject $task `
        -Force | Out-Null

    $registered = Get-ScheduledTask -TaskName $taskName
    $info = Get-ScheduledTaskInfo -TaskName $taskName

    Write-Host ""
    Write-Host "Daily update task was registered successfully."
    Write-Host ("Task name: " + $registered.TaskName)
    Write-Host ("Schedule: Every day at 09:40")
    Write-Host ("Next run: " + $info.NextRunTime)
    Write-Host ""
    Write-Host "The task runs under the current Windows user after sign-in."
    Write-Host "If 09:40 was missed, Windows will start it when available."
}
catch {
    Write-Host ""
    Write-Error $_.Exception.Message
    exit 1
}
