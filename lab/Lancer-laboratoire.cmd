@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-lab.ps1" -Mode api
pause
