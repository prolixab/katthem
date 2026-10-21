@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 24 eller senare behovs for att starta appen.
 pause
 exit /b 1
)
echo Oppna http://127.0.0.1:3080 i webblasaren.
echo Inloggningsuppgifter finns i data\lokala-konton.txt efter forsta starten.
echo Stang fonstret for att stoppa appen.
node server.mjs
pause
