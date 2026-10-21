import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-next-fragment.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/next-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/next-fixture');await page.addScriptTag({url:'/__probe.js'});
});
test('identifica Siguiente sin convertir learningCorrect en aceptación ni hacer clic',async({page})=>{
  const result=await page.evaluate(async()=>{
    let clicks=0;document.addEventListener('click',()=>clicks++);
    const detection=await window.pendingAdapter.detect();
    const attempt=async(operation:()=>Promise<unknown>)=>{try{await operation();return 'allowed';}catch{return 'blocked';}};
    return {detection,feedback:await attempt(()=>window.pendingAdapter.result()),advance:await attempt(()=>window.pendingAdapter.next()),clicks};
  });
  expect(result.detection.editorObservation?.nextControl).toEqual({status:'observed',count:1});
  expect(result.detection.editorObservation?.submitControl.status).toBe('missing');
  expect(result.detection.editorObservation?.renderedAnswer.status).toBe('missing');
  expect(result.detection.supported).toBe(false);expect(result.detection.session).toBe(false);
  expect(result.detection.reason).toContain('no se ha confirmado el resultado');
  expect(result.feedback).toBe('blocked');expect(result.advance).toBe('blocked');expect(result.clicks).toBe(0);
});
for(const mutation of ['label','class','hidden','duplicate','native-disabled','aria-disabled'] as const) {
  test(`no identifica Siguiente disponible con ${mutation}`,async({page})=>{
    const observation=await page.evaluate(mutation=>{
      const button=document.querySelector<HTMLButtonElement>('#smt_bottomnav_button_input_learningCorrect')!;
      if(mutation==='label')button.querySelector('.textContent')!.textContent='Entregar';
      if(mutation==='class')button.classList.remove('learningCorrect');
      if(mutation==='hidden')button.hidden=true;
      if(mutation==='duplicate')document.body.append(button.cloneNode(true));
      if(mutation==='native-disabled')button.disabled=true;
      if(mutation==='aria-disabled')button.setAttribute('aria-disabled','true');
      return window.aleksProbe(document).nextControl;
    },mutation);
    expect(observation.status).toBe(mutation==='duplicate'?'ambiguous':mutation.endsWith('disabled')?'disabled':'missing');
  });
}
