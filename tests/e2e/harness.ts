/** Puente SOLO de pruebas: el navegador administrado no permite cargar extensiones.
 * Se ejecutan el adaptador y controlador de producción, con transporte en Node.
 * No forma parte de dist/ ni del simulador distribuido. */
import { Controller } from '../../extension/src/controller';
import { SimulatorAdapter } from '../../extension/src/adapters';
import { BACKEND,type Exercise,type Limits,type Run,type Solution } from '../../extension/src/shared';
declare global {
  interface Window {
    __testSolve:(exercise:Exercise,ai:boolean)=>Promise<Solution>;
    __testSave:(run:Run)=>Promise<void>;
    mathTest:{controller:Controller;start:(limits?:Partial<Limits>)=>Promise<void>;permitted:boolean};
  }
}
const adapter=new SimulatorAdapter();
const controller=new Controller(adapter,{save:run=>window.__testSave(run),solve:(exercise,allowAI)=>window.__testSolve(exercise,allowAI),permitted:async()=>window.mathTest.permitted,now:()=>Date.now()});
window.mathTest={controller,permitted:true,start:async(limits={})=>{
  const d=await adapter.detect();
  await controller.start({maxExercises:10,maxMinutes:2,maxAICalls:0,preview:false,...limits},{origin:BACKEND,activity:d.activity});
}};
