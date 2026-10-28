import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-content-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
for(const mode of ['no-run','wrong-run','after-stop','replaced-run'] as const) {
  test(`rechaza comandos tardíos de contenido: ${mode}`,async({page})=>{
    await page.route('**/content-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
    await page.route('**/__content.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
    await page.goto('/content-fixture');await page.addScriptTag({url:'/__content.js'});
    const result=await page.evaluate(async mode=>{
      let inputs=0,clicks=0;document.addEventListener('input',()=>inputs++);document.addEventListener('click',()=>clicks++);
      if(mode!=='no-run')await window.contentRPC('automationReset',{runId:'run-1'});
      if(mode==='after-stop')await window.contentRPC('stop');
      if(mode==='replaced-run')await window.contentRPC('automationReset',{runId:'run-2'});
      const context=await window.contentRPC('assistContext');
      const data={runId:mode==='wrong-run'?'foreign':'run-1',fingerprint:context.data.fingerprint,value:'12'};
      const submit=await window.contentRPC('automationSubmit',data),next=await window.contentRPC('automationNext',data);
      return {submit,next,inputs,clicks};
    },mode);
    expect(result.inputs).toBe(0);expect(result.clicks).toBe(0);
    expect(result.submit).toMatchObject({ok:false,error:'Recorrido detenido o reemplazado.'});
    expect(result.next).toMatchObject({ok:false,error:'Recorrido detenido o reemplazado.'});
  });
}
