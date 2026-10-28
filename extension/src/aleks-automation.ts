import { z } from 'zod';
import { assistContextSchema,assistResultSchema,type AssistView } from './shared';
import { proposalFillBlockers,fillBlockerMessages } from './assist-readiness';

export const automationLimitsSchema=z.object({
  maxExercises:z.number().int().min(1).max(100),
  maxMinutes:z.number().int().min(1).max(120),
  maxAICalls:z.number().int().min(1).max(100)
}).strict();
export type AutomationLimits=z.infer<typeof automationLimitsSchema>;
export type AutomationPhase='LEYENDO'|'RESOLVIENDO'|'LISTO'|'ENVIANDO'|'CORRECTA'|'AVANZANDO'|'DETENIDO'|'COMPLETADO';
export interface AutomationView {
  id:string;phase:AutomationPhase;active:boolean;busy:boolean;accepted:number;aiCalls:number;
  started:number;limits:AutomationLimits;message:string;answer?:string;
}
export interface AutomationDependencies {
  now():number;
  solve():Promise<AssistView>;
  submit(proposal:AssistView):Promise<unknown>;
  next():Promise<unknown>;
  cancel():Promise<unknown>;
  save(view:AutomationView):Promise<unknown>;
}

/** Cada llamada realiza solamente una fase. El panel solicita la siguiente;
 * no hay un bucle perpetuo en el worker ni recuperación automática de envíos.
 * El adaptador DOM debe vincular la aceptación a su entrega y comprobar el
 * cambio de ejercicio al avanzar. Esta clase nunca considera correcto un
 * resultado por haber sido propuesto o verificado matemáticamente por la IA.
 */
export class AleksAutomation {
  private state:AutomationView;
  private proposal?:AssistView;
  private submitted=new Set<string>();
  private saving:Promise<unknown>=Promise.resolve();
  private locked=false;

  constructor(limits:AutomationLimits,private deps:AutomationDependencies,seed?:AssistView) {
    const parsed=automationLimitsSchema.parse(limits);
    this.state={id:crypto.randomUUID(),phase:'LEYENDO',active:true,busy:false,accepted:0,aiCalls:0,
      started:deps.now(),limits:parsed,message:'Preparado para resolver el ejercicio actual.'};
    // La propuesta ya obtenida no consume una consulta nueva de esta sesión.
    if(seed)this.acceptProposal(seed);
  }

  get view():AutomationView {return {...this.state,limits:{...this.state.limits}};}

  private acceptProposal(raw:AssistView) {
    const proposal:AssistView={id:raw.id,context:assistContextSchema.parse(raw.context),result:assistResultSchema.parse(raw.result)};
    if(proposal.context.fingerprint!==proposal.result.fingerprint)throw Error('La propuesta no corresponde al ejercicio leído.');
    if(this.submitted.has(proposal.context.fingerprint))throw Error('Este ejercicio ya se envió en el recorrido. No se repetirá la entrega.');
    const blockers=proposalFillBlockers(proposal);
    if(blockers.length)throw Error(blockers.map(blocker=>fillBlockerMessages[blocker]).join(' '));
    this.proposal=proposal;
    this.state.phase='LISTO';this.state.answer=proposal.result.proposal.answers[0].value;
    this.state.message='Respuesta preparada. El siguiente paso la escribirá y pulsará Verificar o Entregar.';
  }

  private guard() {
    if(!this.state.active)throw Error('Recorrido detenido.');
    if(this.deps.now()>=this.state.started+this.state.limits.maxMinutes*60_000)throw Error('Se alcanzó el límite de tiempo. Revisa el estado del ejercicio antes de iniciar otra sesión.');
  }

  private persist() {
    const snapshot=this.view;
    // Serializa las escrituras: una operación anterior no puede guardar un
    // estado activo después del estado detenido durante una cancelación.
    const pending=this.saving.then(()=>this.deps.save(snapshot));
    this.saving=pending.catch(()=>{});
    return pending;
  }

  private async phase(phase:AutomationPhase,message:string) {
    this.guard();this.state.phase=phase;this.state.message=message;
    await this.persist();this.guard();
  }

  async stop(message='Recorrido detenido. No se iniciarán más entregas.'):Promise<AutomationView> {
    this.state.active=false;this.state.phase='DETENIDO';this.state.message=message;
    this.proposal=undefined;
    await Promise.allSettled([Promise.resolve().then(()=>this.deps.cancel()),this.persist()]);
    return this.view;
  }

  private async complete(message:string) {
    this.state.active=false;this.state.phase='COMPLETADO';this.state.message=message;
    this.proposal=undefined;
    await this.persist();
  }

  async step():Promise<AutomationView> {
    if(this.locked || !this.state.active)return this.view;
    this.locked=true;this.state.busy=true;
    const remaining=this.state.started+this.state.limits.maxMinutes*60_000-this.deps.now();
    const timer=setTimeout(()=>{void this.stop('Se alcanzó el límite de tiempo. La operación fue cancelada; revisa el ejercicio.');},Math.max(0,remaining));
    try {
      this.guard();
      if(this.state.phase==='LEYENDO') {
        // El proveedor puede usar dos pasadas. Reservarlas antes de llamar
        // mantiene el límite incluso si falla la red o no llega un resultado.
        if(this.state.aiCalls+2>this.state.limits.maxAICalls) {
          await this.complete('Límite de consultas alcanzado: se necesitan dos llamadas disponibles para iniciar otra resolución.');
        } else {
          this.state.aiCalls+=2;
          await this.phase('RESOLVIENDO','Consultando el ejercicio con el modelo local…');
          const proposal=await this.deps.solve();this.guard();
          const result=assistResultSchema.parse(proposal.result);
          this.state.aiCalls-=2-result.provider_calls;
          this.acceptProposal(proposal);await this.persist();this.guard();
        }
      } else if(this.state.phase==='LISTO') {
        if(!this.proposal)throw Error('No queda una propuesta vigente para entregar.');
        const proposal=this.proposal;
        await this.phase('ENVIANDO','Escribiendo la respuesta y esperando la verificación de ALEKS…');
        this.submitted.add(proposal.context.fingerprint);this.proposal=undefined;
        const result=await this.deps.submit(proposal);this.guard();
        if(!result || typeof result!=='object' || !('status' in result) || result.status!=='accepted') {
          throw Error('ALEKS no confirmó que la entrega fuera correcta. No se avanzará ni se repetirá la respuesta.');
        }
        this.state.accepted++;
        if(this.state.accepted>=this.state.limits.maxExercises)await this.complete('Límite de ejercicios alcanzado. ALEKS confirmó la última respuesta como correcta.');
        else await this.phase('CORRECTA','ALEKS confirmó «Correcta» para esta entrega. Preparado para avanzar.');
      } else if(this.state.phase==='CORRECTA') {
        await this.phase('AVANZANDO','Abriendo el siguiente ejercicio…');
        await this.deps.next();this.guard();
        delete this.state.answer;
        await this.phase('LEYENDO','Nuevo ejercicio reconocido. Preparado para resolver.');
      } else throw Error('La operación anterior no terminó. No se repetirá automáticamente.');
    } catch(error) {
      if(this.state.active)await this.stop(error instanceof Error?error.message:'No se pudo completar el recorrido. Revisa la pestaña.');
    } finally {
      clearTimeout(timer);this.state.busy=false;
      try {await this.persist();} catch {
        if(this.state.active)await this.stop('No se pudo guardar el estado del recorrido. Se detuvo para evitar repetir una entrega.');
      }
      this.locked=false;
    }
    return this.view;
  }
}
