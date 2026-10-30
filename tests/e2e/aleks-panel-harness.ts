/** APIs de Chrome simuladas; usa UI, contexto y escritor de producción.
 * No prueba carga nativa ni ejecuta un modelo real. */
import './aleks-probe-harness';
import { captureFillPolicy,requireAssistImage } from '../../extension/src/assist-readiness';
import { assistResultSchema } from '../../extension/src/shared';
declare global {interface Window {
  testAssistResult?:Record<string,unknown>;
  testNativeKeyboard?:boolean;
  testNativeKeyboardError?:string;
  testPanelMessages:Record<string,unknown>[];
}}
let context:Awaited<ReturnType<typeof window.assistContext>>;
window.testPanelMessages=[];
Object.defineProperty(globalThis,'chrome',{configurable:true,value:{
  permissions:{contains:async()=>true},
  runtime:{sendMessage:async(message:Record<string,unknown>)=>{
    window.testPanelMessages.push(message);
    try {
      let data:unknown;
      if(message.type==='health')data={status:'ok',ai_configured:true,google_configured:false,ai_provider:'ollama'};
      else if(message.type==='session')data={mode:'demo'};
      else if(message.type==='tabs')data=[{id:7,title:'Ejercicio de prueba',url:'https://latam-awu.aleks.com/exercise-fixture'}];
      else if(message.type==='attach' || message.type==='status')data={detection:{...await window.pendingAdapter.detect(),origin:'https://latam-awu.aleks.com'},nativeKeyboard:window.testNativeKeyboard===true};
      else if(message.type==='nativeKeyboard') {
        if(window.testNativeKeyboardError)throw Error(window.testNativeKeyboardError);
        window.testNativeKeyboard=message.enabled===true;data=window.testNativeKeyboard;
      }
      else if(message.type==='localAIStatus')data={configured:true,online:true,model_installed:true,model:'test-model'};
      else if(message.type==='assist') {
        const hasImage=message.includeImage===true || typeof message.image==='string';
        context=requireAssistImage(await window.assistContext(document,hasImage),message.needsImage===true);
        if(context.diagram_required && !hasImage)throw Error('No se debe consultar sin la imagen necesaria');
        const result=assistResultSchema.parse({fingerprint:context.fingerprint,provider:'ollama',provider_calls:1,verified:false,model:'test-model',verification:'none',
          proposal:{status:'proposed',answers:[{field_key:'answer',value:'12',unit:''}],explanation:'Propuesta sintética para probar la UI.',missing_information:[]},...window.testAssistResult});
        data={id:'test-proposal',context:captureFillPolicy(context,result,hasImage),result};
      } else if(message.type==='assistFill')data=await window.fillAssistInteger(document,context.fingerprint,'12',new AbortController().signal);
      else throw Error('Comando no simulado');
      return {ok:true,data};
    }catch(error){return {ok:false,error:(error as Error).message};}
  }}
}});
void import('../../extension/src/ui');
