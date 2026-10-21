import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/single-fixture',route=>route.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',route=>route.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/single-fixture');await page.addScriptTag({url:'/__probe.js'});
});

test('reconoce un recuadro vacío con input transparente sin exigir cm³ ni un menú de unidades',async({page})=>{
  const result=await page.evaluate(async()=>{
    const before=document.body.innerHTML;let events=0;
    for(const name of ['input','change','click'])document.addEventListener(name,()=>events++);
    const detection=await window.pendingAdapter.detect();
    return {detection,events,unchanged:before===document.body.innerHTML};
  });
  expect(result).toMatchObject({events:0,unchanged:true,detection:{supported:false,session:false,activity:'sin-validar',
    promptObservation:{status:'readable',statement:'Hay 4 nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?'},
    editorObservation:{inputCount:0,unitButtonCount:0,singleEditor:{status:'observed',rootCount:1,disabled:false,autoSubmitSupported:false,readback:{status:'empty'}},
      submitControl:{status:'observed',count:1,label:'Verificar'},inputDiagnostics:{presentCount:1,paintedCount:0,visibleRootCount:1,blockedBy:{opacityZero:1}}}}});
  expect(result.detection.reason).toContain('Un recuadro visual reconocido');
  expect(result.detection.reason).not.toContain('No se encuentran todos los controles');
});

test('lee el entero visual e ignora el buffer; no acredita corrección ni desbloquea operaciones',async({page})=>{
  const result=await page.evaluate(async()=>{
    document.querySelector('.ansed_tree')!.innerHTML='<span class="AnsedObject" style="display:block;position:absolute;font:18px serif;left:2px;top:3px;height:24px">12</span>';
    document.querySelector<HTMLInputElement>('.ansed_input')!.value='PRIVATE_BUFFER';
    const detection=await window.pendingAdapter.detect();const blocked:string[]=[];
    for(const operation of ['read','write','submit','result','next'] as const) {
      try{await window.pendingAdapter[operation]();}catch{blocked.push(operation);}
    }
    return {detection,blocked};
  });
  expect(result.detection.editorObservation?.singleEditor.readback).toMatchObject({status:'readable',value:'12',display:'12'});
  expect(JSON.stringify(result.detection)).not.toContain('PRIVATE_BUFFER');
  expect(result.blocked).toEqual(['read','write','submit','result','next']);
  expect(result.detection.complete).toBe(false);expect(result.detection.supported).toBe(false);
});

for(const mutation of ['duplicate','hidden','extra-input','extra-tree','in-prompt','no-root'] as const) {
  test(`no presenta un recuadro único compatible con ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const root=document.querySelector<HTMLElement>('.ansed_root')!;
      if(mutation==='duplicate')root.after(root.cloneNode(true));
      if(mutation==='hidden')root.style.opacity='0';
      if(mutation==='extra-input')root.append(root.querySelector('input')!.cloneNode(true));
      if(mutation==='extra-tree')root.append(root.querySelector('.ansed_tree')!.cloneNode(true));
      if(mutation==='in-prompt')document.querySelector('#algoPrompt')!.append(root);
      if(mutation==='no-root')root.replaceWith(root.querySelector('input')!);
      return window.aleksProbe(document).singleEditor;
    },mutation);
    expect(result.status).toBe(mutation==='duplicate'?'ambiguous':mutation==='extra-input'||mutation==='extra-tree'?'unsupported':'missing');
    expect(result.readback.value).toBeUndefined();expect(result.autoSubmitSupported).toBe(false);
  });
}

for(const mutation of ['sign','unit','clipped','hidden','exponent','far-apart','loose-text','too-long'] as const) {
  test(`no lee como entero una respuesta con ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const tree=document.querySelector('.ansed_tree')!;
      tree.innerHTML='<span class="AnsedObject" style="display:block;position:absolute;font:18px serif;left:2px;top:3px;height:24px">12</span>';
      const first=tree.firstElementChild as HTMLElement;
      if(mutation==='sign')first.textContent='-12';
      if(mutation==='too-long')first.textContent='1234567890123';
      if(mutation==='clipped')first.style.left='100px';
      if(mutation==='hidden')first.style.visibility='hidden';
      if(mutation==='loose-text')tree.append(document.createTextNode('+1'));
      if(['unit','exponent','far-apart'].includes(mutation)) {
        first.textContent='1';const second=first.cloneNode(true) as HTMLElement;second.textContent=mutation==='unit'?'cm':'2';
        second.style.left=mutation==='far-apart'?'27px':'12px';if(mutation==='exponent')second.style.top='0px';tree.append(second);
      }
      return window.aleksProbe(document).singleEditor.readback;
    },mutation);
    expect(result.status).toBe('unsupported');expect(result.value).toBeUndefined();
  });
}

test('conserva la separación entre editor observado y editor deshabilitado',async({page})=>{
  const result=await page.evaluate(()=>{
    document.querySelector<HTMLInputElement>('.ansed_input')!.readOnly=true;
    return window.aleksProbe(document).singleEditor;
  });
  expect(result).toMatchObject({status:'observed',disabled:true,autoSubmitSupported:false,readback:{status:'empty'}});
});

test('lee varios spans de dígitos contiguos como un entero simple',async({page})=>{
  const result=await page.evaluate(()=>{
    document.querySelector('.ansed_tree')!.innerHTML='<span class="AnsedObject" style="display:block;position:absolute;font:18px serif;left:2px;top:3px;height:24px">1</span><span class="AnsedObject" style="display:block;position:absolute;font:18px serif;left:11px;top:3px;height:24px">2</span>';
    return window.aleksProbe(document).singleEditor.readback;
  });
  expect(result).toMatchObject({status:'readable',value:'12'});
});
