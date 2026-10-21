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
test('cuenta dos recuadros como los reportados sin deducir su correspondencia ni escribir',async({page})=>{
  const result=await page.evaluate(async()=>{
    const input=document.querySelector<HTMLInputElement>('.ansed_input')!;
    input.id='ansed_input_tabed_fixture_object_1';input.style.cssText='width:17px;height:32px';
    const second=input.cloneNode(true) as HTMLInputElement;second.id='ansed_input_tabed_fixture_object_2';input.after(second);
    let events=0;for(const name of ['input','change','click'])document.addEventListener(name,()=>events++);
    const detection=await window.pendingAdapter.detect();
    return {detection,events,values:[input.value,second.value]};
  });
  expect(result).toMatchObject({events:0,values:['',''],detection:{supported:false,editorObservation:{status:'ambiguous',inputCount:2,
    inputDiagnostics:{presentCount:2,paintedCount:2,ariaHiddenCount:0,frameCount:0},renderedAnswer:{status:'ambiguous'}}}});
});
test('distingue un input pintado pero excluido por aria-hidden sin autorizar su uso',async({page})=>{
  const result=await page.evaluate(()=>{
    const input=document.querySelector<HTMLInputElement>('.ansed_input')!,wrapper=document.createElement('div');
    wrapper.setAttribute('aria-hidden','true');input.replaceWith(wrapper);wrapper.append(input);
    return window.aleksProbe(document);
  });
  expect(result).toMatchObject({status:'missing',inputCount:0,inputDiagnostics:{presentCount:1,paintedCount:1,ariaHiddenCount:1,frameCount:0},renderedAnswer:{status:'missing'}});
});
test('distingue un input oculto por CSS de uno ausente sin leer su valor',async({page})=>{
  const result=await page.evaluate(()=>{
    const input=document.querySelector<HTMLInputElement>('.ansed_input')!;input.style.display='none';input.value='PRIVATE_INPUT_VALUE';
    return window.aleksProbe(document);
  });
  expect(result).toMatchObject({status:'missing',inputCount:0,inputDiagnostics:{presentCount:1,paintedCount:0,ariaHiddenCount:0,frameCount:0}});
  expect(JSON.stringify(result)).not.toContain('PRIVATE_INPUT_VALUE');
});
for(const state of ['display-none','visibility-hidden','opacity-zero','ancestor-opacity','hidden-attribute'] as const) {
  test(`detalla el motivo ${state} y reconoce el contenedor pintado sin habilitar su input`,async({page})=>{
    const result=await page.evaluate(async state=>{
      const input=document.querySelector<HTMLInputElement>('.ansed_input')!;
      const root=document.createElement('div');root.className='ansed_root';root.style.cssText='width:250px;height:62px';
      input.replaceWith(root);root.append(input);
      if(state==='display-none')input.style.display='none';
      if(state==='visibility-hidden')input.style.visibility='hidden';
      if(state==='opacity-zero')input.style.opacity='0';
      if(state==='hidden-attribute')input.hidden=true;
      if(state==='ancestor-opacity') {
        const wrapper=document.createElement('div');wrapper.style.opacity='0';input.replaceWith(wrapper);wrapper.append(input);
      }
      const before=document.body.innerHTML;let events=0;
      for(const name of ['input','change','click'])document.addEventListener(name,()=>events++);
      const detection=await window.pendingAdapter.detect();
      return {detection,events,unchanged:before===document.body.innerHTML};
    },state);
    expect(result).toMatchObject({events:0,unchanged:true,detection:{supported:false,editorObservation:{inputCount:0,
      inputDiagnostics:{presentCount:1,paintedCount:0,visibleRootCount:1}}}});
    const blockers=result.detection.editorObservation?.inputDiagnostics.blockedBy;
    expect(blockers).toBeDefined();
    expect(blockers?.displayNone).toBe(state==='display-none'||state==='hidden-attribute'?1:0);
    expect(blockers?.visibilityHidden).toBe(state==='visibility-hidden'?1:0);
    expect(blockers?.opacityZero).toBe(state==='opacity-zero'||state==='ancestor-opacity'?1:0);
    expect(blockers?.hiddenAttribute).toBe(state==='hidden-attribute'?1:0);
    expect(blockers?.noLayout).toBe(state==='display-none'||state==='hidden-attribute'?1:0);
  });
}
test('cuenta marcos sin explorar sus campos, URLs o contenido',async({page})=>{
  const result=await page.evaluate(()=>{
    document.querySelector('.ansed_input')!.remove();
    const frame=document.createElement('iframe');frame.srcdoc='<input aria-label="Answer Editor" class="ansed_input" type="text" value="PRIVATE_FRAME_VALUE">';document.body.append(frame);
    return window.aleksProbe(document);
  });
  expect(result).toMatchObject({status:'missing',inputCount:0,inputDiagnostics:{presentCount:0,paintedCount:0,ariaHiddenCount:0,frameCount:1}});
  expect(JSON.stringify(result)).not.toContain('PRIVATE_FRAME_VALUE');
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
