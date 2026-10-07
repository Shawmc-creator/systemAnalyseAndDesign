@echo off
setlocal
chcp 65001 >nul
title 青禾牙科诊所管理系统启动器
set "ROOT=%~dp0"
set "APP=%ROOT%02-系统实现\app"
set "NODE=%ROOT%02-系统实现\runtime\node.exe"

if not exist "%NODE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo [错误] 未找到 Node.js，且提交包中的便携运行环境缺失。
    pause
    exit /b 1
  )
  set "NODE=node"
)

if not exist "%APP%\src\server.js" (
  echo [错误] 找不到系统后端：02-系统实现\app\src\server.js
  pause
  exit /b 1
)

echo 正在启动牙科诊所管理系统...
cd /d "%APP%"
start "Qinghe Dental Server" /min "%NODE%" src\server.js
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:3000/
echo 系统地址：http://127.0.0.1:3000/
echo 负责人账号：manager  密码：Clinic123!
timeout /t 4 /nobreak >nul
endlocal
