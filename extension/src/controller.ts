import { type Adapter, type Run, type State, type Exercise, type Solution, type Limits, limitsSchema, solutionSchema } from './shared';

export interface Services {
  save(run:Run):Promise<void>;
  solve(exercise:Exercise,allowAI:boolean,signal:AbortSignal):Promise<Solution>;
  permitted():Promise<boolean>;
  now():number;
}
const clone = <T>(x:T):T => structuredClone(x);
export class Controller {
  run?:Run;
  exercise?:Exercise;
  solution?:Solution;
  private abort?:AbortController;
  private task?:Promise<void>;
  private epoch=0;
  constructor(private adapter:Adapter,private services:Services) {}
  private async transition(state:State,message:string) {
    if(!this.run) return;
    this.run.state=state;this.run.message=message;
    this.run.events.push({at:this.services.now(),state,message});
    this.run.events=this.run.events.slice(-100);
    await this.services.save(clone(this.run));
  }
  private check(epoch:number,signal:AbortSignal) {
    if(signal.aborted || epoch!==this.epoch) throw new DOMException('Ejecución cancelada','AbortError');
    if(this.run && this.services.now()-this.run.started>=this.run.limits.maxMinutes*60_000) throw Error('Se alcanzó la duración máxima');
  }
  private async guard(epoch:number,signal:AbortSignal,exercise?:Exercise) {
    this.check(epoch,signal);
    if(!await this.services.permitted()) throw Error('Permiso revocado; ejecución detenida');
    const d=await this.adapter.detect();this.check(epoch,signal);
    if(!d.session) throw Error('Se perdió la sesión de la plataforma');
    if(d.human) throw Error('Verificación humana pendiente; resuélvela manualmente');
    if(!d.supported) throw Error(d.reason || 'Este editor todavía no es compatible');
    if(d.origin!==this.run!.origin || d.activity!==this.run!.activity) throw Error('Cambió el dominio o la actividad autorizada');
    if(exercise) {
      const current=await this.adapter.read();this.check(epoch,signal);
      if(current.fingerprint!==exercise.fingerprint || JSON.stringify(current.fields)!==JSON.stringify(exercise.fields)) throw Error('El ejercicio o sus campos cambiaron; respuesta invalidada');
    }
    return d;
  }
  async start(limits:Limits,authorization:{origin:string;activity:string}) {
    limits=limitsSchema.parse(limits);
    if(this.task || (this.run && !['INACTIVO','COMPLETADO','ERROR'].includes(this.run.state))) throw Error('Ya existe un trabajo en esta pestaña; detenlo antes de iniciar otro');
    const d=await this.adapter.detect();
    if(d.origin!==authorization.origin || d.activity!==authorization.activity) throw Error('La actividad cambió después de autorizarla');
    const ledger=this.run?.activity===d.activity ? clone(this.run.operations):{};
    this.run={id:crypto.randomUUID(),origin:d.origin,activity:d.activity,state:'INACTIVO',limits,started:this.services.now(),count:0,aiCalls:0,message:'Autorización de sesión registrada',operations:ledger,events:[]};
    await this.services.save(clone(this.run));
    this.launch();
  }
  private launch() {
    const epoch=++this.epoch;
    const abort=new AbortController();this.abort=abort;
    this.task=this.loop(epoch,abort.signal).catch(async error=>{
      if(epoch!==this.epoch || abort.signal.aborted) return;
      await this.transition('PAUSADO',error instanceof Error ? error.message : 'Fallo desconocido');
    }).finally(()=>{ if(epoch===this.epoch) this.task=undefined; });
  }
  async idle() { await this.task; }
  async pause() {
    ++this.epoch;this.abort?.abort();
    const pending=this.task;this.task=undefined;
    await this.transition('PAUSADO','Pausado por el usuario. No se efectuarán nuevos envíos.');
    // No esperamos a un proveedor remoto que ignore la cancelación.
    void pending;
  }
  async stop() {
    ++this.epoch;this.abort?.abort();this.task=undefined;
    await this.transition('INACTIVO','Detenido. Se conserva el registro de entregas para evitar duplicados.');
  }
  async resume() {
    if(!this.run || this.run.state!=='PAUSADO' || this.task) throw Error('No hay una sesión pausada');
    if(this.run.current && this.run.operations[this.run.current]) {
      const operation=this.run.operations[this.run.current];
      if(operation.status!=='accepted') throw Error('Entrega incierta o rechazada: observa el resultado y reinicia la actividad; no se reenviará');
    }
    this.launch();
  }
  async recover(saved:Run) {
    if(this.task) throw Error('Hay una ejecución activa');
    this.run=clone(saved);
    if(['INACTIVO','COMPLETADO','ERROR'].includes(saved.state)) return;
    const signal=new AbortController().signal;
    const d=await this.adapter.detect();
    if(d.origin!==saved.origin || d.activity!==saved.activity || !d.session) {
      await this.transition('PAUSADO','La página cambió durante la interrupción. Se requiere una nueva autorización.');return;
    }
    const op=saved.current && this.run.operations[saved.current];
    if(op && op.status!=='accepted' && op.status!=='rejected') {
      const result=await this.adapter.result(saved.current!,signal);
      if(result.fingerprint===saved.current && result.status!=='unknown') {
        op.status=result.status;
        if(result.status==='accepted') this.run.count++;
      } else op.status='uncertain';
    }
    await this.transition('PAUSADO','Estado recuperado y página observada. No se repite una entrega pendiente.');
  }
  private async loop(epoch:number,signal:AbortSignal) {
    const run=this.run!;
    while(run.count<run.limits.maxExercises) {
      const d=await this.guard(epoch,signal);
      if(d.complete) {await this.transition('COMPLETADO','La plataforma confirmó el fin de la actividad.');return;}
      await this.transition('LEYENDO','Leyendo el ejercicio actual');this.check(epoch,signal);
      const exercise=await this.adapter.read();this.check(epoch,signal);this.exercise=exercise;
      if(exercise.activity_id!==run.activity || exercise.ambiguities.length) throw Error('Lectura ambigua o actividad distinta');
      run.current=exercise.fingerprint;
      const previous=run.operations[exercise.fingerprint];
      if(previous) {
        if(previous.status==='accepted') {
          const result=await this.adapter.result(exercise.fingerprint,signal);this.check(epoch,signal);
          if(result.status!=='accepted' || result.fingerprint!==exercise.fingerprint) throw Error('La página no confirma la aceptación guardada');
          await this.transition('AVANZANDO','Aceptación reconciliada; avanzando sin repetir la entrega');
          await this.guard(epoch,signal,exercise);await this.adapter.next(signal);this.check(epoch,signal);continue;
        }
        throw Error('Existe una entrega incierta o rechazada. No se enviará otra respuesta.');
      }
      await this.transition('RESOLVIENDO','Calculando la respuesta');this.check(epoch,signal);
      const needsAI=exercise.math===null;
      if(needsAI) {
        if(run.aiCalls>=run.limits.maxAICalls) throw Error('Se alcanzó el límite de llamadas de IA');
        run.aiCalls++;await this.services.save(clone(run)); // reserva incluso si hay timeout
      }
      const solution=solutionSchema.parse(await this.services.solve(exercise,needsAI,signal));this.check(epoch,signal);
      this.solution=solution;
      await this.transition('VERIFICANDO',solution.explanation);this.check(epoch,signal);
      if(solution.status!=='verified') throw Error('La propuesta no tiene verificación suficiente para enviarla');
      await this.guard(epoch,signal,exercise);
      if(run.limits.preview) {await this.transition('PAUSADO','Vista previa completada: respuesta verificada; no se escribió ni envió.');return;}
      await this.transition('ESCRIBIENDO','Introduciendo la respuesta en el campo observado');this.check(epoch,signal);
      await this.adapter.write(exercise,solution.answer,signal);this.check(epoch,signal);
      await this.guard(epoch,signal,exercise);
      const operation={id:`${run.id}:${exercise.fingerprint}`,status:'submitting' as const};
      run.operations[exercise.fingerprint]=operation;
      await this.transition('ENVIANDO','Registro persistido; enviando mediante el control normal');
      await this.guard(epoch,signal,exercise);
      await this.adapter.submit(exercise,operation.id,signal);this.check(epoch,signal);
      await this.transition('COMPROBANDO','Esperando confirmación observable de la plataforma');this.check(epoch,signal);
      const feedback=await this.adapter.result(exercise.fingerprint,signal);this.check(epoch,signal);
      if(feedback.fingerprint!==exercise.fingerprint || feedback.status==='unknown') {
        run.operations[exercise.fingerprint].status='uncertain';throw Error('La plataforma no ha confirmado el envío. No se reintentará.');
      }
      run.operations[exercise.fingerprint].status=feedback.status;
      if(feedback.status==='rejected') throw Error('La plataforma rechazó la respuesta verificada; revisa el adaptador o el motor');
      run.count++;await this.transition('AVANZANDO','Respuesta aceptada por la plataforma');this.check(epoch,signal);
      await this.guard(epoch,signal,exercise);await this.adapter.next(signal);this.check(epoch,signal);
    }
    await this.transition('COMPLETADO','Se alcanzó el límite autorizado de ejercicios.');
  }
}
