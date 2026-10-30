import { Controller } from './controller';
import { SimulatorAdapter, PendingAleksAdapter } from './adapters';
import { simulatorURL, type Limits, type Run, limitsSchema } from './shared';
import { AleksSubmission } from './aleks-submission';
import { editorDiagnostics } from './editor-diagnostics';
import { assistContext,fillAssistAnswer,type NativeInput } from './aleks-assist';

declare global { interface Window { __mathAssistantLoaded?:boolean } }
if(!window.__mathAssistantLoaded) {
  window.__mathAssistantLoaded=true;
  const adapter=simulatorURL(location.href) ? new SimulatorAdapter():new PendingAleksAdapter();
  async function rpc(type:string,data:Record<string,unknown>={}) {
    const result=await chrome.runtime.sendMessage({scope:'content',type,...data});
    if(!result?.ok) throw Error(result?.error || 'La extensión no respondió');
    return result.data;
  }
  const controller=new Controller(adapter,{
    save:run=>rpc('save',{run}),permitted:()=>rpc('permitted'),now:()=>Date.now(),
    solve:async(exercise,allowAI,signal)=>{
      signal.throwIfAborted();
      const result=await rpc('solve',{exercise,allowAI});signal.throwIfAborted();return result;
    }
  });
  const submission=new AleksSubmission(document);
  let busy=false;
  let assistAbort:AbortController|undefined;
  let automationId:string|undefined;
  let nativeGuard:{id:string;check:()=>Promise<void>}|undefined;
  function nativeWriter(id:unknown):NativeInput|undefined {
    if(id===undefined)return;
    if(typeof id!=='string')throw Error('Escritura de teclado inválida');
    return async check=>{
      nativeGuard={id,check};
      try{await rpc('nativeType',{writeId:id});}finally{nativeGuard=undefined;}
    };
  }
  const initialized=(async()=>{
    if(simulatorURL(location.href)) {
      const saved:Run|undefined=await rpc('load');
      if(saved) await controller.recover(saved);
    }
  })();
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id || message?.scope!=='adapter') return;
    void (async()=>{
      await initialized;
      if(message.type==='nativeGuard') {
        if(!nativeGuard || nativeGuard.id!==message.writeId)throw Error('No hay una escritura de teclado vigente.');
        await nativeGuard.check();return true;
      }
      if(message.type==='status') return {detection:await adapter.detect(),run:controller.run,exercise:controller.exercise,solution:controller.solution};
      if(message.type==='editorDiagnostics' && !simulatorURL(location.href))return editorDiagnostics(document);
      if(message.type==='assistContext' && !simulatorURL(location.href))return assistContext(document,message.allowImage===true);
      if(message.type==='pause') {automationId=undefined;nativeGuard=undefined;assistAbort?.abort();submission.reset();await controller.pause();return true;}
      if(message.type==='stop') {automationId=undefined;nativeGuard=undefined;assistAbort?.abort();submission.reset();await controller.stop();return true;}
      if(busy) throw Error('Ya hay una operación en curso');
      busy=true;
      try {
        if(message.type==='automationReset' && !simulatorURL(location.href)) {
          if(typeof message.runId!=='string')throw Error('Recorrido inválido');
          submission.reset();automationId=message.runId;return true;
        }
        if(message.type==='automationSubmit' && !simulatorURL(location.href)) {
          if(!automationId || message.runId!==automationId)throw Error('Recorrido detenido o reemplazado.');
          if(typeof message.fingerprint!=='string' || typeof message.value!=='string')throw Error('Propuesta inválida');
          assistAbort=new AbortController();return await submission.submit(message.fingerprint,message.value,assistAbort.signal,nativeWriter(message.nativeWriteId));
        }
        if(message.type==='automationNext' && !simulatorURL(location.href)) {
          if(!automationId || message.runId!==automationId)throw Error('Recorrido detenido o reemplazado.');
          assistAbort=new AbortController();await submission.next(assistAbort.signal);return true;
        }
        if(message.type==='assistFill' && !simulatorURL(location.href)) {
          if(typeof message.fingerprint!=='string' || typeof message.value!=='string')throw Error('Propuesta inválida');
          assistAbort=new AbortController();return await fillAssistAnswer(document,message.fingerprint,message.value,assistAbort.signal,nativeWriter(message.nativeWriteId));
        }
        else if(message.type==='start') await controller.start(limitsSchema.parse(message.limits) as Limits,message.authorization);
        else if(message.type==='resume') await controller.resume();
        else throw Error('Comando de adaptador desconocido');
        return true;
      } finally {busy=false;assistAbort=undefined;}
    })().then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message}));
    return true;
  });
}
