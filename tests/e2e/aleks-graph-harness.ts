/** Lector y escritura reales con el renderizador ALEKS reproducido en Chromium. */
import { assistContext } from '../../extension/src/aleks-assist';
import { readAleksPrompt } from '../../extension/src/aleks-prompt';
import { drawAleksParabola } from '../../extension/src/aleks-graph';
import { withNativePlot } from '../../extension/src/native-keyboard';
import type { PlotPoint } from '../../extension/src/parabola-answer';

type Fault = 'wrong-point' | 'wrong-curve' | 'abort' | 'zoom';
declare global {
  interface Window {
    nativeGraphCommand(method:string,params:Record<string,unknown>):Promise<void>;
    runParabolaPlot(curve:string,fault?:Fault):Promise<unknown>;
  }
}

const id='Figed__worksheet_1_0';
const svgNS='http://www.w3.org/2000/svg';
const grid=document.getElementById('figed_grid_graphics_#'+id)!;
const labels=document.getElementById('figed_grid_text_#'+id)!;
const objects=document.getElementById('figed_objects_graphics_#'+id)! as unknown as SVGSVGElement;
const overlay=document.getElementById('figed_events_#'+id)!;
const pencil=document.querySelector<HTMLButtonElement>('button[aria-label="Pencil"]')!;
const curve=document.querySelector<HTMLButtonElement>('button[aria-label="Graph-a-function"]')!;
const verify=document.querySelector<HTMLButtonElement>('.checkAnswer')!;

for(const tick of [-8,-6,-4,-2,2,4,6,8]) {
  for(const axis of ['x','y']) {
    const line=document.createElementNS(svgNS,'line');
    const label=document.createElement('div');
    label.id=`${axis}Axis${id}_${tick}`;
    label.className='figed_grid_label';
    label.textContent=String(tick);
    const coordinate=Number((184.5+(axis==='x'?1:-1)*tick*18.45).toFixed(2));
    label.style[axis==='x'?'left':'top']=coordinate+'px';
    for(const [key,value] of Object.entries(axis==='x'?
      {x1:coordinate,x2:coordinate,y1:0,y2:369}:{x1:0,x2:369,y1:coordinate,y2:coordinate}))line.setAttribute(key,String(value));
    grid.append(line);
    labels.append(label);
  }
}

window.runParabolaPlot=async(pathData,fault)=>{
  const expected:PlotPoint[]=[[-5,1],[-7,5],[-6,2],[-4,2],[-3,5]];
  const controller=new AbortController();
  const trace={attach:0,detach:0,pencil:0,curve:0,verify:0,points:[] as PlotPoint[]};
  Object.defineProperty(window,'chrome',{configurable:true,value:{debugger:{
    attach:async()=>{trace.attach++;},detach:async()=>{trace.detach++;},
    onDetach:{addListener:()=>{},removeListener:()=>{}},
    sendCommand:async(_target:unknown,method:string,params:Record<string,unknown>)=>window.nativeGraphCommand(method,params),
  }}});
  pencil.addEventListener('click',event=>{
    if(!event.isTrusted)return;
    trace.pencil++;
    pencil.setAttribute('aria-pressed','true');
  });
  verify.addEventListener('click',()=>trace.verify++);
  overlay.addEventListener('click',event=>{
    if(!event.isTrusted || pencil.getAttribute('aria-pressed')!=='true')return;
    const pixel=new DOMPoint(event.clientX,event.clientY).matrixTransform(objects.getScreenCTM()!.inverse());
    const x=Math.round((pixel.x-184.5)/18.45),y=Math.round((184.5-pixel.y)/18.45);
    trace.points.push([x,y]);
    const group=document.createElementNS(svgNS,'g');
    group.id=`figed_point_${trace.points.length}_#${id}`;
    const dot=document.createElementNS(svgNS,'circle');
    dot.setAttribute('cx',String(184.5+(x+(fault==='wrong-point'?1:0))*18.45));
    dot.setAttribute('cy',String(184.5-y*18.45));
    dot.setAttribute('r','5');
    group.append(dot);
    objects.append(group);
    if(trace.points.length===5)curve.setAttribute('aria-disabled','false');
    if(trace.points.length===1 && fault==='abort')controller.abort();
    if(trace.points.length===1 && fault==='zoom')labels.querySelector<HTMLElement>('.figed_grid_label')!.style.left='22px';
  });
  curve.addEventListener('click',event=>{
    if(!event.isTrusted || trace.points.length!==5)return;
    trace.curve++;
    const group=document.createElementNS(svgNS,'g');
    group.id=`figed_function_10_#${id}`;
    const path=document.createElementNS(svgNS,'path');
    path.setAttribute('d',fault==='wrong-curve'?'M 54 90 L 131 90':pathData);
    path.setAttribute('stroke','teal');
    path.setAttribute('fill','none');
    group.append(path);
    objects.prepend(group);
  });
  const before=await assistContext(document);
  const prompt=await readAleksPrompt(document);
  let success=false,error='';
  try {
    await withNativePlot(7,{signal:controller.signal,check:async()=>{controller.signal.throwIfAborted();}},
      press=>drawAleksParabola(document,prompt.fingerprint!,expected,controller.signal,(_step,locate)=>press(locate)));
    success=true;
  } catch(reason) {
    error=reason instanceof Error?reason.message:String(reason);
  }
  const after=await assistContext(document);
  return {before:before.can_draw_parabola,after:after.can_draw_parabola,success,error,trace};
};
