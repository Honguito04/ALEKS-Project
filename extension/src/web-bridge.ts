import { z } from 'zod';
import { ALEKS_ORIGINS,assistContextSchema,assistResultSchema,type AssistContext,type AssistView } from './shared';
import { AleksAutomation,automationLimitsSchema,type AutomationView } from './aleks-automation';
import { captureFillPolicy } from './assist-readiness';

declare const __BRIDGE_WEB_ORIGIN__:string;
export const BRIDGE_WEB_ORIGIN=typeof __BRIDGE_WEB_ORIGIN__==='string'?__BRIDGE_WEB_ORIGIN__:'';
export const BRIDGE_PORT='aleks-web-bridge-v1';
const base={requestId:z.uuid()};
export const bridgeCommandSchema=z.discriminatedUnion('command',[
  z.object({...base,command:z.literal('connect'),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict(),
  z.object({...base,command:z.literal('list')}).strict(),
  z.object({...base,command:z.literal('bind'),tabId:z.number().int().nonnegative()}).strict(),
  z.object({...base,command:z.literal('read')}).strict(),
  z.object({...base,command:z.literal('preview'),includeImage:z.boolean().optional()}).strict(),
  z.object({...base,command:z.literal('start'),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
    limits:automationLimitsSchema,nativeKeyboard:z.literal(true),proposalId:z.uuid().optional()}).strict(),
  z.object({...base,command:z.literal('stop')}).strict(),
  z.object({...base,command:z.literal('status')}).strict(),
  z.object({...base,command:z.literal('unlink')}).strict(),
]);
type Command=z.infer<typeof bridgeCommandSchema>;
type Tab=chrome.tabs.Tab & {id:number;url:string};
export interface BridgeDependencies {
  tab(id:number):Promise<Tab>;
  attach(id:number):Promise<unknown>;
  send(id:number,type:string,data?:Record<string,unknown>,current?:()=>boolean):Promise<any>;
  deliver(id:number,type:string,data:Record<string,unknown>,current:()=>boolean):Promise<any>;
  cancel(id:number):Promise<unknown>;
  setNative(id:number,enabled:boolean):void;
  legacyBusy(id:number):boolean;
  focus(id:number):Promise<void>;
}
type Connection={port:chrome.runtime.Port;webTabId:number;documentId:string;alive:boolean;token?:string;epoch:number;
  tab?:Tab;context?:AssistContext;proposal?:AssistView;run?:AleksAutomation;remote?:string;
  providerCalls:number;providerCallsUncertain:boolean;http:Set<AbortController>;driving?:Promise<void>;lastPulse:number;queue:Promise<unknown>;requests:Map<string,{payload:string;reply:Promise<unknown>}>};
const JOURNAL='webBridgeJournal';
const journalKey=(id:number)=>`${JOURNAL}:${id}`;
type Journal={active?:boolean;tabId?:number;submitted?:string[]};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

/** Closed protocol: the website selects an ALEKS tab, never DOM operations. */
export class WebBridge {
  private connections=new Set<Connection>();
  private tabs=new Map<number,Connection>();
  private heartbeat?:ReturnType<typeof setInterval>;
  private interrupted?:string;
  private ready:Promise<void>=Promise.resolve();
  private submitted=new Map<number,Set<string>>();

  constructor(private origin:string,private deps:BridgeDependencies) {
    if(!origin || !chrome.runtime.onConnectExternal)return;
    chrome.runtime.onConnectExternal.addListener(port=>this.accept(port));
    chrome.tabs.onUpdated?.addListener((id,change)=>{
      if(change.status==='loading' || change.url)for(const c of this.connections)
        if(c.webTabId===id || c.tab?.id===id)void this.disconnect(c,'La pestaña cambió o se recargó; el recorrido se detuvo.');
    });
    chrome.tabs.onRemoved.addListener(id=>{
      for(const c of this.connections)if(c.webTabId===id || c.tab?.id===id)void this.disconnect(c,'Se cerró una pestaña vinculada.');
    });
    chrome.permissions.onRemoved.addListener(()=>{void this.stopAll('Se retiraron permisos; vuelve a vincular la extensión.');});
    chrome.alarms?.onAlarm.addListener(alarm=>{
      if(alarm.name==='aleks-web-watchdog')for(const c of this.connections)
        if(Date.now()-c.lastPulse>45_000)void this.disconnect(c,'Chrome interrumpió el recorrido. Revisa ALEKS antes de iniciar otro.');
    });
    this.ready=chrome.storage.session.get(null).then(async entries=>{
      for(const [key,value] of Object.entries(entries)) {
        if(key!==JOURNAL && !key.startsWith(JOURNAL+':'))continue;
        const journal=value as Journal;
        if(typeof journal?.tabId!=='number')continue;
        const fingerprints=new Set((journal.submitted||[]).filter(v=>/^[a-f0-9]{64}$/.test(v)));
        this.submitted.set(journal.tabId,fingerprints);
        if(journal.active) {
          this.interrupted='La extensión se reinició. No se reanudarán entregas; revisa ALEKS antes de iniciar otro recorrido.';
          await this.deps.cancel(journal.tabId).catch(()=>{});
          await chrome.storage.session.set({[journalKey(journal.tabId)]:{...journal,active:false,interrupted:true}});
        }
      }
    });
  }

  ownsTab(id:number){return this.tabs.has(id);}
  async authorized(id:number) {
    const c=this.tabs.get(id);
    if(!c?.alive || !c.token)return false;
    await this.session(c);
    return c.alive && this.tabs.get(id)===c;
  }
  async stopAll(reason:string) {await Promise.allSettled([...this.connections].map(c=>this.disconnect(c,reason)));}

  private post(c:Connection,value:unknown) {if(c.alive)try{c.port.postMessage(value);}catch{void this.disconnect(c,'La web se desconectó.');}}
  private view(c:Connection) {
    const state=c.run?.view;
    const automation=state?.canContinue?{...state,canContinue:false,
      message:`Límite autorizado alcanzado. ${state.accepted} respuesta(s) confirmadas por ALEKS. Para otro recorrido, avanza manualmente y vuelve a leer la actividad desde la web.`}:state;
    return {connected:Boolean(c.alive && c.token),...(c.tab?{tab:{id:c.tab.id,title:c.tab.title||'ALEKS'}}:{}),
    ...(c.context?{context:c.context}:{}),...(c.proposal?{proposal:c.proposal}:{}),...(automation?{automation}:{}),
    providerCalls:c.providerCalls,providerCallsUncertain:c.providerCallsUncertain,...(this.interrupted?{interrupted:this.interrupted}:{})};}
  private progress(c:Connection){this.post(c,{event:'progress',value:this.view(c)});}
  private assert(c:Connection,epoch=c.epoch) {if(!c.alive || c.epoch!==epoch)throw Error('Operación detenida o vínculo interrumpido.');}

  private accept(port:chrome.runtime.Port) {
    const sender=port.sender;
    try {
      const url=new URL(sender?.url||'');
      if(port.name!==BRIDGE_PORT || !sender?.tab || typeof sender.tab.id!=='number' || sender.frameId!==0 ||
        !sender.documentId || url.origin!==this.origin || !url.pathname.startsWith('/app/') ||
        new URL(sender.tab.url||'').origin!==this.origin || (sender.origin && sender.origin!==this.origin))throw Error();
    } catch {port.disconnect();return;}
    const c:Connection={port,webTabId:sender!.tab!.id!,documentId:sender!.documentId!,alive:true,epoch:0,
      providerCalls:0,providerCallsUncertain:false,http:new Set(),lastPulse:Date.now(),queue:Promise.resolve(),requests:new Map()};
    this.connections.add(c);
    port.onMessage.addListener(raw=>this.receive(c,raw));
    port.onDisconnect.addListener(()=>{void this.disconnect(c,'La web se desconectó; el recorrido fue detenido.');});
    if(!this.heartbeat)this.heartbeat=setInterval(()=>{void this.pulse();},20_000);
    void chrome.alarms?.create('aleks-web-watchdog',{periodInMinutes:1});
  }

  private receive(c:Connection,raw:unknown) {
    let command:Command;
    try {command=bridgeCommandSchema.parse(raw);}catch {
      const requestId=raw && typeof raw==='object' && 'requestId' in raw && typeof raw.requestId==='string'?raw.requestId:'';
      this.post(c,{requestId,ok:false,error:'Comando del puente no admitido.'});return;
    }
    const payload=JSON.stringify(command),cached=c.requests.get(command.requestId);
    if(cached) {
      if(cached.payload!==payload){this.post(c,{requestId:command.requestId,ok:false,error:'El identificador ya corresponde a otro comando.'});return;}
      void cached.reply.then(reply=>this.post(c,reply));return;
    }
    if(c.requests.size>=128 && command.command!=='stop' && command.command!=='unlink'){this.post(c,{requestId:command.requestId,ok:false,error:'Vuelve a vincular la web para iniciar otra sesión de comandos.'});return;}
    // Stop preempts a queued start/preview and invalidates every pending phase.
    const preempt=command.command==='stop' || command.command==='unlink';
    if(preempt)c.epoch++;
    const epoch=c.epoch;
    const operation=async()=>{await this.ready;return this.execute(c,command,epoch);};
    const pending=preempt?operation():c.queue.then(operation);
    const reply=pending.then(value=>({requestId:command.requestId,ok:true,value}),error=>({requestId:command.requestId,ok:false,
      error:error instanceof Error?error.message:'El comando fue rechazado.'}));
    c.queue=preempt?Promise.allSettled([c.queue,reply]):reply;
    c.requests.set(command.requestId,{payload,reply});
    void reply.then(value=>this.post(c,value));
  }

  private async request(c:Connection,path:string,method='GET',body?:unknown) {
    if(!c.token)throw Error('Vincula tu cuenta web con la extensión.');
    const controller=new AbortController();c.http.add(controller);
    const timeout=setTimeout(()=>controller.abort(),20_000);
    try {
    const response=await fetch(this.origin+'/web-api/bridge'+path,{method,credentials:'omit',redirect:'error',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${c.token}`},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal});
    if(!response.ok) {
      if(response.status===401 || response.status===403)void this.disconnect(c,'La cuenta o la vinculación dejó de estar autorizada.');
      const payload=await response.json().catch(()=>({}));
      throw Error(typeof payload.detail==='string'?payload.detail:`Solicitud rechazada (${response.status}).`);
    }
    return response.status===204?undefined:await response.json();
    } finally {clearTimeout(timeout);c.http.delete(controller);}
  }
  private async session(c:Connection) {const epoch=c.epoch;await this.request(c,'/session');this.assert(c,epoch);}
  private async bound(c:Connection,epoch=c.epoch) {
    this.assert(c,epoch);
    if(!c.tab || this.tabs.get(c.tab.id)!==c)throw Error('Selecciona y vincula una pestaña ALEKS.');
    const t=await this.deps.tab(c.tab.id);this.assert(c,epoch);
    if(t.url!==c.tab.url || !ALEKS_ORIGINS.includes(new URL(t.url).origin))throw Error('La pestaña ALEKS cambió. Lee de nuevo el ejercicio.');
    return t;
  }
  private async read(c:Connection,epoch:number,includeImage=false) {
    const t=await this.bound(c,epoch);
    const context=assistContextSchema.parse(await this.deps.send(t.id,'assistContext',{allowImage:includeImage},()=>c.alive && c.epoch===epoch));
    this.assert(c,epoch);c.context=context;return context;
  }
  private async focused(c:Connection,t:Tab,epoch:number) {
    const selected=await chrome.tabs.query({active:true,windowId:t.windowId}),window=await chrome.windows.get(t.windowId);
    this.assert(c,epoch);
    if(selected.length!==1 || selected[0].id!==t.id || !window.focused)throw Error('ALEKS perdió el foco. El recorrido se detuvo antes de la siguiente operación.');
  }
  private async solve(c:Connection,epoch:number,includeImage=false,expectedFingerprint=c.context?.fingerprint):Promise<AssistView> {
    await this.session(c);const t=await this.bound(c,epoch),context=await this.read(c,epoch,includeImage);
    if(expectedFingerprint && context.fingerprint!==expectedFingerprint)throw Error('El ejercicio cambió sin un avance autorizado. Vuelve a leerlo antes de consultar.');
    if(context.diagram_required && !includeImage)throw Error('Este ejercicio necesita una imagen; no se consultó al proveedor.');
    let image:string|undefined;
    if(includeImage) {
      await this.deps.focus(t.id);await this.focused(c,t,epoch);
      try {image=await chrome.tabs.captureVisibleTab(t.windowId,{format:'jpeg',quality:65});}
      catch {throw Error('Chrome no concedió captura. Activa ALEKS y pulsa el icono de la extensión antes de usar la captura. No se consultó IA.');}
      await this.focused(c,t,epoch);
      const captured=await this.read(c,epoch,true);
      if(captured.fingerprint!==context.fingerprint)throw Error('El ejercicio cambió durante la captura. No se consultó IA.');
      if(image.length>1_333_359)throw Error('La captura supera el tamaño admitido.');
    }
    const {fill_blockers,can_fill_fraction,fixed_unit,...modelContext}=context;
    let remote:string|undefined,reported=0,started=false,settled=false;
    const account=(calls:unknown)=>{if(typeof calls==='number' && Number.isInteger(calls) && calls>reported && calls<=2){c.providerCalls+=calls-reported;reported=calls;this.progress(c);}};
    try {
      this.assert(c,epoch);
      started=true;
      const created=await this.request(c,'/jobs','POST',{context:modelContext,...(image?{image}:{})});
      remote=z.uuid().parse(created.id);c.remote=remote;this.assert(c,epoch);
      const deadline=Date.now()+240_000;
      while(Date.now()<deadline) {
        this.assert(c,epoch);
        const state=await this.request(c,`/jobs/${remote}`);this.assert(c,epoch);
        account(state.provider_calls??state.result?.provider_calls);
        if(state.status==='error'){settled=true;throw Object.assign(Error(state.error?.message||'La IA no completó la consulta.'),{providerCalls:reported});}
        if(state.status==='completed') {
          settled=true;
          const result=assistResultSchema.parse(state.result),fresh=await this.read(c,epoch,includeImage);
          if(fresh.fingerprint!==context.fingerprint || result.fingerprint!==context.fingerprint)throw Error('El ejercicio cambió; se descartó la propuesta.');
          if(result.proposal.status==='proposed' && result.proposal.answers.map(a=>a.field_key).sort().join(',')!==context.fields.map(f=>f.key).sort().join(','))throw Error('Los campos de la respuesta no corresponden al ejercicio.');
          const proposal={id:crypto.randomUUID(),context:captureFillPolicy(context,result,includeImage),result};
          this.assert(c,epoch);c.proposal=proposal;this.progress(c);return proposal;
        }
        if(state.status!=='pending')throw Error('Estado de consulta no admitido.');
        await pause(800);
      }
      throw Object.assign(Error('La consulta se interrumpió por tiempo; no se reintentará.'),{providerCalls:reported});
    } finally {
      if(started && !settled)c.providerCallsUncertain=true;
      if(c.remote===remote)c.remote=undefined;
      if(remote)await this.request(c,`/jobs/${remote}`,'DELETE').catch(()=>{});
      this.progress(c);
    }
  }

  private async start(c:Connection,command:Extract<Command,{command:'start'}>,epoch:number) {
    await this.session(c);const t=await this.bound(c,epoch);
    if(c.driving || c.run?.view.active || this.deps.legacyBusy(t.id))throw Error('Ya hay una operación en la pestaña.');
    await this.deps.focus(t.id);this.assert(c,epoch);
    const context=await this.read(c,epoch);
    if(context.fingerprint!==command.fingerprint)throw Error('El ejercicio cambió. Vuelve a leerlo antes de autorizar.');
    if(context.diagram_required || (!context.can_fill_integer && !context.can_fill_fraction))throw Error('El editor o el ejercicio no admite este recorrido automático.');
    const seed=command.proposalId?c.proposal:undefined;
    if(command.proposalId && (!seed || seed.id!==command.proposalId || seed.context.fingerprint!==context.fingerprint))throw Error('La propuesta dejó de estar vigente.');
    if(this.submitted.get(t.id)?.has(context.fingerprint))throw Error('Este ejercicio ya tuvo una entrega; no se repetirá aunque se reconecte la web. Revisa ALEKS.');
    if((this.submitted.get(t.id)?.size||0)>=100)throw Error('Se alcanzó el máximo de entregas de esta pestaña. Cierra la pestaña al terminar y abre una nueva actividad.');
    let expectedFingerprint=context.fingerprint;
    const current=()=>c.alive && c.epoch===epoch && Boolean(c.run?.view.active);
    const ensure=async()=>{
      await this.session(c);await this.bound(c,epoch);if(!current())throw Error('Recorrido detenido.');
      await this.focused(c,t,epoch);
    };
    const save=async(view:AutomationView)=>{
      await chrome.storage.session.set({[journalKey(t.id)]:{active:view.active,tabId:t.id,
        phase:view.phase,accepted:view.accepted,aiCalls:view.aiCalls,runId:view.id,
        submitted:[...(this.submitted.get(t.id)||[])]}});this.progress(c);
    };
    const run:AleksAutomation=new AleksAutomation(command.limits,{
      now:()=>Date.now(),solve:async()=>{await ensure();return this.solve(c,epoch,false,expectedFingerprint);},
      submit:async proposal=>{
        await ensure();
        const ledger=this.submitted.get(t.id)||new Set<string>();
        if(ledger.has(proposal.context.fingerprint))throw Error('No se repetirá una entrega anterior.');
        ledger.add(proposal.context.fingerprint);this.submitted.set(t.id,ledger);
        await save(run.view);await ensure();
        return this.deps.deliver(t.id,'automationSubmit',{
        fingerprint:proposal.context.fingerprint,value:proposal.context.fields.length===2?proposal.result.proposal.answers:proposal.result.proposal.answers[0].value,runId:run.view.id},current);},
      next:async()=>{
        await ensure();await this.deps.send(t.id,'automationNext',{runId:run.view.id},current);await ensure();
        const next=await this.read(c,epoch);
        if(next.fingerprint===expectedFingerprint)throw Error('El avance no confirmó un ejercicio nuevo. No se repetirá la consulta.');
        expectedFingerprint=next.fingerprint;
      },
      cancel:()=>this.cancelOperations(c),
      save
    },seed);
    this.assert(c,epoch);c.run=run;c.proposal=undefined;
    this.deps.setNative(t.id,true);
    try {
      await save(run.view);
      await this.deps.send(t.id,'automationReset',{runId:run.view.id},current);this.assert(c,epoch);
      const driving=this.drive(c,epoch,run);c.driving=driving;
      void driving.finally(()=>{if(c.driving===driving)c.driving=undefined;});
      return {automation:run.view};
    } catch(error) {await run.stop('No se pudo preparar el recorrido. No se inició ninguna entrega.');throw error;}
  }
  private async drive(c:Connection,epoch:number,run:AleksAutomation) {
    try {while(c.alive && c.epoch===epoch && run.view.active){await this.session(c);await run.step();this.progress(c);}}
    catch(error){await run.stop(error instanceof Error?error.message:'El recorrido se interrumpió.');}
    finally{if(c.run===run && c.tab && this.tabs.get(c.tab.id)===c)this.deps.setNative(c.tab.id,false);this.progress(c);}
  }
  private async cancelOperations(c:Connection) {
    for(const controller of c.http)controller.abort();
    c.http.clear();c.remote=undefined;c.proposal=undefined;
    if(c.tab){this.deps.setNative(c.tab.id,false);await this.deps.cancel(c.tab.id).catch(()=>{});}
    if(c.token)await this.request(c,'/jobs','DELETE').catch(()=>{});
  }
  private async stop(c:Connection,reason:string) {c.epoch++;if(c.run)await c.run.stop(reason);await this.cancelOperations(c);await c.driving;this.progress(c);}
  private async disconnect(c:Connection,reason:string) {
    if(!c.alive)return;c.alive=false;c.epoch++;
    await this.stop(c,reason);if(c.tab)this.tabs.delete(c.tab.id);c.token=undefined;
    this.connections.delete(c);try{c.port.disconnect();}catch{}
    if(!this.connections.size){clearInterval(this.heartbeat);this.heartbeat=undefined;void chrome.alarms?.clear('aleks-web-watchdog');}
  }
  private async pulse() {
    for(const c of this.connections) {
      const epoch=c.epoch;
      try {await chrome.runtime.getPlatformInfo();await this.session(c);c.lastPulse=Date.now();}
      catch {if(c.epoch===epoch)void this.disconnect(c,'La sesión o la conexión dejó de estar disponible.');}
    }
  }
  private async execute(c:Connection,command:Command,epoch:number):Promise<unknown> {
    this.assert(c,epoch);
    if(command.command==='stop'){await this.stop(c,'Recorrido detenido desde la web.');return this.view(c);}
    if(command.command==='unlink'){
      await this.stop(c,'Vinculación cerrada.');if(c.tab)this.tabs.delete(c.tab.id);
      c.token=undefined;c.tab=undefined;c.context=undefined;c.proposal=undefined;c.run=undefined;
      return {connected:false};
    }
    if(command.command==='connect') {
      if(c.token)throw Error('La conexión ya está vinculada.');
      if(!await chrome.permissions.contains({origins:[this.origin+'/*']}))throw Error('Autoriza el servidor web desde el panel de la extensión.');
      c.token=command.token;await this.session(c);this.assert(c,epoch);return this.view(c);
    }
    await this.session(c);this.assert(c,epoch);
    if(command.command==='list')return (await chrome.tabs.query({})).filter(t=>t.id!==undefined && t.url && ALEKS_ORIGINS.includes(new URL(t.url).origin))
      .map(t=>({id:t.id,title:t.title||'ALEKS',active:Boolean(t.active)}));
    if(command.command==='bind') {
      if(c.tab){await this.stop(c,'Se cambió la pestaña vinculada.');epoch=c.epoch;}
      const t=await this.deps.tab(command.tabId);
      if(!ALEKS_ORIGINS.includes(new URL(t.url).origin) || this.deps.legacyBusy(t.id) || (this.tabs.has(t.id) && this.tabs.get(t.id)!==c))throw Error('La pestaña no está disponible para esta vinculación.');
      this.assert(c,epoch);
      if(c.tab)this.tabs.delete(c.tab.id);c.tab=t;c.context=undefined;c.proposal=undefined;c.run=undefined;this.tabs.set(t.id,c);
      await this.deps.attach(t.id);this.assert(c,epoch);return this.view(c);
    }
    if(command.command==='read'){c.proposal=undefined;return {context:await this.read(c,epoch)};}
    if(command.command==='preview'){if(c.run?.view.active)throw Error('Detén el recorrido antes de consultar.');return {proposal:await this.solve(c,epoch,command.includeImage===true)};}
    if(command.command==='start')return this.start(c,command,epoch);
    if(command.command==='status')return this.view(c);
    throw Error('Comando no admitido.');
  }
}
