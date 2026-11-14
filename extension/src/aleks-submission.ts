import { sameAnswer } from './answer-format';
import { assistContext,fillAssistAnswer,type FieldAnswer,type NativeInput } from './aleks-assist';
import { answerUnit } from './answer-units';
import { answerRoots } from './aleks-two-editors';
import { inspectEditorRoot } from './aleks-single-editor';
import { inspectAleksEditor } from './aleks-editor';
import { readAleksPrompt } from './aleks-prompt';
import { visible,disabled } from './aleks-dom';
import { resolveAleksRoute,type AleksRouteObservation } from './aleks-route';

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

/** Una entrega y un avance como máximo, con un clic de continuación de ruta
 * si aparece la pantalla de fin de tema. El resultado se vincula al enunciado
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
  private routeScreenClear() {
    const selectors=['#algoPrompt','#result_feedback_alert',NEXT,...SUBMITS.map(([selector])=>selector)];
    const occupied=(element:HTMLElement)=>{
      if(!visible(element))return false;
      // Un contenedor vacío sin superficie no representa un enunciado activo.
      if(element.id==='algoPrompt' && !element.childElementCount && !element.textContent?.trim()) {
        return [...element.getClientRects()].some(rect=>rect.width>0 && rect.height>0);
      }
      return true;
    };
    if(selectors.some(selector=>[...this.document.querySelectorAll<HTMLElement>(selector)].some(occupied)))return false;
    return ![...this.document.querySelectorAll<HTMLElement>('.ansed_root')].some(root=>
      visible(root) && Boolean(root.querySelector('input.ansed_input')));
  }
  private routeFailure(observation:AleksRouteObservation) {
    if(observation.status==='disabled')return 'El botón «Continuar en Mi ruta» sigue deshabilitado. No se pulsó; revisa ALEKS.';
    if(observation.labelCount && !observation.controlCount)return 'Se encontró «Continuar en Mi ruta», pero falta un elemento botón reconocible que lo contenga. No se hizo clic.';
    if(observation.controlCount && !observation.markerCount)return 'Se encontró «Continuar en Mi ruta», pero no el marcador «Temas restantes». No se pudo confirmar la pantalla de fin de tema.';
    if(observation.markerCount && !observation.labelCount)return 'Se encontró «Temas restantes», pero no el botón visible «Continuar en Mi ruta». Revisa ALEKS.';
    return 'La pantalla de fin de tema conserva un ejercicio, resultado o control incompatible. No se pulsó «Continuar en Mi ruta».';
  }
  async submit(fingerprint:string,value:string|FieldAnswer[],signal:AbortSignal,nativeInput?:NativeInput):Promise<{status:'accepted'}> {
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
      const pair=Array.isArray(value);
      const ordered=answerRoots(this.document),inputs=ordered.map(root=>root.querySelector('input.ansed_input'));
      if(roots.length!==(pair?value.length:1))throw Error('No hay un único recuadro reconocido para esta entrega.');
      const root=roots[0],fixedUnit=inspectAleksEditor(this.document).singleEditor.readback.fixed_unit;
      await fillAssistAnswer(this.document,fingerprint,value,signal,nativeInput);this.check(signal,generation);
      await this.samePrompt(prompt,read.fingerprint,signal,generation);
      const editor=inspectAleksEditor(this.document);
      const freshTargets=SUBMITS.flatMap(([selector,label])=>buttons(this.document,selector,[label]));
      const valid=Array.isArray(value)?ordered.every((node,i)=>{
        const field=inspectEditorRoot(node),current=answerRoots(this.document);
        return current.length===ordered.length && current[i]===node && node.querySelector('input.ansed_input')===inputs[i] && document.activeElement===inputs.at(-1) && field.status==='observed' && !field.disabled && field.readback.status==='readable' &&
          sameAnswer(field.readback.value,value.find(answer=>answer.field_key===(ordered.length===1?'answer':`field_${i+1}`))?.value) && !field.readback.fixed_unit && field.readback.selected_unit===answerUnit(value.find(answer=>answer.field_key===(ordered.length===1?'answer':`field_${i+1}`))?.unit || '');
      }):editor.singleEditor.status==='observed' && !editor.singleEditor.disabled && editor.singleEditor.readback.status==='readable' &&
        sameAnswer(editor.singleEditor.readback.value,value) && !editor.singleEditor.readback.selected_unit && editor.singleEditor.readback.fixed_unit===fixedUnit;
      if(!root.isConnected || !visible(root) || !valid ||
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
      if(resolveAleksRoute(this.document).observation.labelCount)throw Error('«Continuar en Mi ruta» ya estaba visible antes del avance; no se puede asociar esa pantalla a esta respuesta.');
      this.check(signal,generation);pending.next.click();
      let deadline=Date.now()+this.timeout,routeClicked=false;
      let lastRoute:AleksRouteObservation|undefined;
      while(Date.now()<deadline) {
        this.check(signal,generation);
        const prompt=await readAleksPrompt(this.document);this.check(signal,generation);
        if(Date.now()>=deadline)break;
        const route=resolveAleksRoute(this.document);lastRoute=route.observation;
        if(route.observation.labelCount && route.observation.status==='ambiguous')throw Error('Hay varios controles o marcadores de continuación de ruta. Se detuvo el avance sin elegir uno.');
        if(route.observation.labelCount) {
          if(!routeClicked && route.control && route.marker && this.routeScreenClear()) {
            // Exigir que los mismos nodos sigan disponibles tras un turno del
            // navegador. Cancelar o reemplazar el control no dispara un clic.
            await delay();this.check(signal,generation);
            if(Date.now()>=deadline)throw Error('Se agotó el tiempo para confirmar «Continuar en Mi ruta». No se pulsó el botón.');
            const current=resolveAleksRoute(this.document);
            if(current.control!==route.control || current.marker!==route.marker || !this.routeScreenClear()) {
              throw Error('La pantalla o el botón «Continuar en Mi ruta» cambiaron antes del clic. Se detuvo el avance.');
            }
            this.check(signal,generation);routeClicked=true;route.control.click();this.check(signal,generation);
            // Dos esperas acotadas: llegar a la pantalla y abrir el ejercicio.
            // El coordinador conserva además el límite global del recorrido.
            deadline=Date.now()+this.timeout;
          }
        } else if(prompt.status==='readable' && prompt.fingerprint && prompt.fingerprint!==pending.fingerprint && !alerts(this.document).length) {
          const context=await assistContext(this.document);this.check(signal,generation);
          if(resolveAleksRoute(this.document).observation.labelCount)continue;
          const editor=inspectAleksEditor(this.document);
          if((context.can_fill_integer || context.can_fill_fraction) && answerRoots(this.document).every(root=>inspectEditorRoot(root).readback.status==='empty')) {this.phase='idle';return;}
          if(editor.singleEditor.status==='observed' && editor.singleEditor.readback.status==='empty' && !editor.resultMarker.positiveMessageCount && !editor.nextControl.count && !editor.nextTopicControl.count) {
            // Un nuevo ejercicio visual también puede terminar el avance. El
            // coordinador decide si su formato admite otra entrega.
            this.phase='idle';return;
          }
        }
        await delay();this.check(signal,generation);
      }
      if(routeClicked)throw Error('Se pulsó «Continuar en Mi ruta» una vez, pero no se reconoció otro ejercicio vacío. No se repetirá el clic; revisa ALEKS.');
      if(lastRoute && (lastRoute.labelCount || lastRoute.markerCount))throw Error(this.routeFailure(lastRoute));
      throw Error('Se pulsó Siguiente una vez, pero no se reconoció otro ejercicio vacío. Puede haber terminado la actividad; revisa ALEKS.');
    } catch(error) {if(generation===this.generation)this.phase='failed';throw error;}
  }
}
