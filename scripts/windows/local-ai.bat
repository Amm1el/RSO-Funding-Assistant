@echo off
rem Double-click to set up free local AI (Ollama) and score it. Log: local-ai.log
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-ai.ps1"
pause
