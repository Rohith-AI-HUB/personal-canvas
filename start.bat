@echo off
echo Starting Personal AI Knowledge Canvas...

:: Start Qdrant in the background
echo [1/3] Starting Qdrant vector database...
docker compose up -d qdrant 2>nul
if errorlevel 1 (
  echo WARNING: Docker/Qdrant not available. Vector search will be disabled.
)

:: Wait briefly for Qdrant to initialize
timeout /t 2 /nobreak >nul

:: Start backend
echo [2/3] Starting backend server...
start "PAKC Backend" cmd /k "cd /d %~dp0backend && npm run dev"

:: Wait for backend to be ready
timeout /t 3 /nobreak >nul

:: Start frontend
echo [3/3] Starting frontend dev server...
start "PAKC Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo App starting up...
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:3001
echo   Qdrant:   http://localhost:6333
echo.
echo Close the opened terminal windows to stop the servers.
