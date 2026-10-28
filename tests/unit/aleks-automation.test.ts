import { afterEach,describe,expect,it,vi } from 'vitest';
import { AleksAutomation,automationLimitsSchema,type AutomationDependencies,type AutomationLimits,type AutomationView } from '../../extension/src/aleks-automation';
import type { AssistView } from '../../extension/src/shared';

const limits:AutomationLimits={maxExercises:3,maxMinutes:10,maxAICalls:10};
function proposal(index=0):AssistView {
  const fingerprint=index.toString(16).padStart(64,'a');
  return {id:`proposal-${index}`,context:{fingerprint,statement:'Calcula el número de premios.',fields:[{key:'answer',label:'Respuesta'}],diagram_required:false,can_fill_integer:true,fill_blockers:[]},
    result:{fingerprint,provider:'ollama',model:'test-model',provider_calls:1,verified:false,verification:'none',
      proposal:{status:'proposed',answers:[{field_key:'answer',value:'12',unit:''}],explanation:'4 × 3 = 12',missing_information:[]}}};
}
function deferred<T>() {let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(overrides:Partial<AutomationLimits>={},seed?:AssistView) {
  let index=0,clock=0;
  const saved:AutomationView[]=[];
  const deps:AutomationDependencies={now:()=>clock,solve:vi.fn(async()=>proposal(index)),submit:vi.fn(async()=>({status:'accepted'})),
    next:vi.fn(async()=>{index++;}),cancel:vi.fn(async()=>{}),save:vi.fn(async view=>{saved.push(structuredClone(view));})};
  const run=new AleksAutomation({...limits,...overrides},deps,seed);
  return {run,deps,saved,setTime:(value:number)=>{clock=value;}};
}
afterEach(()=>vi.useRealTimers());

describe('recorrido ALEKS por fases',()=>{
  it('resuelve, entrega y avanza solo después de Correcta, hasta el límite',async()=>{
    const {run,deps,saved}=harness();
    expect(run.view.phase).toBe('LEYENDO');
    expect((await run.step()).phase).toBe('LISTO');expect(deps.submit).not.toHaveBeenCalled();
    expect((await run.step()).phase).toBe('CORRECTA');expect(deps.next).not.toHaveBeenCalled();
    expect((await run.step()).phase).toBe('LEYENDO');
    for(let n=0;n<5;n++)await run.step();
    expect(run.view).toMatchObject({phase:'COMPLETADO',active:false,busy:false,accepted:3,aiCalls:3});
    expect(deps.solve).toHaveBeenCalledTimes(3);expect(deps.submit).toHaveBeenCalledTimes(3);expect(deps.next).toHaveBeenCalledTimes(2);
    expect(saved.map(value=>value.phase)).toEqual(expect.arrayContaining(['RESOLVIENDO','ENVIANDO','CORRECTA','AVANZANDO']));
    expect(JSON.stringify(saved)).not.toContain('Calcula el número');expect(JSON.stringify(saved)).not.toContain('test-model');
  });

  it('una propuesta existente no consulta otra vez ni suma llamadas nuevas',async()=>{
    const {run,deps}=harness({maxExercises:1,maxAICalls:1},proposal());
    expect(run.view.phase).toBe('LISTO');
    await run.step();expect(run.view).toMatchObject({phase:'COMPLETADO',accepted:1,aiCalls:0});
    expect(deps.solve).not.toHaveBeenCalled();expect(deps.submit).toHaveBeenCalledTimes(1);
  });

  it.each([{status:'rejected'},{status:'unknown'},undefined,true])('no avanza sin aceptación de la entrega: %j',async result=>{
    const {run,deps}=harness({},proposal());deps.submit=vi.fn(async()=>result);
    await run.step();await run.step();
    expect(run.view).toMatchObject({phase:'DETENIDO',active:false,accepted:0});
    expect(deps.next).not.toHaveBeenCalled();expect(deps.submit).toHaveBeenCalledTimes(1);
  });

  it('el rechazo del adaptador conserva el motivo y nunca vuelve a enviar',async()=>{
    const {run,deps}=harness({},proposal());deps.submit=vi.fn(async()=>{throw Error('ALEKS mostró Incorrecta.');});
    await run.step();await run.step();
    expect(run.view.message).toContain('Incorrecta');expect(deps.submit).toHaveBeenCalledTimes(1);expect(deps.next).not.toHaveBeenCalled();
  });

  it.each(['fingerprint','unit','multiple','diagram','occupied','no-answer'] as const)('no entrega una propuesta incompatible: %s',async reason=>{
    const {run,deps}=harness();const candidate=proposal();
    if(reason==='fingerprint')candidate.result.fingerprint='b'.repeat(64);
    if(reason==='unit')candidate.result.proposal.answers[0].unit='cm';
    if(reason==='multiple')candidate.context.fill_blockers=['multiple_editors'];
    if(reason==='diagram')candidate.context.fill_blockers=['diagram_required'];
    if(reason==='occupied')candidate.context.fill_blockers=['editor_not_empty'];
    if(reason==='no-answer'){candidate.result.proposal.status='unable_to_solve';candidate.result.proposal.answers=[];}
    deps.solve=vi.fn(async()=>candidate);
    await run.step();await run.step();
    expect(run.view.phase).toBe('DETENIDO');expect(deps.submit).not.toHaveBeenCalled();expect(deps.next).not.toHaveBeenCalled();
  });

  it('rechaza una propuesta seed incompatible antes de crear el recorrido',()=>{
    const candidate=proposal();candidate.result.proposal.answers[0].value='1/2';
    expect(()=>harness({},candidate)).toThrow('entero');
  });

  it('no repite un ejercicio que reaparece después de avanzar',async()=>{
    const {run,deps}=harness({},proposal());deps.solve=vi.fn(async()=>proposal());
    await run.step();await run.step();await run.step();await run.step();
    expect(run.view.message).toContain('ya se envió');expect(deps.submit).toHaveBeenCalledTimes(1);expect(deps.next).toHaveBeenCalledTimes(1);
  });

  it('reserva dos llamadas antes de consultar y descuenta las no utilizadas',async()=>{
    const {run,deps,saved}=harness({maxAICalls:2});
    await run.step();expect(saved.find(view=>view.phase==='RESOLVIENDO')?.aiCalls).toBe(2);
    expect(run.view.aiCalls).toBe(1);
    await run.step();await run.step();await run.step();
    expect(run.view).toMatchObject({phase:'COMPLETADO',accepted:1,aiCalls:1});expect(deps.solve).toHaveBeenCalledTimes(1);
  });

  it('una sola llamada disponible no autoriza una consulta que podría necesitar dos',async()=>{
    const {run,deps}=harness({maxAICalls:1});await run.step();
    expect(run.view.phase).toBe('COMPLETADO');expect(deps.solve).not.toHaveBeenCalled();expect(deps.submit).not.toHaveBeenCalled();
  });

  it('si la respuesta del proveedor no llega conserva la reserva y se detiene',async()=>{
    const {run,deps}=harness({maxAICalls:2});deps.solve=vi.fn(async()=>{throw Error('Sin conexión');});
    await run.step();expect(run.view).toMatchObject({phase:'DETENIDO',aiCalls:2});expect(deps.cancel).toHaveBeenCalledTimes(1);
  });

  it('impide operaciones concurrentes durante la resolución',async()=>{
    const {run,deps}=harness();const pending=deferred<AssistView>(),entered=deferred<void>();
    deps.solve=vi.fn(async()=>{entered.resolve();return pending.promise;});
    const running=run.step();await entered.promise;
    expect((await run.step()).busy).toBe(true);expect(deps.solve).toHaveBeenCalledTimes(1);
    pending.resolve(proposal());await running;expect(run.view.phase).toBe('LISTO');
  });

  it('cancelar durante la resolución descarta la respuesta tardía',async()=>{
    const {run,deps}=harness();const pending=deferred<AssistView>(),entered=deferred<void>();
    deps.solve=vi.fn(async()=>{entered.resolve();return pending.promise;});
    const running=run.step();await entered.promise;await run.stop();pending.resolve(proposal());await running;await run.step();
    expect(run.view).toMatchObject({phase:'DETENIDO',active:false,busy:false});expect(deps.submit).not.toHaveBeenCalled();expect(deps.next).not.toHaveBeenCalled();
  });

  it('cancelar durante el envío no acepta un resultado tardío ni avanza',async()=>{
    const {run,deps}=harness({},proposal());const pending=deferred<unknown>(),entered=deferred<void>();
    deps.submit=vi.fn(async()=>{entered.resolve();return pending.promise;});
    const running=run.step();await entered.promise;await run.stop('Detenido por el usuario.');pending.resolve({status:'accepted'});await running;
    expect(run.view).toMatchObject({phase:'DETENIDO',accepted:0,message:'Detenido por el usuario.'});expect(deps.next).not.toHaveBeenCalled();
  });

  it('cancelar durante el avance no reactiva la lectura',async()=>{
    const {run,deps}=harness({},proposal());await run.step();const pending=deferred<void>(),entered=deferred<void>();
    deps.next=vi.fn(async()=>{entered.resolve();return pending.promise;});
    const running=run.step();await entered.promise;await run.stop();pending.resolve();await running;await run.step();
    expect(run.view.phase).toBe('DETENIDO');expect(deps.solve).not.toHaveBeenCalled();expect(deps.next).toHaveBeenCalledTimes(1);
  });

  it('comprueba el límite de tiempo antes de enviar',async()=>{
    const {run,deps,setTime}=harness({maxMinutes:1},proposal());setTime(60_000);await run.step();
    expect(run.view.phase).toBe('DETENIDO');expect(run.view.message).toContain('tiempo');expect(deps.submit).not.toHaveBeenCalled();
  });

  it('el tiempo vencido durante la consulta impide enviar aunque se reciba una propuesta',async()=>{
    const {run,deps,setTime}=harness({maxMinutes:1});deps.solve=vi.fn(async()=>{setTime(60_000);return proposal();});
    await run.step();await run.step();expect(run.view.phase).toBe('DETENIDO');expect(deps.submit).not.toHaveBeenCalled();
  });

  it('el temporizador cancela una operación bloqueada al vencer la duración',async()=>{
    vi.useFakeTimers();const {run,deps}=harness({maxMinutes:1});const entered=deferred<void>(),pending=deferred<AssistView>();
    deps.solve=vi.fn(async()=>{entered.resolve();return pending.promise;});
    const running=run.step();await entered.promise;await vi.advanceTimersByTimeAsync(60_000);
    expect(run.view).toMatchObject({active:false,phase:'DETENIDO'});expect(deps.cancel).toHaveBeenCalledTimes(1);
    pending.resolve(proposal());await running;expect(deps.submit).not.toHaveBeenCalled();
  });

  it('no escribe ni consulta si no pudo guardar el estado previo',async()=>{
    for(const seed of [undefined,proposal()]) {
      const {run,deps}=harness({},seed);deps.save=vi.fn(async()=>{throw Error('Almacenamiento no disponible');});
      await run.step();expect(run.view.phase).toBe('DETENIDO');expect(deps.solve).not.toHaveBeenCalled();expect(deps.submit).not.toHaveBeenCalled();
    }
  });

  it('serializa el guardado de detención detrás del estado pendiente sin reactivar',async()=>{
    const {run,deps}=harness({},proposal());const entered=deferred<void>(),pending=deferred<void>();let writes=0;const states:AutomationView[]=[];
    deps.save=vi.fn(async view=>{if(++writes===1){entered.resolve();await pending.promise;}states.push(structuredClone(view));});
    const running=run.step();await entered.promise;const stopping=run.stop();pending.resolve();await Promise.all([running,stopping]);
    expect(states.at(-1)).toMatchObject({phase:'DETENIDO',active:false,busy:false});expect(deps.submit).not.toHaveBeenCalled();
  });

  it('las vistas no permiten alterar los límites internos',()=>{
    const {run}=harness();const view=run.view;view.limits.maxExercises=99;view.active=false;
    expect(run.view.limits.maxExercises).toBe(3);expect(run.view.active).toBe(true);
  });

  it.each([{maxExercises:0},{maxExercises:101},{maxMinutes:0},{maxMinutes:121},{maxAICalls:0},{maxAICalls:101},{maxExercises:1.5},{extra:true}])('rechaza límites inválidos %j',change=>{
    expect(automationLimitsSchema.safeParse({...limits,...change}).success).toBe(false);
  });
});
