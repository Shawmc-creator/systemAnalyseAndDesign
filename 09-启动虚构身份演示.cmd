@echo off
setlocal
chcp 65001 >nul
set "CLINIC_NODE=%~dp002-系统实现\runtime\node.exe"
if not exist "%CLINIC_NODE%" set "CLINIC_NODE=node"
"%CLINIC_NODE%" "%~dp002-系统实现\app\scripts\start-patient-identity-trial.js" %*
if errorlevel 1 pause
