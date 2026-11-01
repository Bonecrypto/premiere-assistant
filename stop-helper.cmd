@echo off
chcp 65001 >nul
rem Останавливает помощника, который слушает порт 8765 (в том числе запущенного в фоне).
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8765 .*LISTENING"') do (
  taskkill /PID %%p /T /F >nul 2>&1
  set FOUND=1
)
if defined FOUND (echo Помощник остановлен.) else (echo Помощник не был запущен.)
if not "%1"=="nopause" pause
