// Chrome simulado; se carga el listener real de content.ts.
type Listener=(message:unknown,sender:unknown,reply:(value:any)=>void)=>unknown;
declare global {interface Window {
  contentRPC:(type:string,data?:Record<string,unknown>)=>Promise<any>;
  nativeContentHandler?:(message:Record<string,unknown>)=>Promise<any>;
}}
let listener:Listener;
Object.defineProperty(globalThis,'chrome',{value:{runtime:{id:'test-extension',
  onMessage:{addListener:(fn:Listener)=>{listener=fn;}},sendMessage:async(message:Record<string,unknown>)=>
    window.nativeContentHandler?window.nativeContentHandler(message):({ok:true})}}});
window.contentRPC=(type,data={})=>new Promise(resolve=>listener({scope:'adapter',type,...data},{id:'test-extension'},resolve));
void import('../../extension/src/content');
export {};
