import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-verify-button.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/verify-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/verify-fixture');await page.addScriptTag({url:'/__probe.js'});
});
test('identifica Verificar aunque cambie la clase con hash, sin hacer clic ni habilitar entrega',async({page})=>{
  const result=await page.evaluate(async()=>{
    const button=document.querySelector('button')!;button.className='button--otro-hash large checkAnswer primary';
    let events=0;for(const name of ['click','input','change'])document.addEventListener(name,()=>events++);
    const before=document.body.innerHTML,detection=await window.pendingAdapter.detect();
    const submitBlocked=await window.pendingAdapter.submit().then(()=>false,()=>true);
    return {detection,events,unchanged:before===document.body.innerHTML,submitBlocked};
  });
  expect(result).toMatchObject({events:0,unchanged:true,submitBlocked:true,detection:{supported:false,session:false,
    editorObservation:{submitLabelCount:1,submitControl:{status:'observed',count:1,label:'Verificar'}}}});
  expect(result.detection.reason).toContain('Botón Verificar identificado');
});
for(const mutation of ['label','id','class','type','disabled','hidden'] as const) {
  test(`rechaza Verificar con ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const button=document.querySelector<HTMLButtonElement>('button')!;
      if(mutation==='label')button.querySelector('.textContent')!.textContent='Entregar';
      if(mutation==='id')button.id='otro-boton';
      if(mutation==='class')button.classList.remove('checkAnswer');
      if(mutation==='type')button.type='submit';
      if(mutation==='disabled')button.disabled=true;
      if(mutation==='hidden')button.hidden=true;
      return window.aleksProbe(document).submitControl;
    },mutation);
    expect(result.status).toBe(mutation==='disabled'?'disabled':'missing');
  });
}
test('dos controles de envío visibles son ambiguos aunque tengan etiquetas distintas',async({page})=>{
  const result=await page.evaluate(()=>{
    const deliver=document.createElement('button');deliver.type='button';deliver.id='smt_bottomnav_button_input_nextItemAssess';deliver.className='nextItemAssess';
    const label=document.createElement('div');label.className='textContent';label.textContent='Entregar';deliver.append(label);document.body.append(deliver);
    return window.aleksProbe(document).submitControl;
  });
  expect(result).toEqual({status:'ambiguous',count:2});
});
test('Correcta y Siguiente no bastan mientras Verificar siga visible',async({page})=>{
  const result=await page.evaluate(()=>{
    const message=document.createElement('div');message.style.cssText='display:inline-block;color:rgb(57,108,41)';message.textContent='Correcta';
    const next=document.createElement('button');next.type='button';next.id='smt_bottomnav_button_input_learningCorrect';next.className='learningCorrect';
    const label=document.createElement('div');label.className='textContent';label.textContent='Siguiente';next.append(label);document.body.append(message,next);
    return window.aleksProbe(document).resultMarker;
  });
  expect(result.status).toBe('ambiguous');
});
