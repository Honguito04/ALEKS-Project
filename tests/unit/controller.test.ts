import { describe,it,expect,vi } from 'vitest';
import { Controller, type Services } from '../../extension/src/controller';
import { BACKEND,type Adapter,type Detection,type Exercise,type Feedback,type Limits,type Run,type Solution,allowedTab } from '../../extension/src/shared';

const exercise=(i=0):Exercise=>({source:'simulator',activity_id:'activity',fingerprint:i.toString(16).padStart(64,'a'),statement:'Calcula 1 + 1',
  math:{family:'arithmetic',expression:'1+1'},fields:[{id:'answer',kind:'text'}],choices:[],domain:'real',units:'',format:'exact',decimal_places:2,evidence:['test'],ambiguities:[]});
const solution:Solution={status:'verified',answer:'2',values:['2'],explanation:'Exacta',provider:'deterministic',proposed_by_ai:false,provider_calls:0};
const limits:Limits={maxExercises:10,maxMinutes:10,maxAICalls:1,preview:false};
class FakeAdapter implements Adapter {
  index=0;size=3;writes=0;submits=0;accepted=true;unknown=false;changeOnWrite=false;human=false;session=true;origin=BACKEND;activity='activity';
  current=()=>exercise(this.index);
  async detect():Promise<Detection> {return {origin:this.origin,activity:this.activity,session:this.session,complete:this.index>=this.size,human:this.human,supported:true};}
  async read() {return this.current();}
  async write() {this.writes++;if(this.changeOnWrite)this.index++;}
  async submit() {this.submits++;}
  async result(fingerprint:string):Promise<Feedback> {return {status:this.unknown?'unknown':this.accepted?'accepted':'rejected',fingerprint};}
  async next() {this.index++;}
}
function harness() {
  const a=new FakeAdapter();let saved:Run|undefined;
  const services:Services={save:async run=>{saved=structuredClone(run);},solve:async()=>solution,permitted:async()=>true,now:()=>Date.now()};
  const c=new Controller(a,services);
  const start=async(overrides:Partial<Limits>={})=>{await c.start({...limits,...overrides},{origin:BACKEND,activity:'activity'});await c.idle();};
  return {a,c,services,start,saved:()=>saved!};
}
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}

describe('controlador automático',()=>{
  it('ejecuta leer → resolver → verificar → escribir → confirmar → avanzar',async()=>{
    const {a,c,start}=harness();await start();expect(c.run?.state).toBe('COMPLETADO');expect(c.run?.count).toBe(3);expect(a.submits).toBe(3);
    expect(c.run?.events.map(e=>e.state)).toContain('COMPROBANDO');
  });
  it('limita el número de ejercicios y la duración',async()=>{
    const h=harness();await h.start({maxExercises:1});expect(h.a.submits).toBe(1);
    const h2=harness();let now=0;h2.services.now=()=>{now+=500;return now;};await h2.start({maxMinutes:.01});expect(h2.a.submits).toBe(0);expect(h2.c.run?.state).toBe('PAUSADO');
  });
  it('detener durante una llamada tardía impide todo envío posterior',async()=>{
    const h=harness();const pending=deferred<Solution>();const called=deferred<void>();
    h.a.current=()=>({...exercise(),math:null});h.services.solve=async()=>{called.resolve();return pending.promise;};
    await h.c.start(limits,{origin:BACKEND,activity:'activity'});await called.promise;await h.c.stop();pending.resolve({...solution,provider:'openai',provider_calls:1});
    await new Promise(r=>setTimeout(r,0));expect(h.a.submits).toBe(0);expect(h.a.writes).toBe(0);expect(h.c.run?.state).toBe('INACTIVO');
  });
  it('recupera una entrega confirmada sin duplicarla',async()=>{
    const h=harness();await h.start({maxExercises:1});const saved=h.saved();saved.state='ENVIANDO';saved.count=0;saved.operations[saved.current!].status='submitting';
    h.a.index=0;const c2=new Controller(h.a,h.services);await c2.recover(saved);expect(c2.run?.count).toBe(1);expect(c2.run?.state).toBe('PAUSADO');
    await c2.resume();await c2.idle();expect(h.a.submits).toBe(1);
  });
  it('una entrega incierta no se repite ni tras detener y volver a iniciar',async()=>{
    const h=harness();h.a.unknown=true;await h.start();expect(h.c.run?.state).toBe('PAUSADO');expect(h.a.submits).toBe(1);
    await h.c.stop();await h.start();expect(h.a.submits).toBe(1);
    const c2=new Controller(h.a,h.services);const saved=h.saved();saved.state='ENVIANDO';await c2.recover(saved);await expect(c2.resume()).rejects.toThrow('incierta');
  });
  it('invalida la respuesta si cambia el ejercicio después de escribir',async()=>{
    const h=harness();h.a.changeOnWrite=true;await h.start();expect(h.a.writes).toBe(1);expect(h.a.submits).toBe(0);expect(h.c.run?.message).toContain('cambiaron');
  });
  it.each(['permission','session','domain','activity','human','network'] as const)('detiene ante %s',async(reason)=>{
    const h=harness();
    if(reason==='permission')h.services.permitted=async()=>false;
    if(reason==='session')h.a.session=false;
    if(reason==='domain')h.a.origin='https://evil.example';
    if(reason==='activity')h.a.activity='different';
    if(reason==='human')h.a.human=true;
    if(reason==='network')h.services.solve=async()=>{throw Error('Error de red');};
    try {await h.start();} catch { /* rechazo antes de iniciar también es válido */ }
    expect(h.a.submits).toBe(0);expect(h.c.run?.state).not.toBe('COMPLETADO');
  });
  it('no escribe una interpretación no verificable ni una lectura ambigua',async()=>{
    const h=harness();h.services.solve=async()=>({...solution,status:'unverifiable'});await h.start();expect(h.a.writes).toBe(0);
    const h2=harness();h2.a.current=()=>({...exercise(),ambiguities:['Denominador ilegible']});await h2.start();expect(h2.a.submits).toBe(0);
  });
  it('vista previa no escribe ni envía',async()=>{
    const h=harness();await h.start({preview:true});expect(h.c.solution?.answer).toBe('2');expect(h.a.writes).toBe(0);expect(h.a.submits).toBe(0);
  });
  it.each([undefined,'cm^2','m^3'])('no escribe un volumen con unidad no verificada: %s',async(unit)=>{
    const h=harness();h.a.current=()=>({...exercise(),units:'cm^3',fields:[{id:'answer',kind:'quantity'}],
      math:{family:'cylinder_volume',radius:'2',height:'18',pi_value:'3.14',radius_unit:'cm',height_unit:'cm',height_is_perpendicular:true}});
    h.services.solve=async()=>({...solution,answer:'226',unit});await h.start();
    expect(h.a.writes).toBe(0);expect(h.a.submits).toBe(0);expect(h.c.run?.message).toContain('unidad');
  });
  it('rechazo confirmado pausa sin ensayar otra respuesta',async()=>{
    const h=harness();h.a.accepted=false;await h.start();expect(h.a.submits).toBe(1);expect(h.c.run?.message).toContain('rechazó');
    await expect(h.c.resume()).rejects.toThrow('rechazada');
  });
  it('no llama a IA sin presupuesto y no acepta trabajos simultáneos',async()=>{
    const h=harness();h.a.current=()=>({...exercise(),math:null});const spy=vi.fn(async()=>solution);h.services.solve=spy;
    await h.start({maxAICalls:0});expect(spy).not.toHaveBeenCalled();
    await expect(h.c.start(limits,{origin:BACKEND,activity:'activity'})).rejects.toThrow('Ya existe');
  });
  it('no admite orígenes o rutas externas',()=>{
    expect(allowedTab('https://evil.example/simulator')).toBe(false);
    expect(allowedTab(BACKEND+'/health')).toBe(false);
    expect(allowedTab(BACKEND+'/simulator/')).toBe(true);
    expect(allowedTab('https://latam.aleks.com.evil.example/')).toBe(false);
  });
});
