import { assistContext,type FieldAnswer,type NativeInput } from './aleks-assist';
import { inspectEditorRoot } from './aleks-single-editor';
import { inspectAleksEditor } from './aleks-editor';
import { readAleksPrompt } from './aleks-prompt';
import { visible,disabled } from './aleks-dom';
import { answerUnit } from './answer-units';
import { parseSupportedAnswer,sameAnswer } from './answer-format';

export function answerRoots(document:Document):HTMLElement[] {
  return [...new Set([...document.querySelectorAll<HTMLInputElement>('input.ansed_input[aria-label="Answer Editor"][type="text"]')]
    .map(input=>input.closest<HTMLElement>('.ansed_root'))
    .filter((root):root is HTMLElement=>Boolean(root && visible(root) && !root.closest('#algoPrompt'))))]
    .sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top || a.getBoundingClientRect().left-b.getBoundingClientRect().left);
}

/** Orden visual estable. Nunca concatena dos respuestas. Selecciona únicamente los botones de cm aportados. */
export async function fillEditorAnswers(document:Document,fingerprint:string,answers:FieldAnswer[],signal:AbortSignal,nativeInput?:NativeInput) {
  signal.throwIfAborted();
  const promptNode=document.querySelector('#algoPrompt'),prompt=await readAleksPrompt(document);signal.throwIfAborted();
  const context=await assistContext(document);signal.throwIfAborted();
  const roots=answerRoots(document),inputs=roots.map(root=>root.querySelector<HTMLInputElement>('input.ansed_input')!);
  if(context.fingerprint!==fingerprint || !context.can_fill_integer || ![1,2].includes(roots.length) || answers.length!==roots.length || context.fields.length!==roots.length ||
    new Set(answers.map(answer=>answer.field_key)).size!==roots.length ||
    context.fields.some(field=>!answers.some(answer=>answer.field_key===field.key && parseSupportedAnswer(answer.value))))throw Error('Se necesita una respuesta válida por cada campo del ejercicio actual.');
  const units=context.fields.map(field=>{
    const raw=answers.find(answer=>answer.field_key===field.key)?.unit || '';
    const unit=raw?answerUnit(raw):undefined;
    if(raw && !['cm','cm^2','cm^3'].includes(unit || ''))throw Error('Unidad no admitida para seleccionar.');
    return unit;
  });
  const values=context.fields.map(field=>answers.find(answer=>answer.field_key===field.key)!.value);
  let completed=0;
  const guard=async(index:number)=>{
    signal.throwIfAborted();
    const current=await readAleksPrompt(document);signal.throwIfAborted();
    const now=answerRoots(document),editor=inspectAleksEditor(document);
    if(document.querySelector('#algoPrompt')!==promptNode || current.fingerprint!==prompt.fingerprint || now.length!==roots.length || now.some((root,i)=>root!==roots[i]) ||
      editor.resultMarker.positiveMessageCount || editor.nextControl.count || editor.nextTopicControl.count)throw Error('El ejercicio o los recuadros cambiaron durante la escritura.');
    for(let i=0;i<roots.length;i++) {
      const field=inspectEditorRoot(roots[i]);
      if(!inputs[i].isConnected || roots[i].querySelector('input.ansed_input')!==inputs[i] || inputs[i].closest('.ansed_root')!==roots[i] || disabled(inputs[i]) || inputs[i].readOnly || field.status!=='observed' || field.readback.fixed_unit ||
        (i<completed ? field.readback.status!=='readable' || !sameAnswer(field.readback.value,values[i]) || field.readback.selected_unit!==units[i] : i!==index && field.readback.status!=='empty'))throw Error('Un recuadro cambió o perdió su respuesta.');
    }
    if(index>=0 && document.activeElement!==inputs[index])throw Error('Cambió el foco del editor. Se detuvo la escritura.');
  };
  for(let i=0;i<roots.length;i++) {
    await guard(i===0?-1:i-1);inputs[i].focus();await guard(i);
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
      if(read.status==='readable' && sameAnswer(read.value,values[i]) && !read.selected_unit)break;
      if(Date.now()>=deadline)throw Error('ALEKS no reflejó una de las respuestas. No se entregó el ejercicio.');
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(units[i]) {
      const label=units[i]==='cm'?'Centímetros':units[i]==='cm^2'?'Centímetros cuadrados':'Centímetros cúbicos';
      const scope=roots[i].closest('.aleks-editor-layout') || document;
      const buttons=()=>[...scope.querySelectorAll<HTMLButtonElement>('button')].filter(button=>button.getAttribute('aria-label')===label && visible(button));
      const targets=buttons();
      if(targets.length!==1 || disabled(targets[0]))throw Error('No hay un único botón de unidad habilitado para este recuadro.');
      await guard(i);
      if(buttons().length!==1 || buttons()[0]!==targets[0] || disabled(targets[0]))throw Error('El botón de unidad cambió.');
      targets[0].click();
      const deadline=Date.now()+1600;
      while(true) {
        await guard(i);
        const read=inspectEditorRoot(roots[i]).readback;
        if(read.status==='readable' && sameAnswer(read.value,values[i]) && read.selected_unit===units[i])break;
        if(Date.now()>=deadline)throw Error('ALEKS no reflejó el número y su unidad. No se entregó la respuesta.');
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    }
    completed++;
  }
  await guard(roots.length-1);
  return {written:true,display:values.join('; '),submitted:false};
}
