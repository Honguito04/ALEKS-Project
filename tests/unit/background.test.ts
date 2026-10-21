import { beforeEach,it,expect,vi } from 'vitest';
import { BACKEND,ALEKS_ACTIVITY,allowedTab,type Exercise,type Run,type Limits } from '../../extension/src/shared';

const id='fjjgjakbpjhhegekcjogilmfheaicjge';
const ext=`chrome-extension://${id}/`;
type Listener=(message:Record<string,unknown>,sender:chrome.runtime.MessageSender,reply:(response:unknown)=>void)=>unknown;
let listener:Listener;
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
    sidePanel:{setPanelBehavior:async()=>{}},storage:{local:store(local),session:store(session)},
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
