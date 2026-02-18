@echo off
setlocal

echo ===================================================
echo     AUTO-INSTALADOR: MAPA A INKSCAPE
echo ===================================================
echo.

REM 1. Check if Python is installed
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python ya esta instalado.
    goto :install_reqs
)

echo [INFO] Python no encontrado. Descargando e instalando...
echo        Esto puede tardar unos minutos. Por favor espera.

REM 2. Download Python Installer (using PowerShell)
set "PYTHON_URL=https://www.python.org/ftp/python/3.11.5/python-3.11.5-amd64.exe"
set "INSTALLER=python_installer.exe"

powershell -Command "Invoke-WebRequest -Uri '%PYTHON_URL%' -OutFile '%INSTALLER%'"

if not exist "%INSTALLER%" (
    echo [ERROR] No se pudo descargar el instalador. Revisa tu conexion.
    pause
    exit /b 1
)

REM 3. Install Python Silently
echo [INFO] Instalando Python (modo silencioso)...
echo        Se requeriran permisos de Administrador. Acepta si se solicita.
start /wait "" "%INSTALLER%" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0

REM Clean up
del "%INSTALLER%"

REM Refresh Environment (Check again)
REM Note: Usually requires a restart of the script to see the new PATH.
echo.
echo [INFO] Instalacion de Python completada.
echo.

:install_reqs
echo [INFO] Instalando dependencias del programa...
REM Try direct python call. If it fails due to simple path refresh issues, we might need a restart.
python -m pip install -r requirements.txt || (
   echo [WARN] No se pudo ejecutar python inmediatamente.
   echo        Es posible que necesites reiniciar este script o el PC.
   echo        Intentando usar el path directo por defecto...
   "%ProgramFiles%\Python311\python.exe" -m pip install -r requirements.txt
)

echo.
echo ===================================================
echo     INSTALACION COMPLETADA
echo ===================================================
echo.
echo Puedes iniciar el programa con 'run.bat'.
echo.
pause
