import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-submission-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/route-fixture',route=>route.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__route.js',route=>route.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/route-fixture');await page.addScriptTag({url:'/__route.js'});
});

const modes=['direct','button','role-button','hidden-copy','reused-hidden','missing-marker','duplicate-marker',
  'wrong-label','no-parent','hidden','disabled','aria-disabled','inert','duplicate-control','residual-prompt','residual-editor',
  'residual-feedback','not-accepted','already-visible','abort-before-next','abort-on-screen','reset-on-screen',
  'abort-on-route','reset-on-route','persistent','same-prompt','nonempty-exercise',
  'replace-control','replace-marker','disable-before-click','abort-before-click','reset-before-click',
  'empty-prompt','collapsed-prompt-with-text'] as const;

for(const mode of modes) {
  test(`transición de tema mediante Mi ruta: ${mode}`,async({page})=>{
    const result=await page.evaluate(async mode=>{
      // Reconstrucción de prueba a partir de los dos fragmentos aportados.
      // El ancestro button/role=button es semántico, sin IDs ALEKS inventados.
      // El editor y la devolución Correcta son simulados, no una sesión real.
      const exercise=document.createElement('div');
      exercise.append(...document.body.childNodes);document.body.append(exercise);
      const input=exercise.querySelector<HTMLInputElement>('.ansed_input')!;
      const tree=exercise.querySelector('.ansed_tree')!,prompt=exercise.querySelector('#algoPrompt')!;
      const submit=exercise.querySelector<HTMLButtonElement>('.checkAnswer')!;
      input.addEventListener('input',()=>{
        const glyph=document.createElement('span');glyph.className='AnsedObject';glyph.textContent=input.value;
        glyph.style.cssText='position:absolute;font:18px serif;left:2px;top:3px;height:24px';
        tree.replaceChildren(glyph);input.value='';
      });
      const driver=new window.AleksSubmission(document,350),abort=new AbortController();
      let submits=0,nexts=0,routeClicks=0,accepted=false,advanced=false,error='',duplicateNext='';
      const screen=document.createElement('div'),marker=document.createElement('div');
      marker.style.fontWeight='bold';marker.textContent='Temas restantes';
      const control=mode==='role-button'?document.createElement('div'):document.createElement('button');
      if(control instanceof HTMLButtonElement)control.type='button';
      else {control.setAttribute('role','button');control.tabIndex=0;}
      control.innerHTML='<div><div class="textContent">Continuar en Mi ruta</div></div>';
      if(mode==='wrong-label')control.querySelector('.textContent')!.textContent='Regresar a la página inicial';
      if(mode==='hidden')control.hidden=true;
      if(mode==='disabled' && control instanceof HTMLButtonElement)control.disabled=true;
      if(mode==='aria-disabled')control.setAttribute('aria-disabled','true');
      if(mode==='inert')control.setAttribute('inert','');
      if(mode!=='missing-marker')screen.append(marker);
      if(mode==='duplicate-marker')screen.append(marker.cloneNode(true));
      screen.append(mode==='no-parent'?control.firstElementChild!:control);
      if(mode==='duplicate-control')screen.append(control.cloneNode(true));
      if(mode==='hidden-copy'){
        const copy=control.cloneNode(true) as HTMLElement;copy.hidden=true;screen.append(copy);
      }
      if(['replace-control','replace-marker','disable-before-click','abort-before-click','reset-before-click'].includes(mode)){
        // Programar el cambio tras la primera inspección visible, para probar
        // la revalidación durante la espera del adaptador sin depender de que
        // el navegador alcance el rótulo dentro de un plazo arbitrario.
        const rectangles=control.getClientRects.bind(control);let scheduled=false;
        control.getClientRects=()=>{
          const result=rectangles();
          if(result.length && !scheduled){
            scheduled=true;setTimeout(()=>{
              if(mode==='replace-control')control.replaceWith(control.cloneNode(true));
              if(mode==='replace-marker')marker.replaceWith(marker.cloneNode(true));
              if(mode==='disable-before-click')control.setAttribute('aria-disabled','true');
              if(mode==='abort-before-click')abort.abort();
              if(mode==='reset-before-click')driver.reset();
            },0);
          }
          return result;
        };
      }
      function openExercise() {
        screen.remove();exercise.hidden=false;
        if(mode!=='same-prompt')prompt.textContent='Ejercicio siguiente: calcular 3 + 2.';
        if(mode!=='nonempty-exercise')tree.replaceChildren();
        exercise.append(submit);
      }
      control.addEventListener('click',()=>{
        routeClicks++;
        if(mode==='abort-on-route')abort.abort();
        if(mode==='reset-on-route')driver.reset();
        if(mode!=='persistent')openExercise();
      });
      submit.addEventListener('click',()=>{
        submits++;submit.remove();
        const feedback=document.createElement('div');feedback.id='result_feedback_alert';feedback.setAttribute('aria-live','polite');
        feedback.style.cssText='display:inline-block;border:1px solid rgb(57,108,41)';
        feedback.innerHTML='<div style="display:inline-block;color:rgb(57,108,41)">Correcta</div>';
        const next=document.createElement('button');next.type='button';next.id='smt_bottomnav_button_input_learningCorrect';next.className='learningCorrect';
        next.innerHTML='<div><div class="textContent">Siguiente tema</div></div>';
        next.addEventListener('click',()=>{
          nexts++;
          if(mode==='direct'){feedback.remove();next.remove();openExercise();return;}
          exercise.hidden=true;feedback.remove();next.remove();screen.hidden=false;document.body.append(screen);
          if(mode==='residual-prompt')document.body.append(prompt.cloneNode(true));
          if(mode==='empty-prompt' || mode==='collapsed-prompt-with-text'){
            const leftover=prompt.cloneNode(true) as HTMLElement;
            if(mode==='empty-prompt')leftover.replaceChildren();
            else leftover.style.height='0';
            document.body.append(leftover);
            control.addEventListener('click',()=>leftover.remove(),{once:true});
          }
          if(mode==='residual-editor')document.body.append(exercise.querySelector('.ansed_root')!.cloneNode(true));
          if(mode==='residual-feedback')document.body.append(feedback);
          if(mode==='abort-on-screen')abort.abort();
          if(mode==='reset-on-screen')driver.reset();
        });
        exercise.append(feedback,next);
      });
      if(mode==='reused-hidden'){screen.hidden=true;document.body.append(screen);}
      try {
        if(mode!=='not-accepted'){
          const context=await window.assistContext(document);
          await driver.submit(context.fingerprint,'12',abort.signal);accepted=true;
        } else {exercise.hidden=true;document.body.append(screen);}
        if(mode==='already-visible')document.body.append(screen);
        if(mode==='abort-before-next')abort.abort();
        await driver.next(abort.signal);advanced=true;
      } catch(reason){error=(reason as Error).message;}
      try{await driver.next(abort.signal);}catch(reason){duplicateNext=(reason as Error).message;}
      return {submits,nexts,routeClicks,accepted,advanced,error,duplicateNext,
        empty:tree.childNodes.length===0,prompt:prompt.textContent};
    },mode);
    const success=['direct','button','role-button','hidden-copy','reused-hidden','empty-prompt'].includes(mode);
    expect(result.accepted).toBe(mode!=='not-accepted');
    expect(result.submits).toBe(mode==='not-accepted'?0:1);
    expect(result.nexts).toBe(['not-accepted','already-visible','abort-before-next'].includes(mode)?0:1);
    expect(result.routeClicks).toBe(['button','role-button','hidden-copy','reused-hidden','abort-on-route','reset-on-route',
      'persistent','same-prompt','nonempty-exercise','empty-prompt'].includes(mode)?1:0);
    expect(result.advanced).toBe(success);
    expect(result.duplicateNext).not.toBe('');
    if(success){
      expect(result.error).toBe('');expect(result.empty).toBe(true);expect(result.prompt).toContain('Ejercicio siguiente');
    } else expect(result.error).not.toBe('');
    if(mode==='persistent')expect(result.error).toContain('Continuar en Mi ruta');
  });
}
