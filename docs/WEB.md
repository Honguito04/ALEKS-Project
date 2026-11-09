# Demo web independiente

La web permite crear una cuenta, pegar un enunciado, adjuntar una imagen JPEG/PNG/WebP y pedir propuestas matemáticas. Funciona en móvil y computadora. No lee ni controla ALEKS: esa función continúa perteneciendo a la extensión, cuya vinculación con estas cuentas no está implementada.

## Desarrollo local

Usa el checkout existente; cada tarea en la nube ya está aislada. Python 3.12 y Node 24:

```bash
cd /workspace/ALEKS-Project
bash scripts/setup.sh
npm run build:web
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --no-access-log
```

Abre `/app/` en el backend local. Para cambiar la interfaz sin recompilar, `npm run dev:web` usa el proxy al backend; consulta su configuración de puerto/origen. No abras el backend local a Internet con `WEB_PUBLIC_MODE=false`.

Las opciones nuevas están en `.env.web.example`. Añade las que necesites a `.env`, conservando su contenido anterior. La web usa una base SQLite separada en desarrollo; el despliegue público exige PostgreSQL y HTTPS. Los comprobadores exactos de texto funcionan sin clave de IA en los formatos ya reconocidos; los demás ejercicios muestran un mensaje de configuración pendiente.

Pruebas:

```bash
npm run build
npm run build:web
npm test
.venv/bin/python -m pytest backend/tests -q
npm run test:web
npm run test:e2e
```

Deja libre el puerto de pruebas que indique cada configuración Playwright; sus servidores arrancan y terminan automáticamente. Las pruebas con Gemini simulado no acreditan disponibilidad, calidad ni cuota del proveedor real.

La suite PostgreSQL es opcional en la ejecución ordinaria: configura `WEB_TEST_POSTGRES_URL` con una base de pruebas propia y ejecuta `.venv/bin/python -m pytest backend/tests/test_web_postgres.py -q`. Cada caso crea y elimina un esquema aleatorio, por lo que el rol debe poder crear esquemas. El caso de despliegue requiere TLS con `sslmode=verify-full` y una CA de confianza. No uses una base de producción para pruebas.

## Publicar sin contratar un plan

No se ha publicado ningún servicio. Lee primero [las condiciones y fuentes de los proveedores](WEB_PROVEEDORES.md). No introduzcas tarjeta, no actives facturación y no elijas un plan de pago. Si un proveedor exige alguno de esos pasos o tu región/cuenta no tiene cuota gratuita, detente: esta guía no autoriza un gasto ni garantiza que puedas completar el alta gratuita.

### 1. Guardar el código en GitHub

Los commits de esta etapa deben estar en tu repositorio antes de desplegar. Esta tarea no los envía automáticamente a GitHub. Conserva el repositorio privado si contiene información propia. Nunca subas `.env`, claves ni la URL completa de conexión a la base.

### 2. Crear la base PostgreSQL en Neon

1. Entra en [Neon](https://neon.com/), crea una cuenta y elige **Free**. Para esta web solo necesitas PostgreSQL; no actives AI Gateway ni productos de pago.
2. Crea un proyecto y una base en una región próxima al alojamiento. Conserva el rol y contraseña que genera Neon.
3. En **Connect**, copia la cadena PostgreSQL con contraseña. Es un secreto: se pegará únicamente en las variables privadas de Render, nunca en el código ni en el chat.
4. La URL debe usar `sslmode=verify-full&sslrootcert=system`, que valida cifrado y certificado/hostname. Si contiene `sslmode=require`, sustituye ese parámetro por `sslmode=verify-full`; añade `sslrootcert=system` y conserva el resto de parámetros, incluido `channel_binding` si aparece. No desactives TLS para resolver errores.

La aplicación crea sus tablas al arrancar. Las cuentas, sesiones, límites de intentos y consumo diario se guardan aquí, fuera del disco temporal de Render. No se guardan en Neon los enunciados, imágenes ni resultados de las consultas.

### 3. Configurar Gemini sin facturación

1. Entra en [Google AI Studio](https://aistudio.google.com/) y comprueba que tu país y cuenta puedan usar la API gratuitamente.
2. Usa un proyecto sin Cloud Billing asociado. No pulses opciones para activar facturación o subir de nivel.
3. Comprueba en AI Studio qué modelo tiene cuota **Free** disponible para ese proyecto. Copia su identificador exacto; no se ha dejado un modelo predeterminado porque disponibilidad y condiciones cambian. Que un modelo aparezca en una lista no demuestra que sea gratuito.
4. Genera una clave para ese proyecto. Guárdala como `GEMINI_API_KEY` en los secretos de Render. Guarda el identificador como `GEMINI_MODEL`. No pongas claves en variables con prefijo `VITE_` ni en archivos del frontend.
5. Revisa las condiciones de tratamiento de datos del nivel gratuito. Los ejercicios e imágenes se envían a Google cuando requieren IA. No adjuntes datos personales, credenciales ni información sensible.

La aplicación no activa facturación ni cambia de modelo. Tampoco puede comprobar si alguien vinculó después una cuenta de facturación al proyecto: conserva el proyecto sin facturación. Los límites de la aplicación son una protección adicional, no un límite de gasto de Google.

### 4. Crear el servicio web gratuito en Render

1. Entra en [Render](https://render.com/), conecta el repositorio y crea un **Web Service**, con **Docker** como entorno y **Free** como instancia. `render.yaml` contiene una propuesta de configuración; no crea recursos por sí solo.
2. Si el panel pide tarjeta, pago o un plan superior para tu cuenta, detente. No continúes con una prueba que luego se facture.
3. Obtén la dirección HTTPS gratuita asignada, por ejemplo `https://tu-demo.onrender.com`. No necesitas comprar dominio.
4. En **Environment**, configura estas variables. Las dos marcadas como secretas deben permanecer en el backend:

| Variable | Valor |
| --- | --- |
| `WEB_PUBLIC_MODE` | `true` |
| `WEB_PUBLIC_URL` | La dirección HTTPS de Render, sin `/app/`; admite `/` final y normaliza puerto estándar |
| `WEB_DATABASE_URL` | URL privada de Neon con `sslmode=verify-full&sslrootcert=system` (**secreto**) |
| `GEMINI_API_KEY` | Clave del proyecto sin facturación (**secreto**) |
| `GEMINI_MODEL` | Identificador con cuota Free comprobada en AI Studio |
| `WEB_ACCOUNT_DAILY_CALLS` | `10` inicialmente |
| `WEB_GLOBAL_DAILY_CALLS` | `100` inicialmente; redúcelo según la cuota disponible |
| `WEB_AI_TIMEOUT_SECONDS` | `60` |
| `ENABLE_DEMO` | `false` |
| `AI_PROVIDER` | `none` (solo afecta a los proveedores heredados) |

5. Despliega manualmente. El Dockerfile compila React y sirve web/backend en el mismo origen. No configures múltiples workers ni múltiples instancias: las consultas en curso viven en la memoria de un único proceso.
6. Abre `/health`: debe responder `status: ok`. Abre `/app/`, registra una cuenta y prueba cerrar y volver a iniciar sesión. Prueba un problema sin datos sensibles, comprueba su respuesta y si figura como propuesta sin verificar. Una propuesta de IA no garantiza corrección matemática.
7. Reinicia el servicio y vuelve a entrar: la cuenta debe persistir. Una consulta que estaba en curso puede perderse; la interfaz lo indica y no la reenvía automáticamente. Si no pasa esta comprobación, no presentes el despliegue como validado.

La configuración pública falla al arrancar si el origen no es HTTPS o no existe PostgreSQL seguro. Las rutas locales heredadas de demostración, OAuth, Ollama, OpenAI y simulador quedan bloqueadas aunque se manipule `Host`; la extensión mantiene esas rutas en su backend local habitual.

## Límites y seguridad

- Las cuotas diarias UTC por cuenta y global se reservan de forma persistente antes de **cada llamada** al proveedor, incluso si falla o se cancela. Una imagen puede requerir dos llamadas: propuesta y revisión. No hay reintentos automáticos. Agotar cuotas no activa un plan de pago.
- Las imágenes pasan por comprobación exacta de las cuentas propuestas y una segunda revisión visual del mismo modelo. Esa revisión no verifica independientemente las medidas, geometría o unidades. Solo los comprobadores deterministas del texto pueden marcar un resultado como comprobado.
- Las consultas en memoria caducan, desaparecen tras reinicios y se cancelan al cerrar sesión o eliminar la cuenta. No existe historial persistente ni recuperación automática de trabajos. Cancelar no garantiza que el proveedor deje de procesar una petición ya recibida, ni devuelve cuota.
- Se permiten como máximo cuatro consultas simultáneas en el servicio y dos por cuenta para acotar memoria y procesos de cálculo. Cuando el servicio está ocupado, la solicitud se rechaza sin llamar al proveedor.
- Las contraseñas usan scrypt con sal por cuenta. Las sesiones son cookies HttpOnly/SameSite, Secure bajo HTTPS; la protección CSRF exige origen normalizado y token ligado a sesión. No se almacenan sesiones en JavaScript. Cerrar sesión revoca todas las sesiones de la cuenta.
- El correo identifica la cuenta; no se envían mensajes, no se verifica su propiedad y **no existe recuperación por correo**. Si pierdes la contraseña, no hay flujo de restablecimiento. No reutilices una contraseña de otro servicio.
- Los límites de intentos se conservan en la base y son deliberadamente conservadores. Sin confiar en cabeceras IP del cliente, un proxy puede hacer que varios visitantes compartan un límite; la cuota global reduce abuso, pero esta demo no ofrece protección de servicio comercial ni disponibilidad garantizada.
- El alojamiento gratuito puede suspenderse por inactividad, tener arranques en frío y agotarse por uso. PostgreSQL puede pausar su cómputo conservando los datos. Consulta las condiciones actuales enlazadas; no se promete disponibilidad ilimitada.
- `.gitignore` y `.dockerignore` excluyen secretos, bases locales, claves y cachés. No habilites logs de cuerpos/cabeceras ni trazas de depuración en producción.

## Problemas habituales

**Sesión vencida:** vuelve a entrar; la consulta anterior no se vuelve a enviar. **Contraseña incorrecta al eliminar:** la cuenta continúa activa; corrige la contraseña. **Cuota agotada:** espera al restablecimiento que indique el proveedor o al día UTC siguiente para los límites locales. **Error de configuración:** revisa clave/modelo en secretos del backend. **Consulta interrumpida:** puede haber habido un reinicio o caducidad; inicia otra solo si deseas consumir nueva cuota. **Error de origen o CSRF:** comprueba que `WEB_PUBLIC_URL` sea exactamente el origen HTTPS usado para abrir la web y recarga.

## Validación de esta etapa · 9 de noviembre de 2026

- Compilación de extensión y web, comprobación TypeScript y 188 pruebas unitarias aprobadas.
- Suite completa del backend: 370 aprobadas y cinco PostgreSQL omitidas por no configurar su URL en esa ejecución. Tras añadir el límite de concurrencia global, se repitió la suite de IA: 28 aprobadas, con transporte Gemini simulado.
- PostgreSQL 17.11 real: cinco pruebas aprobadas aparte, incluyendo TLS verificado, persistencia al reiniciar la aplicación, revocación, cuotas concurrentes y eliminación. Se retiraron el contenedor y las credenciales temporales al terminar.
- Siete pruebas Chromium de la web aprobadas: registro, acceso, cierre, recarga, eliminación, sesión vencida, cancelación durante creación, móvil e imágenes. El mensaje de cuota del navegador se inyecta explícitamente; las reservas reales se comprueban en backend/PostgreSQL.
- Las 325 regresiones Chromium de la extensión y el simulador también aprobaron, incluido el recorrido completo de diez ejercicios contra el backend real.
- Imagen Docker construida y probada: arranque local, HTML, cookie HttpOnly, recursos compilados con origen público HTTPS y bloqueo de rutas heredadas. Proxy Vite de desarrollo probado con registro y eliminación reales; origen ajeno rechazado.

Sin llamadas a Gemini real, recursos remotos creados ni publicación. Faltan configurar secretos, confirmar cuota gratuita y condiciones de Render/Gemini, y comprobar el despliegue real siguiendo esta guía. Las pruebas PostgreSQL locales no acreditan acceso a Neon remoto.
