import { test,expect,type Page,type APIRequestContext } from '@playwright/test';
import { build } from 'esbuild';
import type { Exercise,Run,Solution } from '../../extension/src/shared';

let bundle:string;
test.beforeAll(async()=>{bundle=(await build({entryPoints:['tests/e2e/harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;});
async function prepare(page:Page,request:APIRequestContext,solver?:(exercise:Exercise,ai:boolean)=>Promise<Solution>) {
  let saved:Run|undefined;
  const session=await (await request.post('/auth/demo')).json();
  const solve=async(exercise:Exercise,allow_ai:boolean)=>{
    const response=await request.post('/solve',{headers:{Authorization:`Bearer ${session.token}`},data:{exercise,allow_ai}});
    if(!response.ok())throw Error(JSON.stringify(await response.json()));return response.json();
  };
  await page.exposeFunction('__testSolve',solver || solve);
  await page.exposeFunction('__testSave',(run:Run)=>{saved=structuredClone(run);});
  await page.route('**/__test_controller.js',route=>route.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/simulator/');await page.locator('#answer').waitFor();
  await page.addScriptTag({url:'/__test_controller.js'});
  return {saved:()=>saved!,solve};
}
test('diez ejercicios: DOM real → backend → respuestas aceptadas → finalización',async({page,request})=>{
  const h=await prepare(page,request);let submissions=0;
  page.on('request',r=>{if(r.url().endsWith('/grade'))submissions++;});
  await page.evaluate(()=>window.mathTest.start());
  await expect.poll(()=>h.saved()?.state,{timeout:45000}).toBe('COMPLETADO');
  expect(h.saved().count).toBe(10);expect(submissions).toBe(10);
  await expect(page.locator('#exercise')).toContainText('Actividad del simulador completada');
  expect(Object.values(h.saved().operations).every(o=>o.status==='accepted')).toBe(true);
});
test('vista previa no modifica el campo ni envía',async({page,request})=>{
  const h=await prepare(page,request);let submissions=0;
  page.on('request',r=>{if(r.url().endsWith('/grade'))submissions++;});
  await page.evaluate(()=>window.mathTest.start({preview:true}));
  await expect.poll(()=>h.saved()?.state).toBe('PAUSADO');
  await expect(page.locator('#answer')).toHaveValue('');expect(submissions).toBe(0);
  expect(await page.evaluate(()=>window.mathTest.controller.solution?.answer)).toBe('17/12');
});
test('detener durante una respuesta remota tardía evita escribir y enviar',async({page,request})=>{
  let release!:(value:Solution)=>void;let called=false;
  const pending=new Promise<Solution>(resolve=>{release=resolve;});
  const h=await prepare(page,request,async()=>{called=true;return pending;});
  let submissions=0;page.on('request',r=>{if(r.url().endsWith('/grade'))submissions++;});
  await page.evaluate(()=>window.mathTest.start());await expect.poll(()=>called).toBe(true);
  await page.evaluate(()=>window.mathTest.controller.stop());
  release({status:'verified',answer:'17/12',values:['17/12'],explanation:'Prueba de respuesta tardía',provider:'deterministic',proposed_by_ai:false,provider_calls:0});
  await expect.poll(()=>h.saved().state).toBe('INACTIVO');await page.waitForTimeout(150);
  expect(submissions).toBe(0);await expect(page.locator('#answer')).toHaveValue('');
});
test('recupera una aceptación tras recargar y no repite la entrega',async({page,request})=>{
  const h=await prepare(page,request);let submissions=0;page.on('request',r=>{if(r.url().endsWith('/grade'))submissions++;});
  // Interrumpir antes del avance, conservando la confirmación en el DOM y el diario.
  await page.evaluate(()=>{
    const button=document.querySelector<HTMLButtonElement>('#next-exercise')!;
    button.addEventListener('click',event=>{event.stopImmediatePropagation();event.preventDefault();},true);
    return window.mathTest.start({maxExercises:2});
  });
  await expect.poll(()=>h.saved()?.state,{timeout:15000}).toBe('PAUSADO');
  expect(submissions).toBe(1);const saved=h.saved();
  await page.reload();await page.locator('#feedback[data-status="accepted"]').waitFor();
  await page.addScriptTag({url:'/__test_controller.js'});
  await page.evaluate(run=>window.mathTest.controller.recover(run),saved);
  await page.evaluate(()=>window.mathTest.controller.resume());
  await expect.poll(()=>h.saved().state,{timeout:15000}).toBe('COMPLETADO');
  expect(h.saved().count).toBe(2);expect(submissions).toBe(2);
});
test('cambiar de actividad durante el cálculo invalida la respuesta',async({page,request})=>{
  let release!:(value:Solution)=>void;let called=false;
  const pending=new Promise<Solution>(resolve=>{release=resolve;});
  const h=await prepare(page,request,async()=>{called=true;return pending;});
  await page.evaluate(()=>window.mathTest.start());await expect.poll(()=>called).toBe(true);
  await page.getByRole('button',{name:'Reiniciar actividad'}).click();
  release({status:'verified',answer:'17/12',values:[],explanation:'Exacto',provider:'deterministic',proposed_by_ai:false,provider_calls:0});
  await expect.poll(()=>h.saved()?.state).toBe('PAUSADO');expect(Object.keys(h.saved().operations)).toHaveLength(0);
  await expect(page.locator('#answer')).toHaveValue('');
});
test('sesión perdida y verificación humana requieren intervención',async({page,request})=>{
  const h=await prepare(page,request);await page.getByRole('button',{name:'Simular pérdida de sesión'}).click();
  await page.evaluate(()=>window.mathTest.start());await expect.poll(()=>h.saved()?.state).toBe('PAUSADO');
  expect(h.saved().message).toContain('sesión');
  await page.evaluate(()=>window.mathTest.controller.stop());await page.getByRole('button',{name:'Reiniciar actividad'}).click();
  await page.getByRole('button',{name:'Simular verificación humana'}).click();
  await page.evaluate(()=>window.mathTest.start());await expect.poll(()=>h.saved()?.state).toBe('PAUSADO');
  expect(h.saved().message).toContain('humana');
});
