# Guía desde cero para Windows

Esta guía está pensada para una persona sin experiencia en programación que todavía no instaló la versión anterior. Asume Windows 10 u 11 y Google Chrome. No necesitas instalar versiones anteriores: la descarga actual incluye los cambios.

Aleks Project lee ejercicios de tu pestaña ALEKS y permite revisar propuestas y autorizar un recorrido desde la web. El panel de Chrome sirve para conceder acceso y abrir la web.

Para una instalación local, abre Chrome en la computadora donde inicies el servidor. Puedes crear una cuenta web y leer la actividad antes de configurar Gemini. Algunas plantillas se calculan sin llamar al proveedor.

**1. Instala los tres programas necesarios**

Usa las páginas oficiales:

| Programa | Qué instalar |
| --- | --- |
| [Google Chrome](https://www.google.com/chrome/) | La versión actual. Si ya lo usas, puedes conservarlo. |
| [Python 3.12.10](https://www.python.org/downloads/release/python-31210/) | En «Files», elige **Windows installer (64-bit)**. Al abrir el instalador, marca **Add python.exe to PATH** y después **Install Now**. |
| [Node.js](https://nodejs.org/en/download) | Elige la versión **24.x LTS** para Windows y el instalador `.msi`. Puedes conservar las opciones predeterminadas; no necesitas instalar herramientas adicionales para compilar módulos nativos. |

Si ya tienes Python 3.12 y Node 24, no necesitas reinstalarlos. Python 3.12.10 es una versión con instalador de Windows; el comando de esta guía utiliza cualquier Python 3.12 instalado.

Cierra las ventanas de PowerShell que estuvieran abiertas antes de instalar los programas.

**2. Descarga el proyecto completo**

Abre [Honguito04/ALEKS-Project](https://github.com/Honguito04/ALEKS-Project) en GitHub. Comprueba que la rama seleccionada sea **main**, pulsa el botón **Code** y elige **Download ZIP**.

En el Explorador de archivos de Windows, abre **Descargas**, haz clic derecho en el ZIP y selecciona **Extraer todo**. Cuando termine, abre la carpeta extraída. Entra en las carpetas necesarias hasta ver juntos `README.md`, `package.json` y las carpetas `backend` y `extension`.

Trabaja dentro de la carpeta extraída, no dentro del archivo ZIP. Conserva esta carpeta: la necesitarás cada vez que abras la aplicación.

**3. Abre una ventana de comandos en esa carpeta**

En el Explorador de archivos, haz clic en la barra de direcciones de arriba, donde aparece la ubicación de la carpeta. Escribe `powershell` y presiona **Enter**.

Se abrirá una ventana en la carpeta del proyecto. Allí pegarás los comandos de esta guía. Copia únicamente el contenido de cada recuadro; presiona Enter y espera a que termine antes de continuar. Cuando vuelve a aparecer una línea que empieza con `PS`, puedes introducir el siguiente comando.

Comprueba los programas con estos comandos, uno por uno:

```powershell
py -3.12 --version
```

Debe aparecer `Python 3.12` seguido de otro número.

```powershell
node --version
```

Debe aparecer una versión que empiece con `v24`.

```powershell
npm.cmd --version
```

Debe aparecer un número de versión. Si dice que no reconoce un comando, consulta la tabla de problemas al final antes de continuar.

**4. Inicia el servidor y compila Aleks Project**

En PowerShell, desde la carpeta del proyecto, ejecuta:

```powershell
.\scripts\start-web.cmd
```

El iniciador instala las dependencias, compila la web y genera la carpeta `dist` que cargará Chrome. El primer inicio necesita Internet y puede tardar varios minutos. Espera a que la consola muestre **Application startup complete** y conserva esa ventana abierta. Puedes minimizarla.

**5. Carga la extensión**

1. Abre `chrome://extensions` en Chrome y activa **Modo de desarrollador**.
2. Pulsa **Cargar descomprimida** y selecciona la carpeta `dist` que indica la consola. Debe contener directamente `manifest.json`.
3. Abre el menú de extensiones de Chrome y fija **Aleks Project** con la chincheta. Pulsa su icono para abrir el panel.
4. Pulsa **Autorizar acceso**, concede los permisos de Chrome y selecciona **Abrir Aleks Project**. También puedes abrir directamente `http://127.0.0.1:8000/app/`.

**6. Vincula tu ejercicio de ALEKS**

1. En la web, crea una cuenta de Aleks Project con una contraseña de al menos doce caracteres o entra con una cuenta que ya tengas.
2. En otra pestaña de Chrome, inicia sesión en ALEKS como de costumbre y abre un ejercicio sin responder.
3. En Aleks Project, pulsa **Conectar extensión ALEKS**. Selecciona la pestaña del ejercicio y pulsa **Vincular pestaña**.
4. Pulsa **Leer actividad ALEKS** y comprueba que el enunciado coincida con el que ves en tu pestaña.
5. Pulsa **Consultar vista previa**. Si el servidor pide configurar la IA en la nube, usa `scripts\edit-local-config.cmd` para guardar la clave y el modelo, y reinicia el servidor. [Configuración de Gemini](WEB.md)

**7. Autoriza tu primer recorrido**

Configura **1 ejercicio**, **5 minutos** y **2 llamadas IA**. Revisa la propuesta. Para un recuadro numérico, activa **Usar teclado de Chrome** y marca la casilla de autorización. Para una parábola comprobada con la cuadrícula vacía, la casilla **Autorizo dibujar, verificar y avanzar** ya incluye el permiso para usar los controles nativos de Chrome.

Pulsa **Autorizar e iniciar recorrido** y mantén la pestaña de ALEKS enfocada. Con el límite de un ejercicio, el recorrido se detiene después de la primera entrega aceptada. Las pruebas locales reproducen el HTML aportado. En tu primera prueba, observa qué registra ALEKS.

Si necesitas detener la sesión, pulsa **Detener recorrido ALEKS** en la web. Al terminar puedes cerrar el servidor con **Ctrl+C** en su ventana.

**8. Volver a abrir o actualizar**

Para volver a usarla, ejecuta `scripts\start-web.cmd` desde la carpeta del proyecto y vuelve a abrir la web. Usa la misma cuenta y vincula de nuevo la pestaña. Los recorridos detenidos no se reanudan automáticamente.

Para actualizar desde un ZIP, detén el servidor anterior, extrae el ZIP nuevo en otra carpeta e inicia la aplicación desde allí. Las cuentas y la configuración se guardan en `%LOCALAPPDATA%\ALEKS-Project`. En `chrome://extensions`, carga el `dist` nuevo si la extensión todavía apunta a la carpeta anterior. Recarga después ALEKS y la web. Al conectar debe aparecer **Web 0.6.1 · Extensión 0.6.1**. [Actualizar con Git o recuperar una cuenta local](WEB.md#actualizar-la-instalacion-local-de-windows)

## Si aparece un problema

| Lo que ves | Qué hacer |
| --- | --- |
| PowerShell no reconoce `py`, `node` o `npm.cmd` | Cierra PowerShell y vuelve a abrirlo tras instalar los programas del paso 1. |
| El puerto 8000 está ocupado | Busca la ventana del servidor anterior y detenlo con **Ctrl+C** antes de iniciar otra copia. |
| Chrome no encuentra el manifiesto | Elige la carpeta `dist` indicada en consola. Comprueba que contenga `manifest.json`. |
| La web no encuentra la extensión | Abre su panel, pulsa **Autorizar acceso** y comprueba que cargaste el `dist` del servidor actual. |
| No aparece la pestaña del ejercicio | Comprueba que ALEKS esté abierto en el mismo Chrome y pulsa **Actualizar pestañas** en la web. |
| El recorrido no se inició | Lee el motivo que aparece junto al botón de inicio. Puede faltar la lectura o la vista previa, o puede que el ejercicio use un formato incompatible. |
| Tu contraseña deja de funcionar después de actualizar | Conserva la instalación anterior y sigue [la recuperación de cuentas locales](WEB.md#actualizar-la-instalacion-local-de-windows). |

Si necesitas ayuda, copia el aviso que muestra la web y omite contraseñas, cookies y enlaces completos de ALEKS. [Detalles de los formatos y el recorrido](WEB_BRIDGE.md)
