import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-editor-rendered.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/rendered-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/rendered-fixture');await page.addScriptTag({url:'/__probe.js'});
});

test('lee 226 cm³ del árbol visual aria-hidden con el input vacío, sin escribir ni entregar',async({page})=>{
  const result=await page.evaluate(async()=>{
    let changes=0;document.addEventListener('input',()=>changes++);document.addEventListener('click',()=>changes++);
    const input=document.querySelector<HTMLInputElement>('.ansed_input')!;
    const observation=window.aleksProbe(document),detection=await window.pendingAdapter.detect();
    return {observation,detection,value:input.value,changes};
  });
  expect(result.observation.renderedAnswer).toMatchObject({status:'readable',value:'226',unit:'cm^3',display:'226 cm³'});
  expect(result.observation.submitControl).toEqual({status:'observed',count:1});
  expect(result.value).toBe('');expect(result.changes).toBe(0);
  expect(result.detection.supported).toBe(false);expect(result.detection.session).toBe(false);
  expect(result.detection.reason).toContain('Respuesta visible: 226 cm³');
});

test('no confunde el buffer del input con la respuesta representada',async({page})=>{
  const result=await page.evaluate(()=>{
    document.querySelector<HTMLInputElement>('.ansed_input')!.value='999';
    return window.aleksProbe(document);
  });
  expect(result.renderedAnswer).toMatchObject({status:'readable',value:'226',unit:'cm^3'});
});

for(const mutation of ['area','baseline','extra-token','clipped','hidden','duplicate'] as const) {
  test(`no declara legible una representación ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const tree=document.querySelector<HTMLElement>('.ansed_tree')!;
      const power=tree.children[2] as HTMLElement;
      if(mutation==='area')power.textContent='2';
      if(mutation==='baseline')power.style.top='23px';
      if(mutation==='extra-token')tree.append(document.createTextNode('+ 1'));
      if(mutation==='clipped')power.style.left='300px';
      if(mutation==='hidden')tree.hidden=true;
      if(mutation==='duplicate')document.body.append(document.querySelector('.aleks-editor-layout')!.cloneNode(true));
      return window.aleksProbe(document).renderedAnswer;
    },mutation);
    expect(result.status).not.toBe('readable');expect(result.value).toBeUndefined();expect(result.unit).toBeUndefined();
  });
}

for(const mutation of ['native-disabled','aria-disabled','label','id','duplicate','hidden'] as const) {
  test(`no identifica Entregar disponible con ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const button=document.querySelector<HTMLButtonElement>('#smt_bottomnav_button_input_nextItemAssess')!;
      if(mutation==='native-disabled')button.disabled=true;
      if(mutation==='aria-disabled')button.setAttribute('aria-disabled','true');
      if(mutation==='label')button.querySelector('.textContent')!.textContent='Siguiente';
      if(mutation==='id')button.id='otro-control';
      if(mutation==='duplicate')document.body.append(button.cloneNode(true));
      if(mutation==='hidden')button.hidden=true;
      return window.aleksProbe(document).submitControl;
    },mutation);
    expect(result.status).toBe(mutation==='duplicate'?'ambiguous':mutation.endsWith('disabled')?'disabled':'missing');
  });
}
