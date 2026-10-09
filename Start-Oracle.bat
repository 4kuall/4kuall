@echo off
REM ─────────────────────────────────────────────────────────────
REM  Oracle of the Third Eye — Windows launcher. Double-click me.
REM ─────────────────────────────────────────────────────────────
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-setup.ps1"
pause
