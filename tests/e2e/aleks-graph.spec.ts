import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let fixture:string,bundle:string,curve:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-parabola-grid.html','utf8');
  curve=(await readFile('tests/fixtures/aleks-parabola-curve.txt','utf8')).trim();
  bundle=(await build({entryPoints:['tests/e2e/aleks-graph-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/aleks-graph-fixture',route=>route.fulfill({contentType:'text/html',body:fixture}));
  const cdp=await page.context().newCDPSession(page);
  await page.exposeFunction('nativeGraphCommand',(method:string,params:unknown)=>{
    if(method!=='Input.dispatchMouseEvent')throw Error('Solo se prueban clics de Chrome');
    return cdp.send(method,params as Parameters<typeof cdp.send<'Input.dispatchMouseEvent'>>[1]);
  });
  await page.goto('/aleks-graph-fixture');
  await page.bringToFront();
  await page.addScriptTag({content:bundle});
});

const points=[[-5,1],[-7,5],[-6,2],[-4,2],[-3,5]];
test('usa clics confiables para marcar los cinco puntos y comprueba la curva aportada',async({page})=>{
  await expect(page.getByRole('button',{name:'Graph-a-function'})).toBeDisabled();
  await page.locator('.figed_root').evaluate(root=>{
    (root as HTMLElement).style.transformOrigin='top left';
    (root as HTMLElement).style.transform='scale(1.25)';
  });
  const result=await page.evaluate(curve=>window.runParabolaPlot(curve),curve);
  expect(result).toMatchObject({before:true,after:false,success:true,error:'',
    trace:{attach:1,detach:1,pencil:1,curve:1,verify:0,points}});
  await expect(page.locator('g[id^="figed_function_"] path')).toHaveAttribute('d',curve);
  await expect(page.locator('g[id^="figed_point_"] circle')).toHaveCount(5);
});

for(const [fault,expectedClicks,error] of [
  ['wrong-point',1,/no confirmó el punto 1/],
  ['zoom',1,/Cambió el ejercicio o la escala/],
  ['abort',1,/cancelada|aborted/i],
  ['wrong-curve',5,/no mostró la parábola esperada/],
] as const) {
  test(`interrumpe el dibujo sin entregar ante ${fault}`,async({page})=>{
    const result=await page.evaluate(({curve,fault})=>window.runParabolaPlot(curve,fault),{curve,fault});
    expect(result).toMatchObject({before:true,after:false,success:false,error:expect.stringMatching(error),
      trace:{attach:1,detach:1,pencil:1,curve:fault==='wrong-curve'?1:0,verify:0,points:points.slice(0,expectedClicks)}});
  });
}

test('el recorrido verifica la parábola después del trazo y reconoce el siguiente gráfico vacío',async({page})=>{
  const result=await page.evaluate(curve=>window.runParabolaPlot(curve,undefined,'submit'),curve);
  expect(result).toMatchObject({accepted:true,nexts:1,renderedOnVerify:true,after:true,error:'',
    trace:{verify:1,points,curve:1}});
  await expect(page.locator('g[id^="figed_point_"] circle')).toHaveCount(0);
});

test('el recorrido no verifica si la curva cambia después de dibujarla',async({page})=>{
  const result=await page.evaluate(curve=>window.runParabolaPlot(curve,'changed-after-draw','submit'),curve);
  expect(result).toMatchObject({accepted:false,nexts:0,error:expect.stringContaining('no reflejó'),
    trace:{verify:0,points,curve:1}});
});

test('el recorrido no verifica si Chrome retira el permiso tras la curva',async({page})=>{
  const result=await page.evaluate(curve=>window.runParabolaPlot(curve,'permission-before-verify','submit'),curve);
  expect(result).toMatchObject({accepted:false,nexts:0,error:expect.stringContaining('desconectó el ratón'),
    trace:{verify:0,points,curve:1}});
});

test('volver a vincular y desplazar la vista no permite repetir una entrega gráfica',async({page})=>{
  const result=await page.evaluate(curve=>window.runParabolaPlot(curve,undefined,'repeat'),curve) as {
    priorFingerprint:string;repeatFingerprint:string;
  };
  expect(result).toMatchObject({accepted:true,after:true,repeatError:expect.stringContaining('ya tuvo una entrega'),
    trace:{verify:1,points,curve:1}});
  expect(result.repeatFingerprint).not.toBe(result.priorFingerprint);
});
