$ErrorActionPreference = "Stop"

$repositoryPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gitSearchPath = Join-Path $env:LOCALAPPDATA "GitHubDesktop\app-*\resources\app\git\cmd\git.exe"
$gitExecutable = Get-ChildItem -Path $gitSearchPath -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName

if (-not $gitExecutable) {
    throw "Git included with GitHub Desktop was not found."
}

$currentBranch = & $gitExecutable -C $repositoryPath branch --show-current
if ($LASTEXITCODE -ne 0 -or $currentBranch -ne "main") {
    throw "SEO publication requires the main branch."
}

$workingChanges = & $gitExecutable -C $repositoryPath status --porcelain
if ($LASTEXITCODE -ne 0 -or $workingChanges) {
    throw "SEO publication requires a clean working tree."
}

& $gitExecutable -C $repositoryPath pull --ff-only
if ($LASTEXITCODE -ne 0) {
    throw "Could not pull the latest files from GitHub."
}

$env:UPDATE_GIT_PATH = $gitExecutable
try {
    & node (Join-Path $PSScriptRoot "publish-product-pages.mjs")
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Remove-Item Env:UPDATE_GIT_PATH -ErrorAction SilentlyContinue
}
