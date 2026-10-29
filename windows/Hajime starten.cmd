@echo off
rem Hajime starten: oeffnet Hajime in einem eigenen Fenster (Microsoft Edge).
rem Keine Installation. Das Programm liegt im Unterordner "programm".
cd /d "%~dp0programm" 2>nul
if not exist "node.exe" goto fehlt
"node.exe" hajime-windows.js
if errorlevel 1 pause
exit /b

:fehlt
echo.
echo   Hajime kann nicht starten: Der Ordner "programm" fehlt.
echo.
echo   Bitte die ZIP-Datei zuerst entpacken:
echo   Rechte Maustaste auf die ZIP-Datei - "Alle extrahieren" - "Extrahieren".
echo   Danach im entpackten Ordner "Hajime starten" doppelklicken.
echo.
pause
