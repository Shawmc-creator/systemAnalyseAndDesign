param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('fixed', 'live')]
    [string]$Mode,
    [Parameter(Mandatory = $true)]
    [string]$AppDirectory
)

$ErrorActionPreference = 'Stop'
$appDirectory = [IO.Path]::GetFullPath($AppDirectory)
$dataDirectory = if ($Mode -eq 'live') { 'chain-live-demo' } else { 'chain-demo' }
$lockPath = Join-Path $appDirectory "data\$dataDirectory\chain-demo.snapshot.sqlite.lock"
if (-not (Test-Path -LiteralPath $lockPath)) { exit 0 }

# Query the real process inventory. A failed or incomplete query must keep the lock.
$processes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'")
foreach ($process in $processes) {
    if ([string]::IsNullOrWhiteSpace($process.CommandLine)) {
        throw '无法核实 Node 进程，请保留数据锁并检查正在运行的演示。'
    }
    if ($process.CommandLine -match 'start-chain-demo\.js') { continue }
    $serviceName = if ($Mode -eq 'live') { 'serve-chain-live-demo.js' } else { 'serve-chain-persistent-demo.js' }
    if ($process.CommandLine.Contains($serviceName)) {
        throw '仍有连锁演示或本项目的 Node 进程，请先停止对应服务再重试。'
    }
    if ($process.CommandLine -match 'serve-chain-(persistent|live|api)-demo\.js') { continue }
    if ($process.CommandLine.Contains($appDirectory)) { throw '本项目仍有其他 Node 进程，请检查后重试。' }
}

$port = if ($Mode -eq 'live') { 3019 } else { 3011 }
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq $port)
if ($listeners.Count -gt 0) { throw "端口 $port 仍被占用，请先检查对应服务。" }

$lock = Get-Item -LiteralPath $lockPath
if ($lock.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw '数据锁路径异常，请人工检查。'
}
Remove-Item -LiteralPath $lockPath
Write-Output "已清理退出进程留下的数据锁，保留演示快照。"
