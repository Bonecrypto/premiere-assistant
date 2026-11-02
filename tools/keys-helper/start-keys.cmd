@echo off
chcp 65001 >nul
title Premiere Assistant - клавиши для покраски
rem Запускает нажиматель клавиш в этом окне. Закройте окно, чтобы выключить.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PremiereAssistantKeys.ps1"
pause
