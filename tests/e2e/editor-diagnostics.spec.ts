import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/editor-diagnostics-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/diagnostics-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__diagnostics.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/diagnostics-fixture');await page.addScriptTag({url:'/__diagnostics.js'});
});
test('informe incluye geometría de fracción y controles conocidos sin modificar la página',async({page})=>{
  const result=await page.evaluate(()=>{
    let clicks=0,events=0;document.addEventListener('click',()=>clicks++);document.addEventListener('input',()=>events++);
    document.querySelector('.ansed_root')!.setAttribute('style','position:relative;width:60px;height:70px');
    document.querySelector('.ansed_tree')!.innerHTML='<span class="AnsedObject" style="position:absolute;left:12px;top:2px;width:12px;height:20px">1</span><span class="AnsedObject" style="position:absolute;left:12px;top:40px;width:12px;height:20px">5</span>';
    document.querySelector('.aleks-editor-menu')!.insertAdjacentHTML('beforeend','<button aria-label="Fraction">Fracción</button>');
    const before=document.body.innerHTML,report=window.editorDiagnostics(document);
    return {report,unchanged:before===document.body.innerHTML,clicks,events};
  });
  expect(result).toMatchObject({unchanged:true,clicks:0,events:0,report:{rootCount:1,inputCount:1,truncated:false}});
  const editor=result.report.editors[0];
  expect(editor.inputs[0].visibility.opacity).toBe(0);
  expect(editor.trees[0]!.children).toMatchObject([{token:'1',box:{left:12,top:2}},{token:'5',box:{left:12,top:40}}]);
  expect(result.report.controls).toContainEqual({label:'Fraction',count:1,visible:1,enabled:1});
  expect(result.report.controls).toContainEqual({label:'Verificar',count:1,visible:1,enabled:1});
});
test('omite texto privado, atributos, buffer, HTML, URL y contenido de marcos',async({page})=>{
  const report=await page.evaluate(()=>{
    document.title='PRIVATE_TITLE';document.querySelector('#algoPrompt')!.textContent='PRIVATE_PROMPT';
    const input=document.querySelector<HTMLInputElement>('input')!;input.value='PRIVATE_BUFFER';input.id='PRIVATE_ID';input.setAttribute('data-private','PRIVATE_ATTRIBUTE');
    document.querySelector('.ansed_tree')!.innerHTML='<span class="AnsedObject PRIVATE_CLASS" title="PRIVATE_TITLE">PRIVATE_PERSON</span><span class="AnsedObject">alert(1)</span><span class="AnsedObject">1/5</span>';
    document.body.insertAdjacentHTML('beforeend','<a href="https://private.invalid/PRIVATE_SESSION">PRIVATE_LINK</a><button>PRIVATE_ACCOUNT</button><iframe srcdoc="PRIVATE_FRAME"></iframe>');
    return window.editorDiagnostics(document);
  });
  expect(JSON.stringify(report)).not.toMatch(/PRIVATE|private\.invalid|alert\(1\)|<span|srcdoc/);
  expect(report.frameCount).toBe(1);expect(report.editors[0].trees[0]!.children?.[0].redactedText).toBe(true);
  expect(report.editors[0].trees[0]!.children?.[2].token).toBe('1/5');
});
test('limita raíces y nodos, cuenta ocultos y excluye fórmulas del enunciado',async({page})=>{
  const report=await page.evaluate(()=>{
    const root=document.querySelector('.ansed_root')!;
    document.querySelector('#algoPrompt')!.append(root.cloneNode(true));
    for(let i=0;i<15;i++){const clone=root.cloneNode(true) as HTMLElement;if(i===0)clone.hidden=true;document.body.append(clone);}
    root.querySelector('.ansed_tree')!.innerHTML=Array.from({length:90},()=>'<span class="AnsedObject">1</span>').join('');
    return window.editorDiagnostics(document);
  });
  expect(report).toMatchObject({rootCount:16,inputCount:16,visibleRootCount:15,truncated:true});
  expect(report.editors).toHaveLength(12);
  const count=(nodes:any[]):number=>nodes.reduce((total,node)=>total+1+count(node.children || []),0);
  expect(report.editors.reduce((total,editor)=>total+count(editor.trees),0)).toBeLessThanOrEqual(60);
});
test('no declara habilitado un control duplicado ajeno ni un Fraction deshabilitado',async({page})=>{
  const report=await page.evaluate(()=>{
    document.querySelector('.aleks-editor-menu')!.innerHTML='<button aria-label="Fraction" aria-disabled="true">Fracción</button><button aria-label="Start over" hidden>Reiniciar</button>';
    document.body.insertAdjacentHTML('beforeend','<button aria-label="Fraction">Control ajeno</button>');
    return window.editorDiagnostics(document);
  });
  expect(report.controls).toContainEqual({label:'Fraction',count:1,visible:1,enabled:0});
  expect(report.controls).toContainEqual({label:'Start over',count:1,visible:0,enabled:0});
});
