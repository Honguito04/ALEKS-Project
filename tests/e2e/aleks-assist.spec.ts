import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/assist-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/assist-fixture');await page.addScriptTag({url:'/__probe.js'});
});
test('contexto sin HTML, URLs o buffer; cambia al cambiar el enunciado o llenar el editor',async({page})=>{
  const result=await page.evaluate(async()=>{
    document.querySelector<HTMLInputElement>('input')!.value='PRIVATE_BUFFER';
    const before=await window.assistContext(document);
    document.querySelector('#algoPrompt')!.textContent='Nuevo ejercicio';
    const after=await window.assistContext(document);
    return {before,after};
  });
  expect(result.before.can_fill_integer).toBe(true);expect(result.before.fields).toEqual([{key:'answer',label:'Respuesta del ejercicio'}]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_BUFFER');expect(result.after.fingerprint).not.toBe(result.before.fingerprint);
});
test('escritura solo se confirma si un editor sintético refleja el entero; nunca pulsa Verificar',async({page})=>{
  const result=await page.evaluate(async()=>{
    // Protocolo sintético de prueba, no implementación ni eventos reales de ALEKS.
    let clicks=0;document.addEventListener('click',()=>clicks++);
    const input=document.querySelector<HTMLInputElement>('input')!;
    input.addEventListener('input',()=>{
      const span=document.createElement('span');span.className='AnsedObject';span.textContent=input.value;
      span.style.cssText='display:block;position:absolute;font:18px serif;left:2px;top:3px;height:24px';
      document.querySelector('.ansed_tree')!.replaceChildren(span);input.value='';
    });
    const context=await window.assistContext(document);
    const written=await window.fillAssistInteger(document,context.fingerprint,'12',new AbortController().signal);
    return {written,clicks,readback:window.aleksProbe(document).singleEditor.readback};
  });
  expect(result).toMatchObject({written:{written:true,display:'12',submitted:false},clicks:0,readback:{value:'12'}});
});
test('input.value sin representación visual no acredita escritura; restaura el buffer sin entregar',async({page})=>{
  const result=await page.evaluate(async()=>{
    const input=document.querySelector<HTMLInputElement>('input')!;input.value='OLD_BUFFER';let clicks=0;document.addEventListener('click',()=>clicks++);
    const context=await window.assistContext(document);let error='';
    try{await window.fillAssistInteger(document,context.fingerprint,'12',new AbortController().signal);}catch(e){error=(e as Error).message;}
    return {error,value:input.value,clicks};
  });
  expect(result.error).toContain('no reflejó');expect(result.value).toBe('OLD_BUFFER');expect(result.clicks).toBe(0);
});
test('con captura permite un MathML no admitido sin enviar HTML o habilitar escritura',async({page})=>{
  const result=await page.evaluate(async()=>{
    document.querySelector('#algoPrompt')!.innerHTML='<span mathml="&lt;math&gt;&lt;mo&gt;∑&lt;/mo&gt;&lt;/math&gt;"></span><a href="https://private.invalid/session">Referencia</a>';
    let blocked=false;try{await window.assistContext(document);}catch{blocked=true;}
    return {blocked,context:await window.assistContext(document,true)};
  });
  expect(result.blocked).toBe(true);expect(result.context).toMatchObject({diagram_required:true,can_fill_integer:false});
  expect(JSON.stringify(result.context)).not.toContain('private.invalid');expect(JSON.stringify(result.context)).not.toContain('<math');
});
for(const state of ['changed-prompt','occupied','disabled','aborted','aborted-on-beforeinput','javascript','changed-on-focus'] as const) {
  test(`no escribe con ${state}`,async({page})=>{
    const result=await page.evaluate(async state=>{
      const context=await window.assistContext(document),input=document.querySelector<HTMLInputElement>('input')!,abort=new AbortController();
      let events=0;input.addEventListener('input',()=>events++);
      if(state==='changed-prompt')document.querySelector('#algoPrompt')!.textContent='Otro ejercicio';
      if(state==='occupied')document.querySelector('.ansed_tree')!.innerHTML='<span class="AnsedObject" style="position:absolute;left:2px;top:3px;height:24px">7</span>';
      if(state==='disabled')input.readOnly=true;
      if(state==='aborted')abort.abort();
      if(state==='aborted-on-beforeinput')input.addEventListener('beforeinput',()=>abort.abort());
      if(state==='changed-on-focus')input.addEventListener('focus',()=>{document.querySelector('#algoPrompt')!.textContent='Otro enunciado';});
      let failed=false;try{await window.fillAssistInteger(document,context.fingerprint,state==='javascript'?'alert(1)':'12',abort.signal);}catch{failed=true;}
      return {failed,events,value:input.value};
    },state);
    expect(result).toEqual({failed:true,events:0,value:''});
  });
}
