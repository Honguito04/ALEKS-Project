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
test('lee mstyle dentro del enunciado sin duplicados, cambios del DOM o habilitar envíos',async({page})=>{
  const result=await page.evaluate(async()=>{
    document.querySelector('[mathml]')!.setAttribute('mathml','<math><mstyle displaystyle="true" scriptlevel="0"><mn>1</mn></mstyle></math>');
    const before=document.body.innerHTML;let events=0;
    for(const name of ['input','change','click'])document.addEventListener(name,()=>events++);
    const detection=await window.pendingAdapter.detect();
    return {detection,events,unchanged:before===document.body.innerHTML};
  });
  expect(result).toMatchObject({events:0,unchanged:true,detection:{supported:false,session:false,promptObservation:{status:'readable',autoSubmitSupported:false}}});
  expect(result.detection.promptObservation?.statement).toContain('números del 1 al 6');
  expect(result.detection.promptObservation?.mathematics).toHaveLength(5);
});
test('mstyle conserva la agrupación y orden de fracciones, potencias y raíces e ignora sus atributos',async({page})=>{
  const result=await page.evaluate(()=>{
    const body='<mfrac><mrow><mn>1</mn></mrow><mn>2</mn></mfrac><mo>+</mo><msup><mi>cm</mi><mn>3</mn></msup><mo>+</mo><msqrt><mn>5</mn></msqrt>';
    const base=window.promptMath(`<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow>${body}</mrow></math>`);
    const styled=window.promptMath(`<math xmlns="http://www.w3.org/1998/Math/MathML"><mstyle displaystyle="true" scriptlevel="0" mathcolor="green" id="PRIVATE_STYLE_ID" onclick="fixture()">${body.replace('<mrow>','<mstyle mathsize="18px">').replace('</mrow>','</mstyle>')}</mstyle></math>`);
    return {base,styled,text:window.promptMathText(styled)};
  });
  expect(result.styled).toEqual(result.base);
  expect(result.text).toBe('(1)/(2) + (cm)^(3) + sqrt(5)');
  expect(JSON.stringify(result.styled)).not.toMatch(/PRIVATE_STYLE_ID|onclick|fixture|green|mathsize|scriptlevel/);
});
test('lee el fragmento real de círculo, arco, ángulo, grados y pi sin interpretar la región sombreada',async({page})=>{
  const circle=await readFile('tests/fixtures/aleks-circle-prompt-fragment.html','utf8');
  await page.route('**/circle-fixture',r=>r.fulfill({contentType:'text/html',body:circle}));
  await page.goto('/circle-fixture');await page.addScriptTag({url:'/__probe.js'});
  const result=await page.evaluate(async()=>{
    // Restituye el p > span > div del DOM generado por ALEKS sin que el
    // parser HTML separe el renderizador de su propietario MathML.
    const wrapper=document.querySelector('[data-fixture-paragraph]')!,paragraph=document.createElement('p');
    paragraph.append(...wrapper.childNodes);wrapper.replaceWith(paragraph);
    const before=document.body.innerHTML;let events=0;
    for(const name of ['input','change','click'])document.addEventListener(name,()=>events++);
    const detection=await window.pendingAdapter.detect();
    return {detection,events,unchanged:before===document.body.innerHTML};
  });
  expect(result.detection.promptObservation?.status,result.detection.promptObservation?.reason).toBe('readable');
  expect(result).toMatchObject({events:0,unchanged:true,detection:{supported:false,session:false,promptObservation:{status:'readable',diagramReferenceDetected:true,autoSubmitSupported:false}}});
  const prompt=result.detection.promptObservation!;
  expect(prompt.statement).toBe('El círculo a continuación tiene su centro en O, y su radio es 3 cm. Dado que m ∠ AOB = 160 °, hallar la longitud de arco(AB) y el área de la región sombreada. Dar respuestas exactas en términos de π, e incluir las unidades correctas.');
  expect(prompt.reason).toContain('No se ha interpretado esa región');
  expect(prompt.mathematics).toHaveLength(5);
  expect(prompt.mathematics?.[2]).toEqual({kind:'row',items:[{kind:'identifier',value:'m'},{kind:'operator',value:'∠'},{kind:'identifier',value:'AOB'},{kind:'space'},{kind:'operator',value:'='},{kind:'number',value:'160'},{kind:'operator',value:'°'}]});
  expect(prompt.mathematics?.[3]).toEqual({kind:'row',items:[{kind:'over',base:{kind:'row',items:[{kind:'identifier',value:'AB'}]},mark:{kind:'operator',value:'︵'}}]});
});
for(const xml of ['<math><mn/></math>','<math><mo> </mo></math>','<math><mover><mi>AB</mi></mover></math>','<math><mover><mi>AB</mi><mo>︵</mo><mn>2</mn></mover></math>']) {
  test(`no inventa tokens o argumentos ausentes: ${xml}`,async({page})=>{
    const result=await page.evaluate(async xml=>{
      document.querySelector('[mathml]')!.setAttribute('mathml',xml);
      return window.aleksPrompt(document);
    },xml);
    expect(result.status).toBe('unsupported');expect(result.statement).toBeUndefined();expect(result.mathematics).toBeUndefined();
  });
}
for(const sample of [
  {xml:'<math><mo>∑</mo></math>',codes:'U+2211'},
  {xml:'<math><mo>🧮</mo></math>',codes:'U+1F9EE'},
  {xml:'<math><mo>https://example.invalid/PRIVATE_TOKEN</mo></math>',codes:'U+0068 U+0074 U+0074 U+0070 U+0073 U+003A U+002F U+002F …'}
]) {
  test(`identifica el operador desconocido por códigos Unicode acotados: ${sample.codes}`,async({page})=>{
    const result=await page.evaluate(async xml=>{
      document.querySelector('[mathml]')!.setAttribute('mathml',xml);
      return window.aleksPrompt(document);
    },sample.xml);
    expect(result.status).toBe('unsupported');expect(result.reason).toContain(sample.codes);
    expect(result.reason).not.toMatch(/PRIVATE_TOKEN|example\.invalid|https:\/\//);
    expect(result.statement).toBeUndefined();expect(result.mathematics).toBeUndefined();expect(result.autoSubmitSupported).toBe(false);
  });
}
for(const sample of [
  {name:'vacío',xml:'<math><mstyle/></math>',reason:'vacía'},
  {name:'con texto fuera de tokens',xml:'<math><mstyle>1 + 2</mstyle></math>',reason:'fuera de un token'},
  {name:'con un hijo no admitido',xml:'<math><mstyle><mn>1</mn><mphantom><mn>2</mn></mphantom></mstyle></math>',reason:'mphantom'},
  {name:'anidado en exceso',xml:`<math>${'<mstyle>'.repeat(13)}<mn>1</mn>${'</mstyle>'.repeat(13)}</math>`,reason:'complejidad'}
]) {
  test(`rechaza mstyle ${sample.name} sin devolver una expresión parcial`,async({page})=>{
    const result=await page.evaluate(async xml=>{
      document.querySelector('[mathml]')!.setAttribute('mathml',xml);
      return window.aleksPrompt(document);
    },sample.xml);
    expect(result.status).toBe('unsupported');expect(result.reason).toContain(sample.reason);
    expect(result.statement).toBeUndefined();expect(result.mathematics).toBeUndefined();
    expect(result.fingerprint).toBeUndefined();expect(result.autoSubmitSupported).toBe(false);
  });
}
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
