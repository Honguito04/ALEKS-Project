import { BACKEND, ALEKS, exerciseSchema, type Adapter, type Exercise, type Detection, type Feedback } from './shared';
import { inspectAleksEditor } from './aleks-editor';

function assertSignal(signal:AbortSignal) { signal.throwIfAborted(); }
async function waitFor<T>(read:()=>T|undefined,signal:AbortSignal,timeout=8000):Promise<T> {
  const started=Date.now();
  while(Date.now()-started<timeout) {
    assertSignal(signal);const value=read();if(value!==undefined) return value;
    await new Promise<void>((resolve,reject)=>{
      const cancel=()=>{clearTimeout(timer);reject(new DOMException('Cancelado','AbortError'));};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},80);
      signal.addEventListener('abort',cancel,{once:true});
    });
  }
  throw Error('No se observó confirmación de la plataforma dentro del plazo');
}

export class SimulatorAdapter implements Adapter {
  private prepared?:{fingerprint:string;answer:string;unit:string};
  private root() {
    if(location.origin!==BACKEND || !location.pathname.startsWith('/simulator')) throw Error('Dominio fuera de la autorización');
    const root=document.querySelector<HTMLElement>('#exercise');
    if(!root) throw Error('El simulador todavía no está listo');return root;
  }
  async detect():Promise<Detection> {
    const r=this.root();return {origin:location.origin,activity:r.dataset.activity || '',session:r.dataset.session==='true',
      complete:r.dataset.complete==='true',human:r.dataset.human==='true',supported:true};
  }
  async read():Promise<Exercise> {
    const r=this.root();
    if(!r.dataset.fingerprint || !r.dataset.payload) throw Error('El ejercicio todavía no está listo');
    const exercise=exerciseSchema.parse(JSON.parse(r.dataset.payload));
    if(exercise.source!=='simulator' || exercise.activity_id!==r.dataset.activity || exercise.fingerprint!==r.dataset.fingerprint) throw Error('Lectura inconsistente');
    if(document.querySelector('#statement')?.textContent!==exercise.statement) throw Error('El enunciado visible no coincide con la representación');
    const canonical=JSON.stringify([exercise.activity_id,exercise.statement,exercise.math,exercise.fields,exercise.choices,exercise.domain,exercise.units,exercise.format,exercise.decimal_places]);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==exercise.fingerprint) throw Error('La huella no coincide con el contenido del ejercicio');
    return exercise;
  }
  private async same(exercise:Exercise,signal:AbortSignal) {
    assertSignal(signal);const current=await this.read();assertSignal(signal);
    const d=await this.detect();assertSignal(signal);
    if(!d.session || d.human || current.fingerprint!==exercise.fingerprint || current.activity_id!==exercise.activity_id) throw Error('La página cambió antes de escribir o enviar');
  }
  async write(exercise:Exercise,answer:string,signal:AbortSignal) {
    this.prepared=undefined;
    await this.same(exercise,signal);
    if(exercise.fields[0].kind==='text' || exercise.fields[0].kind==='quantity') {
      const input=document.querySelector<HTMLInputElement>('#answer');
      if(!input || input.type!=='text') throw Error('Este editor matemático todavía no es compatible');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,answer);
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      if(input.value!==answer) throw Error('El campo no conservó la respuesta');
      if(exercise.fields[0].kind==='quantity') {
        const select=document.querySelector<HTMLSelectElement>('#answer-unit');
        if(!select || ![...select.options].some(o=>o.value===exercise.units)) throw Error('El selector no admite la unidad de volumen verificada');
        select.value=exercise.units;
        select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
        if(select.value!==exercise.units) throw Error('La unidad no quedó seleccionada');
      }
    } else {
      const radio=[...document.querySelectorAll<HTMLInputElement>('input[name="answer"][type="radio"]')].find(r=>r.value===answer);
      if(!radio || !exercise.choices.some(c=>c.id===answer)) throw Error('No se pudo localizar la alternativa verificada');
      radio.click();if(!radio.checked) throw Error('La alternativa no quedó seleccionada');
    }
    await waitFor(()=>{
      const reflected=document.querySelector<HTMLOutputElement>('#reflected');
      return reflected?.textContent===answer && (exercise.fields[0].kind!=='quantity' || reflected.dataset.unit===exercise.units) ? true:undefined;
    },signal,1000);
    assertSignal(signal);this.prepared={fingerprint:exercise.fingerprint,answer,unit:exercise.fields[0].kind==='quantity' ? exercise.units:''};
  }
  async submit(exercise:Exercise,operation:string,signal:AbortSignal) {
    await this.same(exercise,signal);assertSignal(signal);
    const button=document.querySelector<HTMLButtonElement>('#submit-answer');
    const prepared=this.prepared;
    if(!prepared || prepared.fingerprint!==exercise.fingerprint) throw Error('No hay una respuesta preparada para este ejercicio');
    const currentAnswer=exercise.fields[0].kind==='radio' ? document.querySelector<HTMLInputElement>('input[name="answer"]:checked')?.value:document.querySelector<HTMLInputElement>('#answer')?.value;
    const reflected=document.querySelector<HTMLOutputElement>('#reflected');
    if(currentAnswer!==prepared.answer || reflected?.textContent!==prepared.answer) throw Error('La respuesta cambió antes del envío');
    if(exercise.fields[0].kind==='quantity' && (document.querySelector<HTMLSelectElement>('#answer-unit')?.value!==prepared.unit || reflected?.dataset.unit!==prepared.unit)) throw Error('La unidad cambió antes del envío');
    if(!button || button.disabled) throw Error('El control de envío no está disponible');
    this.prepared=undefined;this.root().dataset.operation=operation;button.click();
  }
  async result(fingerprint:string,signal:AbortSignal):Promise<Feedback> {
    try {
      return await waitFor(()=>{
        const f=document.querySelector<HTMLElement>('#feedback');
        if(f?.dataset.fingerprint===fingerprint && ['accepted','rejected'].includes(f.dataset.status || '')) return {status:f.dataset.status as 'accepted'|'rejected',fingerprint};
        return undefined;
      },signal,4000);
    } catch(error) {assertSignal(signal);return {status:'unknown',fingerprint};}
  }
  async next(signal:AbortSignal) {
    assertSignal(signal);const previous=this.root().dataset.fingerprint;
    const button=document.querySelector<HTMLButtonElement>('#next-exercise');
    if(!button || button.hidden || button.disabled) throw Error('No se encuentra el control de avance');
    button.click();await waitFor(()=>{
      const r=this.root();return r.dataset.complete==='true' || (r.dataset.fingerprint && r.dataset.fingerprint!==previous) ? true:undefined;
    },signal);
  }
}

export class PendingAleksAdapter implements Adapter {
  async detect():Promise<Detection> {
    const editorObservation=inspectAleksEditor(document);
    const description={
      observed:'Se identificaron el editor numérico y el botón de centímetros cúbicos. ',
      missing:'No se encuentran todos los controles del fragmento de editor observado. ',
      ambiguous:'Hay varios editores o botones de unidad; no se puede identificar uno sin ambigüedad. ',
      disabled:'El editor o el botón de unidad están deshabilitados. '
    }[editorObservation.status];
    const readback=editorObservation.renderedAnswer.status==='readable' ? `Respuesta visible: ${editorObservation.renderedAnswer.display}. `:'';
    const submit=editorObservation.submitControl.status==='observed' ? 'Botón Entregar identificado. ':'';
    const next=editorObservation.nextControl.status==='observed' ? 'Botón Siguiente identificado; no se ha confirmado el resultado del ejercicio. ':'';
    const result=editorObservation.resultMarker.status==='positive_marker' ? 'Señal positiva observada: Correcta y Siguiente. Aún no está asociada a una entrega de la extensión. ':'';
    return {origin:ALEKS,activity:'sin-validar',session:false,complete:false,human:false,supported:false,
      editorObservation,
      reason:description+readback+submit+result+(result?'':next)+'Inspección de solo lectura: faltan validar la lectura de actividad/enunciado, la interacción con el editor y la asociación de cada resultado a su entrega. La sesión y los envíos reales siguen sin habilitar.'};
  }
  private unavailable():never {throw Error('Adaptador ALEKS pendiente de validación con la interfaz autenticada');}
  async read():Promise<Exercise> {return this.unavailable();}
  async write() {this.unavailable();}
  async submit() {this.unavailable();}
  async result():Promise<Feedback> {return this.unavailable();}
  async next() {this.unavailable();}
}
