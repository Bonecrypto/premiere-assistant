@echo off
chcp 65001 >nul
title Premiere Assistant - helper
cd /d "%~dp0"
if not exist node_modules (
  echo Первый запуск: устанавливаю зависимости...
  call npm install || goto :error
)
call npm start
if errorlevel 1 goto :error
goto :eof
:error
echo.
echo Помощник завершился с ошибкой. Окно можно закрыть.
pause
