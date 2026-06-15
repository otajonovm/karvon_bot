@echo off
cd /d "%~dp0"
echo [karvon] Eski jarayonlar to'xtatilmoqda...
node scripts\stop-karvon.js
timeout /t 2 /nobreak >nul
echo [karvon] Ishga tushirilmoqda...
node scripts\start-all.js
pause
