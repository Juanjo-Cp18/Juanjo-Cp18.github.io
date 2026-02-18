@echo off
echo Starting Map to Inkscape Tool (Background Mode)...
echo Installing requirements if needed...
python -m pip install -r requirements.txt
echo.
echo Starting Server...
start "" "http://localhost:5001"
REM 'pythonw' runs python without a console window
start "" pythonw app.py
exit
