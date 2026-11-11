/** UI real con cuentas/backend reales y puerto Chrome simulado.
 * No carga la extensión ni opera una cuenta ALEKS autenticada. */
import { test, expect, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';

const account=`bridge-${crypto.randomUUID()}@example.com`;
const password='Prueba-bridge-segura-42';
test.beforeAll(async({request})=>{
  const session=await request.get('/web-api/session').then(r=>r.json());
  const registered=await request.post('/web-api/register',{data:{email:account,password},
    headers:{Origin:'http://127.0.0.1:8000','X-CSRF-Token':session.csrf_token}});
  expect(registered.status()).toBe(201);
});

async function prepare(page: Page) {
  await page.addInitScript(() => {
    const context = { fingerprint:'a'.repeat(64), statement:'Hay 4 nadadores y dos premios por puestos distintos.',
      fields:[{key:'answer',label:'Número de maneras'}], diagram_required:false,can_fill_integer:true,can_fill_fraction:true,fill_blockers:[] };
    const proposal = {id:'00000000-0000-4000-8000-000000000021',context,
      result:{fingerprint:context.fingerprint,model:'mock-gemini',provider:'gemini',provider_calls:1,verified:false,verification:'none',
        proposal:{status:'proposed',answers:[{field_key:'answer',value:'12',unit:''}],explanation:'Propuesta simulada para probar la interfaz del puente.',missing_information:[]}}};
    let state:any={connected:true,providerCalls:0},listeners:((message:any)=>void)[]=[],disconnects:(()=>void)[]=[];
    let deferred:any;
    const api:any={commands:[],disconnections:0,holdPreview:false,
      emit:(data:any)=>listeners.forEach(fn=>fn(data)),
      progress:(changes:any)=>{state={...state,...changes};api.emit({event:'progress',value:state});},
      release:()=>{if(deferred){api.emit({requestId:deferred.requestId,ok:true,value:{proposal}});deferred=undefined;}},
      disconnect:()=>disconnects.forEach(fn=>fn()),
    };
    (window as any).bridgeMock=api;
    Object.defineProperty(window,'chrome',{configurable:true,value:{runtime:{connect:(_id:string,options:any)=>{
      if(options.name!=='aleks-web-bridge-v1')throw Error('Puerto inesperado');
      listeners=[];disconnects=[];
      return {onMessage:{addListener:(fn:any)=>listeners.push(fn)},onDisconnect:{addListener:(fn:any)=>disconnects.push(fn)},
        disconnect:()=>{api.disconnections++;disconnects.forEach(fn=>fn());},
        postMessage:(message:any)=>{
          api.commands.push(message);
          let value:any;
          switch(message.command){
            case 'connect':state={connected:true,providerCalls:0};value=state;break;
            case 'list':value=[{id:7,title:'Álgebra',active:true},{id:8,title:'Probabilidad'}];break;
            case 'bind':state={connected:true,providerCalls:0,tab:{id:message.tabId,title:message.tabId===7?'Álgebra':'Probabilidad'}};value=state;break;
            case 'read':state={...state,context};value={context};break;
            case 'preview':if(api.holdPreview){deferred=message;return;}state={...state,proposal,providerCalls:1};api.progress({});value={proposal};break;
            case 'start':state={...state,automation:{id:'00000000-0000-4000-8000-000000000022',phase:'LISTO',active:true,busy:false,canContinue:false,accepted:0,aiCalls:2,started:Date.now(),limits:message.limits,message:'ALEKS activado para usar el teclado.'}};value={automation:state.automation};break;
            case 'stop':state={...state,automation:{...state.automation,phase:'DETENIDO',active:false,busy:false,message:'Detenido por el usuario.'}};value=state;break;
            case 'status':value=state;break;
            default:throw Error('Comando inesperado');
          }
          queueMicrotask(()=>api.emit({requestId:message.requestId,ok:true,value}));
        }};
    }}}});
  });
  await page.goto('/app/');
  await page.getByLabel('Correo electrónico').fill(account);
  await page.getByLabel('Contraseña',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cerrar sesión'})).toBeVisible();
  await page.getByRole('button',{name:'Conectar extensión ALEKS'}).click();
  await expect(page.getByLabel('Pestaña ALEKS que autorizas')).toBeVisible();
}

async function bindRead(page:Page,id='7'){
  await page.getByLabel('Pestaña ALEKS que autorizas').selectOption(id);
  await page.getByRole('button',{name:'Vincular pestaña',exact:true}).click();
  await page.getByRole('button',{name:'Leer actividad ALEKS'}).click();
  await expect(page.getByText('Hay 4 nadadores y dos premios por puestos distintos.',{exact:true})).toBeVisible();
}

test('puerto simulado: vinculación concreta, propuesta, límites, estado y detener desde web',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await prepare(page);await bindRead(page);
  await page.getByRole('button',{name:'Consultar vista previa'}).click();
  await expect(page.getByText('Propuesta simulada para probar la interfaz del puente.')).toBeVisible();
  await page.getByLabel('Máximo de respuestas',{exact:true}).fill('2');
  await page.getByLabel('Usar teclado de Chrome en la pestaña vinculada').check();
  await page.getByLabel('Autorizo escribir, verificar y avanzar en la pestaña vinculada con estos límites').check();
  await page.getByRole('button',{name:'Autorizar e iniciar recorrido'}).click();
  const sent=await page.evaluate(()=>(window as any).bridgeMock.commands.find((c:any)=>c.command==='start'));
  expect(sent).toMatchObject({fingerprint:'a'.repeat(64),nativeKeyboard:true,limits:{maxExercises:2,maxMinutes:5,maxAICalls:2}});
  expect(sent).not.toHaveProperty('tabId');
  await page.evaluate(()=>{const a=(window as any).bridgeMock;const start=a.commands.find((c:any)=>c.command==='start');a.progress({providerCalls:1,providerCallsUncertain:true,automation:{id:'00000000-0000-4000-8000-000000000022',phase:'CORRECTA',active:true,busy:false,canContinue:false,accepted:1,aiCalls:1,started:Date.now(),limits:start.limits,message:'ALEKS confirmó Correcta para la entrega.'}});});
  await expect(page.getByRole('heading',{name:'Estado: CORRECTA'})).toBeVisible();
  await expect(page.getByText('Al menos 1 · consumo final sin confirmar',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Detener recorrido ALEKS'}).click();
  await expect(page.getByRole('heading',{name:'Estado: DETENIDO'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('puerto simulado: desconexión y respuesta tardía no restauran otra sesión',async({page})=>{
  await prepare(page);await bindRead(page);
  await page.evaluate(()=>(window as any).bridgeMock.holdPreview=true);
  await page.getByRole('button',{name:'Consultar vista previa'}).click();
  await expect(page.getByRole('button',{name:'Consultando nube…'})).toBeVisible();
  await page.evaluate(()=>(window as any).bridgeMock.disconnect());
  await expect(page.getByRole('button',{name:'Conectar extensión ALEKS'})).toBeVisible();
  await page.evaluate(()=>(window as any).bridgeMock.release());
  await expect(page.getByText('Propuesta simulada para probar la interfaz del puente.')).toHaveCount(0);
  await page.getByRole('button',{name:'Cerrar sesión'}).click();
  await expect(page.getByRole('button',{name:'Entrar',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).bridgeMock.progress({context:{statement:'NO DEBE APARECER'}}));
  await expect(page.getByText('NO DEBE APARECER')).toHaveCount(0);
  expect((await page.request.get('/web-api/session').then(r=>r.json())).user).toBeNull();
});

test('puerto simulado: cambiar pestaña requiere nueva lectura y autorización; límites inválidos bloquean iniciar',async({page})=>{
  await prepare(page);await bindRead(page);
  await page.getByRole('button',{name:'Consultar vista previa'}).click();
  await expect(page.getByText('Propuesta simulada para probar la interfaz del puente.')).toBeVisible();
  await page.getByLabel('Pestaña ALEKS que autorizas').selectOption('8');
  await page.getByRole('button',{name:'Vincular pestaña',exact:true}).click();
  await expect(page.getByText('Propuesta simulada para probar la interfaz del puente.')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Autorizar e iniciar recorrido'})).toBeDisabled();
  await page.getByRole('button',{name:'Leer actividad ALEKS'}).click();
  await page.getByLabel('Usar teclado de Chrome en la pestaña vinculada').check();
  await page.getByLabel('Autorizo escribir, verificar y avanzar en la pestaña vinculada con estos límites').check();
  await page.getByLabel('Máximo de respuestas',{exact:true}).fill('0');
  await expect(page.getByRole('button',{name:'Autorizar e iniciar recorrido'})).toBeDisabled();
  expect(await page.evaluate(()=>(window as any).bridgeMock.commands.filter((c:any)=>c.command==='bind').map((c:any)=>c.tabId))).toEqual([7,8]);
});

test('revocación tardía de la web conserva el vínculo nuevo en el backend real',async({page})=>{
  await prepare(page);
  const oldToken=await page.evaluate(()=>(window as any).bridgeMock.commands.find((c:any)=>c.command==='connect').token);
  let delayed:Route|undefined;
  await page.route('**/web-api/bridge-token',route=>{
    if(route.request().method()==='DELETE'){delayed=route;return;}
    return route.continue();
  });
  await page.getByRole('button',{name:'Desvincular extensión'}).click();
  await expect.poll(()=>Boolean(delayed)).toBe(true);
  await page.getByRole('button',{name:'Conectar extensión ALEKS'}).click();
  await expect(page.getByLabel('Pestaña ALEKS que autorizas')).toBeVisible();
  const token=await page.evaluate(()=>(window as any).bridgeMock.commands.filter((c:any)=>c.command==='connect').at(-1).token);
  expect(token).not.toBe(oldToken);
  expect(delayed!.request().postDataJSON()).toEqual({capability_id:createHash('sha256').update(oldToken).digest('hex')});
  const response=page.waitForResponse(r=>r.url().endsWith('/bridge-token') && r.request().method()==='DELETE');
  await delayed!.continue();expect((await response).status()).toBe(204);
  const session=await page.request.get('/web-api/bridge/session',{headers:{Origin:'chrome-extension://fjjgjakbpjhhegekcjogilmfheaicjge',Authorization:`Bearer ${token}`}});
  expect(session.status()).toBe(200);
  await expect(page.getByLabel('Pestaña ALEKS que autorizas')).toBeVisible();
});

test('nueva lectura retira la propuesta anterior de la interfaz',async({page})=>{
  await prepare(page);await bindRead(page);
  await page.getByRole('button',{name:'Consultar vista previa'}).click();
  await expect(page.getByText('Propuesta simulada para probar la interfaz del puente.')).toBeVisible();
  await page.getByRole('button',{name:'Leer actividad ALEKS'}).click();
  await expect(page.getByText('Propuesta simulada para probar la interfaz del puente.')).toHaveCount(0);
});
