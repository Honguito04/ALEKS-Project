import { assistContext,type FieldAnswer,type NativeInput } from './aleks-assist';
import { inspectEditorRoot } from './aleks-single-editor';
import { inspectAleksEditor } from './aleks-editor';
import { readAleksPrompt } from './aleks-prompt';
import { visible,disabled } from './aleks-dom';
import { parseSupportedAnswer } from './answer-format';

export function answerRoots(document:Document):HTMLElement[] {
  return [...new Set([...document.querySelectorAll<HTMLInputElement>('input.ansed_input[aria-label="Answer Editor"][type="text"]')]
    .map(input=>input.closest<HTMLElement>('.ansed_root'))
    .filter((root):root is HTMLElement=>Boolean(root && visible(root) && !root.closest('#algoPrompt'))))]
    .sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top || a.getBoundingClientRect().left-b.getBoundingClientRect().left);
}

/** Orden visual estable. Nunca concatena dos respuestas ni selecciona unidades. */
export async function fillTwoAnswers(document:Document,fingerprint:string,answers:FieldAnswer[],signal:AbortSignal,nativeInput?:NativeInput) {
  signal.throwIfAborted();
  const context=await assistContext(document);signal.throwIfAborted();
  const roots=answerRoots(document),inputs=roots.map(root=>root.querySelector<HTMLInputElement>('input.ansed_input')!);
  if(context.fingerprint!==fingerprint || !context.can_fill_integer || roots.length!==2 || answers.length!==2 ||
    new Set(answers.map(answer=>answer.field_key)).size!==2 ||
    context.fields.some(field=>!answers.some(answer=>answer.field_key===field.key && parseSupportedAnswer(answer.value))))throw Error('Se necesitan dos respuestas válidas, una por campo del ejercicio actual.');
  const values=context.fields.map(field=>answers.find(answer=>answer.field_key===field.key)!.value);
  const prompt=await readAleksPrompt(document),promptNode=document.querySelector('#algoPrompt');
  let completed=0;
  const guard=async(index:number)=>{
    signal.throwIfAborted();
    const current=await readAleksPrompt(document);signal.throwIfAborted();
    const now=answerRoots(document),editor=inspectAleksEditor(document);
    if(document.querySelector('#algoPrompt')!==promptNode || current.fingerprint!==prompt.fingerprint || now.length!==2 || now.some((root,i)=>root!==roots[i]) ||
      editor.resultMarker.positiveMessageCount || editor.nextControl.count || editor.nextTopicControl.count)throw Error('El ejercicio o los recuadros cambiaron durante la escritura.');
    for(let i=0;i<2;i++) {
      const field=inspectEditorRoot(roots[i]);
      if(!inputs[i].isConnected || roots[i].querySelector('input.ansed_input')!==inputs[i] || inputs[i].closest('.ansed_root')!==roots[i] || disabled(inputs[i]) || inputs[i].readOnly || field.status!=='observed' || field.readback.fixed_unit ||
        (i<completed ? field.readback.status!=='readable' || field.readback.value!==values[i] : i!==index && field.readback.status!=='empty'))throw Error('Un recuadro cambió o perdió su respuesta.');
    }
    if(index>=0 && document.activeElement!==inputs[index])throw Error('Cambió el foco del editor. Se detuvo la escritura.');
  };
  for(let i=0;i<2;i++) {
    await guard(-1);inputs[i].focus();await guard(i);
    if(nativeInput)await nativeInput(()=>guard(i));
    else {
      const proceed=inputs[i].dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:values[i]}));
      await guard(i);
      if(proceed) {
        if(inspectEditorRoot(roots[i]).readback.status!=='empty')throw Error('El recuadro cambió antes de escribir.');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(inputs[i],values[i]);
        inputs[i].dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:values[i]}));
        inputs[i].dispatchEvent(new Event('change',{bubbles:true}));
      }
    }
    const deadline=Date.now()+1600;
    while(true) {
      await guard(i);
      const read=inspectEditorRoot(roots[i]).readback;
      if(read.status==='readable' && read.value===values[i])break;
      if(Date.now()>=deadline)throw Error('ALEKS no reflejó una de las respuestas. No se entregó el ejercicio.');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    completed++;
  }
  await guard(1);
  return {written:true,display:values.join('; '),submitted:false};
}
