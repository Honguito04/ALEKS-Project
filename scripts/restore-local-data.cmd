@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0.."
set "aleks_previous_folder=%~1"
echo La carpeta anterior debe contener .runtime. Deten antes ambos servidores.
if not defined aleks_previous_folder set /p "aleks_previous_folder=Ruta completa de la carpeta anterior: "
if not defined aleks_previous_folder goto fail
set "aleks_previous_folder=%aleks_previous_folder:"=%"
if not exist .venv\Scripts\python.exe (
  echo Ejecuta primero start-web.cmd para instalar las dependencias y despues deten el servidor.
  pause
  exit /b 1
)
.venv\Scripts\python.exe scripts\local-web-check.py port
if errorlevel 1 goto fail
.venv\Scripts\python.exe scripts\local-web-profile.py --import-from "%aleks_previous_folder%" --prepare-only
if errorlevel 1 goto fail
echo Datos recuperados. Ejecuta start-web.cmd y entra con tu cuenta anterior.
pause
exit /b 0
:fail
echo No se completo la recuperacion. Revisa el mensaje anterior.
pause
exit /b 1
