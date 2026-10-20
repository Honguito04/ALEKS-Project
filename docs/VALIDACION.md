# Validación ejecutada

Fecha: 20 de octubre de 2026. Entorno Linux, Python 3.12.14, Node 24.19.0 y Chromium 154 administrado.

| Comprobación | Resultado observado |
| --- | --- |
| `bash scripts/setup.sh` | Correcta, incluida reinstalación con lockfiles y conservación de `.env` existente |
| TypeScript + `npm run build` | Correctos; `dist/` incluye manifest MV3, panel, opciones, worker modular y content script IIFE |
| `npm test` | **28 pasadas**: 20 del controlador y 8 de fronteras de mensajes del worker |
| `.venv/bin/python -m pytest backend/tests -q` | **49 pasadas**, ninguna omitida; una advertencia de deprecación Starlette/httpx en el cliente de pruebas |
| `npm run test:e2e` | **15 pasadas**, ninguna omitida: 10 del simulador y 5 del diagnóstico sobre fragmentos de editor aportados |
| `pip check` | Sin dependencias incompatibles |
| Sintaxis Python | `compileall` correcto |

La secuencia del navegador resolvió y consiguió **diez aceptaciones de diez envíos**, sin intervención entre ejercicios: fracciones, decimales exactos, porcentaje, proporción, ecuación lineal, cuadrática, restricción de denominador, alternativa única, redondeo y raíces irracionales. La calificación del simulador usa un oráculo de respuestas original separado del motor.

Las otras cinco pruebas de navegador verificaron vista previa sin escritura, detener durante una respuesta remota tardía, recarga y recuperación sin repetir una entrega, cambio de actividad durante el cálculo y sesión perdida/verificación humana. Las pruebas unitarias añaden revocación de permisos, errores de red, ambigüedad, rechazo de respuesta, límite temporal/de llamadas, dominio/actividad fuera de autorización y bloqueo de mensajes desde páginas/marcos ajenos. El backend prueba gramática no ejecutable, dominio, formato, múltiples soluciones, raíces excluidas y redondeo exacto cerca de un empate.

La ampliación de cilindros añade cuatro pruebas de navegador: secuencia con **dos aceptaciones** que exige número y unidad cúbica, vista previa sin modificar ninguno, cambio manual del número antes de entregar y cambio manual de unidad antes de entregar. El motor comprueba la regresión r=2 cm, h=18 cm, pi=3,14: resultado exacto 5652/25, salida redondeada **226 cm³**. También se rechazan altura no confirmada como perpendicular, dimensiones incompatibles/no positivas, pi ausente y unidad de área o longitud. La idempotencia incluye número y unidad sin colisiones de concatenación.

Las cinco pruebas de fragmentos comprueban atributos observados (`Answer Editor`, `Centímetros cúbicos` y etiqueta «Entregar»), independencia de IDs dinámicos y ausencia de escritura/clics, bloqueo de operaciones reales y detección de controles ocultos, duplicados y deshabilitados. Se ejecutan contra un fixture desidentificado derivado del HTML proporcionado, sin scripts o assets remotos. **No son pruebas sobre la interfaz autenticada en vivo.**

La validación de Google usa firmas RSA reales y certificados de prueba locales, y rechaza firma alterada, emisor/audiencia/caducidad/nonce incorrectos. Se prueban estado OAuth, PKCE de vinculación, códigos caducados/de un uso, revocación y separación demo/Google. No se ha probado el intercambio real con Google.

## Comprobaciones externas pendientes

- **Carga nativa de la extensión en Chrome**: el Chromium administrado devolvió `Loading of unpacked extensions is disabled by the administrator`. No se modificó esa política. Playwright usa un puente exclusivo de pruebas para ejecutar las clases de producción, por lo que no valida las APIs nativas de extensión ni la autorización del navegador.
- **Google con cuenta real**: faltan las credenciales OAuth del propietario y la configuración de su cliente. El botón y flujo están implementados; no se simula una identidad Google.
- **IA en la API externa**: proveedor implementado, sin clave/modelo configurados y sin llamadas facturables ejecutadas. Las interpretaciones de IA quedan sin autorización de envío automático hasta contar con verificación independiente de lectura.
- **ALEKS**: se dispone de una captura y fragmentos del editor aportados por el usuario; no de acceso en vivo o evidencia suficiente del valor registrado, control clicable de entrega, feedback y avance. Cero ejercicios reales leídos automáticamente, escritos o enviados. El diagnóstico es de solo lectura; el adaptador y el backend impiden envíos reales incluso con una sesión Google.
- **Windows**: instrucciones incluidas; no se ha ejecutado Windows en este entorno.
- **CI de GitHub**: workflow incluido; los resultados anteriores corresponden a esta máquina y no acreditan un resultado remoto.

Esta versión permite probar el recorrido matemático y automático en el simulador. No acredita compatibilidad con un curso o componente de ALEKS ni funciona con Chrome cerrado.
