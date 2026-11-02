@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Обновляет помощника: свежая версия из GitHub, зависимости, перезапуск в фоне.
echo Обновляю помощника...
git pull
if errorlevel 1 (
  echo Не удалось скачать обновление ^(git pull^). Проверьте интернет и что папка — клон репозитория.
  pause
  exit /b 1
)
call npm install --no-audit --no-fund
call "%~dp0stop-helper.cmd" nopause
start "" wscript.exe "%~dp0scripts\helper-hidden.vbs"
echo.
echo Готово: помощник обновлён и запущен в фоне. Лог — helper.log в папке проекта.
echo.
pause
