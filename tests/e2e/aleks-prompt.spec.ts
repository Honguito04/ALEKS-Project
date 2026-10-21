import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-prompt-fragment.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/prompt-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/prompt-fixture');await page.addScriptTag({url:'/__probe.js'});
});
test('lee los dos sucesos y el MathML una sola vez sin título, clics, escrituras o red',async({page})=>{
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
  const result=await page.evaluate(async()=>{
    let events=0;for(const name of ['input','change','click'])document.addEventListener(name,()=>events++);
    const before=document.body.innerHTML,observation=await window.aleksPrompt(document);
    return {observation,events,unchanged:before===document.body.innerHTML};
  });
  expect(result).toMatchObject({events:0,unchanged:true,observation:{status:'readable',multiplePartsDetected:true,autoSubmitSupported:false}});
  expect(result.observation.statement).toBe('Un dado ordinario (regular) es un cubo con los números del 1 al 6 en los lados (representado por puntos pintados). Imaginemos que tal dado sea lanzado dos veces en sucesión y que los valores de las caras en los dos lances son sumados. Esta suma se registra como el resultado de un único ensayo de un experimento aleatorio. Calcular la probabilidad de cada uno de los siguientes sucesos: Suceso A: La suma es mayor que 7. Suceso B: La suma es un número impar. Escribir las respuestas como fracciones exactas.');
  expect(result.observation.mathematics).toEqual(['1','6','A','7','B'].map(value=>({kind:'row',items:[{kind:/\d/.test(value)?'number':'identifier',value}]})));
  expect(result.observation.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(requests).toEqual([]);
});
test('el diagnóstico muestra el enunciado sin habilitar operaciones reales',async({page})=>{
  const result=await page.evaluate(async()=>{
    const detection=await window.pendingAdapter.detect();
    const blocked=await window.pendingAdapter.read().then(()=>false,()=>true);
    return {detection,blocked};
  });
  expect(result).toMatchObject({blocked:true,detection:{supported:false,session:false,promptObservation:{status:'readable',autoSubmitSupported:false}}});
  expect(result.detection.reason).toContain('sin necesitar un contador');
});
test('la huella ignora enlaces, IDs dinámicos y el contador; cambia con las matemáticas',async({page})=>{
  const result=await page.evaluate(async()=>{
    const first=await window.aleksPrompt(document);
    document.querySelector('a')!.setAttribute('href','https://example.invalid/private?token=fixture-only');
    document.querySelector('[mathml]')!.id='another-dynamic-id';
    const title=document.createElement('h2');title.textContent='Pregunta 12';document.body.prepend(title);
    const second=await window.aleksPrompt(document);
    document.querySelector('[mathml]')!.setAttribute('mathml','<math><mn>2</mn></math>');
    const third=await window.aleksPrompt(document);
    return {first,second,third};
  });
  expect(result.first.fingerprint).toBe(result.second.fingerprint);
  expect(result.third.fingerprint).not.toBe(result.second.fingerprint);
  expect(JSON.stringify(result.second)).not.toMatch(/private|token|example\.invalid|Pregunta 12|dynamic-id/);
});
test('conserva fracciones, exponentes y raíces como estructura sin ejecutar atributos ni anotaciones',async({page})=>{
  const result=await page.evaluate(()=>{
    const math=window.promptMath('<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow onclick="fixture()"><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><msqrt><mn>3</mn></msqrt><mo>+</mo><mroot><mn>8</mn><mn>3</mn></mroot></mrow><annotation>PRIVATE_ANNOTATION</annotation></semantics></math>');
    return {math,text:window.promptMathText(math)};
  });
  expect(result.text).toBe('(1)/(2) + (x)^(2) + sqrt(3) + root(8; 3)');
  expect(JSON.stringify(result.math)).not.toMatch(/onclick|fixture|PRIVATE_ANNOTATION/);
  expect(result.math).toMatchObject({kind:'row',items:[{kind:'row',items:[{kind:'fraction',numerator:{value:'1'},denominator:{value:'2'}},{value:'+'},{kind:'power',base:{value:'x'},exponent:{value:'2'}},{value:'+'},{kind:'sqrt'},{value:'+'},{kind:'root'}]}]});
});
for(const state of ['missing','duplicate','hidden-copy','malformed-math','missing-math','unsupported-math','image','oversized','doctype'] as const) {
  test(`trata el enunciado ${state} sin devolver una lectura parcial`,async({page})=>{
    const result=await page.evaluate(async state=>{
      const root=document.querySelector<HTMLElement>('#algoPrompt')!;
      const math=root.querySelector('[mathml]')!;
      if(state==='missing')root.hidden=true;
      if(state==='duplicate' || state==='hidden-copy') {const copy=root.cloneNode(true) as HTMLElement;if(state==='hidden-copy')copy.hidden=true;root.after(copy);}
      if(state==='malformed-math')math.setAttribute('mathml','<math><mn>');
      if(state==='missing-math')math.removeAttribute('mathml');
      if(state==='unsupported-math')math.setAttribute('mathml','<math><mtable><mtr><mtd><mn>1</mn></mtd></mtr></mtable></math>');
      if(state==='image')root.append(document.createElement('img'));
      if(state==='oversized')root.append('x'.repeat(5000));
      if(state==='doctype')math.setAttribute('mathml','<!DOCTYPE math [<!ENTITY fixture "secret">]><math><mi>&fixture;</mi></math>');
      return window.aleksPrompt(document);
    },state);
    const status=state==='missing'?'missing':state==='duplicate'?'ambiguous':state==='hidden-copy'?'readable':'unsupported';
    expect(result.status).toBe(status);expect(result.autoSubmitSupported).toBe(false);
    if(status!=='readable') {expect(result.statement).toBeUndefined();expect(result.fingerprint).toBeUndefined();}
  });
}
test('descarta una lectura si cambia el enunciado mientras calcula la huella',async({page})=>{
  const result=await page.evaluate(async()=>{
    const digest=crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest=async(algorithm,data)=>{
      const result=await digest(algorithm,data);
      document.querySelector('#algoPrompt')!.append(' Otro enunciado.');
      return result;
    };
    try {return await window.aleksPrompt(document);} finally {crypto.subtle.digest=digest;}
  });
  expect(result.status).toBe('ambiguous');expect(result.statement).toBeUndefined();
});
