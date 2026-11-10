/** Worker y content script de producción sobre DOM real. Chrome, el puerto
 * externo y el proveedor son simulados; no se abre una cuenta ALEKS. */
import { WebBridge,BRIDGE_PORT } from '../../extension/src/web-bridge';

type Callback = (...args:any[])=>unknown;
const event=()=>{
  const listeners:Callback[]=[];
  return {addListener:(listener:Callback)=>listeners.push(listener),removeListener:(listener:Callback)=>{
    const index=listeners.indexOf(listener);if(index>=0)listeners.splice(index,1);
  },emit:(...args:any[])=>listeners.forEach(listener=>listener(...args))};
};
const contentMessages=event(),connections=event(),updated=event(),removed=event(),permissionsRemoved=event();
const origin='https://demo.example.test';
const metrics={submits:0,nexts:0,writes:0,creates:0,polls:0,deletes:0,cancels:0,sent:[] as {tabId:number;type:string}[]};
let currentContext:any,holdProvider=false,releaseProvider:(()=>void)|undefined;
const native=new Set<number>();
const tab=(id:number)=>({id,windowId:1,active:true,title:'Fixture ALEKS',url:'https://latam-awu.aleks.com/fixture'});
Object.defineProperty(globalThis,'chrome',{configurable:true,value:{
  runtime:{id:'fjjgjakbpjhhegekcjogilmfheaicjge',onMessage:contentMessages,onConnectExternal:connections,
    sendMessage:async()=>({ok:true,data:true}),getPlatformInfo:async()=>({os:'linux'})},
  tabs:{onUpdated:updated,onRemoved:removed,query:async()=>[tab(7),tab(8)],get:async(id:number)=>tab(id)},
  permissions:{onRemoved:permissionsRemoved,contains:async()=>true},
  storage:{session:{get:async()=>({}),set:async()=>{},remove:async()=>{}},local:{get:async()=>({}),set:async()=>{}}},
  alarms:{onAlarm:event(),create:()=>{},clear:async()=>true},
}});
async function contentRPC(type:string,data:Record<string,unknown>={}) {
  const reply:any=await new Promise(resolve=>contentMessages.emit({scope:'adapter',type,...data},{id:chrome.runtime.id},resolve));
  if(!reply?.ok)throw Error(reply?.error||'El contenido no respondió');return reply.data;
}

const input=document.querySelector<HTMLInputElement>('input.ansed_input')!;
const verify=document.querySelector<HTMLButtonElement>('.checkAnswer')!;
input.addEventListener('input',()=>{
  metrics.writes++;
  const glyph=document.createElement('span');glyph.className='AnsedObject';glyph.textContent=input.value;
  glyph.style.cssText='position:absolute;left:2px;top:3px;font:18px serif;height:24px';
  document.querySelector('.ansed_tree')!.replaceChildren(glyph);input.value='';
});
verify.addEventListener('click',()=>{
  metrics.submits++;verify.remove();
  const feedback=document.createElement('div');feedback.id='result_feedback_alert';feedback.setAttribute('aria-live','polite');
  feedback.style.cssText='display:inline-block;border:1px solid rgb(57,108,41)';
  feedback.innerHTML='<div style="display:inline-block;color:rgb(57,108,41)">Correcta</div>';
  const next=document.createElement('button');next.type='button';next.id='smt_bottomnav_button_input_learningCorrect';next.className='learningCorrect';
  next.innerHTML='<div class="textContent">Siguiente tema</div>';
  next.addEventListener('click',()=>{
    metrics.nexts++;feedback.remove();next.remove();
    document.querySelector('#algoPrompt')!.textContent=`Hay ${4+metrics.nexts} nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?`;
    document.querySelector('.ansed_tree')!.replaceChildren();document.body.append(verify);
  });
  document.body.append(feedback,next);
});

globalThis.fetch=async(destination:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(destination),method=init?.method||'GET';
  if(url.endsWith('/bridge/session'))return Response.json({user:{id:'account-a',email:'fixture@example.test'},expires_at:Date.now()/1000+3600});
  if(method==='DELETE'){metrics.deletes++;return new Response(null,{status:204});}
  if(url.endsWith('/bridge/jobs') && method==='POST'){
    metrics.creates++;currentContext=JSON.parse(String(init?.body)).context;
    return Response.json({id:'00000000-0000-4000-8000-000000000007'},{status:202});
  }
  if(url.includes('/bridge/jobs/')){
    metrics.polls++;
    if(holdProvider)await new Promise<void>(resolve=>{releaseProvider=resolve;});
    return Response.json({status:'completed',result:{fingerprint:currentContext.fingerprint,model:'synthetic-cloud',provider:'gemini',provider_calls:1,
      verified:false,verification:'none',proposal:{status:'proposed',answers:[{field_key:'answer',value:metrics.nexts?'20':'12',unit:''}],
        explanation:'Proveedor simulado para probar transporte y acciones DOM.',missing_information:[]}}});
  }
  throw Error('Petición inesperada en la prueba: '+url);
};

let port:any;
const pending=new Map<string,(message:any)=>void>();
const notices:any[]=[];
function connect(name=BRIDGE_PORT){
  const messages=event(),disconnects=event();
  port={name,sender:{url:origin+'/app/',origin,frameId:0,documentId:crypto.randomUUID(),tab:{id:99,url:origin+'/app/'}},onMessage:messages,onDisconnect:disconnects,
    postMessage:(message:any)=>{
      const id=message.requestId||message.id;
      if(id && pending.has(id)){pending.get(id)!(message);pending.delete(id);}else notices.push(message);
    },disconnect:()=>disconnects.emit(),_messages:messages};
  connections.emit(port);
}

void import('../../extension/src/content').then(()=>{
  const deps={tab:async(id:number)=>tab(id),attach:async(id:number)=>({tab:tab(id),...await contentRPC('status')}),
    send:async(id:number,type:string,data:Record<string,unknown>={},current=()=>true)=>{
      if(!current())throw Error('Operación cancelada');metrics.sent.push({tabId:id,type});
      const result=await contentRPC(type,data);if(type==='assistContext')currentContext=result;return result;
    },deliver:async(id:number,type:string,data:Record<string,unknown>,current=()=>true)=>{
      if(!current())throw Error('Operación cancelada');metrics.sent.push({tabId:id,type});return contentRPC(type,data);
    },cancel:async()=>{metrics.cancels++;await contentRPC('stop');},setNative:(id:number,enabled:boolean)=>enabled?native.add(id):native.delete(id),
    legacyBusy:()=>false,focus:async()=>{}};
  const controller=new WebBridge(origin,deps);
  const api={metrics,notices,connect,
    request:(command:string,data:Record<string,unknown>={},requestId=crypto.randomUUID())=>new Promise<any>((resolve,reject)=>{
      const timeout=setTimeout(()=>{pending.delete(requestId);reject(Error('El puente no respondió al comando '+command));},10000);
      pending.set(requestId,message=>{clearTimeout(timeout);resolve(message);});port._messages.emit({requestId,command,...data});
    }),disconnect:()=>port.disconnect(),stop:()=>controller.stopAll('Prueba detenida'),
    holdProvider:(hold:boolean)=>{holdProvider=hold;},releaseProvider:()=>{holdProvider=false;releaseProvider?.();},
    updateTab:(id:number)=>updated.emit(id,{url:'https://latam-awu.aleks.com/other-exercise'},tab(id)),
  };
  (window as any).webBridgeTest=api;connect();
});
