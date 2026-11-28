# Conectar la web con ALEKS en Chrome

La web conserva tu cuenta y consulta la IA del servidor. La extensión conecta sus controles con la pestaña ALEKS que tú autorices. No introduce la contraseña de ALEKS ni inicia su sesión: debes abrir ALEKS e iniciar sesión por tu cuenta.

La automatización requiere **Chrome de escritorio 116 o posterior**, la extensión cargada y la pestaña ALEKS disponible en el mismo equipo. Un celular puede usar la demo web para consultar ejercicios, pero no cargar esta extensión ni automatizar ALEKS. Cerrar o suspender el navegador interrumpe la conexión; ningún recorrido se reanuda automáticamente después de reiniciar.

## Actualización de versiones

Desde 0.5.1 la conexión muestra **Web 0.5.9 · Extensión 0.5.9** y comprueba también el adaptador cargado en ALEKS. Una versión distinta se detiene antes de consultar o escribir, con instrucciones para recargar el componente antiguo. Después de actualizar el proyecto, compila con `scripts\start-web.cmd` o actualiza y compila con `scripts\update-web.cmd`. Recarga la extensión desde la carpeta `dist` indicada por el iniciador y después las pestañas de ALEKS y la web. Los recorridos detenidos no se reanudan automáticamente.

## Primera prueba en Windows

1. Instala Python 3.12, Node.js 24 y Chrome. Descarga o actualiza este repositorio conservando tu archivo `.env`.
2. Abre `scripts\start-web.cmd` con doble clic. Instala dependencias, compila la web y genera `dist/` con permiso para **una sola web local**: `http://127.0.0.1:8000`. Conserva esa ventana abierta.
3. En Chrome abre `chrome://extensions`, activa **Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona la carpeta `dist` del proyecto. Si ya estaba instalada, pulsa su botón **Recargar**. El ID de desarrollo esperado es `fjjgjakbpjhhegekcjogilmfheaicjge`.
4. Abre `http://127.0.0.1:8000/app/` en ese mismo Chrome e inicia sesión en la web. Abre otra pestaña con el sitio ALEKS compatible y entra en tu cuenta allí.
5. Abre el panel de la extensión desde su icono. Pulsa **Autorizar conexión con la web** y concede el permiso solicitado. Pulsa **Autorizar sitio ALEKS** y concede también ese acceso. Un botón de la página web no puede conceder estos permisos por ti.
6. Vuelve a la web y conecta la extensión. Comprueba la pestaña y el ejercicio seleccionado antes de consultar o iniciar un recorrido. Mantén ALEKS como pestaña activa cuando deba escribir. Chrome puede mostrar un aviso de depuración mientras el teclado está conectado.
7. Para la primera ejecución usa **1 ejercicio, 5 minutos y 2 llamadas IA**. Lee la actividad, consulta la vista previa y revisa su propuesta. Marca las casillas de teclado y autorización; pulsa **Autorizar e iniciar recorrido**. **Detener recorrido ALEKS** cancela lo pendiente; una consulta ya enviada al proveedor puede haber consumido cuota.

El inicio local no publica la web. La computadora debe seguir encendida para servirla. Consulta [WEB.md](WEB.md) para la instalación del servidor en Internet.

## Qué puede hacer el recorrido

El flujo reutiliza las comprobaciones de la extensión: leer el enunciado, consultar al backend con la cuenta web, escribir, leer la respuesta representada por el editor, pulsar el control conocido de verificación una sola vez, esperar una devolución nueva **Correcta** y avanzar a otro ejercicio mediante los controles compatibles. Aplica los límites de ejercicios completos, tiempo y llamadas de IA: dos respuestas de un ejercicio cuentan como un ejercicio. Una respuesta incorrecta, un cambio inesperado, un formato incompatible o una entrega incierta detienen el recorrido; no se ensaya otra respuesta automáticamente.

La vista previa es una consulta manual: consume cuota de la cuenta y aparece en las llamadas de la conexión. El presupuesto del recorrido limita las nuevas consultas iniciadas durante ese recorrido; reserva hasta dos llamadas por resolución y ajusta el consumo al recibir el resultado. Reutilizar la propuesta vigente no vuelve a consultar. Si la conexión se interrumpe antes de confirmar el consumo, se muestra como incierto, sin afirmar que se gastaron cero llamadas.

Al alcanzar un límite no se pulsa Siguiente. Para otro recorrido, avanza manualmente en ALEKS, vuelve a leer desde la web y autoriza nuevos límites. Reconectar no recupera automáticamente una entrega ni vuelve a enviarla. La sesión de Chrome conserva las huellas ya enviadas por pestaña para impedir duplicados. Hay una vinculación por sesión web: conectar desde otra pestaña web con la misma sesión revoca el vínculo anterior. Varias pestañas ALEKS pueden estar abiertas; solo actúa sobre la vinculada.

La escritura automática admite uno o dos recuadros numéricos vacíos, con una respuesta por campo y lectura de ambos antes de verificar: entero, decimal no negativo o fracción reducida, con doce dígitos por componente. Los sufijos fijos, como `hora(s)`, conservan sus comprobaciones originales. En uno o dos recuadros permite seleccionar cm, cm² o cm³ mediante sus botones y exige leer el número y su unidad en cada campo. El recorrido automático se detiene ante gráficos incompatibles, más de dos recuadros, otras unidades interactivas o respuestas de formato arbitrario. Adjuntar una imagen en la demo conserva el flujo de consulta y revisión visual; no habilita un recorrido automático sobre diagramas.

La versión 0.5.3 reconoce la tabla aportada de dos filas con `P(A) =` y `P(B) =`: contrasta la etiqueta de cada input con el MathML de su fila, sin depender de los IDs dinámicos. La vista previa muestra cada resultado junto al suceso correspondiente. Si el enunciado pide explícitamente la probabilidad de cada suceso y faltan sus recuadros, la consulta conserva los resultados separados, pero la autorización indica el motivo del bloqueo. Las etiquetas incompatibles o un cambio de identidad durante la escritura impiden entregar. Otros diseños de tabla necesitan su propio HTML para adaptar y probar el reconocimiento.

La versión 0.5.4 abrevia la etiqueta de cada valor en la vista previa: `P(A): 13/18` y `P(B): 1/2`. El panel lateral identifica ambos valores y llama «ejercicios» al límite de entregas: los dos recuadros de una actividad cuentan como un ejercicio completo.

Desde 0.5.5, la plantilla de dos lanzamientos de un dado se calcula sin consultar la IA cuando el texto y los dos sucesos se reconocen. El cálculo enumera los 36 pares de lanzamientos y cuenta una sola vez cada par que satisface un suceso. Por ejemplo, «divisible entre 2 o 6 (o ambos)» da 18 de 36, o 1/2.

Desde 0.5.6, la lectura reconoce el exponente separado que ALEKS usa después de un grupo entre paréntesis, como en `y = (x + 5)^2 + 1`. Al leer una instrucción de graficar y una ecuación de la forma `y = …`, muestra el enunciado y clasifica la respuesta como puntos y trazo manual en la cuadrícula. Si falla la lectura, el aviso indica el motivo detectado. La prueba local utiliza el MathML del fragmento aportado.

En 0.5.7, **Consultar vista previa** calcula el vértice y cuatro puntos sin captura ni llamadas al modelo cuando reconoce la plantilla completa y la ecuación en forma de vértice con coeficientes enteros. Muestra el vértice primero y los pasos para dibujar la curva en ALEKS. Los ejercicios con datos de un diagrama siguen requiriendo captura.

Desde 0.5.8, cuando la vista previa de la parábola está comprobada y la cuadrícula es compatible y está vacía, aparece **Dibujar parábola en ALEKS**. Chrome activa esa pestaña y pulsa el lápiz, los cinco puntos y la curva. La extensión confirma cada punto y el trazo en el SVG. Mantén esa pestaña visible y cierra el inspector antes de dibujar. Pulsa **Verificar** en ALEKS para entregar. Si el dibujo se interrumpe, revisa la cuadrícula y vacíala antes de leer y consultar de nuevo.

Con el inspector cerrado, lee una cuadrícula vacía y consulta la vista previa. Cuando se confirmen los cinco puntos a partir de la ecuación, marca **Autorizo dibujar, verificar y avanzar** y pulsa **Autorizar e iniciar recorrido**. Esa casilla incluye el permiso para usar los controles nativos de Chrome. La captura es opcional para este cálculo. La extensión confirma los cinco puntos y la curva antes de pulsar **Verificar**. Usa **1 ejercicio** para probar la entrega sin avanzar. **Dibujar parábola en ALEKS** permite dibujar y pulsar **Verificar** manualmente. Los clics se vinculan al documento de la pestaña autorizada.

**Resultado comprobado** identifica un comprobador matemático independiente admitido. **Propuesta de IA sin verificar** no acredita que el proveedor haya entendido o resuelto bien el problema; la revisión visual o aritmética de una propuesta no convierte la lectura en evidencia independiente. ALEKS es quien califica una entrega.

Las pruebas automáticas usan fixtures de ALEKS y APIs simuladas donde corresponde. No equivalen a una ejecución con una cuenta ALEKS real, una extensión instalada manualmente o una llamada real a Gemini. Consulta los resultados y límites en [VALIDACION.md](VALIDACION.md).

## Frontera de seguridad

El worker valida el origen exacto, la pestaña web y su documento principal. El protocolo solo admite conectar, listar pestañas, vincular, leer, consultar vista previa, iniciar con límites, detener, consultar estado y desvincular. Rechaza campos adicionales, JavaScript, selectores y URLs enviados por la web. Cada entrega usa la pestaña vinculada, la huella leída y el identificador del recorrido; el teclado conserva sus comprobaciones de foco, editor y token de un uso.

La web obtiene una capacidad temporal mediante su sesión y CSRF. El backend guarda únicamente su hash, limita su vigencia a una hora o al vencimiento de la sesión y la revoca al salir o eliminar la cuenta. Una revocación tardía solo afecta a su capacidad exacta. El token permite consultar IA, no administrar cuentas. El diario de entregas conserva huellas y contadores; no guarda enunciados, respuestas ni claves de IA.

## Usar una web HTTPS publicada

Cada compilación permite un origen web exacto. Después de configurar el servidor según [WEB.md](WEB.md), sustituye `https://tu-demo.onrender.com` por su dirección HTTPS real, sin `/app/`, parámetros ni fragmentos. Desde PowerShell, en la carpeta del proyecto:

```powershell
$env:BRIDGE_WEB_ORIGIN = "https://tu-demo.onrender.com"
Remove-Item Env:BRIDGE_ALLOW_LOCAL -ErrorAction SilentlyContinue
npm.cmd ci
npm.cmd run build
```

En Chrome recarga la extensión desde `chrome://extensions` y vuelve a conceder el acceso a la web mediante **Autorizar conexión con la web**. Abre `https://tu-demo.onrender.com/app/`, inicia sesión y conecta la extensión. Configura en el servidor `WEB_PUBLIC_URL` con ese mismo origen y `WEB_BRIDGE_EXTENSION_ID` con el ID permitido de la extensión (`fjjgjakbpjhhegekcjogilmfheaicjge` con la clave de desarrollo incluida). Cambiar de dirección web requiere recompilar y recargar: ninguna página puede elegir un servidor alternativo mediante un mensaje.

`BRIDGE_WEB_ORIGIN` es una dirección pública, no una clave. Los secretos de PostgreSQL y Gemini permanecen exclusivamente en el backend; no se incluyen en variables `VITE_*`, la extensión, la URL o este archivo. No se permiten comodines ni páginas de terceros. Aunque un permiso de Chrome pueda abarcar más puertos del mismo host, el puente comprueba el origen completo en ejecución.

Para compilar el modo anterior, sin conexión externa a una web:

```powershell
Remove-Item Env:BRIDGE_WEB_ORIGIN -ErrorAction SilentlyContinue
Remove-Item Env:BRIDGE_ALLOW_LOCAL -ErrorAction SilentlyContinue
npm.cmd run build
```

Sin `BRIDGE_WEB_ORIGIN`, el manifiesto generado no contiene `externally_connectable`. La extensión conserva los controles y el simulador locales de las versiones anteriores.
