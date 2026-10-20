# Validación ejecutada

Fecha: 20 de octubre de 2026. Entorno Linux, Python 3.12.14, Node 24.19.0 y Chromium 154 administrado.

| Comprobación | Resultado observado |
| --- | --- |
| `bash scripts/setup.sh` | Correcta, incluida reinstalación con lockfiles y conservación de `.env` existente |
| TypeScript + `npm run build` | Correctos; `dist/` incluye manifest MV3, panel, opciones, worker modular y content script IIFE |
| `npm test` | **25 pasadas**: 17 del controlador y 8 de fronteras de mensajes del worker |
| `.venv/bin/python -m pytest backend/tests -q` | **35 pasadas**, ninguna omitida; una advertencia de deprecación Starlette/httpx en el cliente de pruebas |
| `npm run test:e2e` | **6 pasadas**, ninguna omitida, sobre DOM real y backend real del simulador |
| `pip check` | Sin dependencias incompatibles |
| Sintaxis Python | `compileall` correcto |

La secuencia del navegador resolvió y consiguió **diez aceptaciones de diez envíos**, sin intervención entre ejercicios: fracciones, decimales exactos, porcentaje, proporción, ecuación lineal, cuadrática, restricción de denominador, alternativa única, redondeo y raíces irracionales. La calificación del simulador usa un oráculo de respuestas original separado del motor.

Las otras cinco pruebas de navegador verificaron vista previa sin escritura, detener durante una respuesta remota tardía, recarga y recuperación sin repetir una entrega, cambio de actividad durante el cálculo y sesión perdida/verificación humana. Las pruebas unitarias añaden revocación de permisos, errores de red, ambigüedad, rechazo de respuesta, límite temporal/de llamadas, dominio/actividad fuera de autorización y bloqueo de mensajes desde páginas/marcos ajenos. El backend prueba gramática no ejecutable, dominio, formato, múltiples soluciones, raíces excluidas y redondeo exacto cerca de un empate.

La validación de Google usa firmas RSA reales y certificados de prueba locales, y rechaza firma alterada, emisor/audiencia/caducidad/nonce incorrectos. Se prueban estado OAuth, PKCE de vinculación, códigos caducados/de un uso, revocación y separación demo/Google. No se ha probado el intercambio real con Google.

## Comprobaciones externas pendientes

- **Carga nativa de la extensión en Chrome**: el Chromium administrado devolvió `Loading of unpacked extensions is disabled by the administrator`. No se modificó esa política. Playwright usa un puente exclusivo de pruebas para ejecutar las clases de producción, por lo que no valida las APIs nativas de extensión ni la autorización del navegador.
- **Google con cuenta real**: faltan las credenciales OAuth del propietario y la configuración de su cliente. El botón y flujo están implementados; no se simula una identidad Google.
- **IA en la API externa**: proveedor implementado, sin clave/modelo configurados y sin llamadas facturables ejecutadas. Las interpretaciones de IA quedan sin autorización de envío automático hasta contar con verificación independiente de lectura.
- **ALEKS**: cero ejercicios reales leídos, escritos o enviados. No se dispone de evidencia de su interfaz autenticada. El stub y el backend impiden envíos reales incluso con una sesión Google.
- **Windows**: instrucciones incluidas; no se ha ejecutado Windows en este entorno.
- **CI de GitHub**: workflow incluido; los resultados anteriores corresponden a esta máquina y no acreditan un resultado remoto.

Esta versión permite probar el recorrido matemático y automático en el simulador. No acredita compatibilidad con un curso o componente de ALEKS ni funciona con Chrome cerrado.
