import { assistContextSchema,type AssistContext,type FillBlocker } from './shared';
import { readAleksPrompt } from './aleks-prompt';
import { inspectAleksEditor } from './aleks-editor';
import { visible,disabled } from './aleks-dom';
import { answerRoots,fillEditorAnswers } from './aleks-two-editors';
import { inspectEditorRoot } from './aleks-single-editor';
import { probabilityRowOrder } from './aleks-answer-roots';
import { parseSupportedAnswer,sameAnswer } from './answer-format';
import { inspectParabolaGrid,isEmptyParabolaGrid } from './aleks-graph';

// Una definición de A y B también puede preceder a una sola pregunta sobre
// A ∩ B. Solo la petición explícita de probabilidades separadas crea campos.
function requestedEventLabels(statement: string): Map<string, string> | undefined {
  const request = /\bprobabilidad(?:es)?\s+de\s+cada\s+(?:uno\s+de\s+los\s+(?:siguientes\s+)?)?(?:sucesos?|eventos?)\s*:\s*/iu.exec(statement);
  if (!request) return;
  const body = statement.slice(request.index + request[0].length)
    .split(/\s+(?:escrib(?:e|a|ir)|expres(?:a|e|ar))\s+las\s+respuestas\b/iu)[0];
  const markers = [...body.matchAll(/\b(?:suceso|evento)\s+([a-z])\s*:\s*/giu)];
  if (markers.length < 2 || markers[0].index !== 0) return;

  const labels = new Map<string, string>();
  for (const [index, marker] of markers.entries()) {
    const name = marker[1].toUpperCase();
    const definition = body.slice(marker.index + marker[0].length, markers[index + 1]?.index).trim();
    if (!definition || labels.has(name)) return;
    const label = 'P(' + name + '): ' + definition;
    labels.set(name, label.length > 200 ? label.slice(0, 199) + '…' : label);
  }
  if (labels.size > 12) throw Error('Hay demasiados sucesos para esta consulta.');
  return labels;
}

export async function assistContext(document:Document,allowImage=false):Promise<AssistContext> {
  const prompt=await readAleksPrompt(document);
  const prompts=[...document.querySelectorAll<HTMLElement>('#algoPrompt')].filter(visible);
  const readable=prompt.status==='readable' && Boolean(prompt.statement && prompt.fingerprint);
  if(!readable && (!allowImage || prompts.length!==1)) {
    throw Error(`No hay un enunciado legible. ${prompt.reason} Si el ejercicio está visible, incluye su captura para consultar a la IA.`);
  }
  const editor=inspectAleksEditor(document),single=editor.singleEditor;
  const graphing=prompt.graphingExerciseDetected;
  const graph=graphing && !prompt.diagramReferenceDetected?inspectParabolaGrid(document):undefined;
  const pair=answerRoots(document);
  if(pair.length>12)throw Error('Hay demasiados recuadros para esta consulta.');
  const definitions = readable ? requestedEventLabels(prompt.statement!) : undefined;
  const rowOrder = probabilityRowOrder(pair);
  // Generic unlabelled editors cannot establish which event belongs to which
  // box. Keep separate answers for preview, but require the confirmed rows to
  // write to an explicitly named probability event.
  const mismatch = Boolean(definitions && (definitions.size !== pair.length ||
    !rowOrder || rowOrder.some(event => !definitions.has(event))));
  let fields: AssistContext['fields'];
  if (graphing) {
    fields = [{ key:'answer',label:'Puntos y trazo de la función' }];
  } else if (editor.circleTable.status === 'observed') {
    fields = editor.circleTable.fields.map(field => ({ key: field.kind, label: field.label }));
  } else if (definitions || rowOrder || pair.length > 1) {
    let labels: string[];
    if (rowOrder && !mismatch) {
      labels = rowOrder.map(event => definitions?.get(event) ?? 'P(' + event + ')');
    } else if (definitions) {
      labels = [...definitions.values()];
    } else {
      labels = pair.map((_, i) => `Recuadro ${i + 1} en orden visual de arriba abajo e izquierda a derecha; una respuesta por campo`);
    }
    fields = labels.map((label, i) => ({ key: `field_${i + 1}`, label }));
  } else {
    fields = [{ key: 'answer', label: single.readback.unitLabel
      ? `Respuesta del ejercicio (unidad predefinida: ${single.readback.unitLabel}; escribe solo el número)`
      : 'Respuesta del ejercicio' }];
  }
  const fill_blockers:FillBlocker[]=[];
  if(!readable)fill_blockers.push('unreadable_prompt');
  const pairRead=pair.map(inspectEditorRoot);
  const two=pair.length===2 && editor.circleTable.status!=='observed';
  if(graphing) {
    fill_blockers.push('graph_editor');
  } else if(mismatch) {
    fill_blockers.push('field_count_mismatch');
  } else if(two) {
    if(pairRead.some(field=>field.status!=='observed'))fill_blockers.push('editor_structure');
    if(pairRead.some(field=>field.disabled))fill_blockers.push('editor_disabled');
    if(pairRead.some(field=>field.readback.status==='readable'))fill_blockers.push('editor_not_empty');
    if(pairRead.some(field=>field.readback.status==='unsupported' || field.readback.fixed_unit))fill_blockers.push('unsupported_readback');
  } else if(single.status!=='observed')fill_blockers.push(single.status==='ambiguous'?'multiple_editors':single.status==='missing'?'editor_missing':'editor_structure');
  else {
    if(single.disabled)fill_blockers.push('editor_disabled');
    if(single.readback.status==='readable')fill_blockers.push('editor_not_empty');
    if(single.readback.status==='unsupported')fill_blockers.push('unsupported_readback');
  }
  if(editor.resultMarker.positiveMessageCount>0 || editor.nextControl.count>0 || editor.nextTopicControl.count>0)fill_blockers.push('result_present');
  if(prompt.diagramReferenceDetected && !graphing)fill_blockers.push('diagram_required');
  const can_fill_integer=fill_blockers.length===0;
  const can_fill_fraction=can_fill_integer;
  const canDraw=Boolean(graph && isEmptyParabolaGrid(graph) && !fill_blockers.includes('result_present'));
  // Cuando la lectura estructurada falla, el texto/MathML se usa solo en el
  // hash local. La IA recibe la captura elegida, sin HTML o enlaces de sesión.
  const fallback=readable?undefined:[prompts[0].textContent?.slice(0,8000),[...prompts[0].querySelectorAll('[mathml]')].slice(0,100).map(node=>node.getAttribute('mathml')?.slice(0,1000))];
  // Verificar y el menú pueden aparecer al enfocar. No son utilizados para
  // introducir el número y no forman parte de esta huella de escritura.
  const source=JSON.stringify([prompt.fingerprint,fallback,fields,fill_blockers,editor.inputDiagnostics.presentCount,
    single.status,single.rootCount,single.disabled,single.readback,editor.circleTable,two?pairRead:undefined,
    ...(graphing?[graph?.signature,canDraw]:[])]);
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(value=>value.toString(16).padStart(2,'0')).join('');
  return assistContextSchema.parse({fingerprint,statement:readable?prompt.statement:'No fue posible leer el enunciado como texto estructurado. Interpreta únicamente el ejercicio visible en la captura adjunta; si faltan datos, indícalo.',
    fields,diagram_required:!readable || Boolean(prompt.diagramReferenceDetected),can_fill_integer,can_fill_fraction,fill_blockers,
    ...(graphing?{can_draw_parabola:canDraw}:{}),
    ...(!graphing && fields.length===1 && single.readback.fixed_unit?{fixed_unit:single.readback.fixed_unit}:{})});
}

/** El usuario confirmó la conversión automática de a/b en fracción vertical.
 * Se solicita esa escritura una vez y se exige su representación visual.
 * Los eventos sintéticos deben comprobarse en cada instalación de ALEKS.
 */
export type FieldAnswer={field_key:string;value:string;unit?:string};
export type NativeInput=(guard:()=>Promise<void>)=>Promise<void>;
export async function fillAssistAnswer(document:Document,fingerprint:string,value:string|FieldAnswer[],signal:AbortSignal,nativeInput?:NativeInput) {
  if(Array.isArray(value))return fillEditorAnswers(document,fingerprint,value,signal,nativeInput);
  if(!parseSupportedAnswer(value))throw Error('La respuesta debe ser un entero, decimal o una fracción reducida no negativa, sin unidad.');
  return fillScalar(document,fingerprint,value,signal,nativeInput);
}

/** Una sola tentativa, iniciada desde el panel, en un recuadro vacío.
 * No entrega, avanza ni ejecuta instrucciones del modelo. input/change son
 * eventos públicos sintéticos: la lectura visual decide si funcionaron.
 */
export async function fillAssistInteger(document:Document,fingerprint:string,value:string,signal:AbortSignal) {
  if(!/^(0|[1-9]\d{0,11})$/u.test(value))throw Error('La escritura asistida admite únicamente un entero sin unidad.');
  return fillScalar(document,fingerprint,value,signal);
}

async function fillScalar(document:Document,fingerprint:string,value:string,signal:AbortSignal,nativeInput?:NativeInput) {
  signal.throwIfAborted();
  const before=await assistContext(document);
  if(before.fingerprint!==fingerprint || !before.can_fill_integer)throw Error('El ejercicio o el recuadro cambió. Vuelve a consultar a la IA.');
  const promptBefore=await readAleksPrompt(document);
  const roots=answerRoots(document);
  if(roots.length!==1)throw Error('No hay un único recuadro al que escribir.');
  const root=roots[0],input=root.querySelector<HTMLInputElement>('input.ansed_input')!,previousBuffer=input.value;
  const checkInput=()=>{
    signal.throwIfAborted();
    if(!root.isConnected || !input.isConnected || input.closest('.ansed_root')!==root || root.querySelector('input.ansed_input')!==input ||
      !visible(root) || disabled(input) || input.readOnly || document.activeElement!==input)throw Error('El editor o su foco cambió durante la escritura.');
  };
  input.focus();
  const focused=await assistContext(document);checkInput();
  if(!root.isConnected || focused.fingerprint!==fingerprint || !focused.can_fill_integer)throw Error('La página cambió al enfocar el editor.');
  if(nativeInput) {
    const guard=async()=>{
      signal.throwIfAborted();
      const current=await readAleksPrompt(document);checkInput();
      const editor=inspectAleksEditor(document);
      if(current.fingerprint!==promptBefore.fingerprint || !root.isConnected || !input.isConnected || input.closest('.ansed_root')!==root ||
        document.activeElement!==input || disabled(input) || input.readOnly || !visible(root) ||
        editor.singleEditor.status!=='observed' || editor.singleEditor.readback.fixed_unit!==before.fixed_unit || editor.resultMarker.positiveMessageCount || editor.nextControl.count || editor.nextTopicControl.count)throw Error('Cambió el ejercicio, su unidad o el foco del editor. El teclado de Chrome se detuvo.');
    };
    // El panel lateral puede tener el foco de Chrome. CDP dirige las teclas a
    // la pestaña validada por el worker y enfoca su render widget. Aquí importa
    // conservar el input activo del documento, no document.hasFocus().
    await guard();await nativeInput(guard);signal.throwIfAborted();
  } else {
    const intent=new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:value});
    const proceed=input.dispatchEvent(intent);
    signal.throwIfAborted();
    const afterIntent=await readAleksPrompt(document);
    checkInput();
    if(afterIntent.fingerprint!==promptBefore.fingerprint || !root.isConnected)throw Error('El enunciado cambió antes de escribir.');
    if(proceed) {
      const readback=inspectAleksEditor(document).singleEditor.readback;
      if(readback.status!=='empty' || readback.fixed_unit!==before.fixed_unit)throw Error('El editor o su unidad cambió durante la preparación. Revisa el recuadro.');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
      input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }
  }
  const deadline=Date.now()+1600;
  while(Date.now()<deadline) {
    checkInput();
    const observation=inspectAleksEditor(document).singleEditor;
    if(observation.readback.selected_unit)throw Error('Apareció una unidad no solicitada durante la escritura.');
    if(observation.readback.fixed_unit!==before.fixed_unit)throw Error('La unidad del recuadro cambió durante la escritura. No se entregó la respuesta.');
    if(observation.status==='observed' && observation.readback.status==='readable' && sameAnswer(observation.readback.value,value)) {
      const current=await readAleksPrompt(document);checkInput();
      if(current.fingerprint!==promptBefore.fingerprint)throw Error('El enunciado cambió durante la escritura.');
      const confirmed=inspectAleksEditor(document).singleEditor;
      if(confirmed.status!=='observed' || confirmed.readback.status!=='readable' || !sameAnswer(confirmed.readback.value,value) ||
        confirmed.readback.selected_unit || confirmed.readback.fixed_unit!==before.fixed_unit)throw Error('La respuesta o su unidad cambió antes de confirmar la escritura.');
      return {written:true,display:value,submitted:false};
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(root.isConnected && inspectAleksEditor(document).singleEditor.readback.status==='empty')Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,previousBuffer);
  throw Error(`ALEKS no reflejó ${value.includes('/')?'la fracción vertical':'el entero'} en su árbol visual. No se envió ninguna respuesta; ${nativeInput?'usa Preparar diagnóstico del editor para revisar su estructura':'activa Usar teclado de Chrome para esta pestaña y vuelve a consultar con el recuadro vacío'}.`);
}
