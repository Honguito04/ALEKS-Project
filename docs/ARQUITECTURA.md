# Contratos y ampliación del adaptador

`Exercise` es el dato que cruza la frontera extensión/backend: origen lógico, actividad, huella SHA-256, enunciado, AST matemático restringido (`MathSpec`), tipo/correspondencia de campo, alternativas, dominio, unidades, precisión, evidencia y ambigüedades. Zod y Pydantic rechazan propiedades extra y tamaños fuera de límites.

Para `cylinder_volume` son explícitos el radio, altura, unidades de cada dimensión, valor prescrito de pi y confirmación de que la altura es perpendicular. Se rechazan dimensiones de unidades diferentes, valores no positivos, altura inclinada/ambigua y una unidad de resultado que no sea la cúbica correspondiente. El campo `quantity` requiere número y unidad seleccionada; `Solution.unit` debe coincidir antes de escribir. La calificación y la idempotencia del simulador también incluyen esa unidad. Este contrato no define los selectores o eventos del editor real de ALEKS.

`Adapter` tiene operaciones `detect`, `read`, `write`, `submit`, `result` y `next`. El controlador solo llama esas operaciones tipadas. En el simulador la huella se calcula sobre actividad, texto, representación matemática, campos, alternativas y formato, y se vuelve a comprobar antes de escribir/enviar. El valor debe reflejarse en la interfaz tras los eventos de entrada. Un clic no cuenta como aceptación: se exige feedback con la misma huella.

El service worker conserva autorización, identidad y transporte, pero no ejecuta el bucle. El content script continúa con el panel cerrado; el worker se reactiva con cada mensaje. Las autorizaciones y diarios viven en `chrome.storage.local`; los tokens, en `chrome.storage.session` con acceso de contextos confiables. Una nueva instancia del content script recupera el diario, observa el resultado pendiente y queda pausada. Si no hay confirmación, conserva la operación como incierta sin repetir el envío.

Los mensajes de páginas y marcos secundarios no tienen acceso al transporte. El worker comprueba el ID emisor, origen del documento, origen actual de la pestaña, actividad autorizada, estado de ejecución, esquema y límites. El contenido de un enunciado solo se procesa como datos; no hay herramientas de navegación/JavaScript a disposición del modelo.

## Evidencia necesaria para un adaptador ALEKS

Crear un componente de lectura/escritura real exige observar, con autorización, una actividad de prueba que incluya:

1. Estado autenticado, pantalla actual y un identificador de actividad estable.
2. Enunciado aislado y representación textual/MathML de una familia compatible; restricciones, unidades y redondeo.
3. Controles de respuesta, etiquetas y eventos reconocidos por la interfaz; correspondencia si hay varios campos.
4. Botón normal de envío y feedback positivo/negativo inequívoco asociado al mismo ejercicio.
5. Transición al siguiente ejercicio, fin de actividad, pérdida de sesión y verificaciones humanas.

Guardar fixtures desidentificados y pruebas del adaptador antes de activar el origen real. No reutilizar los selectores del simulador en ALEKS. No asumir que un texto de éxito genérico o la desaparición de un botón significa aceptación. No habilitar nuevos orígenes o capturas sin permisos explícitos. El stub `PendingAleksAdapter` no captura credenciales y falla de forma explícita en todas las operaciones de escritura.

Evidencia parcial recibida: captura de cilindro y atributos de un input `input.ansed_input[aria-label="Answer Editor"][type="text"]`, botón `button[aria-label="Centímetros cúbicos"]` y etiqueta `div.textContent` con texto «Entregar». `inspectAleksEditor` usa esos atributos, sin IDs efímeros, sin leer valores/credenciales y sin disparar eventos. No se ha observado el contenedor que conserva la representación matemática, el ancestro clicable de la etiqueta ni feedback/avance: por ello el diagnóstico nunca habilita el adaptador de entrega. El fixture de pruebas conserva solo los atributos necesarios del fragmento recibido, no una réplica completa de la plataforma.
