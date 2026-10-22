import { beforeEach,it,expect,vi } from 'vitest';
import { BACKEND,ALEKS_ACTIVITY,allowedTab,type Exercise,type Run,type Limits } from '../../extension/src/shared';

const id='fjjgjakbpjhhegekcjogilmfheaicjge';
const ext=`chrome-extension://${id}/`;
type Listener=(message:Record<string,unknown>,sender:chrome.runtime.MessageSender,reply:(response:unknown)=>void)=>unknown;
let listener:Listener;
let actionClick:(tab:chrome.tabs.Tab)=>void;
let local:Record<string,unknown>,session:Record<string,unknown>;
let url:string,permitted:boolean;
let tabsSend:ReturnType<typeof vi.fn>;
let fetchMock:ReturnType<typeof vi.fn>;
const limits={maxExercises:10,maxMinutes:10,maxAICalls:0,preview:false};
const exercise:Exercise={source:'simulator',activity_id:'activity',fingerprint:'a'.repeat(64),statement:'1+1',math:{family:'arithmetic',expression:'1+1'},fields:[{id:'answer',kind:'text'}],choices:[],domain:'real',units:'',format:'exact',decimal_places:2,evidence:['test'],ambiguities:[]};
const run=(authorizedLimits:Limits=limits):Run=>({id:'00000000-0000-4000-8000-000000000001',origin:BACKEND,activity:'activity',state:'INACTIVO',limits:authorizedLimits,started:Date.now(),count:0,aiCalls:0,message:'Autorización de sesión registrada',operations:{},events:[]});
function store(data:Record<string,unknown>) {
  return {get:async(keys:string|string[]|null)=>keys===null ? structuredClone(data):Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in data).map(k=>[k,structuredClone(data[k])])),
    set:async(values:Record<string,unknown>)=>{Object.assign(data,structuredClone(values));},remove:async(keys:string|string[])=>{for(const k of typeof keys==='string'?[keys]:keys)delete data[k];},clear:async()=>{for(const k of Object.keys(data))delete data[k];},setAccessLevel:async()=>{}};
}
beforeEach(async()=>{
  vi.resetModules();local={};session={auth:{token:'not-exposed-to-content',mode:'demo'}};url=BACKEND+'/simulator/';permitted=true;
  tabsSend=vi.fn(async()=>({ok:true,data:{detection:{origin:BACKEND,activity:'activity',session:true,supported:true}}}));
  fetchMock=vi.fn(async()=>Response.json({status:'ok',mode:'demo'}));vi.stubGlobal('fetch',fetchMock);
  vi.stubGlobal('chrome',{
    runtime:{id,getURL:(p:string)=>ext+p,onMessage:{addListener:(fn:Listener)=>{listener=fn;}},onInstalled:{addListener:vi.fn()}},
    sidePanel:{setPanelBehavior:vi.fn(async()=>{}),open:vi.fn(async()=>{})},
    action:{onClicked:{addListener:(fn:typeof actionClick)=>{actionClick=fn;}}},storage:{local:store(local),session:store(session)},
    permissions:{contains:async()=>permitted,remove:vi.fn(async()=>true),onRemoved:{addListener:vi.fn()}},
    tabs:{get:async(id:number)=>({id,url,title:'Simulador'}),query:async()=>[{id:7,url}],sendMessage:tabsSend,onRemoved:{addListener:vi.fn()}},
    scripting:{executeScript:async()=>{}}
  });
  await import('../../extension/src/background');
});
const ui:chrome.runtime.MessageSender={id,url:ext+'panel.html'};
const content=():chrome.runtime.MessageSender=>({id,url,tab:{id:7,url,index:0,active:true,pinned:false,highlighted:true,windowId:1,incognito:false,selected:true,discarded:false,frozen:false,autoDiscardable:true,groupId:-1},frameId:0});
async function send(message:Record<string,unknown>,sender:chrome.runtime.MessageSender=ui):Promise<any> {
  return new Promise(resolve=>{if(listener(message,sender,resolve)!==true)resolve(undefined);});
}
it('el clic del icono abre el panel en esa pestaña conservando el gesto y sin capturar o consultar por su cuenta',()=>{
  // Regresión: el modo automático de Chromium no concede activeTab. Las APIs
  // están simuladas; aquí se comprueba la ruta de apertura, no el permiso nativo.
  expect(chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({openPanelOnActionClick:false});
  chrome.tabs.captureVisibleTab=vi.fn();
  actionClick({id:7,windowId:1} as chrome.tabs.Tab);
  expect(chrome.sidePanel.open).toHaveBeenCalledWith({tabId:7}); // inmediato, sin esperar un await
  expect(fetchMock).not.toHaveBeenCalled();expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  expect(tabsSend).not.toHaveBeenCalled();expect(chrome.permissions.remove).not.toHaveBeenCalled();
});
it('no intenta abrir el panel para una pestaña sin identificador válido',()=>{
  actionClick({windowId:1} as chrome.tabs.Tab);actionClick({id:-1,windowId:1} as chrome.tabs.Tab);
  expect(chrome.sidePanel.open).not.toHaveBeenCalled();
});
it('rechaza mensajes de otra extensión, sitios web y marcos secundarios',async()=>{
  expect(await send({scope:'ui',type:'health'},{id:'foreign',url:ext+'panel.html'})).toBeUndefined();
  expect(await send({scope:'ui',type:'demo'},content())).toBeUndefined();
  expect((await send({scope:'content',type:'load'},{...content(),frameId:2})).ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('no transmite sesiones a un content script ni permite que inicie OAuth',async()=>{
  expect((await send({scope:'content',type:'load'},content())).data).toBeUndefined();
  const response=await send({scope:'content',type:'google'},content());
  expect(response.ok).toBe(false);expect(JSON.stringify(response)).not.toContain('not-exposed-to-content');
});
it('rechaza pestañas externas y permisos revocados',async()=>{
  url='https://evil.example/simulator';expect((await send({scope:'ui',type:'attach',tabId:7})).ok).toBe(false);
  url=BACKEND+'/simulator/';permitted=false;expect((await send({scope:'ui',type:'attach',tabId:7})).ok).toBe(false);
});
it('registra actividad y límites autorizados antes de arrancar',async()=>{
  const response=await send({scope:'ui',type:'start',tabId:7,activity:'activity',limits});
  expect(response.ok).toBe(true);expect(local['consent:7']).toEqual({origin:BACKEND,activity:'activity',limits});
  expect(tabsSend.mock.calls.at(-1)?.[1].type).toBe('start');
});
it('guarda la ejecución aunque el almacenamiento reordene las propiedades de los mismos límites',async()=>{
  expect((await send({scope:'ui',type:'start',tabId:7,activity:'activity',limits})).ok).toBe(true);
  const consent=local['consent:7'] as {limits:Limits};
  consent.limits=Object.fromEntries(Object.entries(consent.limits).sort(([a],[b])=>a.localeCompare(b))) as Limits;
  expect(JSON.stringify(consent.limits)).not.toBe(JSON.stringify(limits));
  const current=run();
  const response=await send({scope:'content',type:'save',run:current},content());
  expect(response).toEqual({ok:true,data:true});
  expect((await send({scope:'content',type:'load'},content())).data).toEqual(current);
});
it.each([
  {maxExercises:11}, {maxMinutes:11}, {maxAICalls:1}, {preview:true}
])('rechaza un cambio real de límites %j y conserva la ejecución anterior',async(change)=>{
  local['consent:7']={origin:BACKEND,activity:'activity',limits};
  const current=run();local['run:7']=structuredClone(current);
  const response=await send({scope:'content',type:'save',run:{...current,limits:{...limits,...change}}},content());
  expect(response).toEqual({ok:false,error:'Los límites no coinciden con la autorización'});
  expect(local['run:7']).toEqual(current);
});
it('no permite iniciar en ALEKS ni con otra actividad o sin identidad',async()=>{
  url='https://latam.aleks.com/login';expect((await send({scope:'ui',type:'start',tabId:7,activity:'activity',limits})).ok).toBe(false);
  url=BACKEND+'/simulator/';expect((await send({scope:'ui',type:'start',tabId:7,activity:'foreign',limits})).ok).toBe(false);
  delete session.auth;expect((await send({scope:'ui',type:'start',tabId:7,activity:'activity',limits})).ok).toBe(false);
});
it('permite inspeccionar el origen confirmado pero bloquea inicio y transporte al solver real',async()=>{
  url=ALEKS_ACTIVITY+'/exercise-fixture';
  expect((await send({scope:'ui',type:'attach',tabId:7})).ok).toBe(true);
  expect((await send({scope:'ui',type:'start',tabId:7,activity:'activity',limits})).ok).toBe(false);
  expect((await send({scope:'content',type:'solve',exercise,allowAI:false},content())).ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  for(const untrusted of ['https://latam-awu.aleks.com.evil.example','http://latam-awu.aleks.com','https://latam-awu.aleks.com:8443'])expect(allowedTab(untrusted)).toBe(false);
  permitted=false;expect((await send({scope:'ui',type:'attach',tabId:7})).ok).toBe(false);
});
it('revoca también el permiso del origen de ejercicios confirmado',async()=>{
  expect((await send({scope:'ui',type:'revoke'})).ok).toBe(true);
  expect(chrome.permissions.remove).toHaveBeenCalledWith({origins:[`${BACKEND}/*`,'https://latam.aleks.com/*',`${ALEKS_ACTIVITY}/*`]});
});
it('solo resuelve ejercicios de la actividad autorizada durante RESOLVIENDO',async()=>{
  local['consent:7']={origin:BACKEND,activity:'activity',limits};local['run:7']={state:'RESOLVIENDO',aiCalls:0};
  fetchMock.mockResolvedValue(Response.json({status:'verified',answer:'2',values:['2'],explanation:'Exacto',provider:'deterministic',proposed_by_ai:false,provider_calls:0}));
  const response=await send({scope:'content',type:'solve',exercise,allowAI:false},content());expect(response.ok).toBe(true);
  const foreign={...exercise,activity_id:'foreign'};
  expect((await send({scope:'content',type:'solve',exercise:foreign,allowAI:false},content())).ok).toBe(false);
  expect((await send({scope:'content',type:'solve',exercise,allowAI:true},content())).ok).toBe(false);
  local['run:7']={state:'INACTIVO',aiCalls:0};expect((await send({scope:'content',type:'solve',exercise,allowAI:false},content())).ok).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('cerrar sesión detiene las pestañas y elimina el token local',async()=>{
  local['run:7']={started:Date.now()};
  const response=await send({scope:'ui',type:'logout'});expect(response.ok).toBe(true);expect(session.auth).toBeUndefined();
  expect(tabsSend).toHaveBeenCalledWith(7,{scope:'adapter',type:'stop'});
});
it('el backend que falla no crea una identidad de demostración ficticia',async()=>{
  delete session.auth;fetchMock.mockResolvedValue(Response.json({detail:'Sin conexión'},{status:503}));
  expect((await send({scope:'ui',type:'demo'})).ok).toBe(false);expect(session.auth).toBeUndefined();
});

const assistContext={fingerprint:'b'.repeat(64),statement:'4 nadadores, dos premios distintos.',fields:[{key:'answer',label:'Respuesta'}],diagram_required:false,can_fill_integer:true};
const assistResult={fingerprint:assistContext.fingerprint,model:'local-test',provider:'ollama',provider_calls:1,verified:false,verification:'none',
  proposal:{status:'proposed',answers:[{field_key:'answer',value:'12',unit:''}],explanation:'4 × 3',missing_information:[]}};
function prepareAssist(result=assistResult) {
  url=ALEKS_ACTIVITY+'/exercise-fixture';
  tabsSend.mockResolvedValue({ok:true,data:assistContext});
  fetchMock.mockImplementation(async(destination:string,request:RequestInit)=>{
    if(destination===BACKEND+'/assist/jobs')return Response.json({id:'00000000-0000-4000-8000-000000000002'});
    if(request.method==='DELETE')return Response.json({ok:true});
    return Response.json({status:'completed',result});
  });
}
it('consulta IA local solo desde el panel y conserva la propuesta fuera del almacenamiento',async()=>{
  prepareAssist();
  const result=await send({scope:'ui',type:'assist',tabId:7,includeImage:false});
  expect(result.ok).toBe(true);expect(result.data.result.verified).toBe(false);
  const [destination,request]=fetchMock.mock.calls[0];
  expect(destination).toBe(BACKEND+'/assist/jobs');expect(JSON.parse(request.body)).toEqual({context:assistContext});
  expect(request.credentials).toBe('omit');expect(JSON.stringify(local)).not.toContain('nadadores');
  expect((await send({scope:'content',type:'assist',tabId:7,includeImage:false},content())).ok).toBe(false);
});
it('introduce solo el entero aprobado en esa propuesta y la consume una vez',async()=>{
  prepareAssist();
  const proposal=(await send({scope:'ui',type:'assist',tabId:7,includeImage:false})).data;
  tabsSend.mockResolvedValue({ok:true,data:{written:true,display:'12',submitted:false}});
  expect((await send({scope:'ui',type:'assistFill',tabId:7,proposalId:proposal.id})).ok).toBe(true);
  expect(tabsSend.mock.calls.at(-1)).toEqual([7,{scope:'adapter',type:'assistFill',fingerprint:assistContext.fingerprint,value:'12'}]);
  expect((await send({scope:'ui',type:'assistFill',tabId:7,proposalId:proposal.id})).ok).toBe(false);
});
it('descarta propuestas si el contexto cambia durante el modelo',async()=>{
  prepareAssist();
  tabsSend.mockResolvedValueOnce({ok:true,data:assistContext}).mockResolvedValueOnce({ok:true,data:{...assistContext,fingerprint:'c'.repeat(64)}});
  const result=await send({scope:'ui',type:'assist',tabId:7,includeImage:false});
  expect(result.ok).toBe(false);expect(result.error).toContain('cambió');
});
it.each([{value:'alert(1)',unit:''},{value:'1/2',unit:''},{value:'12',unit:'cm'}])('no ejecuta ni introduce una propuesta fuera del entero sin unidad %j',async answer=>{
  prepareAssist({...assistResult,proposal:{...assistResult.proposal,answers:[{field_key:'answer',...answer}]}});
  const proposal=(await send({scope:'ui',type:'assist',tabId:7,includeImage:false})).data;
  const calls=tabsSend.mock.calls.length;
  expect((await send({scope:'ui',type:'assistFill',tabId:7,proposalId:proposal.id})).ok).toBe(false);
  expect(tabsSend).toHaveBeenCalledTimes(calls);
});
it('solo captura por elección explícita la pestaña activa; la propuesta con imagen es manual',async()=>{
  prepareAssist();
  const capture=vi.fn(async()=> 'data:image/jpeg;base64,/9j//9k=');chrome.tabs.captureVisibleTab=capture;
  const proposal=(await send({scope:'ui',type:'assist',tabId:7,includeImage:true})).data;
  expect(capture).toHaveBeenCalledTimes(1);expect(proposal.context.can_fill_integer).toBe(false);
  expect(proposal.context.fill_blockers).toEqual(['image_based_proposal']);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).image).toBe('data:image/jpeg;base64,/9j//9k=');
  expect((await send({scope:'ui',type:'assistFill',tabId:7,proposalId:proposal.id})).ok).toBe(false);
});
it('la comprobación exacta basada en texto no se bloquea por adjuntar una captura',async()=>{
  prepareAssist({...assistResult,model:'',provider:'deterministic',provider_calls:0,verified:true,verification:'ordered_prizes'});
  chrome.tabs.captureVisibleTab=vi.fn(async()=> 'data:image/jpeg;base64,/9j//9k=');
  const response=await send({scope:'ui',type:'assist',tabId:7,includeImage:true});
  expect(response.ok).toBe(true);expect(response.data.context).toMatchObject({can_fill_integer:true,fill_blockers:[]});
  tabsSend.mockResolvedValue({ok:true,data:{written:true,display:'12',submitted:false}});
  expect((await send({scope:'ui',type:'assistFill',tabId:7,proposalId:response.data.id})).ok).toBe(true);
});
it('explica el bloqueo del editor sin enviar diagnósticos locales al modelo ni escribir aunque el cálculo sea exacto',async()=>{
  prepareAssist({...assistResult,model:'',provider:'deterministic',provider_calls:0,verified:true,verification:'ordered_prizes'});
  tabsSend.mockResolvedValue({ok:true,data:{...assistContext,can_fill_integer:false,fill_blockers:['editor_disabled']}});
  const response=await send({scope:'ui',type:'assist',tabId:7,includeImage:false});
  expect(response.ok).toBe(true);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({context:{...assistContext,can_fill_integer:false}});
  const calls=tabsSend.mock.calls.length;
  expect(await send({scope:'ui',type:'assistFill',tabId:7,proposalId:response.data.id})).toEqual({ok:false,error:'El recuadro está deshabilitado o es de solo lectura.'});
  expect(tabsSend).toHaveBeenCalledTimes(calls);
});
it('no captura otra pestaña ni consulta sin identidad',async()=>{
  prepareAssist();const capture=vi.fn();chrome.tabs.captureVisibleTab=capture;
  chrome.tabs.query=vi.fn(async()=>[{id:99,url}] as chrome.tabs.Tab[]);
  expect((await send({scope:'ui',type:'assist',tabId:7,includeImage:true})).ok).toBe(false);
  expect(capture).not.toHaveBeenCalled();expect(fetchMock).not.toHaveBeenCalled();
  delete session.auth;expect((await send({scope:'ui',type:'assist',tabId:7,includeImage:false})).ok).toBe(false);
});
it('explica el permiso activeTab ausente, no llama al modelo y permite volver a consultar adjuntando una imagen',async()=>{
  prepareAssist();
  const capture=vi.fn(async()=>{throw Error("Either the '<all_urls>' or 'activeTab' permission is required.");});
  chrome.tabs.captureVisibleTab=capture;
  const rejected=await send({scope:'ui',type:'assist',tabId:7,includeImage:true});
  expect(rejected.ok).toBe(false);expect(rejected.error).toContain('pulsa el icono del asistente');
  expect(rejected.error).toContain('Adjuntar imagen del ejercicio');expect(fetchMock).not.toHaveBeenCalled();
  const image='data:image/jpeg;base64,/9j//9k=';
  const retried=await send({scope:'ui',type:'assist',tabId:7,includeImage:false,image});
  expect(retried.ok).toBe(true);expect(capture).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({context:assistContext,image});
  expect(tabsSend).toHaveBeenCalledWith(7,{scope:'adapter',type:'assistContext',allowImage:true});
  expect(retried.data.context).toMatchObject({can_fill_integer:false,fill_blockers:['image_based_proposal']});
});
it.each([false,true])('no consulta sin dibujo requerido por detección o por el usuario; indicado manualmente: %s',async manual=>{
  prepareAssist();
  if(!manual)tabsSend.mockResolvedValue({ok:true,data:{...assistContext,diagram_required:true,can_fill_integer:false,fill_blockers:['diagram_required']}});
  const response=await send({scope:'ui',type:'assist',tabId:7,includeImage:false,needsImage:manual});
  expect(response.ok).toBe(false);expect(response.error).toContain('necesita el dibujo');expect(fetchMock).not.toHaveBeenCalled();
});
it('la indicación manual de dibujo llega al backend con imagen y conserva el bloqueo de escritura',async()=>{
  prepareAssist();const image='data:image/jpeg;base64,/9j//9k=';
  const response=await send({scope:'ui',type:'assist',tabId:7,includeImage:false,needsImage:true,image});
  expect(response.ok).toBe(true);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({context:{...assistContext,diagram_required:true,can_fill_integer:false},image});
  expect(response.data.context.fill_blockers).toContain('diagram_required');
});
it.each([
  {image:'https://private.invalid/image'},
  {image:'data:image/jpeg;base64,'+'a'.repeat(1_333_360)},
  {image:'data:image/jpeg;base64,/9j//9k=',includeImage:true}
])('rechaza imagen remota, excesiva o fuentes simultáneas sin capturar ni llamar al backend',async change=>{
  prepareAssist();chrome.tabs.captureVisibleTab=vi.fn();
  expect((await send({scope:'ui',type:'assist',tabId:7,includeImage:false,...change})).ok).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
});
it('cerrar sesión detiene una escritura asistida aunque no exista una ejecución automática',async()=>{
  prepareAssist();
  const proposal=(await send({scope:'ui',type:'assist',tabId:7,includeImage:false})).data;
  let notifyStarted:()=>void=()=>{},finish:(value:unknown)=>void=()=>{};
  const started=new Promise<void>(resolve=>{notifyStarted=resolve;});
  tabsSend.mockImplementation(async(_id:number,message:Record<string,unknown>)=>{
    if(message.type==='assistFill')return new Promise(resolve=>{finish=resolve;notifyStarted();});
    if(message.type==='stop'){finish({ok:false,error:'Cancelado'});return {ok:true,data:true};}
    throw Error('Operación inesperada');
  });
  const writing=send({scope:'ui',type:'assistFill',tabId:7,proposalId:proposal.id});
  await started;fetchMock.mockResolvedValue(Response.json({ok:true}));
  expect((await send({scope:'ui',type:'logout'})).ok).toBe(true);
  expect((await writing).ok).toBe(false);
  expect(tabsSend).toHaveBeenCalledWith(7,{scope:'adapter',type:'stop'});expect(session.auth).toBeUndefined();
});
it('consulta una tarea lenta sin repetir la petición de inferencia',async()=>{
  prepareAssist();const original=fetchMock.getMockImplementation()!;let polls=0;
  fetchMock.mockImplementation(async(destination:string,request:RequestInit)=>{
    if(request.method==='GET' && destination.includes('/assist/jobs/')) {
      polls++;if(polls===1)return Response.json({status:'pending'});
    }
    return original(destination,request);
  });
  expect((await send({scope:'ui',type:'assist',tabId:7,includeImage:false})).ok).toBe(true);
  expect(polls).toBe(2);
  expect(fetchMock.mock.calls.filter(([destination])=>destination===BACKEND+'/assist/jobs')).toHaveLength(1);
  expect(fetchMock.mock.calls.at(-1)?.[1].method).toBe('DELETE');
});
it('permite cancelar una consulta pendiente y no conserva una propuesta tardía',async()=>{
  prepareAssist();const original=fetchMock.getMockImplementation()!;let notify:()=>void=()=>{};
  const polled=new Promise<void>(resolve=>{notify=resolve;});
  fetchMock.mockImplementation(async(destination:string,request:RequestInit)=>{
    if(request.method==='GET' && destination.includes('/assist/jobs/')){notify();return Response.json({status:'pending'});}
    return original(destination,request);
  });
  const pending=send({scope:'ui',type:'assist',tabId:7,includeImage:false});
  await polled;
  expect((await send({scope:'ui',type:'cancelAssist',tabId:7})).ok).toBe(true);
  const result=await pending;expect(result.ok).toBe(false);expect(result.error).toContain('cancelada');
  expect(tabsSend).toHaveBeenCalledWith(7,{scope:'adapter',type:'stop'});
});
it('acepta un resultado del comprobador exacto y conserva su procedencia',async()=>{
  prepareAssist({...assistResult,model:'',provider:'deterministic',provider_calls:0,verified:true,verification:'ordered_prizes'});
  const response=await send({scope:'ui',type:'assist',tabId:7,includeImage:false});
  expect(response.ok).toBe(true);expect(response.data.result).toMatchObject({verified:true,provider:'deterministic',verification:'ordered_prizes'});
});
it('rechaza una supuesta verificación del modelo sin comprobador y un falso contexto faltante',async()=>{
  prepareAssist({...assistResult,verified:true});
  expect((await send({scope:'ui',type:'assist',tabId:7,includeImage:false})).ok).toBe(false);
  prepareAssist({...assistResult,proposal:{...assistResult.proposal,status:'needs_context',answers:[]}});
  expect((await send({scope:'ui',type:'assist',tabId:7,includeImage:false})).ok).toBe(false);
});
