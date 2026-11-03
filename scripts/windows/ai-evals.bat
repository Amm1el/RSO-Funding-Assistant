@echo off
rem Double-click to re-run the AI evals with the local model. Log: ai-evals.log
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ai-evals.ps1" -Note "tolerant citation check"
pause
