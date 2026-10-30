import { test,expect,type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

async function openPanel(page:Page) {
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
}

test('el panel consulta y permite introducir el entero sin exigir cm³ o pulsar Verificar',async({page})=>{
  await openPanel(page);
  await expect(page.getByText('Un recuadro visual reconocido.',{exact:true})).toBeVisible();
  await expect(page.getByText('Menú: 0 de 4',{exact:false})).toHaveCount(0);
  await page.getByRole('button',{name:'Comprobar Ollama'}).click();
  await expect(page.getByText('Ollama conectado · test-model instalado.')).toBeVisible();
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Propuesta de IA · sin verificar')).toBeVisible();
  await page.getByRole('button',{name:'Introducir respuesta en el recuadro'}).click();
  await expect(page.getByRole('status')).toContainText('Respuesta reflejada');
  await expect(page.getByRole('button',{name:'Autorizar e iniciar'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Iniciar recorrido automático'})).toBeVisible();
});

test('presenta un cálculo exacto como comprobado y disponible para escritura asistida',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{window.testAssistResult={provider:'deterministic',provider_calls:0,model:'',verified:true,verification:'ordered_prizes'};});
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Resultado comprobado · premios por puestos')).toBeVisible();
  await expect(page.getByText('Propuesta de IA · sin verificar')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Autorizar e iniciar'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Iniciar recorrido automático'})).toBeVisible();
});

test('distingue el recorrido detenido de una nueva propuesta válida de 15/64',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{
    window.testAutomation={id:'previous-run',phase:'DETENIDO',active:false,busy:false,canContinue:false,
      accepted:2,aiCalls:3,started:Date.now(),limits:{maxExercises:10,maxMinutes:15,maxAICalls:20},
      message:'La propuesta anterior no tenía un formato de respuesta admitido.'};
    window.testAssistResult={proposal:{status:'proposed',answers:[{field_key:'answer',value:'15/64',unit:''}],
      explanation:'Los giros son independientes: (3/8) × (5/8) = 15/64.',missing_information:[]}};
  });
  const status=page.getByRole('region',{name:'Recorrido automático ALEKS'}).getByRole('status');
  await expect(status.getByText('DETENIDO',{exact:true})).toBeVisible();
  await expect(page.getByText('Recorrido anterior · DETENIDO',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('15/64',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Responder, verificar y continuar'})).toBeEnabled();
  await expect(page.getByText('Escritura asistida no disponible:',{exact:true})).toHaveCount(0);
  await expect(status.getByText('Recorrido anterior · DETENIDO',{exact:true})).toBeVisible();
  await expect(status).toContainText('La consulta nueva se muestra arriba; su resultado no pertenece a este recorrido.');
  await expect(status).toContainText('La propuesta anterior no tenía un formato de respuesta admitido.');
  await expect(status).toContainText('2 correctas confirmadas por ALEKS · 3 llamadas IA');
  expect(await page.evaluate(()=>window.testPanelMessages.filter(message=>message.type==='automationStart' || message.type==='assistFill'))).toEqual([]);
});

test('presenta el comprobador de dos giros con su etiqueta y permite la fracción canónica',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{
    window.testAssistResult={provider:'deterministic',provider_calls:0,model:'',verified:true,verification:'independent_spins',
      proposal:{status:'proposed',answers:[{field_key:'answer',value:'15/64',unit:''}],
        explanation:'Los giros son independientes: (3/8) × (5/8) = 15/64.',missing_information:[]}};
  });
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Resultado comprobado · probabilidad de dos giros',{exact:true})).toBeVisible();
  await expect(page.getByText('Resultado comprobado · premios por puestos',{exact:true})).toHaveCount(0);
  await expect(page.getByText('15/64',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Responder, verificar y continuar'})).toBeEnabled();
});

test('ofrece introducir el cálculo exacto sin reconocer Verificar y con botones matemáticos disponibles',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{
    document.querySelector('#smt_bottomnav_button_input_checkAnswer')!.remove();
    document.querySelector('.aleks-editor-menu')!.innerHTML='<button aria-label="Fraction">Fracción</button><button aria-label="π">π</button>';
    window.testAssistResult={provider:'deterministic',provider_calls:0,model:'',verified:true,verification:'ordered_prizes'};
  });
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toBeVisible();
  await page.getByRole('button',{name:'Introducir respuesta en el recuadro'}).click();
  await expect(page.getByRole('status')).toContainText('Respuesta reflejada');
});

test('muestra por qué un recuadro bloquea la escritura de un resultado comprobado',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{
    document.querySelector<HTMLInputElement>('.ansed_input')!.readOnly=true;
    window.testAssistResult={provider:'deterministic',provider_calls:0,model:'',verified:true,verification:'ordered_prizes'};
  });
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Resultado comprobado · premios por puestos')).toBeVisible();
  await expect(page.getByText('El recuadro está deshabilitado o es de solo lectura.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toHaveCount(0);
});

for(const verified of [true,false]) {
  test(`la captura permite escritura solo para un cálculo comprobado por texto: ${verified}`,async({page})=>{
    await openPanel(page);
    if(verified)await page.evaluate(()=>{window.testAssistResult={provider:'deterministic',provider_calls:0,model:'',verified:true,verification:'ordered_prizes'};});
    await page.getByLabel('Incluir captura visible de la pestaña seleccionada').check();
    await page.getByRole('button',{name:'Resolver con IA local'}).click();
    if(verified)await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toBeVisible();
    else {
      await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toHaveCount(0);
      await expect(page.getByText('La propuesta depende de una captura.',{exact:false})).toBeVisible();
    }
  });
}

test('no presenta la incapacidad del modelo como datos faltantes ni ofrece escribir',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{window.testAssistResult={proposal:{status:'unable_to_solve',answers:[],explanation:'El modelo no produjo una solución utilizable.',missing_information:[]}};});
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('El modelo no obtuvo una solución utilizable',{exact:true})).toBeVisible();
  await expect(page.getByText('Falta información',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toHaveCount(0);
});

test('una imagen necesaria bloquea la consulta sin deshabilitar la elección de captura',async({page})=>{
  await openPanel(page);
  await page.getByLabel('El ejercicio necesita una imagen o dibujo').check();
  await expect(page.getByRole('button',{name:'Resolver con IA local'})).toBeDisabled();
  await expect(page.getByText('Falta la imagen del ejercicio.',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Incluir captura visible de la pestaña seleccionada')).toBeEnabled();
  await page.getByLabel('Incluir captura visible de la pestaña seleccionada').check();
  await expect(page.getByRole('button',{name:'Resolver con IA local'})).toBeEnabled();
});

test('adjunta una captura PNG como JPEG local y la retira al cambiar de ejercicio',async({page})=>{
  await openPanel(page);
  await page.getByLabel('El ejercicio necesita una imagen o dibujo').check();
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;canvas.getContext('2d')!.fillText('Diagrama de prueba',10,20);return canvas.toDataURL('image/png').split(',')[1];});
  await page.getByLabel('Adjuntar imagen del ejercicio').setInputFiles({name:'ejercicio.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  const image=page.getByAltText('Imagen adjunta para la consulta');
  await expect(image).toBeVisible();await expect(image).toHaveAttribute('src',/^data:image\/jpeg;base64,/);
  await expect(page.getByRole('button',{name:'Resolver con IA local'})).toBeEnabled();
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Propuesta de IA · sin verificar')).toBeVisible();
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toHaveCount(0);
  await page.evaluate(()=>{document.querySelector('#algoPrompt')!.textContent='Nuevo ejercicio';});
  await expect(image).toHaveCount(0);
  await expect(page.getByText('Propuesta de IA · sin verificar')).toHaveCount(0);
});

test('un archivo ilegible deja los controles disponibles y no habilita consulta sin imagen',async({page})=>{
  await openPanel(page);
  await page.getByLabel('El ejercicio necesita una imagen o dibujo').check();
  await page.getByLabel('Adjuntar imagen del ejercicio').setInputFiles({name:'roto.png',mimeType:'image/png',buffer:Buffer.from('not-an-image')});
  await expect(page.getByRole('alert')).toContainText('No se pudo abrir la imagen');
  await expect(page.getByRole('button',{name:'Resolver con IA local'})).toBeDisabled();
  await expect(page.getByLabel('Incluir captura visible de la pestaña seleccionada')).toBeEnabled();
  await expect(page.getByLabel('Adjuntar imagen del ejercicio')).toBeEnabled();
});

test('una revisión visual con cuenta comprobada mantiene el resultado sin verificación de geometría y sin escritura',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{window.testAssistResult={provider_calls:2,proposal:{status:'proposed',answers:[{field_key:'answer',value:'1496',unit:'cm^3'}],
    explanation:'13*15*8 - 8*(15-7-7)*8 = 1496 cm^3. Cuenta comprobada; geometría sin verificación independiente.',missing_information:[]}};});
  await page.getByLabel('Incluir captura visible de la pestaña seleccionada').check();
  await expect(page.getByText('La consulta visual puede hacer dos pasadas',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Propuesta de IA · sin verificar')).toBeVisible();
  await expect(page.getByText('1496 cm^3',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toHaveCount(0);
});

test('una propuesta visual incoherente se presenta descartada y sin respuesta disponible',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{window.testAssistResult={proposal:{status:'unable_to_solve',answers:[],
    explanation:'Propuesta visual descartada: la respuesta no coincide con el cálculo propuesto.',missing_information:[]}};});
  await page.getByLabel('Incluir captura visible de la pestaña seleccionada').check();
  await page.getByRole('button',{name:'Resolver con IA local'}).click();
  await expect(page.getByText('Propuesta visual descartada:',{exact:false})).toBeVisible();
  await expect(page.getByText('Respuesta del ejercicio:',{exact:false})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Introducir respuesta en el recuadro'})).toHaveCount(0);
});

test('la elección de teclado se envía para la pestaña seleccionada y sigue el estado del worker',async({page})=>{
  await openPanel(page);
  const keyboard=page.getByLabel('Usar teclado de Chrome para esta pestaña');
  await expect(keyboard).not.toBeChecked();await keyboard.check();
  await expect(keyboard).toBeChecked();
  await expect(page.getByText('Teclado de Chrome activado para esta pestaña.',{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>window.testPanelMessages.filter(message=>message.type==='nativeKeyboard')))
    .toEqual([{scope:'ui',type:'nativeKeyboard',tabId:7,enabled:true}]);
  // Un reinicio del worker pierde la elección en memoria: el sondeo debe
  // reflejarlo y no dejar una casilla que prometa el teclado aún habilitado.
  await page.evaluate(()=>{window.testNativeKeyboard=false;});
  await expect(keyboard).not.toBeChecked();
  await expect(page.getByText('Teclado de Chrome activado para esta pestaña.',{exact:false})).toHaveCount(0);
  await keyboard.check();await keyboard.uncheck();
  expect(await page.evaluate(()=>window.testPanelMessages.filter(message=>message.type==='nativeKeyboard').at(-1)))
    .toEqual({scope:'ui',type:'nativeKeyboard',tabId:7,enabled:false});
});

test('un rechazo al activar el teclado mantiene la casilla desmarcada y explica el fallo',async({page})=>{
  await openPanel(page);
  await page.evaluate(()=>{window.testNativeKeyboardError='Recarga la extensión con el permiso de depuración.';});
  const keyboard=page.getByLabel('Usar teclado de Chrome para esta pestaña');
  await keyboard.click();
  await expect(page.getByRole('alert')).toContainText('Recarga la extensión con el permiso de depuración.');
  await expect(keyboard).not.toBeChecked();await expect(keyboard).toBeEnabled();
  await expect(page.getByText('Teclado de Chrome activado para esta pestaña.',{exact:false})).toHaveCount(0);
});
