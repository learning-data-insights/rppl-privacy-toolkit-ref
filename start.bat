@echo off
echo Starting RPPL Privacy Toolkit...
echo.

echo Starting Backend Server...
start cmd /k "conda activate ldi && python application.py"

echo Waiting for backend to start...
timeout /t 3 /nobreak > nul

echo Starting Frontend Server...
cd ../frontend
start cmd /k "npm run dev"

echo.
echo Application starting...
echo Backend: http://localhost:5000
echo Frontend: http://localhost:3000
echo.
echo Press any key to open the application in your browser...
pause > nul
start http://localhost:3000