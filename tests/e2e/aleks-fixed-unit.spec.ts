import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-fixed-unit-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-submission-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/fixed-unit-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.goto('/fixed-unit-fixture');await page.addScriptTag({content:bundle});
});

test('la unidad predefinida no cuenta como respuesta y llega a la IA en la etiqueta',async({page})=>{
  const result=await page.evaluate(async()=>{
    const before=document.body.innerHTML;
    const context=await window.assistContext(document);
    return {context,unchanged:before===document.body.innerHTML};
  });
  expect(result.unchanged).toBe(true);
  expect(result.context).toMatchObject({can_fill_integer:true,can_fill_fraction:true,fixed_unit:'h',fill_blockers:[],diagram_required:false});
  expect(result.context.fields[0].label).toContain('hora(s)');
  expect(result.context.statement).toContain('diámetro de 10 m');
  expect(result.context.statement).toContain('profundidad de 1,5 m');
  expect(result.context.statement).toContain('16 (m)^(3) por hora');
});

for(const mode of ['correct','wrong-number','unit-change','unknown-unit','editable-text','duplicate-unit','overlap','disabled','cancelled'] as const) {
  test(`escritura con unidad predefinida: ${mode}`,async({page})=>{
    const result=await page.evaluate(async mode=>{
      const input=document.querySelector<HTMLInputElement>('.ansed_input')!,tree=document.querySelector('.ansed_tree')!,unit=tree.firstElementChild!;
      let clicks=0,events=0;document.addEventListener('click',()=>clicks++);
      const context=await window.assistContext(document),abort=new AbortController();
      if(mode==='unknown-unit')unit.textContent='PRIVATE_TEXT';
      if(mode==='editable-text'){unit.textContent='m';(unit as HTMLElement).style.font='italic 18px "Times New Roman"';}
      if(mode==='duplicate-unit')tree.append(unit.cloneNode(true));
      if(mode==='disabled')input.readOnly=true;
      if(mode==='cancelled')abort.abort();
      input.addEventListener('input',()=>{
        events++;
        const digit=document.createElement('span');digit.className='AnsedObject';digit.textContent=mode==='wrong-number'?'8':input.value;
        digit.style.cssText=`position:absolute;left:${mode==='overlap'?28:12}px;top:12px;font:18px serif;height:22px`;
        tree.prepend(digit);input.value='';
        if(mode==='unit-change')unit.textContent='minuto(s)';
      });
      const driver=new window.AleksSubmission(document,120);
      let error='',written=false;
      try {
        // submit exige lectura visual antes de pulsar Verificar.
        if(mode==='correct') {
          document.querySelector('button')!.addEventListener('click',()=>{
            document.querySelector('button')!.remove();
            document.body.insertAdjacentHTML('beforeend','<div id="result_feedback_alert" aria-live="polite" style="display:inline-block;border:1px solid rgb(57,108,41)"><div style="display:inline-block;color:rgb(57,108,41)">Correcta</div></div><button type="button" class="learningCorrect" id="smt_bottomnav_button_input_learningCorrect"><div class="textContent">Siguiente</div></button>');
          });
        }
        written=(await driver.submit(context.fingerprint,'7',abort.signal)).status==='accepted';
      }catch(reason){error=(reason as Error).message;}
      return {written,error,events,clicks,unit:unit.textContent};
    },mode);
    expect(result.written).toBe(mode==='correct');
    expect(result.clicks).toBe(mode==='correct'?1:0);
    if(mode==='correct')expect(result).toMatchObject({error:'',events:1,unit:'hora(s)'});
    else expect(result.error).not.toBe('');
    if(['unknown-unit','editable-text','duplicate-unit','disabled','cancelled'].includes(mode))expect(result.events).toBe(0);
  });
}
