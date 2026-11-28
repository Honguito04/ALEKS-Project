# Aleks Project

Aleks Project reúne en la web la lectura de ejercicios de ALEKS, la vista previa de las respuestas y el control del recorrido automático. El panel de la extensión abre la web y solicita los permisos de Chrome. El servidor calcula las respuestas y consulta Gemini cuando el ejercicio lo requiere.

## Instalar y abrir en Windows

Necesitas Python **3.12**, Node.js **24** y Chrome de escritorio **116 o posterior**. Descarga el proyecto completo, extráelo y ejecuta este comando en PowerShell desde la carpeta del proyecto:

```powershell
.\scripts\start-web.cmd
```

El iniciador compila la web y la extensión e indica la ruta completa de `dist`. En `chrome://extensions`, activa **Modo de desarrollador**, pulsa **Cargar descomprimida** y selecciona esa carpeta.

1. Abre el panel de la extensión. Pulsa **Autorizar acceso**, concede los permisos que muestra Chrome y elige **Abrir Aleks Project**.
2. Entra en tu cuenta de Aleks Project. Abre ALEKS en otra pestaña del mismo Chrome y elige un ejercicio sin responder.
3. En la web, pulsa **Conectar extensión ALEKS**, selecciona la pestaña y pulsa **Vincular pestaña**.
4. Pulsa **Leer actividad ALEKS** y **Consultar vista previa**. Revisa la propuesta y los límites antes de autorizar el recorrido. Los controles de inicio y detención están en la web.

Consulta la [guía de instalación paso a paso](docs/GUIA_DESDE_CERO.md) y la [guía de automatización](docs/WEB_BRIDGE.md).

## Actualizar y conservar tu cuenta

Detén el servidor anterior con **Ctrl+C**. Si usas Git, ejecuta `scripts\update-web.cmd` en la misma carpeta. Si usas ZIP, extrae la versión nueva en otra carpeta y ejecuta `scripts\start-web.cmd`. El iniciador reutiliza cuentas y configuración de `%LOCALAPPDATA%\ALEKS-Project`.

Recarga la extensión desde la carpeta `dist` indicada por el iniciador. Si Chrome apunta al ZIP anterior, carga el `dist` nuevo. Recarga ALEKS y la web antes de vincular. La versión actual muestra **Web 0.6.0 · Extensión 0.6.0**.

Si necesitas migrar una cuenta anterior al perfil persistente o editar el modelo y la clave del servidor, sigue la [guía de actualización de Windows](docs/WEB.md#actualizar-la-instalacion-local-de-windows).

## Qué admite el recorrido

- Uno o dos recuadros numéricos vacíos con enteros, decimales o fracciones reducidas. La extensión lee cada valor y unidad antes de verificar. Los dos recuadros de una actividad cuentan como un ejercicio.
- Parábolas compatibles con una cuadrícula vacía. La extensión confirma los cinco puntos y la curva antes de verificar.
- Unidades fijas o botones reconocidos de cm, cm² y cm³.
- Comprobadores que resuelven algunas plantillas, como la probabilidad de dos lanzamientos de un dado, sin llamar a Gemini.

Para los demás ejercicios, configura `GEMINI_API_KEY` y `GEMINI_MODEL` únicamente en el servidor. En Windows, utiliza `scripts\edit-local-config.cmd` y reinicia el servidor. Los diagramas o formatos de respuesta incompatibles se revisan manualmente. Un recorrido se detiene si cambia el foco, se pierde el vínculo o la entrega queda incierta. [Configuración del servidor](docs/WEB.md)

## Desarrollo y pruebas

Consulta [desarrollo local y despliegue](docs/WEB.md#desarrollo-local). Las pruebas del navegador usan el HTML aportado y un transporte simulado donde corresponde. La compatibilidad con tu sesión de ALEKS se comprueba en tu equipo.

```bash
npm run build
npm run build:web
npm test
.venv/bin/python -m pytest backend/tests -q
npm run test:web
npm run test:e2e
```

En Windows, usa `.venv\Scripts\python.exe` y, si es necesario, configura `PYTHON_EXECUTABLE` para Playwright. Consulta [Reticle en desarrollo](docs/RETICLE.md), [arquitectura](docs/ARQUITECTURA.md) y [resultados de validación](docs/VALIDACION.md).
