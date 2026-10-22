# Copiloto local con Ollama para ALEKS

El objetivo es ampliar la cobertura por interpretación del contenido, sin programar una regla para cada enunciado. Una IA multimodal puede trabajar con texto, fórmulas y diagramas. La extensión puede introducir respuestas y pulsar controles, pero necesita comprobar lo que la interfaz registró. Ningún modelo garantiza resolver todos los ejercicios ni manejar cualquier editor.

## Estado actual

La extensión reconoce un recuadro sin exigir unidades y añade **Resolver con IA local**, **Comprobar Ollama** e **Introducir entero en el recuadro**. La consulta no está limitada a las familias matemáticas del simulador: envía texto y, si lo eliges, una captura visible o una imagen adjunta a Ollama en tu computadora. El modelo devuelve una propuesta por campo, unidades y explicación, o indica qué información falta.

El nuevo flujo `/assist` es independiente de `/solve` y no utiliza una clave de OpenAI. Cuando necesita al modelo, habla únicamente con `http://127.0.0.1:11434`, exige un modelo descargado sin marcadores cloud/remotos y pide una respuesta JSON acotada, sin JavaScript o selectores ejecutables. El proveedor OpenAI anterior se conserva para el flujo del simulador; no se utiliza en este modo.

Se añadió una comprobación matemática para el formato completo de premios por puestos distintos. Extrae participantes y lista de puestos del enunciado, comprueba que coincidan con el número de premios y calcula las selecciones ordenadas sin repetir participantes. El caso de **4 nadadores y dos puestos da 4 × 3 = 12**, no 6. No consulta al modelo en este formato reconocido y muestra **Resultado comprobado · premios por puestos**. Admite de uno a cinco puestos y hasta mil participantes, únicamente con la estructura textual reconocida; condiciones adicionales o formatos diferentes no reciben esa verificación. No interpreta diagramas mediante esta regla.

Los demás resultados del modelo siguen sin verificación independiente. **Falta información** requiere una lista concreta de datos ausentes. Si el modelo no entrega respuestas ni identifica un dato faltante, se muestra **El modelo no obtuvo una solución utilizable**, sin presentar su explicación como una respuesta disponible para escritura.

La escritura asistida admite **un entero no negativo de hasta doce dígitos, sin unidad, en un único recuadro vacío compatible y habilitado**. La presencia de botones de fracción, π o unidades no impide introducir un entero. Tampoco necesita reconocer Verificar, porque no lo utiliza para escribir. Es una tentativa mediante eventos públicos `beforeinput`, `input` y `change`. Solo comunica éxito si vuelve a leer ese entero en el árbol visual. Si ALEKS ignora los eventos, informa el fallo y no pulsa Verificar. No modifica recuadros ocupados ni repite automáticamente la tentativa. Fracciones, unidades y varios recuadros requieren introducción manual por ahora.

Si no puede ofrecer escritura, el panel explica el motivo: recuadro ocupado, deshabilitado, estructura no reconocida, varios recuadros, resultado ya presente o formato de respuesta incompatible, entre otros. Las propuestas que incluyen captura requieren introducción manual, salvo un resultado del comprobador exacto de premios basado únicamente en texto. Esa excepción no habilita un editor incompatible ni respuestas que dependan de un diagrama.

El usuario confirmó Ollama conectado con `gemma3:4b` instalado y reportó su primera respuesta al ejercicio: confundió combinaciones con puestos ordenados y devolvió 6. La corrección añade el cálculo exacto descrito arriba y estados coherentes. El agente no ejecutó un modelo real en esta máquina; las pruebas del proveedor usan transporte simulado y las del editor, escenarios sintéticos. Sigue pendiente validar la escritura en la página real; esta comprobación no acredita la calidad general del modelo ni una entrega aceptada.

La detección de dibujo incluye referencias a figura, imagen, gráfico o diagrama, y el contenedor de figuras ALEKS observado fuera del enunciado. Si no lo detecta, marca **El ejercicio necesita una imagen o dibujo**. Cuando se requiere imagen, el panel y el worker impiden consultar sin ella. Esto evita resolver a partir de texto incompleto; no demuestra que el modelo lea correctamente las medidas de una captura recibida. Las propuestas visuales siguen sin verificación independiente.

## Flujo que requiere el agente general

1. **Leer el ejercicio actual.** Recoger enunciado y campos reconocidos. Para dibujos, incluye una captura de toda el área visible de la pestaña activa seleccionada o adjunta una imagen propia. La captura puede contener datos de tu cuenta: la casilla está desmarcada por defecto. Si el lector estructurado no admite el MathML, una imagen permite consultar sin enviar el HTML desconocido.
2. **Consultar el modelo.** Una consulta local por pulsación, sin reintentos automáticos. El enunciado y la imagen se tratan como datos, aunque contengan instrucciones dirigidas al asistente.
3. **Recibir una propuesta estructurada.** Respuesta por campo, unidades, formato, explicación y datos que falten. La salida no debe ser JavaScript ni selectores arbitrarios generados por el modelo.
4. **Revisar la propuesta.** Los resultados del modelo se marcan sin verificación independiente; solo el comprobador de premios reconoce su formato exacto como verificado. Si la lectura o el usuario indicó que necesita un dibujo y no incluiste imagen, no se consulta al modelo. La verificación matemática general aún no está implementada para este modo.
5. **Introducirla.** Puedes pulsar el botón de escritura cuando la propuesta y el editor cumplen el formato de entero vacío descrito arriba. Se descarta si cambió el enunciado o el recuadro, y se comprueba la representación visual. Los demás formatos se introducen manualmente.
6. **Verificar en ALEKS.** Revisa el contenido y pulsa Verificar tú mismo. El copiloto no entrega ni avanza. El recorrido autónomo de envío/devolución/avance sigue pendiente; «Siguiente tema» no equivale a otro ejercicio del mismo tema.

Se amplía el soporte por **tipos de control**, no por cada problema de natación, cilindros o círculos. Un mismo control de entrada puede servir a muchas familias matemáticas. Los ejercicios que exigen dibujar, mover puntos o manipular gráficos requieren operaciones propias y comprobaciones adicionales.

## Instalación en Windows, conservando tu proyecto

1. Descarga e instala [Ollama para Windows](https://ollama.com/download/windows). Mantén abierta su aplicación. Abre una ventana nueva de PowerShell para que encuentre el comando `ollama`.
2. Comprueba la instalación y descarga un modelo local multimodal. Este ejemplo usa `gemma3:4b`; el rendimiento depende de la memoria y del procesador/GPU de tu computadora. La descarga necesita Internet y espacio en disco; las consultas posteriores usan el modelo local.

   ```powershell
   ollama --version
   ollama pull gemma3:4b
   ollama list
   ```

   Espera a que termine la descarga y comprueba que `gemma3:4b` aparezca en la lista. No uses una variante cloud. Si el comando no aparece después de instalar, cierra PowerShell y abre otra ventana.
3. Descarga el ZIP actualizado de GitHub y extráelo en otra carpeta. De allí copia **backend** y **extension** completas dentro de tu proyecto original, reemplazando archivos. Esta actualización no agrega dependencias; conserva `.venv`, `node_modules` y tu `.env` original.
4. En el PowerShell donde corre el backend, pulsa **Ctrl+C** para detenerlo. Desde la carpeta original abre `.env`:

   ```powershell
   notepad .env
   ```

   Cambia las líneas existentes o agrega las que falten, dejando una sola copia de cada una:

   ```dotenv
   AI_PROVIDER=ollama
   AI_MODEL=gemma3:4b
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
9. Revisa el resultado. Si aparece **Introducir entero en el recuadro**, ese botón intenta escribirlo y leerlo de vuelta. Si no aparece, lee el motivo debajo de **Escritura asistida no disponible**. Por ejemplo, si el recuadro ya tiene una respuesta, vacíalo manualmente y vuelve a consultar. La extensión no pulsa **Verificar** ni avanza de tema.

Si aparece «Ollama no respondió con una propuesta válida», revisa el modelo instalado y que admita imágenes/JSON; también puede haber agotado el tiempo o los recursos disponibles. Si la escritura no se refleja en el árbol visual, no se declara éxito ni se reintenta. El siguiente ajuste depende del comportamiento real del editor, no de inventar otro selector.

Si ya instalaste Ollama y necesitas esta corrección de cálculo, no descargues de nuevo el modelo. Actualiza **backend** y **extension**, compila, reinicia el backend y recarga la extensión como en los pasos 3 a 7. En el problema de nadadores debe aparecer **12** como resultado comprobado; la capacidad general del modelo continúa necesitando revisión.

Si **ya aparece 12 como resultado comprobado**, la corrección del bloqueo de escritura solo requiere actualizar la extensión:

1. Descarga el ZIP actualizado del repositorio y extráelo en otra carpeta. Copia su carpeta **extension** dentro de tu proyecto original, reemplazando archivos. Conserva el backend y Ollama funcionando.
2. Abre otra ventana de PowerShell en tu carpeta original y ejecuta `npm.cmd run build`. Espera a que termine.
3. En `chrome://extensions`, pulsa el icono de recarga de la tarjeta del asistente. En ALEKS pulsa **F5** y vuelve a abrir el panel.
4. Con el recuadro de respuesta vacío, pulsa **Leer actividad seleccionada** y **Resolver con IA local**. Si el editor es compatible, aparecerá **Introducir entero en el recuadro**. Púlsalo y comprueba que se vea **12** antes de verificar tú mismo. Si el botón no aparece, el nuevo mensaje indicará qué condición lo impide.

## Si Chrome muestra el error de activeTab al capturar

El permiso `activeTab` ya está declarado en la extensión, pero Chrome debe concederlo para esa pestaña a partir de una acción del usuario. La extensión no puede concedérselo a sí misma. Esta actualización muestra una explicación en español y no continúa con una consulta sin la captura que falló. El error no deshabilita permanentemente los controles. Si hay una consulta en curso, pulsa **Cancelar operación de IA** antes de cambiar la imagen.

1. Activa la pestaña ALEKS con el ejercicio. En la barra superior de Chrome pulsa el icono del asistente; si está dentro de la pieza de rompecabezas **Extensiones**, abre ese menú y pulsa su nombre.
2. Vuelve al panel, selecciona esa misma pestaña y pulsa **Leer actividad seleccionada**. Marca **Incluir captura visible de la pestaña seleccionada**. Comprueba que el dibujo y sus medidas estén visibles antes de resolver.
3. Si Chrome continúa bloqueando la captura, usa la alternativa por archivo: pulsa **Windows + Mayús + S**, selecciona el enunciado y dibujo completos, abre la notificación de la captura y guárdala como PNG.
4. En el panel pulsa **Adjuntar imagen del ejercicio** y elige ese archivo. Se muestra una vista previa. La elección desmarca la captura directa; el archivo se convierte a JPEG en el navegador y se limita de tamaño antes de enviarlo a Ollama. PNG, JPEG y WebP están admitidos; el archivo original debe ocupar como máximo 10 MB. No se guarda en el historial.
5. Si no apareció un aviso automático de dibujo necesario, marca **El ejercicio necesita una imagen o dibujo**. Pulsa **Resolver con IA local** y compara los valores usados en la explicación con los de la imagen. El modelo aún puede equivocarse.

La imagen adjunta se retira al cambiar el enunciado reconocido o la pestaña seleccionada. Elige siempre una captura del ejercicio actual: la extensión no puede demostrar que un archivo elegido corresponda al dibujo de ALEKS. Los resultados visuales se introducen manualmente; no habilitan escritura o entregas automáticas.

Referencia del protocolo: [API de chat de Ollama](https://docs.ollama.com/api/chat). Este entorno no pudo consultar la documentación o ejecutar el modelo; valida la instalación en tu computadora con el diagnóstico del panel.
