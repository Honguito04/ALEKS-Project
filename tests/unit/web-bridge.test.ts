import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { WebBridge,BRIDGE_PORT,type BridgeDependencies } from '../../extension/src/web-bridge';

const ORIGIN='https://demo.example.test';
const fingerprint='a'.repeat(64);
const context={fingerprint,statement:'Hay 4 participantes y dos premios por puestos.',fields:[{key:'answer',label:'Respuesta'}],diagram_required:false,can_fill_integer:true,can_fill_fraction:true,fill_blockers:[]};
const limits={maxExercises:1,maxMinutes:1,maxAICalls:4};
const event=()=>{const listeners:((...args:any[])=>void)[]=[];return {addListener:(fn:any)=>listeners.push(fn),emit:(...args:any[])=>listeners.forEach(fn=>fn(...args))};};
let bridge:WebBridge,deps:BridgeDependencies,events:any,storage:Record<string,any>,fetcher:ReturnType<typeof vi.fn>;
let active:number,focused:boolean,answerContext:any,posted:number;
const tab=(id:number)=>({id,url:'https://latam-awu.aleks.com/fixture',windowId:1,active:id===active,title:'ALEKS'} as chrome.tabs.Tab & {id:number;url:string});
function port(overrides:Record<string,unknown>={}) {
  const messages=event(),disconnected=event(),replies:any[]=[];
  const p={name:BRIDGE_PORT,sender:{url:ORIGIN+'/app/',origin:ORIGIN,frameId:0,documentId:crypto.randomUUID(),tab:{id:99,url:ORIGIN+'/app/'},...overrides},
    onMessage:messages,onDisconnect:disconnected,postMessage:(v:any)=>replies.push(v),disconnect:vi.fn(()=>disconnected.emit())};
  events.connections.emit(p);
  return {p,replies,send:(command:string,data:Record<string,unknown>={},id=crypto.randomUUID())=>{messages.emit({requestId:id,command,...data});return id;},
    async request(command:string,data:Record<string,unknown>={},id=crypto.randomUUID()) {messages.emit({requestId:id,command,...data});await vi.waitFor(()=>expect(replies.some(r=>r.requestId===id)).toBe(true));return replies.find(r=>r.requestId===id);}};
}
async function connect(id=7) {const p=port();expect((await p.request('connect',{token:'x'.repeat(43)})).ok).toBe(true);expect((await p.request('bind',{tabId:id})).ok).toBe(true);return p;}
beforeEach(()=>{
  events={connections:event(),updated:event(),removed:event(),permissions:event(),alarms:event()};storage={};active=7;focused=true;answerContext=context;posted=0;
  vi.stubGlobal('chrome',{
    runtime:{onConnectExternal:events.connections,getPlatformInfo:async()=>({})},
    tabs:{onUpdated:events.updated,onRemoved:events.removed,query:async(q:any)=>q.active?[tab(active)]:[tab(7),tab(8)]},
    windows:{get:async()=>({focused})},permissions:{onRemoved:events.permissions,contains:async()=>true},
    alarms:{onAlarm:events.alarms,create:vi.fn(),clear:async()=>true},
    storage:{session:{get:async()=>structuredClone(storage),set:async(v:any)=>{Object.assign(storage,structuredClone(v));}}}
  });
  deps={tab:async id=>tab(id),attach:vi.fn(async()=>({})),send:vi.fn(async(_id,type)=>type==='assistContext'?structuredClone(context):{}),
    deliver:vi.fn(async()=>({status:'accepted'})),cancel:vi.fn(async()=>{}),setNative:vi.fn(),legacyBusy:()=>false,focus:async id=>{active=id;}};
  fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/session'))return Response.json({user:{id:'a'},expires_at:Date.now()/1000+3600});
    if(init?.method==='POST'){posted++;answerContext=JSON.parse(String(init.body)).context;return Response.json({id:crypto.randomUUID()});}
    if(init?.method==='DELETE')return new Response(null,{status:204});
    return Response.json({status:'completed',provider_calls:1,result:{fingerprint:answerContext.fingerprint,model:'test',provider:'gemini',provider_calls:1,verified:false,verification:'none',proposal:{status:'proposed',answers:[{field_key:'answer',value:'12',unit:''}],explanation:'Simulada',missing_information:[]}}});
  });
  vi.stubGlobal('fetch',fetcher);bridge=new WebBridge(ORIGIN,deps);
});
afterEach(async()=>{await bridge.stopAll('Fin de prueba');vi.unstubAllGlobals();});

it.each([{url:'https://evil.test/app/'},{frameId:1},{documentId:undefined},{origin:'null'},{url:ORIGIN+'/other'},{tab:{id:99,url:'https://evil.test/app/'}}])('rechaza remitente externo no autorizado %j',overrides=>{
  const p=port(overrides);expect(p.p.disconnect).toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it('no expone órdenes arbitrarias ni permite operar sin vincular cuenta',async()=>{
  const p=port();expect((await p.request('list')).ok).toBe(false);
  expect((await p.request('execute',{javascript:'alert(1)'})).ok).toBe(false);
  expect((await p.request('bind',{tabId:7,selector:'input'})).ok).toBe(false);
  expect(deps.send).not.toHaveBeenCalled();
});
it('duplica el mismo comando sin duplicar consulta ni entrega y rechaza reutilizar ID',async()=>{
  const p=await connect();const id=crypto.randomUUID();
  const first=await p.request('start',{fingerprint,limits,nativeKeyboard:true},id);
  expect(first,first.error).toMatchObject({ok:true});
  await vi.waitFor(()=>expect(deps.deliver).toHaveBeenCalledTimes(1));
  p.send('start',{fingerprint,limits,nativeKeyboard:true},id);
  await vi.waitFor(()=>expect(p.replies.filter(r=>r.requestId===id)).toHaveLength(2));
  expect(posted).toBe(1);expect(deps.deliver).toHaveBeenCalledTimes(1);
  p.send('start',{fingerprint,limits:{...limits,maxExercises:2},nativeKeyboard:true},id);
  await vi.waitFor(()=>expect(p.replies.at(-1).ok).toBe(false));
});
it('una vinculación no roba la pestaña de otra conexión',async()=>{
  await connect();const other=port();await other.request('connect',{token:'y'.repeat(43)});
  expect((await other.request('bind',{tabId:7})).ok).toBe(false);
  expect((await other.request('bind',{tabId:8})).ok).toBe(true);
});
it('rechaza huella cambiada antes de consultar y conserva controles de foco',async()=>{
  const p=await connect();expect((await p.request('start',{fingerprint:'b'.repeat(64),limits,nativeKeyboard:true})).ok).toBe(false);
  focused=false;await p.request('start',{fingerprint,limits,nativeKeyboard:true});
  await vi.waitFor(()=>expect(p.replies.some(r=>r.event==='progress' && r.value.automation?.phase==='DETENIDO')).toBe(true));
  expect(posted).toBe(0);expect(deps.deliver).not.toHaveBeenCalled();
});
it('fallo de reset limpia autorización y deja el recorrido detenido',async()=>{
  (deps.send as any).mockImplementation(async(_id:number,type:string)=>{if(type==='automationReset')throw Error('reset falló');return context;});
  const p=await connect();expect((await p.request('start',{fingerprint,limits,nativeKeyboard:true})).ok).toBe(false);
  const status=await p.request('status');expect(status.value.automation.active).toBe(false);
  expect(deps.setNative).toHaveBeenLastCalledWith(7,false);expect(posted).toBe(0);
});
it('una entrega incierta queda registrada y no se repite al reconectar',async()=>{
  (deps.deliver as any).mockRejectedValue(Error('sin confirmación'));
  const p=await connect();await p.request('start',{fingerprint,limits,nativeKeyboard:true});
  await vi.waitFor(()=>expect(p.replies.some(r=>r.value?.automation?.phase==='DETENIDO')).toBe(true));
  expect(storage['webBridgeJournal:7'].submitted).toContain(fingerprint);
  p.p.disconnect();await vi.waitFor(()=>expect(bridge.ownsTab(7)).toBe(false));
  const other=await connect();const result=await other.request('start',{fingerprint,limits,nativeKeyboard:true});
  expect(result.ok).toBe(false);expect(result.error).toMatch(/no se repetirá/);expect(deps.deliver).toHaveBeenCalledTimes(1);
});
it('recupera todos los diarios de pestañas y no reanuda sus entregas',async()=>{
  await bridge.stopAll('reset');storage={'webBridgeJournal:7':{active:true,tabId:7,submitted:[fingerprint]},'webBridgeJournal:8':{active:true,tabId:8,submitted:['b'.repeat(64)]}};
  events.connections=event();(chrome.runtime.onConnectExternal as any)=events.connections;
  bridge=new WebBridge(ORIGIN,deps);const p=await connect();
  expect(deps.cancel).toHaveBeenCalledWith(7);expect(deps.cancel).toHaveBeenCalledWith(8);
  expect(storage['webBridgeJournal:8'].active).toBe(false);
  expect((await p.request('start',{fingerprint,limits,nativeKeyboard:true})).ok).toBe(false);
  expect(deps.deliver).not.toHaveBeenCalled();
});
it('desconectar durante IA descarta resultado tardío y registra consumo incierto',async()=>{
  let release!:(value:Response)=>void;
  fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(url.endsWith('/session'))return Response.json({user:{id:'a'}});
    if(init?.method==='POST'){posted++;return Response.json({id:crypto.randomUUID()});}
    if(init?.method==='DELETE')return new Response(null,{status:204});
    return new Promise<Response>(resolve=>{release=resolve;});
  });
  const p=await connect();await p.request('start',{fingerprint,limits,nativeKeyboard:true});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  p.p.disconnect();release(Response.json({status:'completed',result:{}}));
  await vi.waitFor(()=>expect(bridge.ownsTab(7)).toBe(false));
  expect(deps.deliver).not.toHaveBeenCalled();expect(deps.cancel).toHaveBeenCalledWith(7);
});
it('navegar en cualquiera de las pestañas vinculadas detiene el control',async()=>{
  const p=await connect();events.updated.emit(99,{status:'loading'});
  await vi.waitFor(()=>expect(p.p.disconnect).toHaveBeenCalled());expect(bridge.ownsTab(7)).toBe(false);
});

it('cambio de ejercicio entre autorización y consulta no consume IA ni escribe',async()=>{
  let reads=0;
  (deps.send as any).mockImplementation(async(_id:number,type:string)=>type==='assistContext'
    ? {...context,fingerprint:++reads===1?fingerprint:'b'.repeat(64)} : {});
  const p=await connect();expect((await p.request('start',{fingerprint,limits,nativeKeyboard:true})).ok).toBe(true);
  await vi.waitFor(()=>expect(p.replies.some(r=>r.value?.automation?.phase==='DETENIDO')).toBe(true));
  expect(posted).toBe(0);expect(deps.deliver).not.toHaveBeenCalled();
});

it.each(['tab','exercise'])('captura descarta imagen cuando cambia %s antes de enviarla',async change=>{
  const p=await connect();await p.request('read');
  (chrome.tabs as any).captureVisibleTab=async()=>{
    if(change==='tab')active=8;
    else (deps.send as any).mockResolvedValue({...context,fingerprint:'b'.repeat(64)});
    return 'data:image/jpeg;base64,AAAA';
  };
  expect((await p.request('preview',{includeImage:true})).ok).toBe(false);
  expect(posted).toBe(0);expect(deps.deliver).not.toHaveBeenCalled();
});

it('detener aborta consulta pendiente y no permite entrega tras su respuesta tardía',async()=>{
  let signal:AbortSignal|undefined;
  const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(url.includes('/jobs/') && !init?.method?.includes('DELETE'))return new Promise<Response>((_resolve,reject)=>{
      signal=init?.signal as AbortSignal;
      signal.addEventListener('abort',()=>reject(signal!.reason),{once:true});
    });
    return original(url,init);
  });
  const p=await connect();await p.request('start',{fingerprint,limits,nativeKeyboard:true});
  await vi.waitFor(()=>expect(signal).toBeDefined());
  const stopped=await p.request('stop');
  expect(signal!.aborted).toBe(true);
  expect(stopped.value).toMatchObject({providerCallsUncertain:true,automation:{phase:'DETENIDO',accepted:0}});
  expect(deps.deliver).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([url,init])=>url.endsWith('/jobs') && init?.method==='DELETE')).toBe(true);
});

it('Detener sigue disponible al agotar la caché de comandos',async()=>{
  const p=await connect();
  for(let n=0;n<126;n++)p.send('status');
  await vi.waitFor(()=>expect(p.replies.filter(r=>r.requestId)).toHaveLength(128));
  expect((await p.request('read')).ok).toBe(false);
  expect((await p.request('stop')).ok).toBe(true);
  expect(deps.cancel).toHaveBeenCalledWith(7);
});

it('si no se puede persistir el diario no entrega y retira el permiso de teclado',async()=>{
  (chrome.storage.session.set as any)=async()=>{throw Error('almacenamiento no disponible');};
  const p=await connect();expect((await p.request('start',{fingerprint,limits,nativeKeyboard:true})).ok).toBe(false);
  expect(deps.setNative).toHaveBeenLastCalledWith(7,false);
  expect(deps.deliver).not.toHaveBeenCalled();expect(posted).toBe(0);
});

it('el puente entrega dos respuestas por clave sin concatenarlas',async()=>{
  const pair={...context,fields:[{key:'field_1',label:'Recuadro 1'},{key:'field_2',label:'Recuadro 2'}]};
  const answers=[{field_key:'field_2',value:'6',unit:''},{field_key:'field_1',value:'12',unit:''}];
  (deps.send as ReturnType<typeof vi.fn>).mockImplementation(async(_id,type)=>type==='assistContext'?pair:{});
  const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(!url.endsWith('/session') && init?.method!=='POST' && init?.method!=='DELETE')return Response.json({status:'completed',provider_calls:1,result:{fingerprint,model:'test',provider:'gemini',provider_calls:1,verified:false,verification:'none',proposal:{status:'proposed',answers,explanation:'Dos respuestas',missing_information:[]}}});
    return original(url,init);
  });
  const p=await connect();expect((await p.request('start',{fingerprint,limits,nativeKeyboard:true})).ok).toBe(true);
  await vi.waitFor(()=>expect(deps.deliver).toHaveBeenCalledTimes(1));
  expect(deps.deliver).toHaveBeenCalledWith(7,'automationSubmit',expect.objectContaining({value:answers}),expect.any(Function));
});
