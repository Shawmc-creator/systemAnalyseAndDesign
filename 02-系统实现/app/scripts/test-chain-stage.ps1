$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$node = Join-Path (Split-Path -Parent $appRoot) 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw '缺少随作业提供的 Node.js 运行环境。' }
& $node --check (Join-Path $appRoot 'public/chain-demo/chain-demo.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$testRoot = Join-Path $appRoot 'tests'
$suite = @(Get-ChildItem -LiteralPath $testRoot -Filter 'v2-chain-*.test.js' | ForEach-Object FullName)
$suite += @(Get-ChildItem -LiteralPath $testRoot -Filter 'v2-inventory*.test.js' | ForEach-Object FullName)
foreach ($file in @('v2-fees.test.js','v2-payments.test.js','v2-treatment.test.js','v2-quotes.test.js')) { $suite += (Join-Path $testRoot $file) }
& $node --test $suite
exit $LASTEXITCODE
