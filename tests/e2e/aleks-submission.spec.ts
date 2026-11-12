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
  'prompt-change','changed-on-submit','abort','abort-on-submit','stop-on-submit','replace-before-submit','no-next-change','next-disabled','abort-next','next-prompt-changed',
  'next-button-replaced','next-feedback-replaced','next-feedback-rejected','hidden-stale','reused-updated'] as const) {
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
        if(mode==='next-button-replaced') {
          const next=document.querySelector('.learningCorrect')!;next.replaceWith(next.cloneNode(true));
        }
        if(mode==='next-feedback-replaced') {
          const feedback=document.querySelector('#result_feedback_alert')!;feedback.replaceWith(feedback.cloneNode(true));
        }
        if(mode==='next-feedback-rejected')document.querySelector('#result_feedback_alert > div')!.textContent='Incorrecta';
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
      expect(result.accepted).toBe(['no-next-change','next-disabled','abort-next','next-prompt-changed',
        'next-button-replaced','next-feedback-replaced','next-feedback-rejected'].includes(mode));
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

for(const mode of ['correct','reversed-answers','missing','duplicate-key','wrong-value','focus','abort','replace','reorder','changed-first','prompt','occupied','readonly','no-readback'] as const) {
  test(`dos recuadros: ${mode}`,async({page})=>{
    const result=await page.evaluate(async mode=>{
      const first=document.querySelector<HTMLElement>('.ansed_root')!;
      const second=first.cloneNode(true) as HTMLElement;first.after(second);
      const roots=[first,second],abort=new AbortController(),driver=new window.AleksSubmission(document,250);
      let clicks=0,error='',duplicate='',seen:string[]=[];
      roots.forEach((root,i)=>{
        const input=root.querySelector<HTMLInputElement>('input')!;
        input.addEventListener('input',()=>{
          if(mode==='no-readback' && i===1)return;
          const span=document.createElement('span');span.className='AnsedObject';span.textContent=mode==='wrong-value' && i===1?'9':input.value;
          span.style.cssText='position:absolute;left:2px;top:3px;height:24px';root.querySelector('.ansed_tree')!.replaceChildren(span);input.value='';
          if(i===1) {
            if(mode==='focus')document.querySelector<HTMLButtonElement>('.checkAnswer')!.focus();
            if(mode==='abort')abort.abort();
            if(mode==='replace')first.replaceWith(first.cloneNode(true));
            if(mode==='reorder')second.after(first);
            if(mode==='changed-first')first.querySelector('span')!.textContent='7';
            if(mode==='prompt')document.querySelector('#algoPrompt')!.textContent='Otro ejercicio';
          }
        });
      });
      if(mode==='occupied')first.querySelector('.ansed_tree')!.innerHTML='<span class="AnsedObject" style="position:absolute;left:2px;top:3px;height:24px">8</span>';
      if(mode==='readonly')second.querySelector<HTMLInputElement>('input')!.readOnly=true;
      const context=await window.assistContext(document);
      const submit=document.querySelector<HTMLButtonElement>('.checkAnswer')!;
      submit.addEventListener('click',()=>{
        clicks++;seen=roots.map(root=>root.querySelector('.ansed_tree')!.textContent!);submit.remove();
        document.body.insertAdjacentHTML('beforeend','<div id="result_feedback_alert" aria-live="polite"><div style="display:inline-block;color:rgb(57,108,41)">Correcta</div></div><button type="button" id="smt_bottomnav_button_input_learningCorrect" class="learningCorrect"><div class="textContent">Siguiente</div></button>');
      });
      let answers=[{field_key:'field_1',value:'12'},{field_key:mode==='duplicate-key'?'field_1':'field_2',value:'6'}];
      if(mode==='reversed-answers')answers.reverse();
      if(mode==='missing')answers.pop();
      try {
        await driver.submit(context.fingerprint,answers,abort.signal);
        try{await driver.submit(context.fingerprint,answers,abort.signal);}catch(e){duplicate=(e as Error).message;}
      }catch(e){error=(e as Error).message;}
      return {clicks,error,duplicate,seen,fields:context.fields};
    },mode);
    if(mode==='correct' || mode==='reversed-answers') {
      expect(result).toMatchObject({clicks:1,error:'',seen:['12','6']});expect(result.duplicate).toContain('ya fue iniciada');
      expect(result.fields.map(field=>field.key)).toEqual(['field_1','field_2']);
    } else {expect(result.clicks).toBe(0);expect(result.error).not.toBe('');}
  });
}

for(const mode of ['cm-square','cm-cube','missing','disabled','duplicate','no-unit','wrong-exponent','wrong-field','focus','cancel','changed-number'] as const) {
  test(`unidad por recuadro: ${mode}`,async({page})=>{
    const result=await page.evaluate(async mode=>{
      const first=document.querySelector<HTMLElement>('.ansed_root')!,second=first.cloneNode(true) as HTMLElement;first.after(second);
      const roots=[first,second],abort=new AbortController();let clicks=0,error='',unitClicks=0,seen:string[]=[];
      for(const root of roots) {
        root.style.width='200px';root.style.height='62px';
        const tree=root.querySelector<HTMLElement>('.ansed_tree')!;tree.style.width='200px';tree.style.height='62px';
        const input=root.querySelector<HTMLInputElement>('input')!;
        input.addEventListener('input',()=>{tree.innerHTML=`<span class="AnsedObject" style="position:absolute;font-family:'Times New Roman';left:10px;top:23px;height:26px">${input.value}</span>`;input.value='';});
      }
      const menu=document.querySelector('.aleks-editor-menu')!;menu.replaceChildren();
      for(const [unit,label] of [['cm','Centímetros'],['cm^2','Centímetros cuadrados'],['cm^3','Centímetros cúbicos']]) {
        const button=document.createElement('button');button.setAttribute('aria-label',label);button.setAttribute('aria-disabled',mode==='disabled'?'true':'false');button.textContent=unit;
        button.addEventListener('click',()=>{
          unitClicks++;
          const index=roots.findIndex(root=>root.contains(document.activeElement));
          const root=roots[mode==='wrong-field'?1-index:index];
          if(mode!=='no-unit') {
            const power=mode==='wrong-exponent'?'3':unit.slice(-1);
            root.querySelector('.ansed_tree')!.insertAdjacentHTML('beforeend',`<span class="AnsedObject" style="position:absolute;font-family:'Times New Roman';left:43px;top:23px;height:26px">cm</span>${unit==='cm'?'':`<span class="AnsedObject" style="position:absolute;font-family:'Times New Roman';left:65px;top:10px;height:24px">${power}</span>`}`);
          }
          if(mode==='focus')button.focus();
          if(mode==='cancel')abort.abort();
          if(mode==='changed-number')root.querySelector('span')!.textContent='99';
        });
        if(mode!=='missing')menu.append(button);
        if(mode==='duplicate')menu.append(button.cloneNode(true));
      }
      const submit=document.querySelector<HTMLButtonElement>('.checkAnswer')!;
      submit.addEventListener('click',()=>{
        clicks++;seen=roots.map(root=>root.querySelector('.ansed_tree')!.textContent!);submit.remove();
        document.body.insertAdjacentHTML('beforeend','<div id="result_feedback_alert" aria-live="polite"><div style="display:inline-block;color:rgb(57,108,41)">Correcta</div></div><button type="button" id="smt_bottomnav_button_input_learningCorrect" class="learningCorrect"><div class="textContent">Siguiente</div></button>');
      });
      const context=await window.assistContext(document);
      const answers=[{field_key:'field_2',value:'6',unit:mode==='cm-cube'?'cm³':'cm²'},{field_key:'field_1',value:'12',unit:'cm'}];
      try{await new window.AleksSubmission(document,300).submit(context.fingerprint,answers,abort.signal);}catch(e){error=(e as Error).message;}
      return {clicks,error,unitClicks,seen};
    },mode);
    if(mode==='cm-square' || mode==='cm-cube')expect(result).toEqual({clicks:1,error:'',unitClicks:2,seen:['12cm',`6cm${mode==='cm-cube'?'3':'2'}`]});
    else {expect(result.clicks).toBe(0);expect(result.error).not.toBe('');}
  });
}
