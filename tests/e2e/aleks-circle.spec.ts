import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let bundle:string;
const fixtures:Record<string,string>={};
test.beforeAll(async()=>{
  for(const name of ['empty','draft','final','menu','result'])fixtures[name]=await readFile(`tests/fixtures/aleks-circle-${name}.html`,'utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-probe-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/circle-fixture',r=>r.fulfill({contentType:'text/html',body:fixtures.final+fixtures.menu+fixtures.result}));
  await page.route('**/__probe.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/circle-fixture');await page.addScriptTag({url:'/__probe.js'});
});

test('asocia arco y área por sus etiquetas y lee los valores finales con inputs transparentes',async({page})=>{
  const result=await page.evaluate(async()=>{
    const before=document.body.innerHTML;let events=0;
    for(const name of ['input','change','click'])document.addEventListener(name,()=>events++);
    for(const input of document.querySelectorAll<HTMLInputElement>('.ansed_input'))input.value='BUFFER_NO_ES_RESPUESTA';
    const detection=await window.pendingAdapter.detect();
    const blocked:string[]=[];
    for(const operation of ['read','write','submit','result','next'] as const) {
      try{await window.pendingAdapter[operation]();}catch{blocked.push(operation);}
    }
    return {detection,events,unchanged:before===document.body.innerHTML,blocked};
  });
  expect(result).toMatchObject({events:0,unchanged:true,blocked:['read','write','submit','result','next'],detection:{supported:false,session:false,
    observedTopic:'Longitud de un arco y el área de un sector circular',
    editorObservation:{inputCount:0,inputDiagnostics:{presentCount:2,paintedCount:0,visibleRootCount:2,blockedBy:{opacityZero:2}},
      circleTable:{status:'observed',disabled:true,autoSubmitSupported:false,fields:[
        {kind:'arc_length',readback:{status:'readable',display:'8π/3 cm',coefficient:'8',denominator:'3',unit:'cm'}},
        {kind:'shaded_area',readback:{status:'readable',display:'4π cm²',coefficient:'4',unit:'cm^2'}}]},
      nextControl:{status:'missing',count:0},nextTopicControl:{status:'observed',count:1},
      resultMarker:{status:'positive_marker',positiveMessageCount:1,continuation:'topic'}}}});
  expect(JSON.stringify(result.detection)).not.toContain('BUFFER_NO_ES_RESPUESTA');
  expect(result.detection.reason).toContain('Correcta y Siguiente tema');
});

for(const state of ['empty','draft'] as const) {
  test(`lee la tabla ${state} sin inferir respuestas aceptadas`,async({page})=>{
    await page.setContent(fixtures[state]);
    const observation=await page.evaluate(()=>window.aleksProbe(document));
    expect(observation.circleTable).toMatchObject({status:'observed',disabled:false,autoSubmitSupported:false});
    const answers=observation.circleTable.fields.map(field=>field.readback);
    if(state==='empty')expect(answers.map(answer=>answer.status)).toEqual(['empty','empty']);
    else {
      expect(answers.map(answer=>answer.display)).toEqual(['5π','7π']);
      expect(answers.map(answer=>answer.unit)).toEqual([undefined,undefined]);
    }
    expect(observation.resultMarker.status).toBe('missing');
  });
}

test('conserva la asociación al invertir filas y cambiar IDs; no usa el orden de los inputs',async({page})=>{
  const table=await page.evaluate(()=>{
    const tbody=document.querySelector('table tbody')!;tbody.append(tbody.firstElementChild!);
    document.querySelectorAll('.ansed_input').forEach((input,i)=>input.id=`otro_${i}`);
    return window.aleksProbe(document).circleTable;
  });
  expect(table.fields.map(field=>[field.kind,field.readback.display])).toEqual([['arc_length','8π/3 cm'],['shaded_area','4π cm²']]);
});

for(const mutation of ['duplicate-table','wrong-label','duplicate-label','hidden-root','extra-input'] as const) {
  test(`no asocia los campos con ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const table=document.querySelector('table')!;
      if(mutation==='duplicate-table')table.after(table.cloneNode(true));
      if(mutation==='wrong-label')table.rows[0].cells[0].querySelector('.visually-hidden')!.textContent='Otra longitud';
      if(mutation==='duplicate-label')table.rows[1].cells[0].innerHTML=table.rows[0].cells[0].innerHTML;
      if(mutation==='hidden-root')table.rows[0].cells[1].querySelector<HTMLElement>('.ansed_root')!.style.opacity='0';
      if(mutation==='extra-input')table.rows[0].cells[1].append(table.querySelector('.ansed_input')!.cloneNode(true));
      return window.aleksProbe(document).circleTable;
    },mutation);
    expect(result.status).not.toBe('observed');expect(result.fields).toEqual([]);
  });
}

for(const mutation of ['zero-denominator','baseline-denominator','extra-token','clipped-token','hidden-token','wrong-unit'] as const) {
  test(`rechaza una fracción visual con ${mutation}`,async({page})=>{
    const readback=await page.evaluate(mutation=>{
      const tree=document.querySelector('table')!.rows[0].cells[1].querySelector('.ansed_tree')!;
      const nodes=[...tree.children] as HTMLElement[];
      if(mutation==='zero-denominator')nodes[2].textContent='0';
      if(mutation==='baseline-denominator')nodes[2].style.top='3px';
      if(mutation==='extra-token')tree.append(document.createTextNode('+1'));
      if(mutation==='clipped-token')nodes[3].style.left='500px';
      if(mutation==='hidden-token')nodes[2].style.visibility='hidden';
      if(mutation==='wrong-unit')nodes[3].textContent='m';
      return window.aleksProbe(document).circleTable.fields[0].readback;
    },mutation);
    expect(readback.status).toBe('unsupported');expect(readback.unit).toBeUndefined();expect(readback.display).toBeUndefined();
  });
}

test('no confunde un exponente en la línea base con centímetros cuadrados',async({page})=>{
  const readback=await page.evaluate(()=>{
    const tree=document.querySelector('table')!.rows[1].cells[1].querySelector('.ansed_tree')!;
    (tree.children[3] as HTMLElement).style.top='16px';
    return window.aleksProbe(document).circleTable.fields[1].readback;
  });
  expect(readback.status).toBe('unsupported');
});

test('el menú aportado tiene fracción, pi, cm y cm² deshabilitados',async({page})=>{
  const menu=await page.evaluate(()=>window.aleksProbe(document).menu);
  expect(menu.status).toBe('observed');
  expect(Object.values(menu.controls).map(control=>control.status)).toEqual(['disabled','disabled','disabled','disabled']);
});

test('no elige entre menús visibles duplicados',async({page})=>{
  const menu=await page.evaluate(()=>{
    const menu=document.querySelector('.aleks-editor-menu')!;menu.after(menu.cloneNode(true));
    return window.aleksProbe(document).menu;
  });
  expect(menu.status).toBe('ambiguous');
  expect(Object.values(menu.controls).every(control=>control.status==='ambiguous')).toBe(true);
});

for(const mutation of ['wrong-id','wrong-live','wrong-border','wrong-message','duplicate-alert','disabled-next','mixed-next','verify-present'] as const) {
  test(`no registra la señal Correcta más Siguiente tema con ${mutation}`,async({page})=>{
    const result=await page.evaluate(mutation=>{
      const alert=document.querySelector<HTMLElement>('#result_feedback_alert')!,next=document.querySelector<HTMLButtonElement>('#smt_bottomnav_button_input_learningCorrect')!;
      if(mutation==='wrong-id')alert.id='otro_resultado';
      if(mutation==='wrong-live')alert.setAttribute('aria-live','off');
      if(mutation==='wrong-border')alert.style.borderColor='red';
      if(mutation==='wrong-message')alert.querySelector('div')!.textContent='Incorrecta';
      if(mutation==='duplicate-alert')alert.after(alert.cloneNode(true));
      if(mutation==='disabled-next')next.disabled=true;
      if(mutation==='mixed-next'){
        const other=next.cloneNode(true) as HTMLElement;other.querySelector('.textContent')!.textContent='Siguiente';next.after(other);
      }
      if(mutation==='verify-present') {
        const verify=document.createElement('button');verify.type='button';verify.id='smt_bottomnav_button_input_checkAnswer';verify.className='checkAnswer';
        const label=document.createElement('div');label.className='textContent';label.textContent='Verificar';verify.append(label);document.body.append(verify);
      }
      return window.aleksProbe(document).resultMarker;
    },mutation);
    expect(result.status).not.toBe('positive_marker');expect(result.continuation).toBeUndefined();
  });
}
