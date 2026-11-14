@echo off
setlocal
cd /d "%~dp0.."
where git >nul 2>nul
if errorlevel 1 (
  echo Instala Git para Windows para actualizar esta misma carpeta.
  echo Si descargaste un ZIP, consulta la seccion Actualizar en docs\WEB.md.
  goto fail
)
if not exist .git (
  echo Esta carpeta viene de un ZIP o no conserva su historial Git.
  echo No se modifico ningun archivo. Consulta Actualizar en docs\WEB.md.
  goto fail
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 goto fail
set "aleks_update_branch="
for /f "delims=" %%B in ('git branch --show-current') do set "aleks_update_branch=%%B"
if not "%aleks_update_branch%"=="main" (
  echo Esta carpeta no esta en la rama main. No se cambiara de rama automaticamente.
  goto fail
)
git diff --quiet --exit-code
if errorlevel 1 (
  echo Hay cambios locales en archivos del proyecto. Guardalos antes de actualizar.
  goto fail
)
git diff --cached --quiet --exit-code
if errorlevel 1 (
  echo Hay cambios locales preparados para un commit. Guardalos antes de actualizar.
  goto fail
)
where py >nul 2>nul
if errorlevel 1 (
  echo Instala Python 3.12 desde python.org antes de actualizar.
  goto fail
)
py -3.12 scripts\local-web-check.py port
if errorlevel 1 goto fail
echo Actualizando esta carpeta. Se conservan .env y .runtime.
git pull --ff-only origin main
if errorlevel 1 goto fail
call scripts\start-web.cmd
exit /b %errorlevel%
:fail
echo La actualizacion no se completo. Revisa el mensaje anterior.
pause
exit /b 1
