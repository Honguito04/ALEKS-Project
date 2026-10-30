import { BACKEND, ALEKS_ORIGINS, allowedTab, simulatorURL, exerciseSchema, limitsSchema, runSchema, solutionSchema, assistContextSchema,assistResultSchema,type AssistView,type Run } from './shared';
import { typeNativeAnswer } from './native-keyboard';
import { parseSupportedAnswer } from './answer-format';
import { AleksAutomation,automationLimitsSchema,type AutomationView } from './aleks-automation';
import { captureFillPolicy,requireAssistImage,proposalFillBlockers,fillBlockerMessages } from './assist-readiness';

type Auth = {token:string;mode:'demo'|'google'};
type Consent = {origin:string;activity:string;limits:ReturnType<typeof limitsSchema.parse>};
const assistProposals=new Map<number,AssistView>();
const assistJobs=new Map<number,string>();
const assistWriters=new Set<number>();
const assistRemoteJobs=new Map<number,string>();
const automations=new Map<number,AleksAutomation>();
const automationStarting=new Map<number,AbortController>();
const nativeTabs=new Set<number>();
let nativeEpoch=0;
const nativeTabEpoch=new Map<number,number>();
function cancelNative(id:number) {nativeTabEpoch.set(id,(nativeTabEpoch.get(id)||0)+1);nativeWrites.get(id)?.abort.abort();}
type NativeWrite={id:string;url:string;value:string;used:boolean;abort:AbortController;current:()=>boolean};
const nativeWrites=new Map<number,NativeWrite>();
async function deliverAnswer(id:number,type:string,data:Record<string,unknown>,current=()=>true) {
  if(!nativeTabs.has(id))return send(id,type,data,current);
  const epoch=nativeEpoch,tabEpoch=nativeTabEpoch.get(id)||0;
  const allowed=()=>current() && nativeTabs.has(id) && epoch===nativeEpoch && tabEpoch===(nativeTabEpoch.get(id)||0);
  const t=await tab(id);
  if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || typeof data.value!=='string' || !parseSupportedAnswer(data.value))throw Error('Respuesta no admitida por el teclado de Chrome.');
  if(!allowed() || nativeWrites.has(id))throw Error('Ya hay otra escritura o el recorrido se detuvo.');
  if(!await chrome.permissions.contains({permissions:['debugger']}))throw Error('Recarga la extensión 0.4.0 y concede el permiso de depuración de Chrome.');
  if(!allowed())throw Error('Escritura cancelada.');
  const write:NativeWrite={id:crypto.randomUUID(),url:t.url,value:data.value,used:false,abort:new AbortController(),current:allowed};
  nativeWrites.set(id,write);
  try{return await send(id,type,{...data,nativeWriteId:write.id},()=>allowed() && !write.abort.signal.aborted);}
  finally {write.abort.abort();if(nativeWrites.get(id)===write)nativeWrites.delete(id);}
}
const automationKey=(id:number)=>`aleksAutomation:${id}`;
async function cancelTabAssist(id:number) {
  cancelNative(id);
  automationStarting.get(id)?.abort();
  assistJobs.delete(id);assistProposals.delete(id);
  const remote=assistRemoteJobs.get(id);assistRemoteJobs.delete(id);
  await Promise.allSettled([
    chrome.tabs.sendMessage(id,{scope:'adapter',type:'stop'}),
    ...(remote?[api(`/assist/jobs/${remote}`,'DELETE',undefined,true)]:[])
  ]);
}
async function automationStatus(id:number):Promise<AutomationView|undefined> {
  const live=automations.get(id);if(live)return live.view;
  const stored=(await chrome.storage.session.get(automationKey(id)))[automationKey(id)] as AutomationView|undefined;
  if(!stored)return;
  if(stored.active) {
    // No repetir una entrega cuyo resultado se perdió al reiniciar el worker.
    const interrupted={...stored,active:false,busy:false,phase:'DETENIDO' as const,message:'La extensión se reinició. Revisa ALEKS antes de iniciar otro recorrido.'};
    await chrome.storage.session.set({[automationKey(id)]:interrupted});
    await cancelTabAssist(id);return interrupted;
  }
  return stored;
}
// El modo automático de panel omite activeTab en Chromium. El clic de action
// concede el permiso antes de este evento. Abrir de forma directa conserva su
// gesto de usuario; no esperar operaciones asíncronas antes de sidePanel.open.
chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:false}).catch(()=>{});
chrome.action.onClicked.addListener(tab=>{
  if(typeof tab.id==='number' && tab.id>=0)void chrome.sidePanel.open({tabId:tab.id}).catch(()=>{});
});
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
async function send(id:number,type:string,data:Record<string,unknown>={},isCurrent=()=>true) {
  await tab(id);if(!isCurrent())throw Error('Recorrido detenido.');
  const response=await chrome.tabs.sendMessage(id,{scope:'adapter',type,...data});
  if(!response?.ok) throw Error(response?.error || 'El adaptador no respondió');return response.data;
}
async function attach(id:unknown) {
  const t=await tab(id);
  await chrome.scripting.executeScript({target:{tabId:t.id},files:['content.js']});
  return {...await send(t.id,'status'),tab:{id:t.id,title:t.title || 'Actividad matemática',url:t.url}};
}
async function stopAll() {
  nativeEpoch++;nativeTabs.clear();for(const write of nativeWrites.values())write.abort.abort();
  for(const starting of automationStarting.values())starting.abort();
  await Promise.allSettled([...automations.values()].map(run=>run.stop('Recorrido detenido por cambio de sesión o permisos.')));
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

async function handleUI(m:Record<string,unknown>,automated=false,isCurrent=()=>true):Promise<any> {
  if(!automated && ['assist','assistFill','start'].includes(String(m.type)) &&
    (automations.get(Number(m.tabId))?.view.active || automationStarting.has(Number(m.tabId))))throw Error('Detén el recorrido automático antes de iniciar otra operación.');
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
    case 'attach': {const result=await attach(m.tabId);return {...result,nativeKeyboard:nativeTabs.has(result.tab.id),automation:await automationStatus(result.tab.id)};}
    case 'status': {const t=await tab(m.tabId);return {...await send(t.id,'status'),nativeKeyboard:nativeTabs.has(t.id),automation:await automationStatus(t.id)};}
    case 'nativeKeyboard': {
      const t=await tab(m.tabId);
      if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || typeof m.enabled!=='boolean')throw Error('Selecciona una pestaña ALEKS.');
      if(assistWriters.has(t.id) || automations.get(t.id)?.view.active || automationStarting.has(t.id))throw Error('Detén la operación antes de cambiar el método de escritura.');
      if(m.enabled) {
        if(!await auth() || !await chrome.permissions.contains({permissions:['debugger']}))throw Error('Inicia sesión en el asistente y recarga la extensión con el permiso de depuración.');
        nativeTabs.add(t.id);
      }else nativeTabs.delete(t.id);
      return nativeTabs.has(t.id);
    }
    case 'automationStart': {
      const t=await tab(m.tabId);
      if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || !await auth())throw Error('Selecciona ALEKS e inicia sesión en el asistente.');
      if(automationStarting.has(t.id) || (automations.get(t.id)?.view.active || automations.get(t.id)?.view.busy) || assistJobs.has(t.id) || assistWriters.has(t.id))throw Error('Ya hay una operación en curso en esta pestaña.');
      const starting=new AbortController();automationStarting.set(t.id,starting);
      try {
        const limits=automationLimitsSchema.parse(m.limits);
        await automationStatus(t.id);starting.signal.throwIfAborted();
        const context=assistContextSchema.parse(await send(t.id,'assistContext'));
        starting.signal.throwIfAborted();
        if(!context.can_fill_integer && !context.can_fill_fraction)throw Error('El recorrido necesita un único recuadro vacío para un entero o fracción y un enunciado sin diagramas.');
        const seed=m.proposalId===undefined?undefined:assistProposals.get(t.id);
        if(m.proposalId!==undefined && (!seed || seed.id!==m.proposalId || seed.context.fingerprint!==context.fingerprint))throw Error('La propuesta cambió; vuelve a consultar.');
        const ensureTab=async()=>{const current=await tab(t.id);if(current.url!==t.url || !await auth())throw Error('La pestaña o la sesión cambió. Se detuvo el recorrido.');};
        const run:AleksAutomation=new AleksAutomation(limits,{
          now:()=>Date.now(),
          solve:async()=>{await ensureTab();if(!run.view.active)throw Error('Recorrido detenido.');return handleUI({type:'assist',tabId:t.id,includeImage:false},true,()=>run.view.active);},
          submit:async proposal=>{
            await ensureTab();if(!run.view.active)throw Error('Recorrido detenido.');assistProposals.delete(t.id);assistWriters.add(t.id);
            try{return await deliverAnswer(t.id,'automationSubmit',{fingerprint:proposal.context.fingerprint,value:proposal.result.proposal.answers[0].value,runId:run.view.id},()=>run.view.active);}
            finally{assistWriters.delete(t.id);}
          },
          next:async()=>{await ensureTab();if(!run.view.active)throw Error('Recorrido detenido.');return send(t.id,'automationNext',{runId:run.view.id},()=>run.view.active);},
          cancel:()=>cancelTabAssist(t.id),
          save:async view=>{
            // Solo progreso: nunca guardar el enunciado, imagen ni respuesta.
            const {answer,...progress}=view;
            await chrome.storage.session.set({[automationKey(t.id)]:{...progress,message:view.phase==='DETENIDO'?'Recorrido detenido. Revisa el resultado en ALEKS.':view.message}});
          }
        },seed);
        await ensureTab();starting.signal.throwIfAborted();
        await send(t.id,'automationReset',{runId:run.view.id},()=>!starting.signal.aborted);starting.signal.throwIfAborted();
        automations.set(t.id,run);assistProposals.delete(t.id);
        const {answer,...progress}=run.view;await chrome.storage.session.set({[automationKey(t.id)]:progress});
        return run.view;
      }catch(error){await automations.get(t.id)?.stop('No se pudo iniciar el recorrido.');await cancelTabAssist(t.id);throw error;}
      finally{automationStarting.delete(t.id);}
    }
    case 'automationStep': {
      const t=await tab(m.tabId),run=automations.get(t.id);
      if(!run || run.view.id!==m.runId)throw Error('El recorrido ya no está activo. Vuelve a leer su estado.');
      return run.step();
    }
    case 'automationStop': {
      automationStarting.get(Number(m.tabId))?.abort();
      if(typeof m.tabId!=='number' || !Number.isInteger(m.tabId))throw Error('Selecciona una pestaña');
      const id=m.tabId,run=automations.get(id);
      if(run)return run.stop();
      await cancelTabAssist(id);return automationStatus(id);
    }
    case 'editorDiagnostics': return send((await tab(m.tabId)).id,'editorDiagnostics');
    case 'localAIStatus': return api('/ai/local/status','GET',undefined,true);
    case 'assist': {
      const t=await tab(m.tabId);
      if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || typeof m.includeImage!=='boolean')throw Error('Selecciona una pestaña ALEKS para la consulta local.');
      if(m.needsImage!==undefined && typeof m.needsImage!=='boolean')throw Error('Indicación de dibujo inválida.');
      if(m.image!==undefined && (m.includeImage || typeof m.image!=='string' || m.image.length>1_333_359 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(m.image)))throw Error('Adjunta una única captura JPEG válida y acotada.');
      const hasImage=m.includeImage || m.image!==undefined;
      if(!await auth())throw Error('Entra en demostración o inicia sesión en la aplicación.');
      if(!isCurrent())throw Error('Recorrido detenido.');
      if(assistJobs.has(t.id))throw Error('Ya hay una consulta de IA en curso en esta pestaña.');
      const job=crypto.randomUUID();assistJobs.set(t.id,job);assistProposals.delete(t.id);let remoteId:string|undefined;
      try {
        const observed=assistContextSchema.parse(await send(t.id,'assistContext',{allowImage:hasImage}));
        const context=requireAssistImage(observed,m.needsImage===true);
        if(context.diagram_required && !hasImage)throw Error('El ejercicio necesita el dibujo. Incluye la captura visible o adjunta una imagen antes de consultar; no se llamó al modelo.');
        let image=m.image as string|undefined;
        if(m.includeImage) {
          const active=async()=>{
            const current=await tab(t.id),selected=await chrome.tabs.query({active:true,windowId:t.windowId});
            if(current.url!==t.url || selected.length!==1 || selected[0].id!==t.id)throw Error('Activa la pestaña ALEKS seleccionada para capturarla.');
          };
          await active();
          try{image=await chrome.tabs.captureVisibleTab(t.windowId,{format:'jpeg',quality:65});}
          catch(error){
            if(/activeTab|<all_urls>/i.test(error instanceof Error?error.message:String(error)))throw Error('Chrome no concedió permiso para capturar esta pestaña. Activa la pestaña ALEKS y pulsa el icono del asistente en la barra de Chrome; después vuelve a consultar. También puedes usar «Adjuntar imagen del ejercicio». No se llamó al modelo.');
            throw Error('Chrome no pudo capturar la pestaña. Puedes usar «Adjuntar imagen del ejercicio» y volver a consultar. No se llamó al modelo.');
          }
          await active();
          if(image.length>1_333_359)throw Error('La captura es demasiado grande; reduce el tamaño de la ventana o adjunta un recorte del ejercicio.');
        }
        // Peticiones cortas: MV3 puede terminar un worker cuyo fetch no recibe
        // respuesta durante 30 s. No mantenemos un fetch abierto a la inferencia.
        // Los motivos de escritura son diagnóstico local, no datos del modelo.
        const {fill_blockers,can_fill_fraction,...modelContext}=context;
        if(!isCurrent() || assistJobs.get(t.id)!==job)throw Error('Consulta cancelada.');
        const started=await api('/assist/jobs','POST',{context:modelContext,...(image?{image}:{})},true);
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
        if(response===undefined)throw Error('El modelo tardó más de cuatro minutos. Revisa los recursos y el modelo local disponibles.');
        const result=assistResultSchema.parse(response);
        const current=await tab(t.id),fresh=assistContextSchema.parse(await send(t.id,'assistContext',{allowImage:hasImage}));
        if(assistJobs.get(t.id)!==job || current.url!==t.url || context.fingerprint!==fresh.fingerprint || result.fingerprint!==context.fingerprint)throw Error('El ejercicio cambió durante la consulta; se descartó la propuesta.');
        const expected=context.fields.map(field=>field.key).sort().join(',');
        if(result.proposal.status==='proposed' && result.proposal.answers.map(answer=>answer.field_key).sort().join(',')!==expected)throw Error('Las respuestas de IA no corresponden a los campos actuales.');
        // El comprobador de premios usa solo texto. Las propuestas que dependen
        // de la captura conservan la introducción manual.
        const proposal:AssistView={id:crypto.randomUUID(),context:captureFillPolicy(context,result,hasImage),result};
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
      if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || !await auth() || !proposal || proposal.id!==m.proposalId)throw Error('No hay una propuesta vigente que se pueda introducir.');
      const blockers=proposalFillBlockers(proposal);
      if(blockers.length)throw Error(blockers.map(blocker=>fillBlockerMessages[blocker]).join(' '));
      const answers=proposal.result.proposal.answers;
      if(proposal.result.proposal.status!=='proposed' || answers.length!==1 || answers[0].field_key!=='answer' || answers[0].unit!=='' || !parseSupportedAnswer(answers[0].value))throw Error('Esta propuesta requiere introducción manual; la escritura asistida admite un entero o fracción sin unidad.');
      assistWriters.add(t.id);
      try{return await deliverAnswer(t.id,'assistFill',{fingerprint:proposal.context.fingerprint,value:answers[0].value});}
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
      const t=await tab(m.tabId);cancelNative(t.id);await automations.get(t.id)?.stop();assistProposals.delete(t.id);assistJobs.delete(t.id);
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
  if(m.type==='nativeType') {
    const write=nativeWrites.get(t.id);
    if(!write || write.used || m.writeId!==write.id || !nativeTabs.has(t.id) || sender.url!==write.url || t.url!==write.url || !ALEKS_ORIGINS.includes(new URL(t.url).origin))throw Error('No hay una escritura de teclado autorizada para esta pestaña.');
    write.used=true;
    const check=async()=>{
      write.abort.signal.throwIfAborted();
      const current=await tab(t.id);
      const active=await chrome.tabs.query({active:true,windowId:current.windowId});
      const window=await chrome.windows.get(current.windowId);
      if(nativeWrites.get(t.id)!==write || !write.current() || !nativeTabs.has(t.id) || current.url!==write.url ||
        active.length!==1 || active[0].id!==t.id || !window.focused || !await auth() || !await chrome.permissions.contains({permissions:['debugger']}))throw Error('Activa la pestaña ALEKS y conserva el foco en el editor. Se detuvo la escritura.');
      write.abort.signal.throwIfAborted();
    };
    await typeNativeAnswer(t.id,write.value,{signal:write.abort.signal,check,
      guard:async()=>{await send(t.id,'nativeGuard',{writeId:write.id},()=>!write.abort.signal.aborted && write.current());}});
    return true;
  }
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
  nativeTabs.delete(id);cancelNative(id);
  void automations.get(id)?.stop('La pestaña se cerró.').finally(()=>chrome.storage.session.remove(automationKey(id)));automations.delete(id);
  assistProposals.delete(id);assistJobs.delete(id);assistWriters.delete(id);
  const remote=assistRemoteJobs.get(id);assistRemoteJobs.delete(id);if(remote)void api(`/assist/jobs/${remote}`,'DELETE',undefined,true).catch(()=>{});
  void chrome.storage.local.remove([`run:${id}`,`consent:${id}`]);
});
