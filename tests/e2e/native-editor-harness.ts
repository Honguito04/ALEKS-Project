/** Motor de teclado de Chromium real mediante un puente CDP de Playwright.
 * chrome.debugger es simulado: no carga una extensión ni contacta ALEKS.
 * Este editor de prueba ignora eventos sintéticos y pinta solamente las teclas
 * confiables recibidas. No reproduce la implementación interna de ALEKS.
 */
import { assistContext,fillAssistAnswer } from '../../extension/src/aleks-assist';
import { inspectSingleEditor } from '../../extension/src/aleks-single-editor';
import { typeNativeAnswer } from '../../extension/src/native-keyboard';

type Mode='normal'|'focus-change'|'prompt-change'|'abort';
declare global {interface Window {
  nativeCommand:(method:string,params:Record<string,unknown>)=>Promise<unknown>;
  nativeEditor:{run:(value:string,native:boolean,mode?:Mode)=>Promise<unknown>;snapshot:()=>unknown};
}}
let attached=0,detached=0,buffer='',mode:Mode='normal',controller=new AbortController();
const events:{key:string;trusted:boolean}[]=[];
let syntheticInputs=0,clicks=0;
Object.defineProperty(globalThis,'chrome',{configurable:true,value:{debugger:{
  attach:async()=>{attached++;},detach:async()=>{detached++;},
  onDetach:{addListener:()=>{},removeListener:()=>{}},
  sendCommand:async(target:{tabId:number},method:string,params:Record<string,unknown>)=>{
    if(target.tabId!==7 || method!=='Input.dispatchKeyEvent')throw Error('Comando de prueba fuera del teclado');
    return window.nativeCommand(method,params);
  }
}}});

const input=document.querySelector<HTMLInputElement>('input.ansed_input')!;
const root=input.closest<HTMLElement>('.ansed_root')!,tree=root.querySelector<HTMLElement>('.ansed_tree')!;
root.style.width='200px';tree.style.width='200px';
const other=document.createElement('input');other.id='other-input';document.body.append(other);
const glyph=(text:string,top:number)=>{
  const span=document.createElement('span');span.className='AnsedObject';span.textContent=text;
  span.style.cssText=`position:absolute;left:12px;top:${top}px;font:18px monospace;height:22px`;
  return span;
};
function render() {
  const [numerator,denominator]=buffer.split('/');
  if(buffer.includes('/')) {
    root.style.height='64px';tree.style.height='64px';
    tree.replaceChildren(glyph(numerator,2),...(denominator?[glyph(denominator,32)]:[]));
  } else tree.replaceChildren(glyph(buffer,3));
}
input.addEventListener('keydown',event=>{
  events.push({key:event.key,trusted:event.isTrusted});
  if(!event.isTrusted || !/^[0-9/]$/.test(event.key))return;
  event.preventDefault();buffer+=event.key;render();
  if(buffer.length===1) {
    if(mode==='focus-change')other.focus();
    if(mode==='prompt-change')document.querySelector('#algoPrompt')!.textContent='Otro ejercicio';
    if(mode==='abort')controller.abort();
  }
});
input.addEventListener('input',event=>{if(!event.isTrusted)syntheticInputs++;});
document.addEventListener('click',()=>clicks++);
const snapshot=()=>({attached,detached,buffer,events,syntheticInputs,clicks,readback:inspectSingleEditor(document).readback});
window.nativeEditor={snapshot,run:async(value,native,nextMode='normal')=>{
  mode=nextMode;controller=new AbortController();
  const context=await assistContext(document);
  try {
    const written=await fillAssistAnswer(document,context.fingerprint,value,controller.signal,native?async guard=>{
      await typeNativeAnswer(7,value,{check:async()=>{},guard,signal:controller.signal});
    }:undefined);
    return {...snapshot(),written,error:''};
  }catch(error){return {...snapshot(),error:(error as Error).message};}
}};
