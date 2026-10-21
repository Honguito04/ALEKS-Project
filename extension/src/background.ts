import { BACKEND, ALEKS_ORIGINS, allowedTab, simulatorURL, exerciseSchema, limitsSchema, runSchema, solutionSchema, assistContextSchema,assistResultSchema,type AssistView,type Run } from './shared';

type Auth = {token:string;mode:'demo'|'google'};
type Consent = {origin:string;activity:string;limits:ReturnType<typeof limitsSchema.parse>};
const assistProposals=new Map<number,AssistView>();
const assistJobs=new Map<number,string>();
const assistWriters=new Set<number>();
const assistRemoteJobs=new Map<number,string>();
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.runtime.onInstalled.addListener(()=>{ void chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}); });
// Retención mínima también después de restaurar Chrome o reactivar el worker.
void chrome.storage.local.get(null).then(entries=>{
  const expired=Object.entries(entries).filter(([key,value])=>key.startsWith('run:') && (value as Run).started<Date.now()-7*86400_000).flatMap(([key])=>[key,`consent:${key.slice(4)}`]);
  if(expired.length) return chrome.storage.local.remove(expired);
});

async function auth():Promise<Auth|undefined> {return (await chrome.storage.session.get('auth')).auth as Auth|undefined;}
async function api(path:string,method='GET',body?:unknown,authenticated=false,timeout=35_000) {
  const session=authenticated ? await auth():undefined;
  if(authenticated && !session) throw Error('Inicia sesión en la aplicación o entra en demostración');
  const response=await fetch(BACKEND+path,{method,headers:{'Content-Type':'application/json',...(session ? {Authorization:`Bearer ${session.token}`}:{})},
    body:body===undefined ? undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout),credentials:'omit',redirect:'error'});
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
  const activeAssist=[...assistWriters];
  const jobs=[...assistRemoteJobs.values()];assistRemoteJobs.clear();
  assistProposals.clear();assistJobs.clear();
  const entries=await chrome.storage.local.get(null);
  const ids=new Set([...Object.keys(entries).filter(k=>k.startsWith('run:')).map(k=>Number(k.slice(4))),...activeAssist]);
  await Promise.allSettled([...ids].map(id=>chrome.tabs.sendMessage(id,{scope:'adapter',type:'stop'})).concat(
    jobs.map(id=>api(`/assist/jobs/${id}`,'DELETE',undefined,true))));
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
    case 'localAIStatus': return api('/ai/local/status','GET',undefined,true);
    case 'assist': {
      const t=await tab(m.tabId);
      if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || typeof m.includeImage!=='boolean')throw Error('Selecciona una pestaña ALEKS para la consulta local.');
      if(!await auth())throw Error('Entra en demostración o inicia sesión en la aplicación.');
      if(assistJobs.has(t.id))throw Error('Ya hay una consulta de IA en curso en esta pestaña.');
      const job=crypto.randomUUID();assistJobs.set(t.id,job);assistProposals.delete(t.id);let remoteId:string|undefined;
      try {
        const context=assistContextSchema.parse(await send(t.id,'assistContext',{allowImage:m.includeImage}));
        let image:string|undefined;
        if(m.includeImage) {
          const active=async()=>{
            const current=await tab(t.id),selected=await chrome.tabs.query({active:true,windowId:t.windowId});
            if(current.url!==t.url || selected.length!==1 || selected[0].id!==t.id)throw Error('Activa la pestaña ALEKS seleccionada para capturarla.');
          };
          await active();image=await chrome.tabs.captureVisibleTab(t.windowId,{format:'jpeg',quality:65});await active();
          if(image.length>1_500_000)throw Error('La captura es demasiado grande; reduce el tamaño de la ventana.');
        }
        // Peticiones cortas: MV3 puede terminar un worker cuyo fetch no recibe
        // respuesta durante 30 s. No mantenemos un fetch abierto a la inferencia.
        const started=await api('/assist/jobs','POST',{context,...(image?{image}:{})},true);
        if(typeof started?.id!=='string' || !/^[a-f0-9-]{36}$/.test(started.id))throw Error('Identificador de consulta inválido.');
        remoteId=started.id;
        if(assistJobs.get(t.id)!==job)throw Error('Consulta cancelada.');
        assistRemoteJobs.set(t.id,started.id);
        const deadline=Date.now()+240_000;let response:unknown;
        while(Date.now()<deadline) {
          if(assistJobs.get(t.id)!==job)throw Error('Consulta cancelada.');
          const state=await api(`/assist/jobs/${started.id}`,'GET',undefined,true);
          if(state.status==='completed'){response=state.result;break;}
          if(state.status==='error')throw Error('Ollama no produjo una propuesta válida. Comprueba el servicio, modelo y tiempo disponible.');
          if(state.status!=='pending')throw Error('Estado de consulta inválido.');
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
        if(response===undefined)throw Error('El modelo tardó más de cuatro minutos. Usa un modelo más pequeño o revisa los recursos disponibles.');
        const result=assistResultSchema.parse(response);
        const current=await tab(t.id),fresh=assistContextSchema.parse(await send(t.id,'assistContext',{allowImage:m.includeImage}));
        if(assistJobs.get(t.id)!==job || current.url!==t.url || context.fingerprint!==fresh.fingerprint || result.fingerprint!==context.fingerprint)throw Error('El ejercicio cambió durante la consulta; se descartó la propuesta.');
        const expected=context.fields.map(field=>field.key).sort().join(',');
        if(result.proposal.status==='proposed' && result.proposal.answers.map(answer=>answer.field_key).sort().join(',')!==expected)throw Error('Las respuestas de IA no corresponden a los campos actuales.');
        // La captura contiene solo el área visible; el contexto textual no valida
        // cambios del diagrama. Por ahora esas propuestas se introducen a mano.
        const proposal:AssistView={id:crypto.randomUUID(),context:{...context,can_fill_integer:context.can_fill_integer && !m.includeImage},result};
        assistProposals.set(t.id,proposal);return proposal;
      } finally {
        if(assistRemoteJobs.get(t.id)===remoteId)assistRemoteJobs.delete(t.id);
        if(remoteId)await api(`/assist/jobs/${remoteId}`,'DELETE',undefined,true).catch(()=>{});
        if(assistJobs.get(t.id)===job)assistJobs.delete(t.id);
      }
    }
    case 'assistFill': {
      const t=await tab(m.tabId),proposal=assistProposals.get(t.id);
      assistProposals.delete(t.id);
      if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || !await auth() || !proposal || proposal.id!==m.proposalId || !proposal.context.can_fill_integer)throw Error('No hay una propuesta vigente que se pueda introducir.');
      const answers=proposal.result.proposal.answers;
      if(proposal.result.proposal.status!=='proposed' || answers.length!==1 || answers[0].field_key!=='answer' || answers[0].unit!=='' || !/^(0|[1-9]\d{0,11})$/.test(answers[0].value))throw Error('Esta propuesta requiere introducción manual; la escritura asistida admite un entero sin unidad.');
      assistWriters.add(t.id);
      try{return await send(t.id,'assistFill',{fingerprint:proposal.context.fingerprint,value:answers[0].value});}
      finally{assistWriters.delete(t.id);}
    }
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
    case 'pause': case 'resume': case 'stop': case 'cancelAssist': {
      const t=await tab(m.tabId);assistProposals.delete(t.id);assistJobs.delete(t.id);
      const remote=assistRemoteJobs.get(t.id);assistRemoteJobs.delete(t.id);
      if(remote)await api(`/assist/jobs/${remote}`,'DELETE',undefined,true).catch(()=>{});
      return send(t.id,m.type==='cancelAssist'?'stop':String(m.type));
    }
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
    // El almacenamiento puede devolver las propiedades en otro orden.
    // La autorización depende de sus valores, no del orden de serialización.
    const authorized=limitsSchema.parse(consent.limits);
    if(run.limits.maxExercises!==authorized.maxExercises || run.limits.maxMinutes!==authorized.maxMinutes ||
      run.limits.maxAICalls!==authorized.maxAICalls || run.limits.preview!==authorized.preview) throw Error('Los límites no coinciden con la autorización');
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
chrome.tabs.onRemoved.addListener(id=>{
  assistProposals.delete(id);assistJobs.delete(id);assistWriters.delete(id);
  const remote=assistRemoteJobs.get(id);assistRemoteJobs.delete(id);if(remote)void api(`/assist/jobs/${remote}`,'DELETE',undefined,true).catch(()=>{});
  void chrome.storage.local.remove([`run:${id}`,`consent:${id}`]);
});
