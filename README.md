# Asistente Matemático para ALEKS · MVP

Extensión Chrome Manifest V3, panel lateral en español, backend FastAPI + SymPy y simulador local con diez ejercicios básicos originales y una actividad de volúmenes con unidades.

**El recorrido automático se implementa en el simulador. La integración real con ALEKS está pendiente de validación y sus envíos están deshabilitados.** No se han inventado selectores ni probado una cuenta de ALEKS. Google identifica al usuario de esta aplicación; no inicia sesión en ALEKS.

## Inicio rápido en Windows (PowerShell)

Requisitos: Python **3.12**, Node.js **24**, npm y Chrome **116 o posterior**. El backend debe ejecutarse en el mismo equipo que Chrome. No requiere administrador, componentes nativos de automatización ni cuentas externas para la demostración.

```powershell
git clone https://github.com/Honguito04/ALEKS-Project.git
cd ALEKS-Project
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run build
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log
```

Mantén esa terminal abierta. En Chrome:

1. Abre `chrome://extensions`, activa **Modo de desarrollador**, selecciona **Cargar descomprimida** y elige `dist/`.
2. El ID de desarrollo será `fjjgjakbpjhhegekcjogilmfheaicjge`, gracias a una clave pública fija incluida en el manifest. No se distribuye una clave privada. Si cambias la clave, actualiza `CHROME_EXTENSION_IDS` en `.env` y reinicia el backend.
3. Abre `http://127.0.0.1:8000/simulator/` en otra pestaña. Pulsa el icono de la extensión para abrir su panel lateral.
4. Pulsa **Conectar backend y simulador** y concede el permiso para ese origen. Pulsa **Entrar en demostración**: no representa un acceso real a Google.
5. Actualiza las pestañas, selecciona el laboratorio y pulsa **Leer actividad seleccionada**.
6. Comprueba la pestaña, actividad y límites; pulsa **Autorizar e iniciar**. Por defecto son diez ejercicios, diez minutos y cero llamadas de IA. El simulador se puede completar con el motor determinista.
7. **Pausar**, **Continuar** y **Detener** controlan esa sesión. Una entrega rechazada o incierta exige revisión: no se reenvía automáticamente. **Reiniciar actividad** crea una actividad de prueba nueva.

En **Vista previa** se lee y resuelve un solo ejercicio sin escribir ni enviar. Chrome y la pestaña deben seguir disponibles; cerrar el panel no detiene al controlador, que vive en el content script.

Para probar **volúmenes de cilindros**, usa el enlace «Volúmenes de cilindros con unidades» del laboratorio o abre `http://127.0.0.1:8000/simulator/?activity=cylinder`. Vuelve a leer y autorizar esa actividad. Incluye dos ejercicios originales: el controlador introduce el número y selecciona la unidad cúbica; ambos deben ser aceptados. El selector de esta actividad pertenece al simulador y no representa el editor de ALEKS.

## Linux / entorno de desarrollo en la nube

```bash
bash scripts/setup.sh
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log
```

El script conserva `.env` si ya existe, instala versiones bloqueadas y genera `dist/`. Usa el checkout existente; cada tarea en la nube ya está aislada y no necesita un worktree. Los procesos deben arrancarse de nuevo en cada máquina. El backend en la nube sirve para desarrollar y probar; el navegador de Windows usa su propio backend local en este MVP.

## Autenticación real con Google

1. En Google Cloud, configura la pantalla de consentimiento y un cliente OAuth **Aplicación web**. En pruebas, agrega los usuarios de prueba necesarios.
2. Registra exactamente `http://127.0.0.1:8000/auth/google/callback` como URI de redirección. El cliente propietario debe comprobar que la consola de Google acepte la configuración de loopback para su tipo de cliente; un despliegue público necesita HTTPS y una revisión de orígenes/CSP.
3. Introduce `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `CHROME_EXTENSION_IDS` en `.env` del backend. Reinicia el backend. No introduzcas secretos en la extensión.
4. Usa **Continuar con Google**. Se abre el flujo oficial de autorización mediante `chrome.identity.launchWebAuthFlow`; no se cargan scripts remotos en la extensión. Solo se solicita `openid`, sin Gmail, Drive o acceso a cursos.

El backend guarda estado OAuth con caducidad, nonce y PKCE S256; intercambia el código por HTTPS y verifica firma, emisor, audiencia, caducidad, nonce y `sub` mediante `google-auth`. Se vincula el resultado a la instancia de extensión con otro código de un uso, de 60 segundos, ligado a su propio desafío PKCE. La sesión no viaja en una URL. Se guarda únicamente su hash en SQLite y el token en `chrome.storage.session`, inaccesible a content scripts. Caduca a las ocho horas y se pierde al cerrar el navegador. No se solicitan refresh tokens de Google.

**Cerrar sesión** revoca el token actual; **Desvincular extensión** revoca las sesiones de esa identidad en nuestra aplicación. No modifica la sesión de ALEKS ni revoca un consentimiento Google que quieras gestionar desde tu cuenta Google. El flujo externo completo necesita credenciales reales y una prueba manual en Chrome; las pruebas locales comprueban las defensas OAuth y firmas RSA reales con certificados de prueba.

## Proveedor de IA opcional

```dotenv
AI_PROVIDER=openai
AI_MODEL=nombre-de-un-modelo-disponible-en-tu-cuenta
OPENAI_API_KEY=valor-configurado-solo-en-el-backend
```

Elige un modelo que admita Responses API y salidas estructuradas. No se presupone un nombre o acceso concreto. `OpenAIInterpreter` usa el SDK oficial y `responses.parse(text_format=AIProposal)`, sin herramientas, con esquema cerrado, `store=False`, timeout y sin reintentos automáticos. La interfaz `Interpreter` permite sustituir el proveedor. Esta versión acepta texto; imágenes/visión están fuera del alcance.

El límite de llamadas se reserva antes de cada solicitud de interpretación, también si falla la red. Los ejercicios estructurados del simulador no usan IA. Una interpretación de texto por IA se calcula con SymPy, pero queda **no verificable para envío automático**: comprobar el cálculo no demuestra que el texto se haya interpretado correctamente. Para ampliar ese flujo se necesita evidencia independiente de lectura/interpretación. No se ejecuta código generado por IA.

Destinos externos: gestores de paquetes durante instalación; `accounts.google.com`, `oauth2.googleapis.com` y `www.googleapis.com` para Google; `api.openai.com` si habilitas IA. La comunicación extensión/backend se limita a loopback en desarrollo. En entornos con lista de acceso restringida, agrega solo los destinos necesarios y conserva los ya autorizados.

## Cobertura implementada

| Familia | Cobertura verificable | Entrada del simulador |
| --- | --- | --- |
| Aritmética | Enteros, decimales exactos, fracciones, potencias enteras acotadas, raíces constantes reales | Texto, p. ej. `17/12`, `sqrt(2)` |
| Porcentajes | Porcentaje de una cantidad | Texto numérico; unidad visible fuera del campo |
| Proporciones | `a/b = c/x`, no degeneradas | Texto numérico |
| Lineales | Una variable `x`, grado uno | Texto exacto |
| Cuadráticas | Numerador de grado dos; raíces reales, dominio entero/racional/real, exclusión de denominadores nulos | Texto; varias raíces con `;` |
| Selección única | Una alternativa simbólicamente equivalente y única | Radio observado |
| Volumen de cilindro recto u oblicuo | Radio y altura perpendicular positivos, valor de pi explícito, dimensiones en la misma unidad (mm, cm o m), unidad cúbica verificada | Número y selector de unidad del simulador |
| Formato decimal | 0–8 decimales; redondeo final con mitades alejadas de cero | Texto decimal |

No son compatibles gráficos interactivos, construcción geométrica, OCR, matrices, múltiples campos numéricos, editores matemáticos de ALEKS, soluciones complejas, infinitos conjuntos ni campos de conjunto vacío. En volúmenes se exige la unidad cúbica correspondiente a las dimensiones y se selecciona por separado; en otras familias las unidades se conservan como metadatos. No hay conversión entre unidades o interpretación de unidades arbitrarias. La gramática admite números, `x`, `+ - * / ^` y `sqrt(constante)`; no admite multiplicación implícita o funciones arbitrarias.

## Diseño y seguridad del flujo

- `extension/src/ui.tsx`: panel y configuración; autorización con actividad y límites.
- `background.ts`: permisos, OAuth, transporte al backend y validación de mensajes por origen, pestaña, marco, actividad y presupuesto. No hay `externally_connectable` ni puente de mensajes desde la página.
- `adapters.ts`: contrato tipado, adaptador funcional del simulador y adaptador ALEKS explícitamente pendiente.
- `controller.ts`: máquina de estados, cancelación efectiva, límites y diario persistido **antes** de enviar. Solo avanza al observar aceptación. Un timeout no dispara un nuevo envío.
- `content.ts`: ejecuta en el mundo aislado de la pestaña; una sola instancia/controlador. No depende de un popup ni de temporizadores en el service worker.
- `backend/app/engine.py`: AST con lista cerrada de operaciones; no usa `eval`, `sympify` ni `parse_expr` para entradas no confiables. Cálculos en proceso separado con límite de tres segundos; Linux aplica además CPU/memoria. En Windows se aplica el timeout con terminación del proceso.
- `backend/simulator/`: interfaz original con feedback observable. La calificación usa respuestas originales predefinidas, independientes del solver, y claves de idempotencia.

Estados: `INACTIVO → LEYENDO → RESOLVIENDO → VERIFICANDO → ESCRIBIENDO → ENVIANDO → COMPROBANDO → AVANZANDO`; también `PAUSADO`, `COMPLETADO` y `ERROR`. Al reactivar un content script se observa la página y se pausa para reconciliar el diario; no se reanuda a ciegas. Una entrega pendiente no se repite incluso al pulsar Detener e iniciar en la misma actividad. Una respuesta tardía queda invalidada por cancelación y generación de ejecución.

El backend solo escucha en `127.0.0.1:8000`, valida Host y Origin y acepta los IDs explícitos de la extensión. Nunca extrae cookies o contraseñas de ALEKS. No debe exponerse este servidor local a Internet. Un despliegue público requiere endurecimiento adicional (HTTPS, límites de tráfico, despliegue, configuración del origen y almacenamiento de secretos).

Por defecto se guardan huellas, familia y resultado de verificación durante siete días, sin capturas ni enunciados completos. La extensión guarda los últimos cien eventos y un diario mínimo por pestaña; se elimina al cerrar la pestaña o al borrar el historial. Las calificaciones del simulador caducan a las 24 horas. Los datos de prueba del simulador en `sessionStorage` desaparecen con su sesión de pestaña. **Borrar historial de la aplicación** detiene el trabajo y borra el historial del usuario en backend y los diarios de la extensión; no borra datos de ALEKS.

## Pruebas

```bash
npm run build                 # TypeScript + dos bundles MV3
npm test                      # controlador y fronteras de mensajes
.venv/bin/python -m pytest backend/tests -q
npm run test:e2e              # necesita Chromium instalado; puerto 8000 libre
```

Windows: sustituye `.venv/bin/python` por `.venv\Scripts\python.exe`. Para Playwright configura `CHROMIUM_PATH` con la ruta de tu Chromium/Chrome. `npm run test:e2e` usa el ejecutable `.venv/bin/python` en Linux; en Windows configura `PYTHON_EXECUTABLE=.venv\Scripts\python.exe`. El servidor de pruebas arranca y termina automáticamente. Si instalas el navegador de Playwright por separado, indica su ruta; no es requisito de la extensión para usuarios.

Las pruebas del navegador ejecutan **el adaptador y controlador de producción con el DOM real del simulador y el backend real**. Un puente exclusivo de pruebas sustituye el transporte de Chrome. No se incluye en `dist/`. El navegador administrado de este entorno prohíbe cargar extensiones; estas pruebas no prueban APIs nativas de extensión, permisos del navegador, apertura real del panel ni OAuth externo. No se ha debilitado la CSP del producto para ejecutar las pruebas.

Consulta [docs/VALIDACION.md](docs/VALIDACION.md) para los resultados ejecutados y pendientes, y [docs/PLAN.md](docs/PLAN.md) para criterios y decisiones.

## Integración real con ALEKS y siguientes pasos

`https://latam.aleks.com/login` es el único origen de referencia declarado. Su permiso es opcional, separado del simulador. Al concederlo se puede detectar que el adaptador está pendiente; no se presume una sesión autenticada ni se lee un curso. No hay selectores privados ni navegación/entregas activas.

Para ampliar el adaptador se necesita una muestra autorizada y sin datos personales de la pantalla de un ejercicio: DOM/MathML, campos, control normal de envío, feedback de aceptación/rechazo y avance. Una captura por sí sola no demuestra cómo funcionan los controles. Después habrá que validar lectura, escritura reconocida por la interfaz, detección de sesión, verificación humana y un ejercicio limitado con acceso autorizado. No envíes contraseñas, cookies o credenciales en incidencias.

La captura proporcionada de un cilindro permite comprobar la fórmula, el redondeo y la necesidad de una unidad cúbica. Los fragmentos posteriores incluyen el input `Answer Editor`, los botones accesibles de unidades, el árbol visual con `226`, `cm` y el exponente `3`, y los botones completos «Entregar» y «Siguiente». `aleks-editor.ts` reconoce esos atributos en una inspección de solo lectura, comprobando visibilidad, unicidad y estado habilitado. No depende de los IDs efímeros del editor; para los controles de navegación usa el ID, tipo, clase funcional y etiqueta explícitamente aportados.

Para probar la inspección en la pestaña permitida usa «Autorizar sitio ALEKS para inspección», selecciona la pestaña y pulsa «Leer actividad seleccionada». En el caso documentado el panel muestra **Respuesta visible en el editor: 226 cm³. Aceptación pendiente** y **Botón Entregar identificado**. No hace clic, no escribe y no envía los fragmentos al backend. Actualiza el código, compila con `npm run build` y recarga la extensión descomprimida antes de probar cambios.

La lectura visual se limita al entero y centímetros cúbicos con el árbol plano observado. Comprueba la posición relativa del exponente para distinguir `cm³` de `cm²` o de un `3` en la misma línea, sin usar coordenadas fijas para interactuar. El árbol `ansed_tree` está marcado `aria-hidden` por accesibilidad, pero sus glifos se dibujan; se comprueba su visibilidad CSS. `input.value` no se toma como respuesta completa. La representación visible no acredita aceptación.

Para el botón «Siguiente» se observó `smt_bottomnav_button_input_learningCorrect`, con clase funcional `learningCorrect`. El usuario confirmó que apareció después de entregar manualmente `226 cm³` en el mismo ejercicio, junto al mensaje visible **«Correcta»** (`div` de texto plano, `display: inline-block`, color inline `rgb(57, 108, 41)`). Esto documenta una devolución positiva real reportada por el usuario, no una entrega ejecutada por la extensión.

El diagnóstico reconoce la combinación de un mensaje visible y único con esos atributos y un Siguiente habilitado, sin un Entregar simultáneo. El panel la muestra como **señal positiva observada**. Un color, clase, texto parcial, señal oculta o duplicada no basta. La observación sigue separada del feedback `accepted` del controlador: en una ejecución futura tendrá que asociarse al envío pendiente, actividad y huella actuales, descartando mensajes anteriores. Aún no se ha observado el DOM de rechazo; cualquier estado no reconocido deberá pausar sin reintentar otra respuesta.

Siguen faltando el HTML y la lectura validada del enunciado/actividad, la interacción reconocida por el editor, la asociación automática del feedback al envío y el avance comprobado. El adaptador continúa sin habilitar entregas reales. Las pruebas usan fixtures desidentificados derivados de los fragmentos recibidos; no equivalen a una prueba autenticada en vivo realizada por el agente.

Próximas mejoras: validación del adaptador real, entradas fraccionarias/múltiples observadas, verificación independiente de interpretación por IA y prueba manual de Google/Chrome con credenciales del propietario. No se publica la extensión ni se despliegan servicios externos automáticamente.

Referencias: [permisos Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [panel lateral](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [ciclo MV3](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [OIDC Google](https://developers.google.com/identity/openid-connect/openid-connect), [verificación de tokens](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [SDK oficial OpenAI](https://github.com/openai/openai-python/blob/main/helpers.md). Las páginas de documentación web devolvieron 403 desde esta red; se consultaron las fuentes oficiales accesibles de OpenAI y google-auth en GitHub.
