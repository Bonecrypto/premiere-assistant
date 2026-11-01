@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Сначала установите зависимости: npm install
  pause
  exit /b 1
)
rem Ярлык в папке «Автозагрузка»: при входе в Windows помощник запускается сам, без окна.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Premiere Assistant helper.lnk');" ^
  "$s.TargetPath='wscript.exe';" ^
  "$s.Arguments='\"' + (Resolve-Path 'scripts\helper-hidden.vbs').Path + '\"';" ^
  "$s.WorkingDirectory=(Get-Location).Path;" ^
  "$s.Description='Premiere Assistant: локальный помощник';" ^
  "$s.Save()"
if errorlevel 1 (
  echo Не удалось создать ярлык автозапуска.
  pause
  exit /b 1
)
rem Если помощник уже работает (порт занят) — второй не запускаем.
netstat -ano | findstr /r /c:":8765 .*LISTENING" >nul
if errorlevel 1 start "" wscript.exe "%~dp0scripts\helper-hidden.vbs"
echo.
echo Готово: помощник запущен в фоне и будет стартовать сам при входе в Windows.
echo Лог работы: helper.log в папке проекта. Выключить автозапуск: autostart-off.cmd
echo.
pause
