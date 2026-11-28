import { parseSupportedAnswer } from './answer-format';
import type { PlotPoint } from './parabola-answer';

export interface NativeKeyboardDependencies {
  /** Comprueba permiso, sesión, origen y pestaña activa elegida. */
  check:()=>Promise<void>;
  /** Comprueba el editor, foco y enunciado conservados antes de cada carácter. */
  guard:()=>Promise<void>;
  signal:AbortSignal;
}

const writing=new Set<number>();

type InputSession = {
  target: chrome.debugger.Debuggee;
  current: () => void;
  checked: () => Promise<void>;
};
type NativeSessionDependencies = Omit<NativeKeyboardDependencies,'guard'> & {isCurrent?:()=>boolean};

async function withNativeInput<T>(tabId:number,deps:NativeSessionDependencies,device:'teclado'|'ratón',
  operation:(session:InputSession)=>Promise<T>):Promise<T> {
  if(!Number.isInteger(tabId) || tabId<0)throw Error('Pestaña no admitida para la entrada de Chrome.');
  if(writing.has(tabId))throw Error('Ya hay una escritura de teclado en esta pestaña.');
  const target={tabId};let attached=false,detached=false,listenerAdded=false;
  const current=()=>{
    if(deps.signal.aborted || deps.isCurrent?.()===false)throw Error('Operación de entrada cancelada. Revisa ALEKS antes de continuar.');
    if(detached)throw Error(`Chrome desconectó el ${device} de esta pestaña. No se repetirá la operación.`);
  };
  const checked=async()=>{current();await deps.check();current();};
  const onDetach=(source:chrome.debugger.Debuggee)=>{if(source.tabId===tabId)detached=true;};
  writing.add(tabId);
  try {
    await checked();
    chrome.debugger.onDetach.addListener(onDetach);listenerAdded=true;
    try {await chrome.debugger.attach(target,'1.3');attached=true;}
    catch {throw Error(`Chrome no pudo conectar el ${device}. Comprueba el permiso de depuración y cierra DevTools de esta pestaña antes de volver a intentarlo.`);}
    current();
    return await operation({target,current,checked});
  } finally {
    // Nunca desconectar una sesión ajena cuando attach fue rechazado.
    if(listenerAdded)chrome.debugger.onDetach.removeListener(onDetach);
    if(attached && !detached)await chrome.debugger.detach(target).catch(()=>{});
    writing.delete(tabId);
  }
}

/** Teclea una respuesta numérica sin Enter y confirma la representación por DOM. */
export async function typeNativeAnswer(tabId:number,value:string,deps:NativeKeyboardDependencies):Promise<void> {
  if(value.length>25 || !parseSupportedAnswer(value))throw Error('Respuesta no admitida para el teclado de Chrome.');
  await withNativeInput(tabId,deps,'teclado',async({target,current,checked})=>{
    for(const character of value) {
      await checked();await deps.guard();current();
      const key={key:character,code:character==='/'?'Slash':character===','?'Comma':character==='.'?'Period':`Digit${character}`,windowsVirtualKeyCode:character==='/'?191:character===','?188:character==='.'?190:character.charCodeAt(0)};
      await checked();
      try {await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyDown',...key,text:character,unmodifiedText:character});}
      catch {throw Error('Chrome no pudo escribir el siguiente carácter. Revisa el recuadro; no se reintentará.');}
      current();await checked();
      try {await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyUp',...key});}
      catch {throw Error('Chrome interrumpió el teclado. Revisa la respuesta parcial; no se reintentará.');}
      current();
    }
  });
}

export type NativePlotClick = (locate:()=>Promise<PlotPoint|null>)=>Promise<void>;

/** Mantiene una sola sesión para el lápiz, los cinco puntos y la curva. */
export function withNativePlot<T>(tabId:number,deps:NativeSessionDependencies,
  draw:(click:NativePlotClick,check:()=>Promise<void>)=>Promise<T>) {
  return withNativeInput(tabId,deps,'ratón',async({target,current,checked})=>{
    let count=0;
    return draw(async locate=>{
      if(++count>7)throw Error('Se alcanzó el límite de clics del dibujo.');
      await checked();
      const point=await locate();
      current();
      if(point===null && count===1)return; // El lápiz ya estaba seleccionado.
      if(!Array.isArray(point) || point.length!==2 || !point.every(value=>Number.isFinite(value) && value>=0 && value<=32_768)) {
        throw Error('La posición para dibujar está fuera de la vista.');
      }
      const [x,y]=point;
      const mouse={x,y,button:'left',clickCount:1};
      try {await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{x,y,type:'mouseMoved',buttons:0});}
      catch {throw Error('Chrome no pudo ubicar el puntero sobre la cuadrícula.');}
      // El movimiento puede actualizar la herramienta o mostrar una capa.
      // Revalida el destino justo antes de pulsar.
      current();
      const latest=await locate();
      current();
      if(!latest || latest[0]!==x || latest[1]!==y)throw Error('Cambió la posición del clic. Revisa la cuadrícula.');
      try {await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{...mouse,type:'mousePressed',buttons:1});}
      catch {throw Error('Chrome no pudo marcar una posición en la cuadrícula. Revisa ALEKS antes de continuar.');}
      await checked();
      try {await chrome.debugger.sendCommand(target,'Input.dispatchMouseEvent',{...mouse,type:'mouseReleased',buttons:0});}
      catch {throw Error('Chrome interrumpió el clic. Revisa ALEKS antes de continuar.');}
      current();
    },checked);
  });
}
