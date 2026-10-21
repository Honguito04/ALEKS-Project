**Guía desde cero: instalar y probar el asistente en Windows**

Esta guía está pensada para una persona sin experiencia en programación que todavía no instaló la versión anterior. Asume Windows 10 u 11 y Google Chrome. No necesitas instalar versiones anteriores: la descarga actual incluye los cambios.

Actualmente puedes completar automáticamente los ejercicios del simulador y probar la lectura del enunciado en ALEKS. **La extensión todavía no escribe ni entrega respuestas en ALEKS.** El simulador sirve para comprobar que la instalación funciona antes de abrir tu curso.

La aplicación debe ejecutarse en la misma computadora donde usas Chrome. Lo preparado en el entorno de desarrollo en la nube no instala programas en tu computadora. Para esta prueba no necesitas claves de IA, una cuenta de desarrollador de Google ni configurar el acceso con Google.

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

**4. Prepara la aplicación: se hace una vez por instalación**

Ejecuta los siguientes comandos **uno por uno**, esperando a que termine cada uno. Las descargas de este paso necesitan Internet y pueden tardar varios minutos.

Crea el espacio de Python de la aplicación:

```powershell
py -3.12 -m venv .venv
```

Instala sus componentes de cálculo y del servicio local:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
```

Instala los componentes de la extensión:

```powershell
npm.cmd ci
```

Crea la configuración inicial. Este comando conserva el archivo si ya existe:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Genera la carpeta que cargará Chrome:

```powershell
npm.cmd run build
```

**Resultado esperado:** aparece una carpeta llamada `dist` junto a `backend` y `extension`. Contiene `manifest.json`, `panel.html` y otros archivos. Si un comando termina con un error, resuélvelo antes de pasar al siguiente paso.

Usamos `npm.cmd` para ejecutar npm desde PowerShell sin cambiar la política de ejecución de Windows. No necesitas activar manualmente el entorno de Python ni editar archivos del proyecto.

**5. Enciende el servicio local**

En la misma ventana, ejecuta:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log
```

Espera hasta ver un mensaje parecido a:

```text
Uvicorn running on http://127.0.0.1:8000
```

**Deja esa ventana abierta.** Mientras el servicio funciona no vuelve a aparecer la línea `PS`: es lo esperado. Puedes minimizar la ventana y seguir trabajando en Chrome.

**6. Instala la extensión en Chrome**

Escribe `chrome://extensions` en la barra de direcciones de Chrome y presiona Enter. Activa **Modo de desarrollador**, normalmente arriba a la derecha. Pulsa **Cargar descomprimida** y selecciona la carpeta **dist** creada en el paso 4.

Debes seleccionar `dist`, no `extension`, `backend` ni la carpeta general del proyecto. Aparecerá una tarjeta con el nombre **Asistente Matemático — MVP**.

En Chrome, pulsa el icono de extensiones, con forma de pieza de rompecabezas, y fija el asistente con la chincheta. Pulsa el icono del asistente para abrir su panel lateral.

**7. Haz tu primera prueba con el simulador**

En otra pestaña del mismo Chrome, pega esta dirección en la barra de direcciones:

```text
http://127.0.0.1:8000/simulator/
```

Debe aparecer **Laboratorio matemático**. Esa página contiene ejercicios de prueba independientes de tu curso de ALEKS.

En el panel del asistente, sigue este orden:

1. Pulsa **Conectar backend y simulador** y concede el acceso solicitado al servicio local.
2. Comprueba que el panel muestre **Backend conectado · SymPy disponible**.
3. Pulsa **Entrar en demostración**. Esta es la opción preparada para probar sin configurar cuentas externas.
4. Si la pestaña del laboratorio no aparece, pulsa **Actualizar pestañas**.
5. En **Pestaña de trabajo**, selecciona **Laboratorio matemático · Simulador** y pulsa **Leer actividad seleccionada**.
6. Deja los límites en **10 ejercicios**, **10 minutos** y **0 llamadas IA**. Para probar el recorrido completo, deja **Vista previa** desmarcada.
7. Pulsa **Autorizar e iniciar** y observa la secuencia.

**Resultado esperado:** el asistente introduce respuestas, las entrega en el simulador y avanza. Al terminar debe mostrar **COMPLETADO** y **10 aceptadas**. Puedes usar **Pausar**, **Continuar** o **Detener** durante la prueba.

Si quieres repetirla, pulsa **Reiniciar actividad** en el laboratorio, vuelve a **Leer actividad seleccionada** y autoriza la nueva actividad.

También puedes pulsar **Volúmenes de cilindros con unidades** en el laboratorio. Vuelve a leer y autorizar esa actividad: contiene dos ejercicios y debe terminar con dos respuestas aceptadas.

**8. Prueba la lectura en tu página real de ALEKS**

Conserva abierto el servicio del paso 5. En otra pestaña de Chrome, entra a ALEKS como lo haces normalmente y abre un ejercicio. El dominio que confirmaste para los ejercicios es **latam-awu.aleks.com**.

En el panel lateral del asistente:

1. Busca **Datos y permisos** y pulsa **Autorizar sitio ALEKS para inspección**.
2. Concede el permiso solicitado para `https://latam-awu.aleks.com`.
3. Pulsa **Actualizar pestañas**, selecciona tu pestaña de ALEKS y pulsa **Leer actividad seleccionada**.
4. Busca el texto **Enunciado leído** y comprueba si el texto coincide con el ejercicio que ves.

No hace falta que el ejercicio tenga un título como «Pregunta 12». La lectura utiliza el contenedor del enunciado observado en los fragmentos que aportaste. Las imágenes, gráficos y estructuras matemáticas todavía no compatibles pueden impedir la lectura; el panel explicará el motivo.

**Resultado esperado en ALEKS:** el panel muestra el enunciado si reconoce su estructura. También puede reconocer los controles documentados del editor. **Autorizar e iniciar seguirá deshabilitado para ALEKS**: la escritura, interpretación completa y entrega real todavía necesitan validación. Ver «pendiente de validación» en esta etapa no significa que instalaste mal la aplicación.

El acceso de Google que aparece en el panel pertenece al asistente; tu sesión en ALEKS se abre por separado de la manera habitual.

**9. Cuando quieras volver a usar la aplicación**

La instalación de Python, Node, los componentes y la extensión se hace una vez. Para una nueva sesión, abre la carpeta del proyecto, escribe `powershell` en su barra de direcciones y vuelve a ejecutar únicamente el comando del **paso 5**. Después abre Chrome y el simulador o tu pestaña de ALEKS.

Si Chrome perdió la sesión de demostración, pulsa **Entrar en demostración** otra vez. Al terminar, pulsa **Detener** en el panel. Puedes apagar el servicio pulsando **Ctrl+C** en su ventana y después cerrarla.

Cuando haya una actualización del proyecto, descarga el ZIP nuevo en otra carpeta y repite los pasos de preparación allí. En `chrome://extensions`, elimina la tarjeta anterior y carga el `dist` de la carpeta nueva. Conserva la carpeta anterior hasta comprobar que la nueva funciona.

**10. Si aparece un problema**

| Lo que ves | Qué hacer |
| --- | --- |
| No reconoce `py`, `node` o `npm.cmd` | Cierra PowerShell y vuelve a abrirlo desde la carpeta del proyecto. Si persiste, revisa la instalación del programa correspondiente. |
| `No suitable Python runtime found` | Instala Python 3.12; el comando solicita específicamente esa versión. |
| No encuentra `package.json` o `backend/requirements.lock` | Abriste PowerShell en otra carpeta. Vuelve a la que contiene ambos archivos y abre allí la ventana. |
| Error que menciona `npm.ps1` o scripts deshabilitados | Usa `npm.cmd`, tal como está escrito en esta guía. |
| No existe `dist` | Comprueba que el paso 4 terminó correctamente, especialmente `npm.cmd run build`. |
| Chrome no encuentra el manifest | Selecciona la carpeta `dist` que contiene directamente `manifest.json`. |
| Chrome indica que el administrador impide cargar extensiones | La política del navegador debe permitirlo; consulta al administrador del equipo. |
| El simulador no abre o dice que no se puede acceder al sitio | Comprueba que la ventana del paso 5 siga abierta y muestre el mensaje de servicio iniciado. La dirección se abre en la misma computadora donde lo encendiste. |
| Puerto 8000 ocupado o error `10048` | Si ya dejaste abierta una ventana del servicio, úsala. Evita abrir una segunda copia. |
| El panel no conecta al servicio local | Pulsa **Conectar backend y simulador** y concede el permiso. Comprueba también que el servicio siga encendido. |
| El laboratorio no aparece en la lista | Abre su pestaña en el mismo Chrome y pulsa **Actualizar pestañas**. |
| **Autorizar e iniciar** está deshabilitado en el simulador | Entra en demostración, selecciona el laboratorio y pulsa **Leer actividad seleccionada**. |
| «Los límites no coinciden con la autorización» al iniciar | Actualiza la extensión con la corrección indicada debajo de esta tabla. Una versión anterior comparaba también el orden interno de las propiedades, aunque los valores fueran iguales. |
| «Estructura MathML no admitida: mstyle.» | Actualiza la extensión siguiendo los pasos de debajo. El lector ya admite esa etiqueta de formato; después vuelve a leer tu pestaña de ALEKS. |
| «Operador MathML no admitido» | La actualización admite los símbolos aportados del círculo, ángulo, grados, arco y pi. Si aparece otro, comparte el mensaje completo con sus códigos `U+…`; identifican el símbolo sin volver a copiar todo el HTML. |
| La pestaña de ALEKS no aparece | Concede el permiso del paso 8, comprueba el dominio y pulsa **Actualizar pestañas**. |
| No se encuentra un enunciado visible en ALEKS | Comprueba que estés viendo un ejercicio. Algunas pantallas o estructuras todavía requieren ampliar el lector. |
| El panel indica cero campos pero ves recuadros de respuesta | Abre **Detalle del diagnóstico del editor** y comparte sus conteos, incluidos **Contenedores visuales del editor** y **Motivos de exclusión**. Distinguen el input y su representación visual, así como el motivo de ocultación; no significan que ALEKS carezca de recuadros. |

Si necesitas ayuda con un error, indica el número de paso y copia el mensaje que aparece, omitiendo información de tu cuenta. No necesitas compartir contraseñas, cookies ni enlaces completos de sesión de ALEKS.

**Actualizar la extensión conservando tu instalación**

Descarga el ZIP actualizado desde **Code → Download ZIP** en GitHub y extráelo en una carpeta aparte. Abre la carpeta del proyecto nuevo y copia su carpeta **extension** completa. Pégala dentro de la carpeta original del proyecto que ya habías instalado; acepta reemplazar los archivos existentes. La carpeta original es la que contiene `package.json`, `backend`, `.venv` y `node_modules`. No necesitas copiar `.env` ni reinstalar Python o Node.

Abre **otra ventana de PowerShell desde la carpeta original**, conservando abierta la del servicio, y ejecuta:

```powershell
npm.cmd run build
```

Cuando termine, abre `chrome://extensions` y pulsa el botón de recargar, con flecha circular, de la tarjeta del asistente. Actualiza también la pestaña del simulador con **F5** y vuelve a abrir el panel.

Conecta el backend, entra en demostración si es necesario, actualiza la lista de pestañas y lee el laboratorio. Si **Detener** está habilitado, púlsalo. Después pulsa **Reiniciar actividad** en el laboratorio, vuelve a **Leer actividad seleccionada** y pulsa **Autorizar e iniciar** con 10 ejercicios, 10 minutos y 0 llamadas IA. La vista previa debe estar desmarcada para el recorrido completo.

Para comprobar la corrección de `mstyle` en ALEKS, actualiza también esa pestaña, selecciona su entrada en el panel y pulsa **Leer actividad seleccionada**. La actualización del lector no habilita escritura o entrega automática. Si sigue indicando cero campos, hace falta revisar el HTML del editor actual.

En el ejercicio del círculo, el lector puede mostrar `arco(AB)` al leer la marca situada sobre AB. La advertencia sobre la región sombreada significa que se leyó el texto, pero todavía falta interpretar el dibujo. No acredita una respuesta geométrica.
