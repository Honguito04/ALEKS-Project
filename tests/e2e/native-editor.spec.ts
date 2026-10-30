import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/native-editor-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/native-editor-fixture',route=>route.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__native-editor.js',route=>route.fulfill({contentType:'application/javascript',body:bundle}));
  const cdp=await page.context().newCDPSession(page);
  await page.exposeFunction('nativeCommand',async(method:string,params:Record<string,unknown>)=>{
    if(method!=='Input.dispatchKeyEvent')throw Error('Solo se prueba el teclado');
    return cdp.send('Input.dispatchKeyEvent',params as Parameters<typeof cdp.send<'Input.dispatchKeyEvent'>>[1]);
  });
  await page.goto('/native-editor-fixture');await page.bringToFront();
  await page.addScriptTag({url:'/__native-editor.js'});
});

test('el editor que exige eventos confiables ignora la escritura sintética',async({page})=>{
  const result=await page.evaluate(()=>window.nativeEditor.run('12',false)) as any;
  expect(result).toMatchObject({attached:0,detached:0,buffer:'',syntheticInputs:1,clicks:0,readback:{status:'empty'}});
  expect(result.error).toContain('no reflejó');expect(result.written).toBeUndefined();
});

for(const value of ['12','1/5']) {
  test(`Chromium entrega teclas confiables y el lector confirma ${value}`,async({page})=>{
    const result=await page.evaluate(value=>window.nativeEditor.run(value,true),value) as any;
    expect(result).toMatchObject({attached:1,detached:1,buffer:value,syntheticInputs:0,clicks:0,error:'',
      written:{written:true,display:value,submitted:false},readback:{status:'readable',value}});
    expect(result.events).toEqual([...value].map(key=>({key,trusted:true})));
  });
}

test('rechaza texto ejecutable antes de conectar el teclado',async({page})=>{
  const result=await page.evaluate(()=>window.nativeEditor.run('alert(1)',true)) as any;
  expect(result).toMatchObject({attached:0,detached:0,buffer:'',clicks:0});
  expect(result.error).not.toBe('');expect(result.events).toEqual([]);
});

test('permite iniciar desde el panel aunque el documento no tenga el foco de Chrome',async({page})=>{
  // El foco externo se simula; las teclas sí las entrega Chromium por CDP.
  // No se carga una extensión ni un panel nativo en este entorno administrado.
  const result=await page.evaluate(async()=>{
    Object.defineProperty(document,'hasFocus',{value:()=>false,configurable:true});
    return window.nativeEditor.run('12',true);
  }) as any;
  expect(result).toMatchObject({attached:1,detached:1,buffer:'12',clicks:0,error:'',
    written:{written:true,display:'12',submitted:false}});
  expect(result.events).toEqual([{key:'1',trusted:true},{key:'2',trusted:true}]);
});

for(const mode of ['focus-change','prompt-change','abort'] as const) {
  test(`interrumpe el teclado ante ${mode} y conserva la respuesta parcial sin entregar`,async({page})=>{
    const result=await page.evaluate(mode=>window.nativeEditor.run('123',true,mode),mode) as any;
    expect(result).toMatchObject({attached:1,detached:1,buffer:'1',clicks:0});
    expect(result.error).not.toBe('');expect(result.written).toBeUndefined();
    expect(result.events).toEqual([{key:'1',trusted:true}]);
  });
}
