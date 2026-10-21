import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-correct-fragment.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/result-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/result-fixture');await page.addScriptTag({url:'/__probe.js'});
});
test('observa Correcta y Siguiente sin acreditar una entrega de la extensión ni avanzar',async({page})=>{
  const result=await page.evaluate(async()=>{
    let clicks=0;document.addEventListener('click',()=>clicks++);
    const detection=await window.pendingAdapter.detect();
    let feedback='blocked';try{await window.pendingAdapter.result();feedback='allowed';}catch{}
    let advance='blocked';try{await window.pendingAdapter.next();advance='allowed';}catch{}
    return {detection,feedback,advance,clicks};
  });
  expect(result.detection.editorObservation?.resultMarker).toEqual({status:'positive_marker',positiveMessageCount:1});
  expect(result.detection.supported).toBe(false);expect(result.feedback).toBe('blocked');expect(result.advance).toBe('blocked');expect(result.clicks).toBe(0);
  expect(result.detection.reason).toContain('Correcta y Siguiente');
});
for(const mutation of ['hidden','aria-hidden','wrong-text','wrong-style','wrapper','duplicate','no-next','disabled-next','simultaneous-submit'] as const) {
  test(`no confirma la señal positiva con ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const message=document.querySelector<HTMLDivElement>('body > div')!;
      const next=document.querySelector<HTMLButtonElement>('button')!;
      if(mutation==='hidden')message.hidden=true;
      if(mutation==='aria-hidden')message.setAttribute('aria-hidden','true');
      if(mutation==='wrong-text')message.textContent='La respuesta Correcta';
      if(mutation==='wrong-style')message.style.color='red';
      if(mutation==='wrapper'){const child=document.createElement('span');child.textContent='Correcta';message.replaceChildren(child);}
      if(mutation==='duplicate')message.after(message.cloneNode(true));
      if(mutation==='no-next')next.remove();
      if(mutation==='disabled-next')next.disabled=true;
      if(mutation==='simultaneous-submit'){
        const submit=document.createElement('button');submit.type='button';submit.id='smt_bottomnav_button_input_nextItemAssess';submit.className='nextItemAssess';
        const label=document.createElement('div');label.className='textContent';label.textContent='Entregar';submit.append(label);document.body.append(submit);
      }
      return window.aleksProbe(document).resultMarker;
    },mutation);
    expect(result.status).not.toBe('positive_marker');
  });
}
