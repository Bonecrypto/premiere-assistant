@echo off
chcp 65001 >nul
title Premiere Assistant - обновление плагина
cd /d "%~dp0"

echo Закройте Premiere Pro перед обновлением.
echo.

if not exist node_modules (
  echo Устанавливаю зависимости...
  call npm install || goto :error
)

echo [1/3] Собираю панель...
call npm run build:panel || goto :error

echo [2/3] Упаковываю в premiere-assistant.ccx...
if exist premiere-assistant.zip del /q premiere-assistant.zip
if exist premiere-assistant.ccx del /q premiere-assistant.ccx
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'packages\panel-premiere\dist\*' -DestinationPath 'premiere-assistant.zip' -Force" || goto :error
ren premiere-assistant.zip premiere-assistant.ccx || goto :error

echo [3/3] Устанавливаю в Premiere...
set "UPIA=C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"
if not exist "%UPIA%" (
  echo Не найден установщик плагинов Creative Cloud. Обновите приложение Creative Cloud и повторите.
  goto :error
)
rem Сначала удаляем старую версию (если её нет — не страшно), затем ставим новую.
"%UPIA%" /remove "Premiere Assistant" >nul 2>&1
"%UPIA%" /install "%~dp0premiere-assistant.ccx"
if errorlevel 1 goto :error

echo.
echo Готово! Откройте Premiere: Window - Premiere Assistant.
pause
exit /b 0

:error
echo.
echo Что-то пошло не так — пришлите скриншот этого окна.
pause
exit /b 1
