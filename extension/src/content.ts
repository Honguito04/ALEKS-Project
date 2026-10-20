import { Controller } from './controller';
import { SimulatorAdapter, PendingAleksAdapter } from './adapters';
import { simulatorURL, type Limits, type Run, limitsSchema } from './shared';

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
  let busy=false;
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
      if(message.type==='status') return {detection:await adapter.detect(),run:controller.run,exercise:controller.exercise,solution:controller.solution};
      if(message.type==='pause') {await controller.pause();return true;}
      if(message.type==='stop') {await controller.stop();return true;}
      if(busy) throw Error('Ya hay una operación en curso');
      busy=true;
      try {
        if(message.type==='start') await controller.start(limitsSchema.parse(message.limits) as Limits,message.authorization);
        else if(message.type==='resume') await controller.resume();
        else throw Error('Comando de adaptador desconocido');
        return true;
      } finally {busy=false;}
    })().then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message}));
    return true;
  });
}
