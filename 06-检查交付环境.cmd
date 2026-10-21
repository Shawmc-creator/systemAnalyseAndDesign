@echo off
setlocal
chcp 65001 >nul
set "CLINIC_NODE=%~dp002-系统实现\runtime\node.exe"
if exist "%CLINIC_NODE%" goto check
where node >nul 2>nul
if errorlevel 1 (
  echo 请安装 Node.js 24 或以上版本，或恢复作业附带的便携运行时。
  pause
  exit /b 1
)
set "CLINIC_NODE=node"
:check
"%CLINIC_NODE%" "%~dp002-系统实现\app\scripts\check-delivery.js"
set "CLINIC_EXIT=%errorlevel%"
if /i not "%~1"=="--no-pause" pause
exit /b %CLINIC_EXIT%
