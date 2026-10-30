import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-content-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
async function openContent(page:Page) {
  await page.route('**/content-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__content.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/content-fixture');await page.bringToFront();await page.addScriptTag({url:'/__content.js'});
}
for(const mode of ['no-run','wrong-run','after-stop','replaced-run'] as const) {
  test(`rechaza comandos tardíos de contenido: ${mode}`,async({page})=>{
    await openContent(page);
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

test('el guard del teclado atiende durante la escritura y rechaza identificadores ajenos o caducados',async({page})=>{
  await openContent(page);
  const result=await page.evaluate(async()=>{
    const responses:Record<string,unknown>={};let inputs=0,clicks=0;
    document.addEventListener('input',()=>inputs++);document.addEventListener('click',()=>clicks++);
    responses.before=await window.contentRPC('nativeGuard',{writeId:'write-1'});
    window.nativeContentHandler=async message=>{
      if(message.type!=='nativeType')throw Error('RPC inesperado');
      responses.request=message;
      responses.guard=await window.contentRPC('nativeGuard',{writeId:message.writeId});
      responses.foreign=await window.contentRPC('nativeGuard',{writeId:'another-write'});
      responses.competing=await window.contentRPC('assistFill',{fingerprint:'unused',value:'99'});
      // Solo simula el acuse de lectura visual del puente: las teclas nativas
      // reales se ejercitan por separado en native-editor.spec.ts.
      const glyph=document.createElement('span');glyph.className='AnsedObject';glyph.textContent='12';
      glyph.style.cssText='position:absolute;font:18px serif;left:2px;top:3px;height:24px';
      document.querySelector('.ansed_tree')!.replaceChildren(glyph);
      return {ok:true,data:true};
    };
    const context=await window.contentRPC('assistContext');
    responses.fill=await window.contentRPC('assistFill',{fingerprint:context.data.fingerprint,value:'12',nativeWriteId:'write-1'});
    responses.after=await window.contentRPC('nativeGuard',{writeId:'write-1'});
    return {...responses,inputs,clicks};
  });
  expect(result).toMatchObject({inputs:0,clicks:0,
    before:{ok:false,error:'No hay una escritura de teclado vigente.'},
    request:{scope:'content',type:'nativeType',writeId:'write-1'},guard:{ok:true,data:true},
    foreign:{ok:false,error:'No hay una escritura de teclado vigente.'},
    competing:{ok:false,error:'Ya hay una operación en curso'},
    fill:{ok:true,data:{written:true,display:'12',submitted:false}},
    after:{ok:false,error:'No hay una escritura de teclado vigente.'}});
});

for(const stop of ['stop','pause'] as const) {
  test(`${stop} invalida el guard mientras espera al teclado y no entrega`,async({page})=>{
    await openContent(page);
    const result=await page.evaluate(async stop=>{
      const responses:Record<string,unknown>={};let clicks=0;
      document.addEventListener('click',()=>clicks++);
      window.nativeContentHandler=async message=>{
        if(message.type!=='nativeType')return {ok:true};
        responses.guard=await window.contentRPC('nativeGuard',{writeId:message.writeId});
        responses.stop=await window.contentRPC(stop);
        responses.after=await window.contentRPC('nativeGuard',{writeId:message.writeId});
        return {ok:true,data:true};
      };
      const context=await window.contentRPC('assistContext');
      responses.fill=await window.contentRPC('assistFill',{fingerprint:context.data.fingerprint,value:'12',nativeWriteId:'write-1'});
      return {...responses,clicks,tree:document.querySelector('.ansed_tree')!.textContent};
    },stop);
    expect(result).toMatchObject({clicks:0,tree:'',guard:{ok:true,data:true},stop:{ok:true},
      after:{ok:false,error:'No hay una escritura de teclado vigente.'},fill:{ok:false}});
  });
}

test('el guard rechaza un cambio de enunciado antes de escribir',async({page})=>{
  await openContent(page);
  const result=await page.evaluate(async()=>{
    window.nativeContentHandler=async message=>{
      document.querySelector('#algoPrompt')!.textContent='Otro ejercicio';
      return window.contentRPC('nativeGuard',{writeId:message.writeId});
    };
    const context=await window.contentRPC('assistContext');
    return window.contentRPC('assistFill',{fingerprint:context.data.fingerprint,value:'12',nativeWriteId:'write-1'});
  });
  expect(result).toMatchObject({ok:false,error:'Cambió el ejercicio o el foco del editor. El teclado de Chrome se detuvo.'});
  await expect(page.locator('.ansed_tree')).toHaveText('');
});

test('conserva Correcta en el mismo recorrido y avanza una vez con Siguiente tema antes de otra respuesta',async({page})=>{
  await openContent(page);
  const result=await page.evaluate(async()=>{
    const input=document.querySelector<HTMLInputElement>('input.ansed_input')!;
    const submit=document.querySelector<HTMLButtonElement>('.checkAnswer')!;
    let submits=0,nexts=0;
    input.addEventListener('input',()=>{
      const span=document.createElement('span');span.className='AnsedObject';span.textContent=input.value;
      span.style.cssText='position:absolute;left:2px;top:3px;font:18px serif;height:24px';
      document.querySelector('.ansed_tree')!.replaceChildren(span);input.value='';
    });
    submit.addEventListener('click',()=>{
      submits++;submit.remove();
      const feedback=document.createElement('div');feedback.id='result_feedback_alert';feedback.setAttribute('aria-live','polite');
      feedback.style.cssText='display:inline-block;border:1px solid rgb(57,108,41)';
      feedback.innerHTML='<div style="display:inline-block;color:rgb(57,108,41)">Correcta</div>';
      const next=document.createElement('button');next.type='button';next.id='smt_bottomnav_button_input_learningCorrect';next.className='learningCorrect';
      next.innerHTML='<div class="textContent">Siguiente tema</div>';
      next.addEventListener('click',()=>{
        nexts++;document.querySelector('#algoPrompt')!.textContent='Calcular 2 + 3.';
        document.querySelector('.ansed_tree')!.replaceChildren();feedback.remove();next.remove();document.body.append(submit);
      });
      document.body.append(feedback,next);
    });
    await window.contentRPC('automationReset',{runId:'same-run'});
    const first=await window.contentRPC('assistContext');
    const accepted=await window.contentRPC('automationSubmit',{runId:'same-run',fingerprint:first.data.fingerprint,value:'12'});
    // Completar por límite no resetea el contenido. El sondeo del panel tampoco
    // debe consumir la confirmación mientras el usuario amplía sus límites.
    await window.contentRPC('status');await window.contentRPC('status');
    const before={submits,nexts};
    const [advanced,duplicate]=await Promise.all([
      window.contentRPC('automationNext',{runId:'same-run'}),
      window.contentRPC('automationNext',{runId:'same-run'})
    ]);
    const second=await window.contentRPC('assistContext');
    const acceptedAgain=await window.contentRPC('automationSubmit',{runId:'same-run',fingerprint:second.data.fingerprint,value:'5'});
    return {accepted,before,advanced,duplicate,acceptedAgain,submits,nexts};
  });
  expect(result).toMatchObject({accepted:{ok:true,data:{status:'accepted'}},before:{submits:1,nexts:0},
    advanced:{ok:true},duplicate:{ok:false},acceptedAgain:{ok:true,data:{status:'accepted'}},submits:2,nexts:1});
});
