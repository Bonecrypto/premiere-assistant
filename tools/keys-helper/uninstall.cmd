@echo off
chcp 65001 >nul
rem Останавливает и удаляет нажиматель клавиш Premiere Assistant.
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.ProcessId -ne $PID -and $_.CommandLine -like '*PremiereAssistantKeys.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
del /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Premiere Assistant keys.lnk" 2>nul
rmdir /s /q "%LOCALAPPDATA%\PremiereAssistant\keys" 2>nul
echo Нажиматель клавиш остановлен и удалён.
pause
