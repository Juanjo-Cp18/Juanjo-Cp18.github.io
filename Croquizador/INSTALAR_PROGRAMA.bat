@echo off
setlocal EnableDelayedExpansion
title Instalador Plano para Croquis

:: ---------------------------------------------------------
:: 1. CHECK ADMIN RIGHTS
:: ---------------------------------------------------------
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo =======================================================
    echo [!] ERROR DE PERMISOS
    echo =======================================================
    echo Este instalador necesita copiar archivos en C:\.
    echo.
    echo POR FAVOR:
    echo 1. Cierra esta ventana.
    echo 2. Haz clic derecho en 'INSTALAR_PROGRAMA.bat'.
    echo 3. Elige "Ejecutar como administrador".
    echo =======================================================
    echo.
    pause
    exit
)

:: ---------------------------------------------------------
:: 2. INKSCAPE WARNING & FOLDER CHECK
:: ---------------------------------------------------------
cls
echo =======================================================
echo      INSTALADOR: PLANO PARA CROQUIS
echo         Policia Local Soller
echo =======================================================
echo.
echo [IMPORTANTE] REQUISITO PREVIO:
echo    Este programa funciona conjuntamente con **INKSCAPE**.
echo.

set "INSTALL_DIR=%SystemDrive%\PlanoCroquis"

:: Check if already installed
if exist "%INSTALL_DIR%" (
    echo [!] AVISO: Se ha detectado una instalacion previa en:
    echo     %INSTALL_DIR%
    echo.
    echo Si continuas, se actualizaran los archivos.
    echo.
    set /p "Overwrite=Quieres continuar? (S/N): "
    
    REM Debug: Check what was captured
    REM echo Debug: User said !Overwrite!
    
    if /i "!Overwrite!" neq "S" (
        echo.
        echo Instalacion cancelada por el usuario.
        pause
        exit
    )
)

echo.
set /p "Ask=Tiene Inkscape instalado en este equipo? (S/N): "
if /i "%Ask%" neq "S" (
    echo.
    echo [CANCELADO] Por favor, instale Inkscape primero.
    echo Descarga: https://inkscape.org
    pause
    exit
)

:: ---------------------------------------------------------
:: 3. COPY FILES
:: ---------------------------------------------------------
echo.
echo [1/4] Preparando carpeta %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

echo [2/4] Copiando archivos del sistema...
xcopy /E /I /Y "%~dp0*" "%INSTALL_DIR%" >nul

:: ---------------------------------------------------------
:: 4. SETUP PYTHON ENVIRONMENT
:: ---------------------------------------------------------
echo [3/4] Verificando entorno Python...
cd /d "%INSTALL_DIR%"

python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo     [OK] Python detectado en el sistema.
    echo     Saltando instalacion de Python.
) else (
    echo     [!] Python no detectado. Descargando instalador...
    
    set "PYTHON_URL=https://www.python.org/ftp/python/3.11.5/python-3.11.5-amd64.exe"
    set "INSTALLER=python_installer.exe"
    
    powershell -Command "Invoke-WebRequest -Uri '!PYTHON_URL!' -OutFile '!INSTALLER!'"
    
    echo     Instalando Python...
    start /wait "" "!INSTALLER!" /quiet InstallAllUsers=1 PrependPath=1 Include_test=0
    del "!INSTALLER!"
)

echo     Instalando librerias necesarias...
python -m pip install -r requirements.txt || (
    echo     [Info] Intentando con ruta directa...
    "%ProgramFiles%\Python311\python.exe" -m pip install -r requirements.txt
)


:: ---------------------------------------------------------
:: 5. CREATE DESKTOP SHORTCUT (VBScript Method)
:: ---------------------------------------------------------
echo [4/4] Creando acceso directo...

set "VBS_SCRIPT=%TEMP%\CreateShortcut_%RANDOM%.vbs"
set "LINK_PATH=%PUBLIC%\Desktop\Plano Croquis.lnk"
set "TARGET_PATH=%INSTALL_DIR%\run.bat"
set "ICON_PATH=%SystemRoot%\System32\shell32.dll,13"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_SCRIPT%"
echo sLinkFile = "%LINK_PATH%" >> "%VBS_SCRIPT%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_SCRIPT%"
echo oLink.TargetPath = "%TARGET_PATH%" >> "%VBS_SCRIPT%"
echo oLink.WorkingDirectory = "%INSTALL_DIR%" >> "%VBS_SCRIPT%"
echo oLink.IconLocation = "%ICON_PATH%" >> "%VBS_SCRIPT%"
echo oLink.Save >> "%VBS_SCRIPT%"

cscript //nologo "%VBS_SCRIPT%"
del "%VBS_SCRIPT%"

echo.
echo =======================================================
echo      INSTALACION COMPLETADA CON EXITO
echo =======================================================
echo.
echo 1. Icono "Plano Croquis" creado en el Escritorio.
echo 2. Carpeta de programa: %INSTALL_DIR%
echo.
pause
