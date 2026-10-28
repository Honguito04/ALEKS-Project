/** Panel y coordinadores reales, puente Chrome y proveedor de IA sintéticos.
 * No carga una extensión nativa ni contacta ALEKS u Ollama. */
import { editorDiagnostics } from '../../extension/src/editor-diagnostics';
import { AleksAutomation,automationLimitsSchema } from '../../extension/src/aleks-automation';
import { AleksSubmission } from '../../extension/src/aleks-submission';
import { assistContext } from '../../extension/src/aleks-assist';
import { PendingAleksAdapter } from '../../extension/src/adapters';
import { assistResultSchema,type AssistView } from '../../extension/src/shared';

declare global {interface Window {
  automationTest:{fraction:boolean;holdSolve:boolean;feedback:'correct'|'incorrect';solves:number;submits:number;nexts:number;releaseSolve?:()=>void};
}}
const metrics=window.automationTest={fraction:false,holdSolve:false,feedback:'correct' as 'correct'|'incorrect',solves:0,submits:0,nexts:0,releaseSolve:undefined as undefined|(()=>void)};
const adapter=new PendingAleksAdapter(),submission=new AleksSubmission(document,800);
let automation:AleksAutomation|undefined,abort=new AbortController(),proposal:AssistView|undefined;
const status=async()=>({detection:{...await adapter.detect(),origin:'https://latam-awu.aleks.com'},automation:automation?.view});
async function solve():Promise<AssistView> {
  metrics.solves++;
  const context=await assistContext(document);
  if(metrics.holdSolve)await new Promise<void>(resolve=>{metrics.releaseSolve=resolve;});
  return {id:crypto.randomUUID(),context,result:assistResultSchema.parse({fingerprint:context.fingerprint,provider:'ollama',provider_calls:1,
    model:'synthetic-model',verified:false,verification:'none',proposal:{status:'proposed',answers:[{field_key:'answer',value:metrics.fraction?'1/5':metrics.nexts?'20':'12',unit:''}],
      explanation:'Propuesta sintética para comprobar el recorrido del panel.',missing_information:[]}})};
}
const input=document.querySelector<HTMLInputElement>('input.ansed_input')!,verify=document.querySelector<HTMLButtonElement>('.checkAnswer')!;
input.addEventListener('input',()=>{
  const glyph=document.createElement('span');glyph.className='AnsedObject';glyph.textContent=input.value;
  glyph.style.cssText='position:absolute;font:18px serif;left:2px;top:3px;height:24px';
  if(metrics.fraction){
    const denominator=glyph.cloneNode(true) as HTMLElement;glyph.textContent='1';denominator.textContent='5';denominator.style.top='32px';
    document.querySelector<HTMLElement>('.ansed_root')!.style.height='65px';document.querySelector<HTMLElement>('.ansed_tree')!.style.height='65px';
    document.querySelector('.ansed_tree')!.replaceChildren(glyph,denominator);
  }else document.querySelector('.ansed_tree')!.replaceChildren(glyph);input.value='';
});
verify.addEventListener('click',()=>{
  metrics.submits++;verify.remove();
  const feedback=document.createElement('div');feedback.id='result_feedback_alert';feedback.setAttribute('aria-live','polite');
  feedback.style.cssText='display:inline-block;border:1px solid rgb(57,108,41)';
  feedback.innerHTML=`<div style="display:inline-block;color:rgb(57,108,41)">${metrics.feedback==='correct'?'Correcta':'Incorrecta'}</div>`;
  document.body.append(feedback);
  if(metrics.feedback==='incorrect')return;
  const next=document.createElement('button');next.type='button';next.id='smt_bottomnav_button_input_learningCorrect';next.className='learningCorrect';
  next.innerHTML='<div><div class="textContent">Siguiente tema</div></div>';
  next.addEventListener('click',()=>{
    metrics.nexts++;document.querySelector('#algoPrompt')!.textContent=`Hay ${4+metrics.nexts} nadadores en una carrera. Hay premios para un primer lugar y un segundo lugar. ¿De cuántas maneras distintas se pueden otorgar los 2 premios?`;
    document.querySelector('.ansed_tree')!.replaceChildren();feedback.remove();next.remove();document.body.append(verify);
  });
  document.body.append(next);
});
Object.defineProperty(globalThis,'chrome',{configurable:true,value:{
  permissions:{contains:async()=>true},
  runtime:{sendMessage:async(message:Record<string,unknown>)=>{
    try {
      let data:unknown;
      if(message.type==='health')data={status:'ok',ai_configured:true,google_configured:false,ai_provider:'ollama'};
      else if(message.type==='session')data={mode:'demo'};
      else if(message.type==='tabs')data=[{id:7,title:'Ejercicio de recorrido sintético',url:'https://latam-awu.aleks.com/fixture'}];
      else if(message.type==='attach' || message.type==='status')data=await status();
      else if(message.type==='editorDiagnostics')data=editorDiagnostics(document);
      else if(message.type==='localAIStatus')data={configured:true,online:true,model_installed:true,model:'synthetic-model'};
      else if(message.type==='assist')data=proposal=await solve();
      else if(message.type==='automationStart') {
        if(automation?.view.active)throw Error('Ya existe un recorrido activo.');
        submission.reset();abort=new AbortController();
        automation=new AleksAutomation(automationLimitsSchema.parse(message.limits),{
          now:Date.now,solve,
          submit:proposal=>submission.submit(proposal.context.fingerprint,proposal.result.proposal.answers[0].value,abort.signal),
          next:()=>submission.next(abort.signal),
          cancel:async()=>{abort.abort();submission.reset();},save:async()=>{}
        },message.proposalId===proposal?.id?proposal:undefined);
        data=automation.view;
      } else if(message.type==='automationStep') {
        if(!automation || automation.view.id!==message.runId)throw Error('Recorrido no vigente.');
        data=await automation.step();
      } else if(message.type==='automationStop')data=await automation?.stop();
      else throw Error('Comando no simulado');
      return {ok:true,data};
    } catch(error){return {ok:false,error:(error as Error).message};}
  }}
}});
void import('../../extension/src/ui');
