import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-automation-panel-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022',loader:{'.css':'empty'}})).outputFiles[0].text;
});
async function openPanel(page:Page) {
  await page.route('**/automation-panel-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__automation-panel.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/automation-panel-fixture');
  await page.evaluate(()=>{const root=document.createElement('div');root.id='root';document.body.append(root);});
  await page.addScriptTag({url:'/__automation-panel.js'});
  await page.getByRole('button',{name:'Leer actividad seleccionada'}).click();
}
const counters=(page:Page)=>page.evaluate(()=>({solves:window.automationTest.solves,submits:window.automationTest.submits,nexts:window.automationTest.nexts}));

test('escribe una fracción, pulsa Verificar y confirma Correcta',async({page})=>{
  await openPanel(page);await page.evaluate(()=>{window.automationTest.fraction=true;});
  await page.getByLabel('Máximo de respuestas ALEKS').fill('1');
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  await expect(page.getByRole('status')).toContainText('1 correctas confirmadas');
  expect(await counters(page)).toEqual({solves:1,submits:1,nexts:0});
});

test('prepara diagnóstico desde el panel sin enviar respuestas',async({page})=>{
  await openPanel(page);await page.getByRole('button',{name:'Preparar diagnóstico del editor'}).click();
  const report=JSON.parse(await page.getByLabel('Diagnóstico del editor',{exact:true}).inputValue());
  expect(report.rootCount).toBe(1);expect(report.controls.some((item:{label:string})=>item.label==='Verificar')).toBe(true);
  expect(await counters(page)).toEqual({solves:0,submits:0,nexts:0});
});

test('el recorrido respeta la necesidad de imagen declarada por el usuario',async({page})=>{
  await openPanel(page);
  await page.getByLabel('El ejercicio necesita una imagen o dibujo').check();
  await expect(page.getByRole('button',{name:'Iniciar recorrido automático'})).toBeDisabled();
  expect(await counters(page)).toEqual({solves:0,submits:0,nexts:0});
});

test('panel completa dos respuestas y avanza solamente entre ambas',async({page})=>{
  await openPanel(page);
  await page.getByLabel('Máximo de respuestas ALEKS').fill('2');
  await page.getByLabel('Máximo de minutos ALEKS').fill('1');
  await page.getByLabel('Máximo de llamadas IA ALEKS').fill('4');
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  await expect(page.getByLabel('Máximo de respuestas ALEKS')).toBeDisabled();
  await expect(page.getByRole('button',{name:'Detener recorrido'})).toBeEnabled();
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status).toContainText('COMPLETADO',{timeout:15000});
  await expect(status).toContainText('2 correctas confirmadas por ALEKS · 2 llamadas IA');
  expect(await counters(page)).toEqual({solves:2,submits:2,nexts:1});
  await expect(page.locator('.ansed_tree')).toHaveText('20');
  await expect(page.getByRole('button',{name:'Detener recorrido'})).toBeDisabled();
  await expect(page.getByLabel('Máximo de respuestas ALEKS')).toBeEnabled();
});

test('Detener durante una consulta cancela el recorrido y descarta la respuesta tardía',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{window.automationTest.holdSolve=true;});
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status).toContainText('RESOLVIENDO');
  await page.getByRole('button',{name:'Detener recorrido'}).click();
  await expect(status).toContainText('DETENIDO');
  await page.evaluate(()=>{window.automationTest.releaseSolve?.();});
  await expect(page.getByRole('button',{name:'Iniciar recorrido automático'})).toBeEnabled();
  // Dos rondas completas del temporizador del panel comprueban que no se
  // programa otra entrega cuando la consulta cancelada acaba de responder.
  await page.waitForTimeout(1200);
  expect(await counters(page)).toEqual({solves:1,submits:0,nexts:0});
  await expect(page.locator('.ansed_tree')).toBeEmpty();
  await expect(status).toContainText('DETENIDO');
});

test('Incorrecta detiene el recorrido y muestra el rechazo sin avanzar',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{window.automationTest.feedback='incorrect';});
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status).toContainText('ALEKS rechazó la respuesta');
  await expect(status).toContainText('DETENIDO');
  await expect(status).toContainText('0 correctas confirmadas por ALEKS');
  expect(await counters(page)).toEqual({solves:1,submits:1,nexts:0});
  await expect(page.getByRole('button',{name:'Detener recorrido'})).toBeDisabled();
});

test('el panel muestra límites editables y rechaza valores fuera del rango',async({page})=>{
  await openPanel(page);
  await expect(page.getByLabel('Máximo de respuestas ALEKS')).toHaveValue('10');
  await expect(page.getByLabel('Máximo de minutos ALEKS')).toHaveValue('15');
  await expect(page.getByLabel('Máximo de llamadas IA ALEKS')).toHaveValue('20');
  await page.getByLabel('Máximo de respuestas ALEKS').fill('0');
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button',{name:'Detener recorrido'})).toBeDisabled();
  expect(await counters(page)).toEqual({solves:0,submits:0,nexts:0});
});

test('el límite 01 se explica como una respuesta y conserva Correcta sin avanzar',async({page})=>{
  await openPanel(page);
  await page.getByLabel('Máximo de respuestas ALEKS').fill('01');
  await expect(page.getByLabel('Alcance del recorrido')).toContainText('1 respuesta');
  await expect(page.getByLabel('Alcance del recorrido')).toContainText('no avanzará');
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status).toContainText('COMPLETADO');
  await expect(status).toContainText('1 correctas confirmadas');
  await expect(page.getByRole('button',{name:'Iniciar recorrido automático'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Continuar desde la respuesta correcta'})).toBeEnabled();
  expect(await counters(page)).toEqual({solves:1,submits:1,nexts:0});
  await expect(page.locator('#result_feedback_alert')).toHaveText('Correcta');
});

test('continúa desde Correcta después del límite y pulsa Siguiente tema una sola vez',async({page})=>{
  await openPanel(page);
  await page.getByLabel('Máximo de respuestas ALEKS').fill('1');
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status).toContainText('COMPLETADO');
  await expect(page.getByRole('button',{name:'Siguiente tema',exact:true})).toBeVisible();
  const continuation=page.getByRole('button',{name:'Continuar desde la respuesta correcta'});
  await expect(continuation).toBeEnabled();
  await page.getByLabel('Máximo de respuestas ALEKS').fill('2');
  await continuation.click();
  await expect(status).toContainText('2 correctas confirmadas por ALEKS · 2 llamadas IA',{timeout:15000});
  await expect(status).toContainText('COMPLETADO');
  expect(await counters(page)).toEqual({solves:2,submits:2,nexts:1});
  await expect(page.locator('.ansed_tree')).toHaveText('20');
  await expect(page.locator('#result_feedback_alert')).toHaveText('Correcta');
  await expect(continuation).toBeEnabled();
});

test('rechazar límites de continuación conserva el resultado y permite corregirlos',async({page})=>{
  await openPanel(page);
  await page.getByLabel('Máximo de respuestas ALEKS').fill('1');
  await page.getByRole('button',{name:'Iniciar recorrido automático'}).click();
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status).toContainText('COMPLETADO');
  const continuation=page.getByRole('button',{name:'Continuar desde la respuesta correcta'});
  // El límite es total: dejarlo en uno no autoriza una segunda respuesta.
  await continuation.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(status).toContainText('COMPLETADO');
  await expect(status).toContainText('1 correctas confirmadas');
  await expect(status).not.toContainText('No se pudo iniciar el recorrido');
  expect(await counters(page)).toEqual({solves:1,submits:1,nexts:0});
  await expect(continuation).toBeEnabled();
  await page.getByLabel('Máximo de respuestas ALEKS').fill('2');
  await continuation.click();
  await expect(status).toContainText('2 correctas confirmadas',{timeout:15000});
  expect(await counters(page)).toEqual({solves:2,submits:2,nexts:1});
});

test('tras avanzar manualmente permite iniciar desde el nuevo ejercicio vacío',async({page})=>{
  await openPanel(page);
  await page.getByLabel('Máximo de respuestas ALEKS').fill('1');
  const start=page.getByRole('button',{name:'Iniciar recorrido automático'});
  await start.click();
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status).toContainText('COMPLETADO');
  await expect(page.getByRole('button',{name:'Continuar desde la respuesta correcta'})).toBeVisible();
  await page.getByRole('button',{name:'Siguiente tema',exact:true}).click();
  await expect(start).toBeEnabled();
  await expect(page.getByRole('button',{name:'Continuar desde la respuesta correcta'})).toHaveCount(0);
  await start.click();
  await expect.poll(async()=>(await counters(page)).submits).toBe(2);
  await expect(status).toContainText('COMPLETADO');
  expect(await counters(page)).toEqual({solves:2,submits:2,nexts:1});
  await expect(page.locator('.ansed_tree')).toHaveText('20');
});
