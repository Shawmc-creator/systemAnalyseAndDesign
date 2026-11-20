$ErrorActionPreference = 'Stop'
$appDir = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path (Split-Path -Parent $appDir) 'runtime\node.exe'
$launcher = Join-Path $PSScriptRoot 'start-chain-demo.js'
& $nodePath $launcher --no-browser
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $nodePath $launcher --live --no-browser
exit $LASTEXITCODE
