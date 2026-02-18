@echo off
echo Creating Desktop Shortcut...

set "TARGET=%~dp0run.bat"
set "SHORTCUT=%Userprofile%\Desktop\Mapa Inkscape.lnk"
set "ICON=%SystemRoot%\System32\shell32.dll,13"

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT%'); $s.TargetPath = '%TARGET%'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%ICON%'; $s.Save()"

echo.
echo [OK] Acceso directo creado en el Escritorio con icono de Mundo.
echo.
pause
