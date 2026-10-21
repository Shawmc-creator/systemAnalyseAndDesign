@echo off
setlocal
chcp 65001 >nul
title 青禾牙科诊所管理系统
set "CLINIC_NODE=%~dp002-系统实现\runtime\node.exe"
if exist "%CLINIC_NODE%" goto launch
where node >nul 2>nul
if errorlevel 1 (
  echo 请安装 Node.js 24 或以上版本，或恢复作业附带的运行环境。
  pause
  exit /b 1
)
set "CLINIC_NODE=node"
:launch
"%CLINIC_NODE%" "%~dp002-系统实现\app\scripts\start-v2.js" %*
set "CLINIC_EXIT=%errorlevel%"
if "%CLINIC_EXIT%"=="0" exit /b 0
if /i not "%~1"=="--check" pause
exit /b %CLINIC_EXIT%