import { assistContextSchema,type AssistContext,type FillBlocker } from './shared';
import { readAleksPrompt } from './aleks-prompt';
import { inspectAleksEditor } from './aleks-editor';
import { visible,disabled } from './aleks-dom';
import { parseSupportedAnswer } from './answer-format';

export async function assistContext(document:Document,allowImage=false):Promise<AssistContext> {
  const prompt=await readAleksPrompt(document);
  const prompts=[...document.querySelectorAll<HTMLElement>('#algoPrompt')].filter(visible);
  const readable=prompt.status==='readable' && Boolean(prompt.statement && prompt.fingerprint);
  if(!readable && (!allowImage || prompts.length!==1))throw Error('No hay un enunciado legible. Si el ejercicio está visible, incluye su captura para consultar a la IA.');
  const editor=inspectAleksEditor(document),single=editor.singleEditor;
  const roots=new Set([...document.querySelectorAll<HTMLInputElement>('input.ansed_input[aria-label="Answer Editor"][type="text"]')]
    .map(input=>input.closest<HTMLElement>('.ansed_root')).filter((root):root is HTMLElement=>root!==null && visible(root) && !root.closest('#algoPrompt')));
  if(roots.size>12)throw Error('Hay demasiados recuadros para esta consulta.');
  const fields=editor.circleTable.status==='observed'?editor.circleTable.fields.map(field=>({key:field.kind,label:field.label})):
    roots.size>1?[...roots].sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top || a.getBoundingClientRect().left-b.getBoundingClientRect().left)
      .map((_,i)=>({key:`field_${i+1}`,label:`Recuadro ${i+1} en orden visual de arriba abajo e izquierda a derecha; asociación sin validar`})):
      [{key:'answer',label:'Respuesta del ejercicio'}];
  const fill_blockers:FillBlocker[]=[];
  if(!readable)fill_blockers.push('unreadable_prompt');
  if(single.status!=='observed')fill_blockers.push(single.status==='ambiguous'?'multiple_editors':single.status==='missing'?'editor_missing':'editor_structure');
  else {
    if(single.disabled)fill_blockers.push('editor_disabled');
    if(single.readback.status==='readable')fill_blockers.push('editor_not_empty');
    if(single.readback.status==='unsupported')fill_blockers.push('unsupported_readback');
  }
  if(editor.resultMarker.positiveMessageCount>0 || editor.nextControl.count>0 || editor.nextTopicControl.count>0)fill_blockers.push('result_present');
  if(prompt.diagramReferenceDetected)fill_blockers.push('diagram_required');
  const can_fill_integer=fill_blockers.length===0;
  const can_fill_fraction=can_fill_integer;
  // Cuando la lectura estructurada falla, el texto/MathML se usa solo en el
  // hash local. La IA recibe la captura elegida, sin HTML o enlaces de sesión.
  const fallback=readable?undefined:[prompts[0].textContent?.slice(0,8000),[...prompts[0].querySelectorAll('[mathml]')].slice(0,100).map(node=>node.getAttribute('mathml')?.slice(0,1000))];
  // Verificar y el menú pueden aparecer al enfocar. No son utilizados para
  // introducir el número y no forman parte de esta huella de escritura.
  const source=JSON.stringify([prompt.fingerprint,fallback,fields,fill_blockers,editor.inputDiagnostics.presentCount,
    single.status,single.rootCount,single.disabled,single.readback,editor.circleTable]);
  const fingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)))].map(value=>value.toString(16).padStart(2,'0')).join('');
  return assistContextSchema.parse({fingerprint,statement:readable?prompt.statement:'No fue posible leer el enunciado como texto estructurado. Interpreta únicamente el ejercicio visible en la captura adjunta; si faltan datos, indícalo.',
    fields,diagram_required:!readable || Boolean(prompt.diagramReferenceDetected),can_fill_integer,can_fill_fraction,fill_blockers});
}

/** El usuario confirmó la conversión automática de a/b en fracción vertical.
 * Se solicita esa escritura una vez y se exige su representación visual.
 * Los eventos sintéticos deben comprobarse en cada instalación de ALEKS.
 */
export async function fillAssistAnswer(document:Document,fingerprint:string,value:string,signal:AbortSignal) {
  if(!parseSupportedAnswer(value))throw Error('La respuesta debe ser un entero o una fracción reducida no negativa, sin unidad.');
  return fillScalar(document,fingerprint,value,signal);
}

/** Una sola tentativa, iniciada desde el panel, en un recuadro vacío.
 * No entrega, avanza ni ejecuta instrucciones del modelo. input/change son
 * eventos públicos sintéticos: la lectura visual decide si funcionaron.
 */
export async function fillAssistInteger(document:Document,fingerprint:string,value:string,signal:AbortSignal) {
  if(!/^(0|[1-9]\d{0,11})$/u.test(value))throw Error('La escritura asistida admite únicamente un entero sin unidad.');
  return fillScalar(document,fingerprint,value,signal);
}

async function fillScalar(document:Document,fingerprint:string,value:string,signal:AbortSignal) {
  signal.throwIfAborted();
  const before=await assistContext(document);
  if(before.fingerprint!==fingerprint || !before.can_fill_integer)throw Error('El ejercicio o el recuadro cambió. Vuelve a consultar a la IA.');
  const promptBefore=await readAleksPrompt(document);
  const inputs=[...document.querySelectorAll<HTMLInputElement>('input.ansed_input[aria-label="Answer Editor"][type="text"]')]
    .filter(input=>{const root=input.closest<HTMLElement>('.ansed_root');return root && visible(root) && !root.closest('#algoPrompt');});
  if(inputs.length!==1)throw Error('No hay un único recuadro al que escribir.');
  const input=inputs[0],root=input.closest<HTMLElement>('.ansed_root')!,previousBuffer=input.value;
  input.focus();
  const focused=await assistContext(document);signal.throwIfAborted();
  if(!root.isConnected || focused.fingerprint!==fingerprint || !focused.can_fill_integer)throw Error('La página cambió al enfocar el editor.');
  const intent=new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:value});
  const proceed=input.dispatchEvent(intent);
  signal.throwIfAborted();
  const afterIntent=await readAleksPrompt(document);
  signal.throwIfAborted();
  if(afterIntent.fingerprint!==promptBefore.fingerprint || !root.isConnected)throw Error('El enunciado cambió antes de escribir.');
  if(proceed) {
    const stillEmpty=inspectAleksEditor(document).singleEditor.readback.status==='empty';
    if(!stillEmpty)throw Error('El editor cambió durante la preparación. Revisa el recuadro.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  const deadline=Date.now()+1600;
  while(Date.now()<deadline) {
    signal.throwIfAborted();
    if(!root.isConnected || !input.isConnected || input.closest('.ansed_root')!==root || !visible(root) || disabled(input) || input.readOnly)throw Error('El editor desapareció o cambió durante la escritura.');
    const observation=inspectAleksEditor(document).singleEditor;
    if(observation.status==='observed' && observation.readback.status==='readable' && observation.readback.value===value) {
      const current=await readAleksPrompt(document);signal.throwIfAborted();
      if(current.fingerprint!==promptBefore.fingerprint)throw Error('El enunciado cambió durante la escritura.');
      return {written:true,display:value,submitted:false};
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(root.isConnected && inspectAleksEditor(document).singleEditor.readback.status==='empty')Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,previousBuffer);
  throw Error(`ALEKS no reflejó ${value.includes('/')?'la fracción vertical':'el entero'} en su árbol visual. No se envió ninguna respuesta; usa Preparar diagnóstico del editor para revisar su estructura.`);
}
