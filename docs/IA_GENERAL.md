# Copiloto local con Ollama para ALEKS

El objetivo es ampliar la cobertura por interpretación del contenido, sin programar una regla para cada enunciado. Una IA multimodal puede trabajar con texto, fórmulas y diagramas. La extensión puede introducir respuestas y pulsar controles, pero necesita comprobar lo que la interfaz registró. Ningún modelo garantiza resolver todos los ejercicios ni manejar cualquier editor.

## Estado actual

La versión **0.2.0** incorpora **Iniciar recorrido automático** y **Responder, verificar y continuar**. Resuelve ejercicios compatibles, escribe la respuesta, pulsa Verificar o Entregar y avanza cuando ALEKS confirma una nueva devolución Correcta asociada a ese envío. Conserva **Resolver con IA local**, **Comprobar Ollama** e **Introducir entero en el recuadro** para consultar o escribir por separado. La consulta no está limitada a las familias matemáticas del simulador: envía texto y, si lo eliges, una captura visible o una imagen adjunta a Ollama en tu computadora. El modelo devuelve una propuesta por campo, unidades y explicación, o indica qué información falta.

El flujo `/assist` y sus tareas de consulta son independientes de `/solve` y no utilizan una clave de OpenAI. `/solve` y el controlador original siguen reservados al simulador; el recorrido ALEKS utiliza un coordinador y un controlador de entrega separados. Cuando necesita al modelo, habla únicamente con `http://127.0.0.1:11434`, exige un modelo descargado sin marcadores cloud/remotos y pide una respuesta JSON acotada, sin JavaScript o selectores ejecutables. El proveedor OpenAI anterior se conserva para el flujo del simulador; no se utiliza en este modo.

Se añadió una comprobación matemática para el formato completo de premios por puestos distintos. Extrae participantes y lista de puestos del enunciado, comprueba que coincidan con el número de premios y calcula las selecciones ordenadas sin repetir participantes. El caso de **4 nadadores y dos puestos da 4 × 3 = 12**, no 6. No consulta al modelo en este formato reconocido y muestra **Resultado comprobado · premios por puestos**. Admite de uno a cinco puestos y hasta mil participantes, únicamente con la estructura textual reconocida; condiciones adicionales o formatos diferentes no reciben esa verificación. No interpreta diagramas mediante esta regla.

Los demás resultados del modelo siguen sin verificación independiente. **Falta información** requiere una lista concreta de datos ausentes. Si el modelo no entrega respuestas ni identifica un dato faltante, se muestra **El modelo no obtuvo una solución utilizable**, sin presentar su explicación como una respuesta disponible para escritura.

**Revisión visual, versión 0.1.2:** las consultas con imagen identifican medidas y solicitan una fórmula numérica por campo. Un proceso acotado comprueba la equivalencia entre fórmula y respuesta con aritmética exacta, fracciones, pi, raíces y redondeo explícito. Si no coinciden, no se publica una respuesta. Si coinciden, una segunda llamada al mismo modelo revisa las etiquetas, dimensiones, huecos, solapamientos y la interpretación del objeto completo. Un rechazo, datos ilegibles o revisión inválida también descartan la respuesta. La explicación pública se construye con las observaciones y cuentas contrastadas; no se reutiliza la prosa numérica libre del modelo.

Este control **no verifica independientemente la geometría, las medidas o las unidades**. El mismo modelo puede equivocarse en las dos pasadas. `gemma3:4b` ya produjo un error en este dibujo y puede necesitar un reemplazo más capaz según la RAM/GPU disponibles. La actualización mejora la detección de contradicciones; no garantiza resolver todos los diagramas. Una salida que no puede representarse en la gramática numérica admitida se descarta, en lugar de presentar una respuesta no comprobada.

La corrección posterior del formato para Qwen conserva ese flujo. Se envía una plantilla JSON con los campos actuales, `think:false` para pedir una respuesta final directa y contexto explícito de 8192 tokens. La descripción libre es opcional; una propuesta sigue necesitando medidas identificadas y una fórmula por campo para superar los controles. Solo se normalizan representaciones equivalentes: un único bloque JSON completo y números JSON convertidos a texto con precisión decimal exacta. No se extraen respuestas de prosa, no se añaden fórmulas ausentes y no se relajan los controles matemáticos o la revisión.

Regresión aportada: en el prisma con hueco, las medidas visibles permiten proponer `13*15*8 - 8*(15-7-7)*8 = 1496 cm³`. La altura del hueco es `15-7-7 = 1 cm`. También coincide la descomposición `13*7*8 + 13*7*8 + (13-8)*(15-7-7)*8`. El modelo había devuelto 180 en la respuesta y 728 al final de la explicación, además de interpretar «de abajo» como solo la parte inferior. «De abajo» se refiere al sólido completo dibujado bajo el enunciado. El agente leyó esa imagen en la conversación y comprobó las cuentas; las pruebas del proveedor usan respuestas simuladas y no demuestran que Gemma obtenga 1496 por sí mismo.

La escritura asistida admite **un entero no negativo de hasta doce dígitos, sin unidad, en un único recuadro vacío compatible y habilitado**. La presencia de botones de fracción, π o unidades no impide introducir un entero. El botón **Introducir entero en el recuadro** solo escribe y no necesita reconocer Verificar. El recorrido automático sí exige un control de envío único, visible y habilitado. Es una tentativa mediante eventos públicos `beforeinput`, `input` y `change`. Solo comunica éxito si vuelve a leer ese entero en el árbol visual. Si ALEKS ignora los eventos, informa el fallo y no pulsa Verificar. No modifica recuadros ocupados ni repite automáticamente la tentativa. Fracciones, unidades y varios recuadros requieren introducción manual por ahora.

Si no puede ofrecer escritura, el panel explica el motivo: recuadro ocupado, deshabilitado, estructura no reconocida, varios recuadros, resultado ya presente o formato de respuesta incompatible, entre otros. Las propuestas que incluyen captura requieren introducción manual, salvo un resultado del comprobador exacto de premios basado únicamente en texto. Esa excepción no habilita un editor incompatible ni respuestas que dependan de un diagrama.

El usuario confirmó Ollama conectado con `gemma3:4b` instalado y reportó su primera respuesta al ejercicio: confundió combinaciones con puestos ordenados y devolvió 6. La corrección añade el cálculo exacto descrito arriba y estados coherentes. El agente no ejecutó un modelo real en esta máquina; las pruebas del proveedor usan transporte simulado y las del editor, escenarios sintéticos. El usuario confirmó posteriormente que su modelo activo es `qwen3-vl:4b`. Sigue pendiente validar la escritura y el recorrido completo en la página real; las pruebas sintéticas no acreditan la calidad general del modelo ni una entrega aceptada en una cuenta real.

La detección de dibujo incluye referencias a figura, imagen, gráfico o diagrama, y el contenedor de figuras ALEKS observado fuera del enunciado. Si no lo detecta, marca **El ejercicio necesita una imagen o dibujo**. Cuando se requiere imagen, el panel y el worker impiden consultar sin ella. Esto evita resolver a partir de texto incompleto; no demuestra que el modelo lea correctamente las medidas de una captura recibida. Las propuestas visuales siguen sin verificación independiente.

## Consulta y recorrido actual

1. **Leer el ejercicio actual.** Recoger enunciado y campos reconocidos. Para dibujos, incluye una captura de toda el área visible de la pestaña activa seleccionada o adjunta una imagen propia. La captura puede contener datos de tu cuenta: la casilla está desmarcada por defecto. Si el lector estructurado no admite el MathML, una imagen permite consultar sin enviar el HTML desconocido.
2. **Consultar el modelo.** Cada consulta individual o ejercicio del recorrido hace una operación, sin reintentos automáticos: cero llamadas en el comprobador textual de premios, una para otras consultas de texto, y hasta dos para imagen (propuesta y revisión). El enunciado y la imagen se tratan como datos, aunque contengan instrucciones dirigidas al asistente.
3. **Recibir una propuesta estructurada.** Respuesta por campo, unidades, formato, explicación y datos que falten. La salida no debe ser JavaScript ni selectores arbitrarios generados por el modelo.
4. **Revisar la propuesta.** Los resultados del modelo se marcan sin verificación independiente; solo el comprobador de premios reconoce su formato exacto como verificado. En imágenes, la cuenta se contrasta por separado y el mismo modelo revisa el dibujo, pero la interpretación sigue sin acreditarse. Si la lectura o el usuario indicó que necesita un dibujo y no incluiste imagen, no se consulta al modelo. La verificación general del problema aún no está implementada para este modo.
5. **Introducirla.** Puedes pulsar el botón de escritura cuando la propuesta y el editor cumplen el formato de entero vacío descrito arriba. Se descarta si cambió el enunciado o el recuadro, y se comprueba la representación visual. Los demás formatos se introducen manualmente.
6. **Verificar y avanzar.** Con **Responder, verificar y continuar**, el recorrido comienza desde esa propuesta. Con **Iniciar recorrido automático**, primero consulta el ejercicio actual. Tras comprobar la escritura, pulsa Verificar o Entregar una vez y espera una devolución nueva Correcta vinculada al envío. Después pulsa Siguiente o Siguiente tema y exige un nuevo enunciado con el recuadro vacío. Siguiente tema puede abrir otro tema; se vuelven a comprobar los controles. El botón independiente Introducir entero en el recuadro sigue dejando la entrega manual.

Se amplía el soporte por **tipos de control**, no por cada problema de natación, cilindros o círculos. Un mismo control de entrada puede servir a muchas familias matemáticas. Los ejercicios que exigen dibujar, mover puntos o manipular gráficos requieren operaciones propias y comprobaciones adicionales.

## Actualizar al recorrido 0.2.0 en Windows

Estos pasos sirven si la extensión, Ollama y el backend ya funcionan en tu computadora. La actualización del recorrido cambia la extensión; conserva la configuración y el modelo que ya utilizas.

1. Descarga [el ZIP de la rama main](https://github.com/Honguito04/ALEKS-Project/archive/refs/heads/main.zip) y extráelo en una carpeta temporal.
2. Dentro de la carpeta extraída, abre **extension**. Copia sus carpetas **src** y **public** dentro de la carpeta **extension** de tu proyecto original. Acepta reemplazar los archivos existentes. Conserva `.env`, `.venv` y `node_modules` de tu proyecto original.
3. Abre otra ventana de PowerShell en la carpeta principal de tu proyecto original, la que contiene `package.json`. Ejecuta y espera a que termine:

   ```powershell
   npm.cmd run build
   ```

   Este comando regenera `dist`; es la carpeta que Chrome carga. Si PowerShell no encuentra npm, abre una ventana nueva después de instalar Node.js conforme a la guía inicial.
4. Mantén funcionando el backend y Ollama. Si el backend está detenido, abre PowerShell en esa misma carpeta principal y ejecuta:

   ```powershell
   $env:AI_PROVIDER = "ollama"
   $env:AI_MODEL = "qwen3-vl:4b"
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
   ```

   Deja esa ventana abierta. Si el backend ya estaba funcionando, continúa con el paso siguiente; no arranques otra copia. `http://127.0.0.1:8000/health` debe abrir en Chrome.
5. Abre `chrome://extensions`, localiza el asistente y pulsa su botón **Recargar**. Comprueba que indique **0.2.0**. Si conserva otra versión, revisa que hayas compilado el proyecto cuya carpeta `dist` cargaste en Chrome.
6. En la pestaña ALEKS pulsa **F5**. Abre el panel con el icono del asistente. Pulsa **Conectar backend y simulador**, entra en demostración si se perdió la sesión del asistente y pulsa **Autorizar sitio ALEKS** si falta el permiso del sitio.
7. Selecciona tu pestaña ALEKS y pulsa **Leer actividad seleccionada**. Comprueba Ollama y abre un ejercicio de texto con un único recuadro vacío. Para la primera comprobación configura **Máximo de respuestas: 1**, **Máximo de minutos: 5** y **Máximo de llamadas IA: 2** en **RECORRIDO AUTOMÁTICO ALEKS**.
8. Pulsa **Iniciar recorrido automático**. Si prefieres consultar primero y mirar la propuesta, usa **Resolver con IA local** y después **Responder, verificar y continuar**. Ambas opciones utilizan los límites del recorrido. Mantén abiertos Chrome, la pestaña y el panel.
9. Observa el estado y el contador de respuestas correctas. Al alcanzar el límite se deja visible la última respuesta aceptada. Para continuar por varios ejercicios, inicia otra sesión desde un ejercicio vacío con el límite que necesites. **Detener recorrido** cancela las operaciones pendientes.

El formato admitido es **un entero no negativo de hasta doce dígitos, sin unidad, en un solo recuadro vacío y habilitado, para un ejercicio que se puede leer como texto y no requiere imagen**. El recorrido se detiene ante fracciones, decimales, unidades, varios recuadros, dibujos o un editor que no refleje los eventos de escritura. Puedes seguir consultando esos ejercicios con la IA e introducir sus resultados manualmente.

El máximo de respuestas admite 1–100 y el de minutos 1–120. Antes de consultar se reservan **dos llamadas IA** del límite, y al recibir el resultado se descuentan las que no se utilizaron. Con menos de dos disponibles no empieza otra resolución, aunque el siguiente ejercicio podría usar solo una o ninguna. Una propuesta ya consultada antes de iniciar no suma llamadas nuevas a ese recorrido. Si la consulta falla sin informar su consumo, se conserva la reserva.

Una devolución anterior de Correcta no autoriza avanzar. Se comprueba la estabilidad del enunciado, la escritura visible, el envío único y una devolución nueva. Una respuesta incorrecta, un resultado ausente o incierto, un cambio inesperado de pestaña o la falta de un siguiente ejercicio reconocible detienen la ejecución. No se prueba otra respuesta ni se repite automáticamente un envío. Si Chrome reinicia la extensión, el recorrido queda detenido para revisar la pestaña antes de empezar otro.

Las pruebas del código simulan la interacción con los fragmentos recibidos. No se ha ejecutado el recorrido en una cuenta real de ALEKS ni un modelo real de Ollama desde este entorno. El primer uso permite comprobar si el editor real acepta los eventos; si no refleja el número, el recorrido se detiene antes de entregarlo.

## Instalación en Windows, conservando tu proyecto

1. Descarga e instala [Ollama para Windows](https://ollama.com/download/windows). Mantén abierta su aplicación. Abre una ventana nueva de PowerShell para que encuentre el comando `ollama`.
2. Comprueba la instalación y descarga un modelo local multimodal. Este ejemplo usa `qwen3-vl:4b`; el rendimiento depende de la memoria y del procesador/GPU de tu computadora. La descarga necesita Internet y espacio en disco; las consultas posteriores usan el modelo local.

   ```powershell
   ollama --version
   ollama pull qwen3-vl:4b
   ollama list
   ```

   Espera a que termine la descarga y comprueba que `qwen3-vl:4b` aparezca en la lista. No uses una variante cloud. Si el comando no aparece después de instalar, cierra PowerShell y abre otra ventana. Si el modelo requiere una versión más reciente de Ollama, actualiza su aplicación desde el instalador oficial y vuelve a intentarlo.
3. Descarga el ZIP actualizado de GitHub y extráelo en otra carpeta. De allí copia **backend** y **extension** completas dentro de tu proyecto original, reemplazando archivos. Esta actualización no agrega dependencias; conserva `.venv`, `node_modules` y tu `.env` original.
4. En el PowerShell donde corre el backend, pulsa **Ctrl+C** para detenerlo. Desde la carpeta original abre `.env`:

   ```powershell
   notepad .env
   ```

   Cambia las líneas existentes o agrega las que falten, dejando una sola copia de cada una:

   ```dotenv
   AI_PROVIDER=ollama
   AI_MODEL=qwen3-vl:4b
   AI_TIMEOUT_SECONDS=180
   ```

   Guarda el archivo. No necesitas una clave de OpenAI ni cambiar la configuración de Google.
5. En esa carpeta, compila y arranca el backend:

   ```powershell
   npm.cmd run build
   ```

   Cuando termine:

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
   ```

   Deja abiertas esa ventana y la aplicación Ollama. No arranques dos copias del backend.
6. En `chrome://extensions`, recarga la tarjeta del asistente. Actualiza ALEKS con **F5**, abre el panel y pulsa **Conectar backend y simulador**. Entra en demostración si no tienes una sesión de la aplicación. Esta sesión también permite las consultas locales; no inicia sesión en ALEKS.
7. Selecciona tu pestaña y pulsa **Leer actividad seleccionada**. En **IA LOCAL / OLLAMA**, pulsa **Comprobar Ollama**. Debe indicar que está conectado y el modelo está instalado. Si falta, comprueba el nombre exacto con `ollama list`; si está desconectado, abre Ollama.
8. Pulsa **Resolver con IA local**. Para diagramas, marca antes la captura y asegúrate de que el ejercicio/dibujo esté visible en la pestaña activa. Para conceder el permiso temporal de captura, pulsa el icono de la extensión sobre esa misma pestaña. Abrir el panel desde el menú lateral de Chrome o elegir otra pestaña en la lista no concede `activeTab`. Si falla, usa **Adjuntar imagen del ejercicio**, descrito abajo; no necesitas conceder acceso a todos los sitios. La primera consulta puede tardar al cargar el modelo. Puedes pulsar **Cancelar operación de IA**. Se mostrará la propuesta o qué información falta; el panel espera como máximo cuatro minutos.
9. Revisa el resultado. Si aparece **Introducir entero en el recuadro**, ese botón intenta escribirlo y leerlo de vuelta. Si no aparece, lee el motivo debajo de **Escritura asistida no disponible**. Por ejemplo, si el recuadro ya tiene una respuesta, vacíalo manualmente y vuelve a consultar. Para entregar esa propuesta e iniciar la continuación, usa **Responder, verificar y continuar**, con los límites del recorrido. Para los formatos no compatibles, introduce y verifica la respuesta manualmente.

Si aparece «Ollama no respondió con una propuesta válida», revisa el modelo instalado y que admita imágenes/JSON; también puede haber agotado el tiempo o los recursos disponibles. Si la escritura no se refleja en el árbol visual, no se declara éxito ni se reintenta. El siguiente ajuste depende del comportamiento real del editor, no de inventar otro selector.

Si Qwen está conectado pero aparece **«el modelo no entregó datos y cuentas coherentes en el formato requerido»**, el mensaje antiguo no permitía distinguir el motivo. El backend actualizado diferencia respuesta vacía, razonamiento sin respuesta final, salida cortada, JSON inválido, campos ausentes y campos con tipo/tamaño incompatible. Es un diagnóstico de formato; no demuestra que la solución matemática fuera incorrecta. El detalle omite el contenido bruto del modelo, valores del ejercicio y nombres de propiedades desconocidas.

**Antecedente de la versión 0.1.2:** la corrección del formato de Qwen modificaba solo el backend. Para recibir esa corrección si aún te falta, copia también **backend** desde el ZIP al proyecto original con el servidor detenido y vuelve a iniciarlo. Para el recorrido actual 0.2.0 actualiza además la extensión y recárgala siguiendo los pasos de arriba; la instrucción antigua de actualizar únicamente el backend no instala el recorrido.

`AI_CONTEXT_TOKENS` es opcional y vale 8192 por defecto (admite 2048–16384). Reserva contexto para enunciado, imagen, formato y salida. Si el modelo no cabe en los recursos disponibles, puede probarse `AI_CONTEXT_TOKENS=4096` en `.env`, reiniciando el backend. Reducirlo deja menos espacio para el ejercicio. La ventana real y el rendimiento en la RTX 3050 siguen requiriendo prueba en el equipo del usuario.

Si ya instalaste Ollama y necesitas esta corrección de cálculo, no descargues de nuevo el modelo. Actualiza **backend** y **extension**, compila, reinicia el backend y recarga la extensión como en los pasos 3 a 7. En el problema de nadadores debe aparecer **12** como resultado comprobado; la capacidad general del modelo continúa necesitando revisión.

La revisión visual introducida en **0.1.2** se conserva en **0.2.0**. Si partes de una versión anterior, actualiza **backend** y **extension**, compila, reinicia el backend y recarga Chrome como se indica en la instalación completa. Las propuestas visuales siguen siendo de introducción manual.

Las dos pasadas visuales comparten como máximo 210 segundos (o dos veces `AI_TIMEOUT_SECONDS` si es menor). El panel espera hasta cuatro minutos para respetar el límite de operaciones prolongadas del worker de Chrome. Si el modelo no termina, se descarta la consulta; no se publica la primera respuesta sin revisar.

## Cambiar de modelo con 16 GB de RAM y RTX 3050 de 6 GB

El usuario confirmó ese equipo después del error de volumen. Se propone probar `qwen3-vl:4b`, orientado a visión; no se afirma que resuelva correctamente todos los ejercicios ni que se haya probado su rendimiento en ese equipo. La descarga ocupa varios GB. Conserva Gemma hasta comprobar el nuevo modelo; no es necesario borrarlo.

1. En otra ventana de PowerShell ejecuta `ollama pull qwen3-vl:4b` y espera a que termine. Comprueba el nombre con `ollama list`. Si Ollama informa que debe actualizarse para usar ese modelo, actualiza la aplicación desde su sitio oficial.
2. En el PowerShell del backend pulsa **Ctrl+C**. En la carpeta del proyecto ejecuta `notepad .env` y cambia solo la línea del modelo a `AI_MODEL=qwen3-vl:4b`. Conserva `AI_PROVIDER=ollama` y `AI_TIMEOUT_SECONDS=180`, sin líneas duplicadas.
3. Guarda y arranca de nuevo el backend con `.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`.
4. En el panel pulsa **Comprobar Ollama**. Debe indicar `qwen3-vl:4b instalado`. Repite la consulta con la imagen actual y revisa las medidas que diga haber leído.
5. Si va muy lento, `ollama ps` permite comprobar cómo se reparte entre GPU y CPU. El rendimiento depende de versión, contexto, imagen y otras aplicaciones abiertas. La primera carga puede tardar más. No cambies a una variante cloud para este flujo local.

## Si Chrome muestra el error de activeTab al capturar

El permiso `activeTab` ya está declarado en la extensión, pero Chrome debe concederlo para esa pestaña a partir de una acción del usuario. La extensión no puede concedérselo a sí misma. Esta actualización muestra una explicación en español y no continúa con una consulta sin la captura que falló. El error no deshabilita permanentemente los controles. Si hay una consulta en curso, pulsa **Cancelar operación de IA** antes de cambiar la imagen.

**Corrección de apertura del panel, introducida en 0.1.1 y conservada en 0.2.0:** la configuración anterior usaba `openPanelOnActionClick:true`. Chromium omite la concesión de `activeTab` en ese recorrido, incluso al pulsar el icono. Ahora se desactiva ese modo y se abre el panel directamente desde `chrome.action.onClicked`, sin esperar operaciones asíncronas. Esa corrección de apertura solo cambiaba la extensión; la revisión visual nueva necesita también el backend actualizado como se indica arriba.

1. Activa la pestaña ALEKS con el ejercicio. En la barra superior de Chrome pulsa el icono del asistente; si está dentro de la pieza de rompecabezas **Extensiones**, abre ese menú y pulsa su nombre.
2. Vuelve al panel, selecciona esa misma pestaña y pulsa **Leer actividad seleccionada**. Marca **Incluir captura visible de la pestaña seleccionada**. Comprueba que el dibujo y sus medidas estén visibles antes de resolver.
3. Si Chrome continúa bloqueando la captura, usa la alternativa por archivo: pulsa **Windows + Mayús + S**, selecciona el enunciado y dibujo completos, abre la notificación de la captura y guárdala como PNG.
4. En el panel pulsa **Adjuntar imagen del ejercicio** y elige ese archivo. Se muestra una vista previa. La elección desmarca la captura directa; el archivo se convierte a JPEG en el navegador y se limita de tamaño antes de enviarlo a Ollama. PNG, JPEG y WebP están admitidos; el archivo original debe ocupar como máximo 10 MB. No se guarda en el historial.
5. Si no apareció un aviso automático de dibujo necesario, marca **El ejercicio necesita una imagen o dibujo**. Pulsa **Resolver con IA local** y compara los valores usados en la explicación con los de la imagen. El modelo aún puede equivocarse.

La imagen adjunta se retira al cambiar el enunciado reconocido o la pestaña seleccionada. Elige siempre una captura del ejercicio actual: la extensión no puede demostrar que un archivo elegido corresponda al dibujo de ALEKS. Los resultados visuales se introducen manualmente; no habilitan escritura o entregas automáticas.

Referencia del protocolo: [API de chat de Ollama](https://docs.ollama.com/api/chat). Este entorno no pudo consultar la documentación o ejecutar el modelo; valida la instalación en tu computadora con el diagnóstico del panel.
