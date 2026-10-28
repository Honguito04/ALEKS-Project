import { assistContext,fillAssistAnswer } from './aleks-assist';
import { inspectAleksEditor } from './aleks-editor';
import { readAleksPrompt } from './aleks-prompt';
import { visible,disabled } from './aleks-dom';

const SUBMITS=[
  ['button#smt_bottomnav_button_input_checkAnswer.checkAnswer[type="button"]','Verificar'],
  ['button#smt_bottomnav_button_input_nextItemAssess.nextItemAssess[type="button"]','Entregar']
] as const;
const NEXT='button#smt_bottomnav_button_input_learningCorrect.learningCorrect[type="button"]';
const delay=()=>new Promise(resolve=>setTimeout(resolve,50));

function buttons(document:Document,selector:string,labels:readonly string[]) {
  return [...document.querySelectorAll<HTMLButtonElement>(selector)].filter(button=>visible(button) &&
    button.querySelectorAll('div.textContent').length===1 && labels.includes(button.querySelector('div.textContent')?.textContent?.trim() || ''));
}
function alerts(document:Document) {
  return [...document.querySelectorAll<HTMLElement>('#result_feedback_alert')].filter(visible);
}

/** Una entrega y un avance como máximo. El resultado se vincula al enunciado
 * conservado y a un mensaje que aparece después de nuestro clic. Nunca deduce
 * aceptación de la ausencia del editor o de un botón «Siguiente» por sí solo.
 */
export class AleksSubmission {
  private phase:'idle'|'submitting'|'accepted'|'advancing'|'failed'='idle';
  private generation=0;
  private pending?:{fingerprint:string;prompt:HTMLElement;feedback:HTMLElement;next:HTMLButtonElement};
  constructor(private document:Document,private timeout=15_000) {}
  reset() {this.generation++;this.pending=undefined;this.phase='idle';}
  private check(signal:AbortSignal,generation:number) {
    signal.throwIfAborted();
    if(generation!==this.generation)throw Error('La operación de ALEKS fue detenida.');
  }
  private promptNode() {
    const nodes=[...this.document.querySelectorAll<HTMLElement>('#algoPrompt')].filter(visible);
    if(nodes.length!==1)throw Error('No hay un enunciado visible único.');
    return nodes[0];
  }
  private async samePrompt(prompt:HTMLElement,fingerprint:string,signal:AbortSignal,generation:number) {
    this.check(signal,generation);
    const current=await readAleksPrompt(this.document);this.check(signal,generation);
    if(this.promptNode()!==prompt || current.status!=='readable' || current.fingerprint!==fingerprint)throw Error('El ejercicio cambió durante la entrega. Revisa la plataforma antes de continuar.');
  }
  private nextButton() {
    const matches=buttons(this.document,NEXT,['Siguiente','Siguiente tema']);
    if(matches.length!==1 || disabled(matches[0]))return undefined;
    return matches[0];
  }
  private positiveFeedback() {
    const feedback=alerts(this.document),editor=inspectAleksEditor(this.document),next=this.nextButton();
    if(feedback.length!==1 || feedback[0].getAttribute('aria-live')!=='polite' || !next || editor.resultMarker.status!=='positive_marker')return undefined;
    const messages=[...feedback[0].querySelectorAll<HTMLElement>('div')].filter(node=>visible(node) &&
      node.childNodes.length===1 && node.firstChild?.nodeType===3 && node.textContent?.trim()==='Correcta');
    if(messages.length!==1)return undefined;
    return {feedback:feedback[0],next};
  }
  async submit(fingerprint:string,value:string,signal:AbortSignal):Promise<{status:'accepted'}> {
    if(this.phase!=='idle')throw Error('Esta entrega ya fue iniciada; no se vuelve a pulsar Verificar.');
    this.phase='submitting';const generation=this.generation;
    let feedbackObserver:MutationObserver|undefined;
    try {
      this.check(signal,generation);
      const prompt=this.promptNode(),read=await readAleksPrompt(this.document);this.check(signal,generation);
      if(read.status!=='readable' || !read.fingerprint)throw Error('No se puede identificar el enunciado de esta entrega.');
      if(alerts(this.document).length)throw Error('Ya existe un resultado visible. Lee el siguiente ejercicio antes de iniciar.');
      // Validar los controles antes de tocar el recuadro. Una duplicación no se
      // resuelve eligiendo el primer botón de la página.
      const targets=SUBMITS.flatMap(([selector,label])=>buttons(this.document,selector,[label]));
      if(targets.length!==1 || disabled(targets[0]))throw Error('No hay un único botón Verificar o Entregar habilitado.');
      const target=targets[0];
      const roots=[...this.document.querySelectorAll<HTMLElement>('.ansed_root')].filter(root=>visible(root) && !root.closest('#algoPrompt') && root.querySelector('input.ansed_input[aria-label="Answer Editor"]'));
      if(roots.length!==1)throw Error('No hay un único recuadro reconocido para esta entrega.');
      const root=roots[0];
      await fillAssistAnswer(this.document,fingerprint,value,signal);this.check(signal,generation);
      await this.samePrompt(prompt,read.fingerprint,signal,generation);
      const editor=inspectAleksEditor(this.document);
      const freshTargets=SUBMITS.flatMap(([selector,label])=>buttons(this.document,selector,[label]));
      if(!root.isConnected || !visible(root) || editor.singleEditor.status!=='observed' || editor.singleEditor.disabled ||
        editor.singleEditor.readback.status!=='readable' || editor.singleEditor.readback.value!==value ||
        freshTargets.length!==1 || freshTargets[0]!==target || disabled(target) || alerts(this.document).length ||
        editor.resultMarker.positiveMessageCount || editor.nextControl.count || editor.nextTopicControl.count)throw Error('El recuadro o los controles cambiaron antes de verificar. No se entregó la respuesta.');
      // Ocultar/mostrar un resultado antiguo no acredita otra entrega. Solo
      // admitimos un alert nuevo o con cambios de texto/hijos desde el clic.
      const previousAlerts=new Set(this.document.querySelectorAll<HTMLElement>('#result_feedback_alert'));
      const changedAlerts=new Set<HTMLElement>();
      const recordChanges=(records:MutationRecord[])=>{
        for(const record of records) {
          const element=record.target.nodeType===1?record.target as HTMLElement:record.target.parentElement;
          const alert=element?.closest<HTMLElement>('#result_feedback_alert');
          if(alert)changedAlerts.add(alert);
        }
      };
      feedbackObserver=new MutationObserver(recordChanges);
      feedbackObserver.observe(this.document,{subtree:true,childList:true,characterData:true});
      this.check(signal,generation);
      target.click();
      const deadline=Date.now()+this.timeout;
      while(Date.now()<deadline) {
        await this.samePrompt(prompt,read.fingerprint,signal,generation);
        const feedback=alerts(this.document);
        if(feedback.length>1)throw Error('Hay varios mensajes de resultado; no se puede confirmar la entrega.');
        if(feedback.some(node=>/\bincorrect[ao]\b|int[eé]ntalo de nuevo|vuelve a intentarlo/iu.test(node.textContent || '')))throw Error('ALEKS rechazó la respuesta. La ejecución se detuvo sin volver a enviarla.');
        recordChanges(feedbackObserver.takeRecords());
        const positive=this.positiveFeedback();
        if(positive && (!previousAlerts.has(positive.feedback) || changedAlerts.has(positive.feedback))) {
          this.pending={fingerprint:read.fingerprint,prompt,...positive};this.phase='accepted';
          return {status:'accepted'};
        }
        await delay();this.check(signal,generation);
      }
      throw Error('La respuesta se entregó, pero no apareció una confirmación nueva de Correcta con Siguiente. No se reintentará la entrega.');
    } catch(error) {if(generation===this.generation){this.phase='failed';this.pending=undefined;}throw error;}
    finally {feedbackObserver?.disconnect();}
  }
  async next(signal:AbortSignal):Promise<void> {
    if(this.phase!=='accepted' || !this.pending)throw Error('No hay una respuesta confirmada pendiente de avance.');
    this.phase='advancing';const generation=this.generation,pending=this.pending;this.pending=undefined;
    try {
      await this.samePrompt(pending.prompt,pending.fingerprint,signal,generation);
      const positive=this.positiveFeedback();
      if(!positive || positive.feedback!==pending.feedback || positive.next!==pending.next)throw Error('La confirmación o el botón Siguiente cambiaron; se detuvo el avance.');
      this.check(signal,generation);pending.next.click();
      const deadline=Date.now()+this.timeout;
      while(Date.now()<deadline) {
        this.check(signal,generation);
        const prompt=await readAleksPrompt(this.document);this.check(signal,generation);
        if(prompt.status==='readable' && prompt.fingerprint && prompt.fingerprint!==pending.fingerprint && !alerts(this.document).length) {
          const context=await assistContext(this.document);this.check(signal,generation);
          const editor=inspectAleksEditor(this.document);
          if((context.can_fill_integer || context.can_fill_fraction) && editor.singleEditor.readback.status==='empty') {this.phase='idle';return;}
          if(editor.singleEditor.status==='observed' && editor.singleEditor.readback.status==='empty' && !editor.resultMarker.positiveMessageCount && !editor.nextControl.count && !editor.nextTopicControl.count) {
            // Un nuevo ejercicio visual también puede terminar el avance. El
            // coordinador decide si su formato admite otra entrega.
            this.phase='idle';return;
          }
        }
        await delay();this.check(signal,generation);
      }
      throw Error('Se pulsó Siguiente una vez, pero no se reconoció otro ejercicio vacío. Puede haber terminado la actividad; revisa ALEKS.');
    } catch(error) {if(generation===this.generation)this.phase='failed';throw error;}
  }
}
