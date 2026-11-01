@echo off
chcp 65001 >nul
cd /d "%~dp0"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Premiere Assistant helper.lnk" 2>nul
call "%~dp0stop-helper.cmd" nopause
echo Автозапуск выключен, помощник остановлен.
echo Запускать вручную: start-helper.cmd
pause
