import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-submission-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/submission-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__submission.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/submission-fixture');await page.addScriptTag({url:'/__submission.js'});
});

for(const mode of ['correct','topic','assess','incorrect','timeout','next-only','plain-correct','stale','disabled','duplicate-button',
  'prompt-change','changed-on-submit','abort','abort-on-submit','stop-on-submit','replace-before-submit','no-next-change','next-disabled','abort-next','next-prompt-changed','hidden-stale','reused-updated'] as const) {
  test(`entrega sintética: ${mode}`,async({page})=>{
    const result=await page.evaluate(async mode=>{
      // Este editor refleja eventos públicos solamente para comprobar el flujo.
      // No acredita la aceptación de eventos sintéticos por el ALEKS nativo.
      const input=document.querySelector<HTMLInputElement>('input')!;
      input.addEventListener('input',()=>{
        const span=document.createElement('span');span.className='AnsedObject';span.textContent=input.value;
        span.style.cssText='display:block;position:absolute;font:18px serif;left:2px;top:3px;height:24px';
        document.querySelector('.ansed_tree')!.replaceChildren(span);input.value='';
      });
      let submits=0,nexts=0,accepted=false,error='',duplicateSubmit='',duplicateNext='';
      const submit=document.querySelector<HTMLButtonElement>('#smt_bottomnav_button_input_checkAnswer')!;
      const abort=new AbortController(),driver=new window.AleksSubmission(document,250);
      const positive=()=>{
        const feedback=document.querySelector<HTMLDivElement>('#result_feedback_alert') || document.createElement('div');feedback.id='result_feedback_alert';feedback.setAttribute('aria-live','polite');feedback.hidden=false;
        feedback.style.cssText='display:inline-block;border:1px solid rgb(57,108,41)';
        if(mode!=='hidden-stale')feedback.innerHTML=`<div style="display:inline-block;color:rgb(57,108,41)">${mode==='incorrect'?'Incorrecta':'Correcta'}</div>`;
        if(mode!=='next-only')document.body.append(mode==='plain-correct'?feedback.firstChild!:feedback);
        const next=document.createElement('button');next.type='button';next.id='smt_bottomnav_button_input_learningCorrect';next.className='learningCorrect';
        next.innerHTML=`<div><div class="textContent">${mode==='topic'?'Siguiente tema':'Siguiente'}</div></div>`;
        next.addEventListener('click',()=>{
          nexts++;
          if(mode==='no-next-change')return;
          document.querySelector('#algoPrompt')!.textContent='Hay 5 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?';
          document.querySelector('.ansed_tree')!.replaceChildren();feedback.remove();next.remove();document.body.append(submit);
        });
        document.body.append(next);
      };
      submit.addEventListener('click',()=>{
        submits++;
        if(mode==='abort-on-submit')abort.abort();
        if(mode==='stop-on-submit')driver.reset();
        if(mode==='changed-on-submit')document.querySelector('#algoPrompt')!.textContent='Otro problema';
        if(mode==='timeout')return;
        submit.remove();positive();
      });
      if(mode==='hidden-stale' || mode==='reused-updated') {
        const old=document.createElement('div');old.id='result_feedback_alert';old.hidden=true;old.setAttribute('aria-live','polite');
        old.innerHTML=`<div style="display:inline-block;color:rgb(57,108,41)">${mode==='hidden-stale'?'Correcta':'Esperando'}</div>`;
        document.body.append(old);
      }
      const context=await window.assistContext(document);
      if(mode==='assess'){submit.id='smt_bottomnav_button_input_nextItemAssess';submit.className='nextItemAssess';submit.querySelector('.textContent')!.textContent='Entregar';}
      if(mode==='stale')positive();
      if(mode==='disabled')submit.disabled=true;
      if(mode==='duplicate-button')document.body.append(submit.cloneNode(true));
      if(mode==='prompt-change')document.querySelector('#algoPrompt')!.textContent='Otro problema';
      if(mode==='abort')abort.abort();
      if(mode==='replace-before-submit')input.addEventListener('input',()=>submit.replaceWith(submit.cloneNode(true)));
      try {
        await driver.submit(context.fingerprint,'12',abort.signal);accepted=true;
        try{await driver.submit(context.fingerprint,'12',abort.signal);}catch(e){duplicateSubmit=(e as Error).message;}
        if(mode==='next-disabled')document.querySelector<HTMLButtonElement>('.learningCorrect')!.disabled=true;
        if(mode==='abort-next')abort.abort();
        if(mode==='next-prompt-changed')document.querySelector('#algoPrompt')!.textContent='Modificado';
        await driver.next(abort.signal);
        try{await driver.next(abort.signal);}catch(e){duplicateNext=(e as Error).message;}
      }catch(e){error=(e as Error).message;}
      return {submits,nexts,accepted,error,duplicateSubmit,duplicateNext};
    },mode);
    if(['correct','topic','assess','reused-updated'].includes(mode)) {
      expect(result).toMatchObject({submits:1,nexts:1,accepted:true,error:''});
      expect(result.duplicateSubmit).toContain('ya fue iniciada');expect(result.duplicateNext).toContain('No hay una respuesta');
    } else {
      expect(result.error).not.toBe('');
      expect(result.nexts).toBe(mode==='no-next-change'?1:0);
      expect(result.submits).toBe(['stale','disabled','duplicate-button','prompt-change','abort','replace-before-submit'].includes(mode)?0:1);
      expect(result.accepted).toBe(['no-next-change','next-disabled','abort-next','next-prompt-changed'].includes(mode));
    }
  });
}

test('dos ejercicios sucesivos se entregan una vez cada uno y exigen respuesta nueva',async({page})=>{
  const result=await page.evaluate(async()=>{
    const driver=new window.AleksSubmission(document,250),abort=new AbortController();let submits=0,nexts=0;
    const submit=document.querySelector<HTMLButtonElement>('.checkAnswer')!,input=document.querySelector<HTMLInputElement>('input')!;
    input.addEventListener('input',()=>{
      const span=document.createElement('span');span.className='AnsedObject';span.textContent=input.value;
      span.style.cssText='position:absolute;left:2px;top:3px;height:24px';document.querySelector('.ansed_tree')!.replaceChildren(span);input.value='';
    });
    submit.addEventListener('click',()=>{
      submits++;submit.remove();
      const feedback=document.createElement('div');feedback.id='result_feedback_alert';feedback.setAttribute('aria-live','polite');
      feedback.innerHTML='<div style="display:inline-block;color:rgb(57,108,41)">Correcta</div>';
      const next=document.createElement('button');next.type='button';next.id='smt_bottomnav_button_input_learningCorrect';next.className='learningCorrect';next.innerHTML='<div class="textContent">Siguiente</div>';
      next.addEventListener('click',()=>{
        nexts++;document.querySelector('#algoPrompt')!.textContent=`Ejercicio ${nexts+1}: calcular ${nexts+1} + 3.`;
        document.querySelector('.ansed_tree')!.replaceChildren();feedback.remove();next.remove();document.body.append(submit);
      });
      document.body.append(feedback,next);
    });
    for(const value of ['12','5']) {
      const context=await window.assistContext(document);await driver.submit(context.fingerprint,value,abort.signal);await driver.next(abort.signal);
    }
    return {submits,nexts};
  });
  expect(result).toEqual({submits:2,nexts:2});
});
