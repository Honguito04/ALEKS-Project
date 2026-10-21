# Plan y criterios de la primera versión

El repositorio inicial estaba vacío, sin commits ni instrucciones propias. Se eligió un paquete npm, FastAPI, SQLite y un simulador servido por el mismo backend local, sin infraestructura adicional.

1. Construir extensión MV3, UI española, backend, configuración, OAuth y simulador original.
2. Implementar resolución determinista con esquema cerrado y familias explícitas; IA como proveedor intercambiable opcional.
3. Recorrer diez ejercicios: leer, verificar, escribir, enviar, observar aceptación y avanzar.
4. Probar cancelación, reinicio, idempotencia, cambios de actividad, permisos, sesión, fallos de red y separación demo/Google.
5. Compilar, documentar Windows y las limitaciones externas; entregar código en GitHub sin publicar la extensión o servicios.

Criterio ejecutable: backend arrancable y secuencia completa del simulador aprobada; build MV3 generado y tests significativos. La validación nativa de Chrome/Google se reporta por separado. ALEKS requiere evidencia autenticada autorizada y no es criterio que pueda afirmarse con el simulador.

Decisiones: origen local fijo y explícito; un solo campo de texto/radio; respuestas exactas por defecto; diez ejercicios por sesión; cero llamadas externas por defecto; ningún envío automático basado únicamente en interpretación de IA. No se capturan imágenes en esta versión.

Ampliación posterior solicitada: el usuario eligió un modelo local para cubrir problemas generales. El copiloto Ollama se implementa separado del controlador automático: texto/captura opcional, propuesta estructurada, revisión y tentativa de escritura comprobada de entero en un recuadro vacío. La instalación real del modelo y los eventos de ALEKS están pendientes de prueba en la computadora del usuario; formatos complejos y envío/avance autónomos siguen fuera de este primer recorrido. Véase `IA_GENERAL.md`.
