# Reticle: comprobación local

Reticle está configurado para desarrollo. El simulador instrumentado usa
`http://127.0.0.1:5173/simulator/` y envía sus peticiones `/api` al backend local
de `127.0.0.1:8000`. La extensión conserva el simulador habitual del puerto 8000.
No se modifican la CSP del backend ni los permisos de Chrome.

## Arranque en Windows

Desde la carpeta del proyecto:

1. Actualiza dependencias con `npm.cmd ci`.
2. Inicia el backend en una ventana de PowerShell y déjala abierta:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
   ```

3. En otra ventana, inicia Reticle:

   ```powershell
   npx.cmd @reticlehq/server@3.9.0 serve
   ```

4. En otra ventana, inicia el simulador instrumentado:

   ```powershell
   npm.cmd run dev
   ```

5. Abre `http://127.0.0.1:5173/simulator/`. Comprueba la conexión con
   `npx.cmd @reticlehq/server@3.9.0 status`.

El daemon debe arrancar antes del servidor de desarrollo para compartir la
credencial local. Si cambia, reinicia `npm.cmd run dev`.

Si necesitas otro puerto para Reticle, establece el mismo `RETICLE_PORT` al
arrancar ambos procesos. En entornos con carpeta de usuario de solo lectura,
`RETICLE_STATE_DIR` y `RETICLE_PAIRING_TOKEN_DIR` deben apuntar a una carpeta
temporal escribible en ambos procesos. No compartas la credencial que contiene.

## Alcance

El servidor instrumentado escucha solo en loopback. Su proxy traduce únicamente
los orígenes `http://127.0.0.1:5173` y `http://localhost:5173` al del backend; los orígenes ajenos siguen
rechazándose. Reticle registra cuerpos de red en este simulador de desarrollo.
Usa datos de prueba. Los registros locales `.reticle/` quedan fuera de Git.

`npm.cmd run dev` carga Reticle. `npm.cmd run build` genera la extensión sin él.

Solo se comprobó el simulador local; ALEKS real sigue pendiente.
Resultados y límites de la prueba: [VALIDACION.md](VALIDACION.md#integración-de-reticle-para-desarrollo-8-de-noviembre).
