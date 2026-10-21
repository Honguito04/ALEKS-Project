import { BACKEND, ALEKS_ORIGINS, allowedTab, simulatorURL, exerciseSchema, limitsSchema, runSchema, solutionSchema, type Run } from './shared';

type Auth = {token:string;mode:'demo'|'google'};
type Consent = {origin:string;activity:string;limits:ReturnType<typeof limitsSchema.parse>};
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.runtime.onInstalled.addListener(()=>{ void chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}); });
// Retención mínima también después de restaurar Chrome o reactivar el worker.
void chrome.storage.local.get(null).then(entries=>{
  const expired=Object.entries(entries).filter(([key,value])=>key.startsWith('run:') && (value as Run).started<Date.now()-7*86400_000).flatMap(([key])=>[key,`consent:${key.slice(4)}`]);
  if(expired.length) return chrome.storage.local.remove(expired);
});

async function auth():Promise<Auth|undefined> {return (await chrome.storage.session.get('auth')).auth as Auth|undefined;}
async function api(path:string,method='GET',body?:unknown,authenticated=false) {
  const session=authenticated ? await auth():undefined;
  if(authenticated && !session) throw Error('Inicia sesión en la aplicación o entra en demostración');
  const response=await fetch(BACKEND+path,{method,headers:{'Content-Type':'application/json',...(session ? {Authorization:`Bearer ${session.token}`}:{})},
    body:body===undefined ? undefined:JSON.stringify(body),signal:AbortSignal.timeout(35_000),credentials:'omit',redirect:'error'});
  if(!response.ok) {
    const detail=await response.json().catch(()=>({detail:'No se pudo conectar con el backend'}));
    throw Error(typeof detail.detail==='string' ? detail.detail:`Petición rechazada (${response.status})`);
  }
  return response.json();
}
async function permitted() {return chrome.permissions.contains({origins:[`${BACKEND}/*`]});}
async function tab(id:unknown) {
  if(typeof id!=='number' || !Number.isInteger(id)) throw Error('Selecciona una pestaña');
  const t=await chrome.tabs.get(id);
  if(!t.url || !allowedTab(t.url)) throw Error('Pestaña fuera de los dominios admitidos');
  if(!await chrome.permissions.contains({origins:[`${new URL(t.url).origin}/*`]})) throw Error('Falta el permiso del sitio');
  return t as chrome.tabs.Tab & {id:number;url:string};
}
async function send(id:number,type:string,data:Record<string,unknown>={}) {
  await tab(id);
  const response=await chrome.tabs.sendMessage(id,{scope:'adapter',type,...data});
  if(!response?.ok) throw Error(response?.error || 'El adaptador no respondió');return response.data;
}
async function attach(id:unknown) {
  const t=await tab(id);
  await chrome.scripting.executeScript({target:{tabId:t.id},files:['content.js']});
  return {...await send(t.id,'status'),tab:{id:t.id,title:t.title || 'Actividad matemática',url:t.url}};
}
async function stopAll() {
  const entries=await chrome.storage.local.get(null);
  await Promise.allSettled(Object.keys(entries).filter(k=>k.startsWith('run:')).map(k=>chrome.tabs.sendMessage(Number(k.slice(4)),{scope:'adapter',type:'stop'})));
}
const random=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
async function sha(text:string) {return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}

async function handleUI(m:Record<string,unknown>) {
  switch(m.type) {
    case 'health': return api('/health');
    case 'session': return await auth() ? api('/auth/session','GET',undefined,true):{mode:null};
    case 'demo': {
      await stopAll();const result=await api('/auth/demo','POST');
      await chrome.storage.session.set({auth:{token:result.token,mode:result.mode}});return {mode:result.mode};
    }
    case 'google': {
      await stopAll();const verifier=random(),state=random();
      const started=await api('/auth/google/start','POST',{extension_id:chrome.runtime.id,handoff_challenge:await sha(verifier),client_state:state});
      const url=new URL(started.authorization_url);
      if(url.origin!=='https://accounts.google.com') throw Error('Origen OAuth inesperado');
      // La promesa del evento mantiene viva esta operación durante launchWebAuthFlow.
      const final=await chrome.identity.launchWebAuthFlow({url:url.href,interactive:true});
      if(!final) throw Error('Autorización cancelada');
      const returned=new URL(final),expected=new URL(chrome.identity.getRedirectURL('oauth'));
      if(returned.origin!==expected.origin || returned.pathname!==expected.pathname) throw Error('Redirección OAuth incorrecta');
      const params=new URLSearchParams(returned.hash.slice(1));
      if(params.get('state')!==state || !params.get('code')) throw Error('Respuesta OAuth no vinculada a esta extensión');
      const result=await api('/auth/google/complete','POST',{code:params.get('code'),verifier,extension_id:chrome.runtime.id});
      await chrome.storage.session.set({auth:{token:result.token,mode:result.mode}});return {mode:result.mode};
    }
    case 'logout': case 'unlink': {
      await stopAll();
      try { if(await auth()) await api(m.type==='unlink'?'/auth/link':'/auth/logout',m.type==='unlink'?'DELETE':'POST',undefined,true); }
      finally {await chrome.storage.session.remove('auth');}
      return true;
    }
    case 'clear': {
      await stopAll();if(await auth()) await api('/history','DELETE',undefined,true);
      await chrome.storage.local.clear();return true;
    }
    case 'revoke': {
      await stopAll();await chrome.storage.local.clear();
      await chrome.permissions.remove({origins:[`${BACKEND}/*`,...ALEKS_ORIGINS.map(origin=>`${origin}/*`)]});return true;
    }
    case 'tabs': return (await chrome.tabs.query({})).filter(t=>t.id && t.url && allowedTab(t.url)).map(t=>({id:t.id,title:t.title,url:t.url}));
    case 'attach': return attach(m.tabId);
    case 'status': return send((await tab(m.tabId)).id,'status');
    case 'start': {
      const t=await tab(m.tabId);if(!simulatorURL(t.url)) throw Error('ALEKS aún no está validado. Solo se permite el simulador.');
      if(!await auth()) throw Error('Inicia sesión o selecciona demostración');
      await api('/auth/session','GET',undefined,true);
      const limits=limitsSchema.parse(m.limits);
      const observed=await send(t.id,'status');
      if(m.activity!==observed.detection.activity) throw Error('La actividad cambió; vuelve a conectarla');
      const consent:Consent={origin:new URL(t.url).origin,activity:String(m.activity),limits};
      await chrome.storage.local.set({[`consent:${t.id}`]:consent});
      return send(t.id,'start',{limits,authorization:consent});
    }
    case 'pause': case 'resume': case 'stop': return send((await tab(m.tabId)).id,String(m.type));
    default: throw Error('Comando desconocido');
  }
}
async function handleContent(m:Record<string,unknown>,sender:chrome.runtime.MessageSender) {
  if(!sender.tab?.id || sender.frameId!==0) throw Error('Marco no autorizado');
  const t=await tab(sender.tab.id);
  if(!sender.url || new URL(sender.url).origin!==new URL(t.url).origin || !simulatorURL(t.url)) throw Error('Origen del adaptador no autorizado');
  const key=`run:${t.id}`,consentKey=`consent:${t.id}`;
  const entries=await chrome.storage.local.get([key,consentKey]);
  const consent=entries[consentKey] as Consent|undefined;
  if(m.type==='load') return entries[key];
  if(m.type==='permitted') return await permitted() && Boolean(await auth());
  if(!consent) throw Error('No existe autorización para esta pestaña');
  if(m.type==='save') {
    const run=runSchema.parse(m.run);
    if(run.origin!==consent.origin || run.activity!==consent.activity) throw Error('Actividad fuera de la autorización');
    if(JSON.stringify(run.limits)!==JSON.stringify(consent.limits)) throw Error('Los límites no coinciden con la autorización');
    await chrome.storage.local.set({[key]:run});return true;
  }
  if(m.type==='solve') {
    const exercise=exerciseSchema.parse(m.exercise);
    const run=entries[key] as Run|undefined;
    if(!run || exercise.activity_id!==consent.activity || exercise.source!=='simulator' || run.state!=='RESOLVIENDO') throw Error('Ejercicio fuera de la ejecución autorizada');
    if(typeof m.allowAI!=='boolean' || (m.allowAI && (run.aiCalls>consent.limits.maxAICalls || !run.aiCalls))) throw Error('Límite de IA no autorizado');
    return solutionSchema.parse(await api('/solve','POST',{exercise,allow_ai:m.allowAI},true));
  }
  throw Error('Operación de contenido no permitida');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || !message || typeof message!=='object') return;
  let result:Promise<unknown>;
  if(message.scope==='content') result=handleContent(message,sender);
  else if(message.scope==='ui' && !sender.tab?.url?.startsWith('http') && sender.url?.startsWith(chrome.runtime.getURL(''))) result=handleUI(message);
  else return;
  result.then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error instanceof Error?error.message:'Operación rechazada'}));
  return true;
});
chrome.permissions.onRemoved.addListener(()=>{void stopAll();});
chrome.tabs.onRemoved.addListener(id=>{void chrome.storage.local.remove([`run:${id}`,`consent:${id}`]);});
