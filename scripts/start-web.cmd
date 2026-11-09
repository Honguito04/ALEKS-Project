@echo off
setlocal
cd /d "%~dp0.."
where py >nul 2>nul
if errorlevel 1 (
  echo Instala Python 3.12 desde python.org y vuelve a abrir este archivo.
  goto fail
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 24 desde nodejs.org y vuelve a abrir este archivo.
  goto fail
)
if not exist .venv\Scripts\python.exe (
  py -3.12 -m venv .venv
  if errorlevel 1 goto fail
)
.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
if errorlevel 1 goto fail
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto fail
call npm.cmd run build:web
if errorlevel 1 goto fail
if not exist .env copy .env.example .env >nul
set WEB_PUBLIC_MODE=false
set WEB_PUBLIC_URL=http://127.0.0.1:8000
set WEB_DATABASE_URL=
echo Abre http://127.0.0.1:8000/app/ en tu navegador cuando aparezca Application startup complete.
echo Conserva esta ventana abierta. Para detener el servidor pulsa Ctrl+C.
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log
if errorlevel 1 goto fail
exit /b 0
:fail
echo No se pudo iniciar la web. Copia el error que aparece arriba para revisarlo.
pause
exit /b 1
