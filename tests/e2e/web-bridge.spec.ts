import { WRITER_VERSION } from '../../extension/src/writer-version';
import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

declare global {interface Window {webBridgeTest:any}}
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/web-bridge-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
async function openBridge(page:Page) {
  await page.route('**/web-bridge-fixture',route=>route.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__web_bridge.js',route=>route.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/web-bridge-fixture');await page.addScriptTag({url:'/__web_bridge.js'});
  await page.waitForFunction(()=>Boolean(window.webBridgeTest));
  const connected=await command(page,'connect',{token:'a'.repeat(43),writerVersion:WRITER_VERSION});expect(connected.ok).toBe(true);
  expect((await command(page,'bind',{tabId:7})).ok).toBe(true);
  const read=await command(page,'read');expect(read.ok).toBe(true);return read.value.context;
}
const command=(page:Page,name:string,data:Record<string,unknown>={},id?:string)=>page.evaluate(
  ({name,data,id})=>window.webBridgeTest.request(name,data,id),{name,data,id});
const metrics=(page:Page)=>page.evaluate(()=>window.webBridgeTest.metrics);
const limits={maxExercises:2,maxMinutes:1,maxAICalls:4};

test('puerto simulado → worker real → lectura, escritura, Correcta y siguiente en DOM real',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const context=await openBridge(page);
  expect(context.statement).toContain('4 nadadores');
  const response=await command(page,'start',{fingerprint:context.fingerprint,limits,nativeKeyboard:true});
  expect(response.ok).toBe(true);
  await expect.poll(async()=>{
    const status=await command(page,'status');return status.value.automation?.phase;
  },{timeout:15000}).toBe('COMPLETADO');
  const status=await command(page,'status');
  expect(status.value.automation).toMatchObject({accepted:2,aiCalls:2,active:false});
  expect(await metrics(page)).toMatchObject({writes:2,submits:2,nexts:1,creates:2});
  await expect(page.locator('.ansed_tree')).toHaveText('20');
  expect(errors).toEqual([]);
});

test('ID duplicado no duplica consulta ni entrega; cambiar contenido con el mismo ID se rechaza',async({page})=>{
  const context=await openBridge(page);
  const id='00000000-0000-4000-8000-000000000017';
  const data={fingerprint:context.fingerprint,limits:{...limits,maxExercises:1},nativeKeyboard:true};
  expect((await command(page,'start',data,id)).ok).toBe(true);
  expect((await command(page,'start',data,id)).ok).toBe(true);
  const altered=await command(page,'start',{...data,limits},id);
  expect(altered).toMatchObject({ok:false});expect(altered.error).toContain('otro comando');
  await expect.poll(async()=>(await command(page,'status')).value.automation?.phase).toBe('COMPLETADO');
  expect(await metrics(page)).toMatchObject({writes:1,submits:1,nexts:0,creates:1});
});

test('no acepta tabId en órdenes de ejecución ni envía acciones a otra pestaña',async({page})=>{
  const context=await openBridge(page);
  const response=await command(page,'start',{fingerprint:context.fingerprint,limits,nativeKeyboard:true,tabId:8});
  expect(response).toMatchObject({ok:false,error:'Comando del puente no admitido.'});
  expect(await metrics(page)).toMatchObject({writes:0,submits:0,nexts:0,creates:0});
  expect((await metrics(page)).sent.every((item:{tabId:number})=>item.tabId===7)).toBe(true);
});

test('detener durante proveedor tardío invalida la propuesta y no escribe',async({page})=>{
  const context=await openBridge(page);
  await page.evaluate(()=>window.webBridgeTest.holdProvider(true));
  expect((await command(page,'start',{fingerprint:context.fingerprint,limits,nativeKeyboard:true})).ok).toBe(true);
  await expect.poll(async()=>(await metrics(page)).polls).toBe(1);
  expect((await command(page,'stop')).ok).toBe(true);
  await page.evaluate(()=>window.webBridgeTest.releaseProvider());
  await expect.poll(async()=>(await command(page,'status')).value.automation?.phase).toBe('DETENIDO');
  expect(await metrics(page)).toMatchObject({writes:0,submits:0,nexts:0,creates:1});
  await expect(page.locator('.ansed_tree')).toBeEmpty();
});

test('desconectar el puerto durante consulta cancela y descarta respuesta tardía',async({page})=>{
  const context=await openBridge(page);
  await page.evaluate(()=>window.webBridgeTest.holdProvider(true));
  expect((await command(page,'start',{fingerprint:context.fingerprint,limits,nativeKeyboard:true})).ok).toBe(true);
  await expect.poll(async()=>(await metrics(page)).polls).toBe(1);
  await page.evaluate(()=>window.webBridgeTest.disconnect());
  await expect.poll(async()=>(await metrics(page)).cancels).toBeGreaterThan(0);
  await page.evaluate(()=>window.webBridgeTest.releaseProvider());
  await expect.poll(async()=>(await metrics(page)).deletes).toBeGreaterThan(0);
  expect(await metrics(page)).toMatchObject({writes:0,submits:0,nexts:0,creates:1});
  await expect(page.locator('.ansed_tree')).toBeEmpty();
});

test('navegar la pestaña vinculada detiene sin continuar otro ejercicio',async({page})=>{
  const context=await openBridge(page);
  await page.evaluate(()=>window.webBridgeTest.holdProvider(true));
  expect((await command(page,'start',{fingerprint:context.fingerprint,limits,nativeKeyboard:true})).ok).toBe(true);
  await expect.poll(async()=>(await metrics(page)).polls).toBe(1);
  await page.evaluate(()=>{window.webBridgeTest.updateTab(7);window.webBridgeTest.releaseProvider();});
  await expect.poll(async()=>(await metrics(page)).cancels).toBeGreaterThan(0);
  expect(await metrics(page)).toMatchObject({writes:0,submits:0,nexts:0,creates:1});
});

for(const feedback of ['incorrect','uncertain'] as const) test(`devolución ${feedback} detiene sin contar Correcta ni avanzar`,async({page})=>{
  const context=await openBridge(page);
  await page.evaluate(mode=>window.webBridgeTest.feedback(mode),feedback);
  expect((await command(page,'start',{fingerprint:context.fingerprint,limits,nativeKeyboard:true})).ok).toBe(true);
  await expect.poll(async()=>(await command(page,'status')).value.automation?.phase,{timeout:20000}).toBe('DETENIDO');
  const status=await command(page,'status');
  expect(status.value.automation).toMatchObject({accepted:0,active:false});
  expect(await metrics(page)).toMatchObject({writes:1,submits:1,nexts:0,creates:1});
});

const formatScenarios=[
  {name:'169,56 cm², un campo',answers:[{field_key:'answer',value:'169,56',unit:'cm²'}],options:{},shown:['169,56cm2'],clicks:1},
  {name:'169,56 cm² representado con punto',answers:[{field_key:'answer',value:'169,56',unit:'cm²'}],options:{separator:'dot'},shown:['169.56cm2'],clicks:1},
  {name:'dos campos decimales con orden de propuesta invertido',answers:[{field_key:'field_2',value:'169.56',unit:'cm²'},{field_key:'field_1',value:'52,1',unit:'cm'}],options:{separator:'comma'},shown:['52,1cm','169,56cm2'],clicks:2},
  {name:'fracción vertical y unidad cúbica',answers:[{field_key:'answer',value:'15/64',unit:'cm³'}],options:{},shown:['1564cm3'],clicks:1},
  {name:'decimal con unidad fija',answers:[{field_key:'answer',value:'2,75',unit:'horas'}],options:{fixedUnit:'h'},shown:['2,75h'],clicks:0},
  {name:'decimal sin unidad',answers:[{field_key:'answer',value:'169.56',unit:''}],options:{separator:'comma'},shown:['169,56'],clicks:0},
  {name:'fracción y decimal sin unidades en dos campos',answers:[{field_key:'field_1',value:'1/2',unit:''},{field_key:'field_2',value:'0,125',unit:''}],options:{},shown:['12','0,125'],clicks:0},
];
for(const scenario of formatScenarios)test(`puente de producción: ${scenario.name}`,async({page})=>{
  await openBridge(page);
  await page.evaluate(scenario=>window.webBridgeTest.configureAnswers(scenario.answers,scenario.options),scenario);
  const read=await command(page,'read');expect(read.ok).toBe(true);
  expect((await command(page,'start',{fingerprint:read.value.context.fingerprint,limits:{...limits,maxExercises:1},nativeKeyboard:true})).ok).toBe(true);
  await expect.poll(async()=>(await command(page,'status')).value.automation?.phase,{timeout:10000}).toBe('COMPLETADO');
  expect(await metrics(page)).toMatchObject({submits:1,nexts:0,creates:1,writes:scenario.answers.length,unitClicks:scenario.clicks,submittedValues:[scenario.shown]});
});

for(const fault of ['number','unit','first-unit'] as const)test(`puente de producción no entrega con cambio de ${fault}`,async({page})=>{
  await openBridge(page);
  const answers=fault==='first-unit'?[{field_key:'field_1',value:'12',unit:'cm'},{field_key:'field_2',value:'169,56',unit:'cm²'}]:[{field_key:'answer',value:'169,56',unit:'cm²'}];
  await page.evaluate(({answers,fault})=>window.webBridgeTest.configureAnswers(answers,{fault}),{answers,fault});
  const read=await command(page,'read');
  expect((await command(page,'start',{fingerprint:read.value.context.fingerprint,limits:{...limits,maxExercises:1},nativeKeyboard:true})).ok).toBe(true);
  await expect.poll(async()=>(await command(page,'status')).value.automation?.phase,{timeout:10000}).toBe('DETENIDO');
  expect(await metrics(page)).toMatchObject({submits:0,nexts:0,creates:1});
});

test('puente de producción detiene un decimal sin unidad si pierde foco al escribir',async({page})=>{
  await openBridge(page);
  await page.evaluate(()=>window.webBridgeTest.configureAnswers([{field_key:'answer',value:'169,56',unit:''}],{fault:'focus'}));
  const read=await command(page,'read');
  expect((await command(page,'start',{fingerprint:read.value.context.fingerprint,limits:{...limits,maxExercises:1},nativeKeyboard:true})).ok).toBe(true);
  await expect.poll(async()=>(await command(page,'status')).value.automation?.phase,{timeout:5000}).toBe('DETENIDO');
  expect(await metrics(page)).toMatchObject({submits:0,nexts:0,creates:1,writes:1});
});
