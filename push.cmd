@echo off
cd /d "%~dp0"
git push origin main > "%~dp0push-result.log" 2>&1
echo exit=%ERRORLEVEL% >> "%~dp0push-result.log"
