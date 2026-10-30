# Asistente Matemático para ALEKS · MVP

Extensión Chrome Manifest V3, panel lateral en español, backend FastAPI + SymPy y simulador local con diez ejercicios básicos originales y una actividad de volúmenes con unidades.

**La versión 0.4.0 añade escritura mediante el teclado de Chrome para el editor que ignora los eventos sintéticos.** El recorrido ALEKS resuelve, escribe, verifica y avanza después de una confirmación nueva de «Correcta». Admite ejercicios de texto con un entero no negativo o una fracción reducida, sin unidad, en un único recuadro vacío compatible (doce dígitos por componente). Diagramas, unidades y varios recuadros requieren intervención manual. Se probaron teclas reales de Chromium contra un editor de prueba; falta comprobar el recorrido en ALEKS real. Google identifica al usuario de esta aplicación; no inicia sesión en ALEKS.

Para usar el nuevo método, actualiza la extensión y marca **Usar teclado de Chrome para esta pestaña**. La versión declara el permiso `debugger`, que Chrome exige para enviar esas teclas y que puede mostrar un aviso al actualizar. La conexión se abre al escribir y se cierra al terminar; Chrome muestra un aviso de depuración mientras está conectada. El código restringe la operación a la respuesta numérica de la pestaña ALEKS seleccionada. Sigue [los pasos de actualización y prueba para Windows](docs/IA_GENERAL.md#actualizar-a-040-en-windows).

¿Es tu primera instalación y no tienes experiencia en programación? Sigue la [guía desde cero para Windows](docs/GUIA_DESDE_CERO.md): incluye descarga, instalación, primera prueba y lectura en ALEKS.

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

Para ALEKS se añade un flujo separado de **copiloto local con Ollama**, sin API de pago: `AI_PROVIDER=ollama`, `AI_MODEL` igual al modelo descargado y `AI_TIMEOUT_SECONDS` para la inferencia local. Permite propuestas generales con captura opcional, escritura asistida de enteros y un recorrido de entrega y avance para el formato textual compatible. Su instalación y límites están en [docs/IA_GENERAL.md](docs/IA_GENERAL.md). Usa tareas con sondeo para no mantener un fetch largo en el worker MV3 y puede cancelarse desde el panel.

El copiloto comprueba por cálculo exacto el formato reconocido de premios por puestos distintos: cuatro participantes y dos puestos dan **12**, porque el orden importa. Ese resultado se identifica como comprobado y no requiere una consulta al modelo. Otras estructuras siguen siendo propuestas sin verificar. El panel distingue datos faltantes concretos de un modelo que no logró producir una solución utilizable.

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

La tabla anterior describe el simulador. El recorrido ALEKS admite únicamente el editor numérico único descrito al inicio. Quedan fuera de la escritura automática los gráficos interactivos, construcción geométrica, OCR, matrices, múltiples campos numéricos, unidades en ALEKS, soluciones complejas, infinitos conjuntos y campos de conjunto vacío. En volúmenes se exige la unidad cúbica correspondiente a las dimensiones y se selecciona por separado; en otras familias las unidades se conservan como metadatos. No hay conversión entre unidades o interpretación de unidades arbitrarias. La gramática admite números, `x`, `+ - * / ^` y `sqrt(constante)`; no admite multiplicación implícita o funciones arbitrarias.

## Diseño y seguridad del flujo

- `extension/src/ui.tsx`: panel y configuración; autorización con actividad y límites.
- `background.ts`: permisos, OAuth, transporte al backend y validación de mensajes por origen, pestaña, marco, actividad y presupuesto. No hay `externally_connectable` ni puente de mensajes desde la página.
- `adapters.ts`: contrato del simulador y lectura de diagnóstico ALEKS. El recorrido ALEKS usa `aleks-automation.ts` y `aleks-submission.ts` por separado; `/solve` sigue reservado al simulador.
- `controller.ts`: máquina de estados, cancelación efectiva, límites y diario persistido **antes** de enviar. Solo avanza al observar aceptación. Un timeout no dispara un nuevo envío.
- `content.ts`: ejecuta en el mundo aislado de la pestaña; una sola instancia/controlador. El recorrido del simulador continúa con el panel cerrado. El recorrido ALEKS recibe fases desde el panel abierto y conserva en la pestaña la vinculación de cada entrega con su devolución.
- `backend/app/engine.py`: AST con lista cerrada de operaciones; no usa `eval`, `sympify` ni `parse_expr` para entradas no confiables. Cálculos en proceso separado con límite de tres segundos; Linux aplica además CPU/memoria. En Windows se aplica el timeout con terminación del proceso.
- `backend/simulator/`: interfaz original con feedback observable. La calificación usa respuestas originales predefinidas, independientes del solver, y claves de idempotencia.

Estados del simulador: `INACTIVO → LEYENDO → RESOLVIENDO → VERIFICANDO → ESCRIBIENDO → ENVIANDO → COMPROBANDO → AVANZANDO`; también `PAUSADO`, `COMPLETADO` y `ERROR`. Al reactivar un content script se observa la página y se pausa para reconciliar el diario; no se reanuda a ciegas. Una entrega pendiente no se repite incluso al pulsar Detener e iniciar en la misma actividad. Una respuesta tardía queda invalidada por cancelación y generación de ejecución.

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

## Recorrido ALEKS 0.4.0

El ejercicio de dos cajas se comprueba exactamente: `4/(1+4) × 3/(9+3) = 1/5`. Este comprobador reconoce la plantilla completa y variantes numéricas, sin llamar a Ollama. Otros problemas siguen usando el modelo. El lector y el escritor admiten fracciones reducidas `a/b`: el usuario confirmó que ALEKS convierte ese texto en una fracción vertical. La extensión exige leer ambos componentes antes de verificar; un `input.value` o el texto literal `1/5` sin conversión no acreditan escritura.

Cuando el modelo no devuelve una respuesta, el recorrido muestra su motivo concreto. **Preparar diagnóstico del editor** y **Copiar diagnóstico** producen un informe acotado de símbolos, posiciones y botones conocidos, sin HTML completo, enlaces de sesión o datos de cuenta. No se otorga acceso genérico a funciones internas de ALEKS.


Si ya tienes la versión 0.3.0, sigue [la actualización paso a paso para Windows](docs/IA_GENERAL.md#actualizar-a-040-en-windows). Esta corrección cambia únicamente la extensión: actualiza `extension/src` y `extension/public`, ejecuta `npm.cmd run build`, recarga la extensión en `chrome://extensions` y actualiza ALEKS con **F5**. Conserva `.env`, `.venv` y `node_modules`; el backend puede seguir funcionando.

1. Abre el ejercicio en `https://latam-awu.aleks.com` y deja vacío su recuadro. En el panel pulsa **Autorizar sitio ALEKS**, selecciona esa pestaña y pulsa **Leer actividad seleccionada**.
2. Comprueba que el backend y Ollama estén disponibles. Entra en demostración o inicia sesión en el asistente; ALEKS utiliza tu sesión propia en su pestaña.
3. Marca **Usar teclado de Chrome para esta pestaña**, cierra DevTools y mantén ALEKS como pestaña activa. En **RECORRIDO AUTOMÁTICO ALEKS**, configura el máximo de respuestas, minutos y llamadas IA. Para la primera comprobación puedes elegir una respuesta, cinco minutos y dos llamadas.
4. Pulsa **Iniciar recorrido automático**. Si ya obtuviste una propuesta compatible con **Resolver con IA local**, puedes comenzar desde ella con **Responder, verificar y continuar**.
5. Mantén abiertos Chrome, la pestaña y el panel. **Detener recorrido** cancela las operaciones pendientes. El panel muestra cuántas respuestas confirmó ALEKS como correctas y el motivo de cualquier detención.

El recorrido comprueba que el enunciado y el editor correspondan a la propuesta, escribe una sola vez y lee el valor representado por el editor. Después pulsa el control conocido **Verificar** o **Entregar** una sola vez. Solo reconoce aceptación cuando aparece una devolución nueva **Correcta**, vinculada a esa entrega, junto con el control de continuación correspondiente. Una observación anterior de Correcta, un color o un botón aislado no confirman el envío actual.

Después de aceptar, pulsa **Siguiente** o **Siguiente tema** y espera un enunciado nuevo con un editor vacío. Siguiente tema puede cambiar de tema; el recorrido vuelve a comprobar el formato del ejercicio que aparezca. Al alcanzar el máximo de respuestas, deja visible la última respuesta correcta. Una respuesta incorrecta, una entrega sin confirmación, un editor incompatible, un diagrama, un fallo de escritura o un cambio inesperado detienen el recorrido. No se ensaya otra respuesta ni se repite la entrega automáticamente. Un reinicio de la extensión tampoco reanuda entregas pendientes.

Cada consulta reserva dos llamadas IA antes de empezar y devuelve al presupuesto las no utilizadas cuando recibe un resultado válido. Es un límite conservador del proveedor: el formato textual reconocido de premios utiliza cero llamadas, otras consultas textuales usan una y el contrato permite hasta dos. Con menos de dos disponibles no empieza otra consulta. Comenzar con una propuesta ya obtenida no hace una nueva llamada al modelo.

`/assist` y las tareas de consulta local alimentan este recorrido. `/solve` y el controlador automático original siguen limitados al simulador. Los diagnósticos de lectura de `adapters.ts` continúan separados de la ejecución ALEKS; **Leer actividad seleccionada** por sí solo inspecciona, mientras que los botones del recorrido autorizan escribir, entregar y avanzar.

Los fragmentos históricos del cilindro, círculo y premios aportaron `#algoPrompt`, los inputs `Answer Editor`, los árboles visuales y los botones completos. `input.value` no acredita la respuesta del editor: se exige su representación visual aunque el input tenga `opacity:0`. «Pregunta 12» no es un requisito. La lectura del círculo puede reconocer fracciones, pi y unidades en sus dos campos, pero esa observación no habilita su escritura automática.

Las pruebas de entrega y avance usan esos fragmentos sin datos personales y respuestas DOM simuladas. La prueba de teclado utiliza eventos confiables de Chromium (`isTrusted`) en un editor que rechaza los eventos sintéticos; simula el puente `chrome.debugger`. No equivale a cargar la extensión ni a una ejecución autenticada en ALEKS o una inferencia real de Qwen. Sigue pendiente comprobar en el equipo del usuario que ALEKS registre esas teclas. Si no refleja la respuesta, la extensión detiene el recorrido antes de entregar.

Referencias: [permisos Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [panel lateral](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), [ciclo MV3](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [OIDC Google](https://developers.google.com/identity/openid-connect/openid-connect), [verificación de tokens](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [SDK oficial OpenAI](https://github.com/openai/openai-python/blob/main/helpers.md). Las páginas de documentación web devolvieron 403 desde esta red; se consultaron las fuentes oficiales accesibles de OpenAI y google-auth en GitHub.
