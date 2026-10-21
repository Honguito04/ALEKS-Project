import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-editor-fragment.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/editor-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/editor-fixture');await page.addScriptTag({url:'/__probe.js'});
});
test('reconoce los atributos aportados sin depender del ID dinámico ni modificar el editor',async({page})=>{
  const result=await page.evaluate(()=>{
    let changes=0;document.addEventListener('input',()=>changes++);document.addEventListener('click',()=>changes++);
    const input=document.querySelector<HTMLInputElement>('.ansed_input')!;input.id='otro-id-dinamico';
    return {observation:window.aleksProbe(document),value:input.value,changes};
  });
  expect(result).toMatchObject({observation:{status:'observed',inputCount:1,unitButtonCount:1,submitLabelCount:1,renderedAnswer:{status:'missing'},submitControl:{status:'missing',count:0}},value:'',changes:0});
});
test('reconocer un editor no habilita lectura de ejercicio, escritura ni entrega real',async({page})=>{
  const result=await page.evaluate(async()=>{
    const d=await window.pendingAdapter.detect();
    const attempt=async(operation:()=>Promise<unknown>)=>{try{await operation();return 'allowed';}catch{return 'blocked';}};
    return {d,read:await attempt(()=>window.pendingAdapter.read()),write:await attempt(()=>window.pendingAdapter.write()),submit:await attempt(()=>window.pendingAdapter.submit()),next:await attempt(()=>window.pendingAdapter.next())};
  });
  expect(result.d.supported).toBe(false);expect(result.d.session).toBe(false);expect(result.d.editorObservation?.status).toBe('observed');
  expect([result.read,result.write,result.submit,result.next]).toEqual(['blocked','blocked','blocked','blocked']);
});
for(const state of ['hidden','duplicate','disabled'] as const) {
  test(`el diagnóstico rechaza controles ${state}`,async({page})=>{
    const result=await page.evaluate(state=>{
      const input=document.querySelector<HTMLInputElement>('.ansed_input')!;
      if(state==='hidden')input.hidden=true;
      if(state==='duplicate')input.after(input.cloneNode(true));
      if(state==='disabled')document.querySelector('button[aria-label="Centímetros cúbicos"]')!.setAttribute('aria-disabled','true');
      return window.aleksProbe(document);
    },state);
    expect(result.status).toBe(state==='hidden'?'missing':state==='duplicate'?'ambiguous':'disabled');
  });
}
