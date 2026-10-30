import { beforeEach,expect,it,vi } from 'vitest';
import { typeNativeAnswer,type NativeKeyboardDependencies } from '../../extension/src/native-keyboard';

let attach:ReturnType<typeof vi.fn>,detach:ReturnType<typeof vi.fn>,command:ReturnType<typeof vi.fn>;
let onDetach:((source:chrome.debugger.Debuggee)=>void)|undefined;
let controller:AbortController,deps:NativeKeyboardDependencies;
beforeEach(()=>{
  controller=new AbortController();deps={check:vi.fn(async()=>{}),guard:vi.fn(async()=>{}),signal:controller.signal};
  attach=vi.fn(async()=>{});detach=vi.fn(async()=>{});command=vi.fn(async()=>{});onDetach=undefined;
  vi.stubGlobal('chrome',{debugger:{attach,detach,sendCommand:command,onDetach:{
    addListener:vi.fn(fn=>{onDetach=fn;}),removeListener:vi.fn(fn=>{if(onDetach===fn)onDetach=undefined;})}}});
});
it.each(['12','1/5','0/1','999999999999/2'])('teclea %s sólo como dígitos/barra y suelta cada tecla',async value=>{
  await typeNativeAnswer(7,value,deps);
  expect(attach).toHaveBeenCalledExactlyOnceWith({tabId:7},'1.3');
  expect(detach).toHaveBeenCalledExactlyOnceWith({tabId:7});
  expect(command).toHaveBeenCalledTimes(value.length*2);expect(deps.guard).toHaveBeenCalledTimes(value.length);
  for(let index=0;index<value.length;index++) {
    const character=value[index],key={key:character,code:character==='/'?'Slash':`Digit${character}`,windowsVirtualKeyCode:character==='/'?191:character.charCodeAt(0)};
    expect(command.mock.calls[index*2]).toEqual([{tabId:7},'Input.dispatchKeyEvent',{type:'keyDown',...key,text:character,unmodifiedText:character}]);
    expect(command.mock.calls[index*2+1]).toEqual([{tabId:7},'Input.dispatchKeyEvent',{type:'keyUp',...key}]);
  }
  expect(onDetach).toBeUndefined();
});
it.each(['','alert(1)','1\n2','-1','1/0','2/4','1.5','9999999999999','1/9999999999999'])('rechaza texto no admitido: %s',async value=>{
  await expect(typeNativeAnswer(7,value,deps)).rejects.toThrow('no admitida');expect(attach).not.toHaveBeenCalled();
});
it.each([-1,1.5,NaN])('rechaza una pestaña inválida %s',async tabId=>{
  await expect(typeNativeAnswer(tabId,'12',deps)).rejects.toThrow('no admitida');expect(attach).not.toHaveBeenCalled();
});
it('cancelación previa no conecta ni escribe',async()=>{
  controller.abort();await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('cancelada');
  expect(attach).not.toHaveBeenCalled();expect(command).not.toHaveBeenCalled();
});
it('cancelación durante attach desconecta la sesión propia sin teclear',async()=>{
  attach.mockImplementation(async()=>{controller.abort();});
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('cancelada');
  expect(command).not.toHaveBeenCalled();expect(detach).toHaveBeenCalledTimes(1);
});
it('cancelación entre caracteres evita la siguiente tecla',async()=>{
  command.mockImplementation(async(_target, _method,params)=>{if(params.type==='keyUp')controller.abort();});
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('cancelada');
  expect(command).toHaveBeenCalledTimes(2);expect(detach).toHaveBeenCalledTimes(1);
});
it('un guard del editor que falla detiene el texto antes de emitir teclas',async()=>{
  deps.guard=vi.fn(async()=>{throw Error('El foco cambió.');});
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('El foco cambió');
  expect(command).not.toHaveBeenCalled();expect(detach).toHaveBeenCalledTimes(1);
});
it('revalida permisos/pestaña antes de emitir keyUp y ante una pérdida desconecta',async()=>{
  command.mockImplementation(async()=>{deps.check=vi.fn(async()=>{throw Error('Permiso revocado');});});
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('Permiso revocado');
  expect(command).toHaveBeenCalledTimes(1);expect(detach).toHaveBeenCalledTimes(1);
});
it('attach rechazado no desconecta otro depurador ni filtra su mensaje',async()=>{
  attach.mockRejectedValue(Error('PRIVATE_DEBUGGER_DATA'));
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('Chrome no pudo conectar');
  expect(detach).not.toHaveBeenCalled();expect(command).not.toHaveBeenCalled();expect(onDetach).toBeUndefined();
});
it('fallo al emitir tecla limpia la sesión propia y no reintenta',async()=>{
  command.mockRejectedValue(Error('PRIVATE_PROTOCOL_DATA'));
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('Chrome no pudo escribir');
  expect(command).toHaveBeenCalledTimes(1);expect(detach).toHaveBeenCalledTimes(1);
});
it('desconexión del usuario impide continuar y no vuelve a conectar',async()=>{
  command.mockImplementation(async()=>{onDetach?.({tabId:7});});
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('Chrome desconectó');
  expect(command).toHaveBeenCalledTimes(1);expect(attach).toHaveBeenCalledTimes(1);expect(detach).not.toHaveBeenCalled();
});
it('ignora la desconexión de otra pestaña',async()=>{
  command.mockImplementation(async()=>{onDetach?.({tabId:8});});
  await typeNativeAnswer(7,'12',deps);expect(command).toHaveBeenCalledTimes(4);expect(detach).toHaveBeenCalledTimes(1);
});
it('no permite dos escrituras concurrentes en una pestaña',async()=>{
  let finish!:()=>void;let entered!:()=>void;const pending=new Promise<void>(resolve=>{entered=resolve;});
  attach.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;entered();}));
  const first=typeNativeAnswer(7,'12',deps);await pending;
  await expect(typeNativeAnswer(7,'12',deps)).rejects.toThrow('Ya hay una escritura');
  finish();await first;expect(attach).toHaveBeenCalledTimes(1);
});
