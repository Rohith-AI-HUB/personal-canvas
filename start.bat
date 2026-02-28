@echo off
setlocal enabledelayedexpansion
echo Starting Personal AI Knowledge Canvas...

:: Start Qdrant in the background
echo [1/4] Starting Qdrant vector database...
docker compose up -d qdrant 2>nul
if errorlevel 1 (
  echo WARNING: Docker/Qdrant not available. Vector search will be disabled.
)

:: Wait for Qdrant to be healthy (up to 30s)
echo [2/4] Waiting for Qdrant to be ready...
set QDRANT_READY=0
for /L %%i in (1,1,15) do (
  if !QDRANT_READY!==0 (
    curl -sf http://127.0.0.1:6333/readyz >nul 2>&1 && set QDRANT_READY=1
    if !QDRANT_READY!==0 timeout /t 2 /nobreak >nul
  )
)
if !QDRANT_READY!==1 (
  echo   Qdrant is ready.
) else (
  echo   WARNING: Qdrant did not respond in time. Continuing anyway.
)

:: Build backend (fast incremental compile, ~5s)
echo [3/4] Building backend...
cd /d %~dp0backend
call npm run build >nul 2>&1
if errorlevel 1 (
  echo WARNING: Build failed, attempting to use existing dist...
)
cd /d %~dp0

:: Start backend using compiled JS (fast: no tsx transpilation overhead)
echo [4/4] Starting backend and frontend servers...
start "PAKC Backend" cmd /k "cd /d %~dp0backend && node dist/server.js"

:: Give backend a moment to bind its port
timeout /t 3 /nobreak >nul

:: Start frontend
start "PAKC Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo App starting up...
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:3001
echo   Qdrant:   http://localhost:6333
echo.
echo Close the opened terminal windows to stop the servers.
