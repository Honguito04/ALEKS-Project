import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
let fixture:string,bundle:string;
test.beforeAll(async()=>{
  fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  bundle=(await build({entryPoints:['tests/e2e/aleks-fraction-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0].text;
});
test.beforeEach(async({page})=>{
  await page.route('**/fraction-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__fraction.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/fraction-fixture');await page.addScriptTag({url:'/__fraction.js'});
  await page.evaluate(()=>{
    document.querySelector('.aleks-editor-menu')!.innerHTML='<button aria-label="Fraction">Fracción</button>';
    document.querySelector('#algoPrompt')!.textContent='Escribir la probabilidad como una fracción reducida.';
  });
});

test('gramática cerrada de enteros y fracciones reducidas con componentes acotados',async({page})=>{
  const result=await page.evaluate(()=>({valid:['0','0/1','123','1/5','5/3','999999999999/2'].map(window.fractionTest.parseSupportedAnswer),
    invalid:['0/2','2/4','1/0','1/-5','-1/5','1 / 5','01/5','1.5','π','alert(1)','1000000000000/3'].map(value=>Boolean(window.fractionTest.parseSupportedAnswer(value)))}));
  expect(result.valid.every(Boolean)).toBe(true);expect(result.invalid.some(Boolean)).toBe(false);
});

for(const mode of ['fraction','reverse-order','zero-denominator','unreduced','misaligned','clipped','hidden','third-row','nested','slash-text','unit','too-far'] as const) {
  test(`lectura de fracción: ${mode}`,async({page})=>{
    const result=await page.evaluate(mode=>{
      const root=document.querySelector<HTMLElement>('.ansed_root')!,tree=root.querySelector<HTMLElement>('.ansed_tree')!;
      root.style.height='80px';tree.style.height='80px';
      const number=(text:string,top:number,left=10)=>{const node=document.createElement('span');node.className='AnsedObject';node.textContent=text;node.style.cssText=`position:absolute;left:${left}px;top:${top}px;height:20px;font:18px serif`;return node;};
      const n=number(mode==='unreduced'?'2':'1',2),d=number(mode==='zero-denominator'?'0':mode==='unreduced'?'4':'5',mode==='too-far'?55:28,mode==='misaligned'?25:10);
      tree.replaceChildren(n,d);
      if(mode==='reverse-order')tree.replaceChildren(d,n);
      if(mode==='clipped')d.style.top='76px';
      if(mode==='hidden')d.style.opacity='0';
      if(mode==='third-row')tree.append(number('2',52));
      if(mode==='nested')n.innerHTML='<b>1</b>';
      if(mode==='slash-text')tree.replaceChildren(number('1/5',2));
      if(mode==='unit')tree.append(number('cm',28,25));
      return window.fractionTest.inspectSingleEditor(document).readback;
    },mode);
    if(mode==='fraction' || mode==='reverse-order')expect(result).toMatchObject({status:'readable',value:'1/5'});
    else expect(result.status).toBe('unsupported');
  });
}

for(const mode of ['success','zero','no-menu','ignored','slash-text','wrong-denominator','cancel-input','cancel-beforeinput','changed-prompt','replaced-input'] as const) {
  test(`escritura con conversión a fracción vertical: ${mode}`,async({page})=>{
    const result=await page.evaluate(async mode=>{
      const root=document.querySelector<HTMLElement>('.ansed_root')!,tree=root.querySelector<HTMLElement>('.ansed_tree')!,input=root.querySelector<HTMLInputElement>('input')!;
      let submits=0;const writes:string[]=[];const abort=new AbortController();
      const glyph=(text:string,top:number)=>{const node=document.createElement('span');node.className='AnsedObject';node.textContent=text;node.style.cssText=`position:absolute;left:10px;top:${top}px;height:20px;font:18px serif`;return node;};
      document.querySelector('.checkAnswer')!.addEventListener('click',()=>submits++);
      if(mode==='no-menu')document.querySelector('.aleks-editor-menu')!.remove();
      if(mode==='cancel-beforeinput')input.addEventListener('beforeinput',()=>abort.abort());
      input.addEventListener('input',()=>{
        writes.push(input.value);
        if(mode==='cancel-input')abort.abort();
        if(mode==='changed-prompt')document.querySelector('#algoPrompt')!.textContent='Otro ejercicio';
        if(mode==='replaced-input'){input.replaceWith(input.cloneNode());return;}
        if(mode==='ignored')return;
        root.style.height='56px';tree.style.height='56px';
        const [n,d]=input.value.split('/');
        tree.replaceChildren(...(mode==='slash-text'?[glyph(input.value,2)]:[glyph(n,2),glyph(mode==='wrong-denominator'?'7':d,28)]));input.value='';
      });
      const context=await window.fractionTest.assistContext(document);let error='',written:unknown;
      try{written=await window.fractionTest.fillAssistAnswer(document,context.fingerprint,mode==='zero'?'0/1':'1/5',abort.signal);}catch(e){error=(e as Error).message;}
      return {written,error,submits,writes};
    },mode);
    expect(result.submits).toBe(0);
    if(['success','zero','no-menu'].includes(mode))expect(result).toMatchObject({written:{written:true,display:mode==='zero'?'0/1':'1/5',submitted:false},error:''});
    else {expect(result.error).not.toBe('');expect(result.written).toBeUndefined();}
    expect(result.writes.length).toBe(mode==='cancel-beforeinput'?0:1);
  });
}
