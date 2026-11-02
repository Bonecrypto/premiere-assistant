@echo off
chcp 65001 >nul
rem Устанавливает нажиматель клавиш для Premiere Assistant: копирует в %LOCALAPPDATA%, включает автозапуск, запускает.
set "DEST=%LOCALAPPDATA%\PremiereAssistant\keys"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0PremiereAssistantKeys.ps1" "%DEST%\" >nul
copy /y "%~dp0run-hidden.vbs" "%DEST%\" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'PremiereAssistant\keys') | Unblock-File"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Premiere Assistant keys.lnk');" ^
  "$s.TargetPath='wscript.exe';" ^
  "$s.Arguments='\"' + $env:LOCALAPPDATA + '\PremiereAssistant\keys\run-hidden.vbs\"';" ^
  "$s.Description='Premiere Assistant: клавиши для автопокраски';" ^
  "$s.Save()"
rem Перезапуск, если уже работал (обновление).
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.ProcessId -ne $PID -and $_.CommandLine -like '*PremiereAssistantKeys.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
start "" wscript.exe "%DEST%\run-hidden.vbs"
echo.
echo Готово: нажиматель клавиш установлен, запущен и будет стартовать сам при входе в Windows.
echo Вернитесь в Premiere: Авто - Покрасить таймлайн - Покрасить автоматически.
echo Удалить: uninstall.cmd
echo.
pause
