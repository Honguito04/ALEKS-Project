import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

test('el panel consulta y permite introducir el entero sin exigir cm³ o pulsar Verificar',async({page})=>{
  const fixture=await readFile('tests/fixtures/aleks-single-editor.html','utf8');
  const bundle=(await build({entryPoints:['tests/e2e/aleks-panel-harness.ts'],bundle:true,write:false,format:'iife',target:'es2022',loader:{'.css':'empty'}})).outputFiles[0].text;
  await page.route('**/panel-fixture',r=>r.fulfill({contentType:'text/html',body:fixture}));
  await page.route('**/__panel.js',r=>r.fulfill({contentType:'application/javascript',body:bundle}));
  await page.goto('/panel-fixture');
  await page.evaluate(()=>{
    const root=document.createElement('div');root.id='root';document.body.append(root);
    // Editor sintético: refleja los eventos en el árbol, no emula ALEKS.
    const input=document.querySelector<HTMLInputElement>('.ansed_input')!;
    input.addEventListener('input',()=>{
      const glyph=document.createElement('span');glyph.className='AnsedObject';glyph.textContent=input.value;
      glyph.style.cssText='position:absolute;font:18px serif;left:2px;top:3px;height:24px';
      document.querySelector('.ansed_tree')!.replaceChildren(glyph);input.value='';
    });
    document.querySelector('#smt_bottomnav_button_input_checkAnswer')!.addEventListener('click',()=>{throw Error('No se debe entregar');});
  });
  await page.addScriptTag({url:'/__panel.js'});
  await page.getByRole('button',{name:'Leer actividad seleccionada'}).click();
  await expect(page.getByText('Un recuadro visual reconocido.',{exact:true})).toBeVisible();
  await expect(page.getByText('Menú: 0 de 4',{exact:false})).toHaveCount(0);
  await page.getByRole('button',{name:'Comprobar Ollama'}).click();
  await expect(page.getByText('Ollama conectado · test-model instalado.')).toBeVisible();
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Propuesta de IA · sin verificar')).toBeVisible();
  await page.getByRole('button',{name:'Introducir entero en el recuadro'}).click();
  await expect(page.getByRole('status')).toContainText('Entero reflejado');
  await expect(page.getByRole('button',{name:'Autorizar e iniciar'})).toBeDisabled();
});
