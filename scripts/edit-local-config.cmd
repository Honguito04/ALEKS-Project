@echo off
setlocal
if not exist "%LOCALAPPDATA%\ALEKS-Project\.env" (
  echo Ejecuta primero scripts\start-web.cmd para preparar el perfil local.
  pause
  exit /b 1
)
echo Despues de guardar, reinicia el servidor para cargar los cambios.
notepad "%LOCALAPPDATA%\ALEKS-Project\.env"
