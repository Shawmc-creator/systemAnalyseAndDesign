@echo off
setlocal
chcp 65001 >nul
set "CLINIC_NODE=%~dp002-系统实现\runtime\node.exe"
if exist "%CLINIC_NODE%" goto launch
where node >nul 2>nul
if errorlevel 1 (
  echo 请安装 Node.js 24 或以上版本。
  pause
  exit /b 1
)
set "CLINIC_NODE=node"
:launch
echo 正在启动实时日期虚构演示，请访问 http://127.0.0.1:3019/
"%CLINIC_NODE%" "%~dp002-系统实现\app\scripts\serve-chain-live-demo.js"
echo 服务已停止。
pause
