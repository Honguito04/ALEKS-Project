import { parseSupportedAnswer } from './answer-format';

export interface NativeKeyboardDependencies {
  /** Comprueba permiso, sesión, origen y pestaña activa elegida. */
  check:()=>Promise<void>;
  /** Comprueba el editor, foco y enunciado conservados antes de cada carácter. */
  guard:()=>Promise<void>;
  signal:AbortSignal;
}

const writing=new Set<number>();

/** Única operación CDP permitida: teclear la respuesta numérica acotada.
 * No ejecuta JavaScript, lee datos del depurador ni envía Enter. La aceptación
 * de la escritura se comprueba después con el lector visual del content script.
 */
export async function typeNativeAnswer(tabId:number,value:string,deps:NativeKeyboardDependencies):Promise<void> {
  if(!Number.isInteger(tabId) || tabId<0 || value.length>25 || !parseSupportedAnswer(value))throw Error('Respuesta o pestaña no admitida para el teclado de Chrome.');
  if(writing.has(tabId))throw Error('Ya hay una escritura de teclado en esta pestaña.');
  const target={tabId};let attached=false,detached=false,listenerAdded=false;
  const current=()=>{
    if(deps.signal.aborted)throw Error('Escritura de teclado cancelada. Revisa el recuadro antes de continuar.');
    if(detached)throw Error('Chrome desconectó el teclado de esta pestaña. No se repetirá la escritura.');
  };
  const checked=async()=>{current();await deps.check();current();};
  const onDetach=(source:chrome.debugger.Debuggee)=>{if(source.tabId===tabId)detached=true;};
  writing.add(tabId);
  try {
    await checked();
    chrome.debugger.onDetach.addListener(onDetach);listenerAdded=true;
    try {await chrome.debugger.attach(target,'1.3');attached=true;}
    catch {throw Error('Chrome no pudo conectar el teclado. Comprueba el permiso de depuración y cierra DevTools de esta pestaña antes de volver a intentarlo.');}
    current();
    for(const character of value) {
      await checked();await deps.guard();current();
      const key={key:character,code:character==='/'?'Slash':`Digit${character}`,windowsVirtualKeyCode:character==='/'?191:character.charCodeAt(0)};
      await checked();
      try {await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyDown',...key,text:character,unmodifiedText:character});}
      catch {throw Error('Chrome no pudo escribir el siguiente carácter. Revisa el recuadro; no se reintentará.');}
      current();await checked();
      try {await chrome.debugger.sendCommand(target,'Input.dispatchKeyEvent',{type:'keyUp',...key});}
      catch {throw Error('Chrome interrumpió el teclado. Revisa la respuesta parcial; no se reintentará.');}
      current();
    }
  } finally {
    // Nunca desconectar una sesión ajena cuando attach fue rechazado.
    if(listenerAdded)chrome.debugger.onDetach.removeListener(onDetach);
    if(attached && !detached)await chrome.debugger.detach(target).catch(()=>{});
    writing.delete(tabId);
  }
}
