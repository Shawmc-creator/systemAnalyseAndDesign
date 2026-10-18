@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp002-系统实现\app"
set "CLINIC_V2_NODE=%~dp002-系统实现\runtime\node.exe"
if exist "%CLINIC_V2_NODE%" goto check_node
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或以上版本，并加入 PATH。
  pause
  exit /b 1
)
set "CLINIC_V2_NODE=node"
:check_node
"%CLINIC_V2_NODE%" -e "if(Number(process.versions.node.split('.')[0])<24){console.error('Node.js 24 or later is required.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
echo 新版网页：http://127.0.0.1:3001/
echo 关闭此窗口或按 Ctrl+C 可停止本窗口启动的服务。
if /i "%~1"=="--check" exit /b 0
"%CLINIC_V2_NODE%" src/v2/server.js --demo
if errorlevel 1 pause
endlocal
