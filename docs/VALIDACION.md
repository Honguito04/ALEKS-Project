# Validación ejecutada

Fecha: 20 de octubre de 2026. Entorno Linux, Python 3.12.14, Node 24.19.0 y Chromium 154 administrado.

| Comprobación | Resultado observado |
| --- | --- |
| `bash scripts/setup.sh` | Correcta, incluida reinstalación con lockfiles y conservación de `.env` existente |
| TypeScript + `npm run build` | Correctos; `dist/` incluye manifest MV3, panel, opciones, worker modular y content script IIFE |
| `npm test` | **30 pasadas**: 20 del controlador y 10 de fronteras de mensajes del worker |
| `.venv/bin/python -m pytest backend/tests -q` | **49 pasadas**, ninguna omitida; una advertencia de deprecación Starlette/httpx en el cliente de pruebas |
| `npm run test:e2e` | **60 pasadas**, ninguna omitida: 10 del simulador, 36 del diagnóstico de editor y 14 del lector de enunciados |
| `pip check` | Sin dependencias incompatibles |
| Sintaxis Python | `compileall` correcto |

La secuencia del navegador resolvió y consiguió **diez aceptaciones de diez envíos**, sin intervención entre ejercicios: fracciones, decimales exactos, porcentaje, proporción, ecuación lineal, cuadrática, restricción de denominador, alternativa única, redondeo y raíces irracionales. La calificación del simulador usa un oráculo de respuestas original separado del motor.

Las otras cinco pruebas de navegador verificaron vista previa sin escritura, detener durante una respuesta remota tardía, recarga y recuperación sin repetir una entrega, cambio de actividad durante el cálculo y sesión perdida/verificación humana. Las pruebas unitarias añaden revocación de permisos, errores de red, ambigüedad, rechazo de respuesta, límite temporal/de llamadas, dominio/actividad fuera de autorización y bloqueo de mensajes desde páginas/marcos ajenos. El backend prueba gramática no ejecutable, dominio, formato, múltiples soluciones, raíces excluidas y redondeo exacto cerca de un empate.

La ampliación de cilindros añade cuatro pruebas de navegador: secuencia con **dos aceptaciones** que exige número y unidad cúbica, vista previa sin modificar ninguno, cambio manual del número antes de entregar y cambio manual de unidad antes de entregar. El motor comprueba la regresión r=2 cm, h=18 cm, pi=3,14: resultado exacto 5652/25, salida redondeada **226 cm³**. También se rechazan altura no confirmada como perpendicular, dimensiones incompatibles/no positivas, pi ausente y unidad de área o longitud. La idempotencia incluye número y unidad sin colisiones de concatenación.

Las cinco pruebas de fragmentos comprueban atributos observados (`Answer Editor`, `Centímetros cúbicos` y etiqueta «Entregar»), independencia de IDs dinámicos y ausencia de escritura/clics, bloqueo de operaciones reales y detección de controles ocultos, duplicados y deshabilitados. Se ejecutan contra un fixture desidentificado derivado del HTML proporcionado, sin scripts o assets remotos. **No son pruebas sobre la interfaz autenticada en vivo.**

Las catorce pruebas adicionales sobre el nuevo contenedor leen **226 cm³** de los spans visuales con `aria-hidden`, incluso con el buffer del input vacío o distinto, y reconocen el botón completo de Entregar aportado por el usuario. Se comprueba que no ocurren eventos de escritura/clic y que el adaptador sigue bloqueado para operaciones reales. Se rechazan cm², un 3 en la misma línea, tokens extra, glifos recortados/ocultos, editores duplicados y botones con ID/etiqueta distintos, ocultos, duplicados o deshabilitados. Las posiciones son las del fragmento aportado; se evalúa su relación geométrica y no se interactúa mediante coordenadas.

Siete pruebas del nuevo botón `learningCorrect` identifican «Siguiente» sin hacer clic, declarar aceptación o habilitar el adaptador. También rechazan otra etiqueta/clase, controles ocultos, duplicados y deshabilitados. El fixture solo acredita la estructura de ese botón; no contiene una transición observada de la entrega ni una identidad de ejercicio. No se interpreta el nombre de clase como feedback confirmado.

Diez pruebas del mensaje «Correcta» reconocen la señal positiva aportada junto a Siguiente, y comprueban que no se acredita una entrega de la extensión ni se produce un clic/avance. Se rechazan mensaje oculto, aria-hidden, texto parcial, estilo diferente, estructura no observada, duplicados, ausencia de Siguiente, Siguiente deshabilitado y Entregar simultáneo. La confirmación de que apareció después de enviar 226 cm³ corresponde a la prueba manual reportada por el usuario; el agente no ejecutó esa entrega en ALEKS.

Las catorce pruebas del enunciado usan el fragmento de dados desidentificado en `#algoPrompt`. Comprueban la lectura exacta de texto y MathML sin duplicados, sin contador/título, clics, escritura o solicitudes de red; conservación estructural de fracciones, exponentes y raíces; exclusión de URLs, IDs y anotaciones; huella estable ante cambios ajenos al enunciado y descarte si este cambia durante el hash. Rechazan enunciados ausentes/duplicados, XML inválido, MathML ausente o no admitido, imágenes, tamaños excesivos y declaraciones de entidades. El diagnóstico permanece separado de un `Exercise` ejecutable y no activa la resolución ni el envío de los dos sucesos.

Dos pruebas unitarias adicionales verifican el origen confirmado `https://latam-awu.aleks.com`: adjuntar el diagnóstico con permiso, rechazar inicio/transporte real y orígenes parecidos con otro sufijo, protocolo o puerto, y retirar su permiso al revocar. Las APIs de permisos están simuladas en estas pruebas; el diálogo nativo de Chrome requiere comprobación manual.

La validación de Google usa firmas RSA reales y certificados de prueba locales, y rechaza firma alterada, emisor/audiencia/caducidad/nonce incorrectos. Se prueban estado OAuth, PKCE de vinculación, códigos caducados/de un uso, revocación y separación demo/Google. No se ha probado el intercambio real con Google.

## Comprobaciones externas pendientes

- **Carga nativa de la extensión en Chrome**: el Chromium administrado devolvió `Loading of unpacked extensions is disabled by the administrator`. No se modificó esa política. Playwright usa un puente exclusivo de pruebas para ejecutar las clases de producción, por lo que no valida las APIs nativas de extensión ni la autorización del navegador.
- **Google con cuenta real**: faltan las credenciales OAuth del propietario y la configuración de su cliente. El botón y flujo están implementados; no se simula una identidad Google.
- **IA en la API externa**: proveedor implementado, sin clave/modelo configurados y sin llamadas facturables ejecutadas. Las interpretaciones de IA quedan sin autorización de envío automático hasta contar con verificación independiente de lectura.
- **ALEKS**: el usuario reportó aceptación manual de 226 cm³ y aportó editor, controles, «Correcta» y un enunciado posterior de probabilidad. Confirmó `latam-awu.aleks.com` como dominio de ejercicios y que el contador puede faltar en actividades normales. Se validaron detección y lectura de texto/MathML sobre fixtures locales; faltan prueba en vivo del código, interpretación verificable, identidad de actividad y correspondencia de campos, escritura reconocida por el editor, asociación automática del resultado al envío y avance comprobado. Cero ejercicios reales leídos automáticamente como ejercicio completo, escritos o enviados por el agente/extensión. El diagnóstico es de solo lectura; el adaptador y el backend impiden envíos reales incluso con una sesión Google.
- **Windows**: instrucciones incluidas; no se ha ejecutado Windows en este entorno.
- **CI de GitHub**: workflow incluido; los resultados anteriores corresponden a esta máquina y no acreditan un resultado remoto.

Esta versión permite probar el recorrido matemático y automático en el simulador. No acredita compatibilidad con un curso o componente de ALEKS ni funciona con Chrome cerrado.
