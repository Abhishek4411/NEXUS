@echo off
echo ============================================================
echo   NEXUS - Global Intelligence Platform
echo   Starting up on port 8001...
echo ============================================================

:: Kill ALL python.exe instances to ensure clean start
echo Stopping any running Python/NEXUS servers...
taskkill /F /IM python.exe >nul 2>&1
taskkill /F /IM python3.exe >nul 2>&1
taskkill /F /IM pythonw.exe >nul 2>&1
timeout /t 2 /nobreak >nul

:: Also kill by port just in case
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr "LISTENING" ^| findstr ":800"') do (
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr "LISTENING" ^| findstr ":801"') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from python.org
    pause
    exit /b 1
)

:: Copy .env if not exists
if not exist .env (
    if exist .env.example (
        copy .env.example .env
        echo Created .env from .env.example
    )
)

:: Create venv if needed
if not exist venv\ (
    echo Creating virtual environment...
    python -m venv venv
)

echo Activating virtual environment...
call venv\Scripts\activate.bat

echo Installing/checking dependencies...
pip install -r requirements.txt -q

echo.
echo ============================================================
echo   NEXUS starting on http://localhost:8001
echo   Press Ctrl+C to stop
echo ============================================================
echo.

python main.py

pause
