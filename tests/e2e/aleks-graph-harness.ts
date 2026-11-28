/** Lector y escritura reales con el renderizador ALEKS reproducido en Chromium. */
import { assistContext } from '../../extension/src/aleks-assist';
import { readAleksPrompt } from '../../extension/src/aleks-prompt';
import { drawAleksParabola } from '../../extension/src/aleks-graph';
import { AleksSubmission } from '../../extension/src/aleks-submission';
import { withNativePlot } from '../../extension/src/native-keyboard';
import type { PlotPoint } from '../../extension/src/parabola-answer';

type Fault = 'wrong-point' | 'wrong-curve' | 'abort' | 'zoom' | 'changed-after-draw' | 'permission-before-verify';
type Mode = 'draw' | 'submit' | 'repeat';
declare global {
  interface Window {
    nativeGraphCommand(method:string,params:Record<string,unknown>):Promise<void>;
    runParabolaPlot(curve:string,fault?:Fault,mode?:Mode):Promise<unknown>;
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

window.runParabolaPlot=async(pathData,fault,mode='draw')=>{
  const expected:PlotPoint[]=[[-5,1],[-7,5],[-6,2],[-4,2],[-3,5]];
  const controller=new AbortController();
  const trace={attach:0,detach:0,pencil:0,curve:0,verify:0,points:[] as PlotPoint[]};
  const submission=new AleksSubmission(document,800);
  let nexts=0,accepted=false,priorFingerprint='',repeatFingerprint='',repeatError='',renderedOnVerify=false;
  function resetGrid() {
    objects.replaceChildren();
    pencil.setAttribute('aria-pressed','false');
    curve.setAttribute('aria-disabled','true');
    document.querySelector('#result_feedback_alert')?.remove();
    document.querySelector('.learningCorrect')?.remove();
    document.body.append(verify);
  }
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
  if(mode!=='draw')verify.disabled=true;
  verify.addEventListener('click',()=>{
    trace.verify++;
    renderedOnVerify=objects.querySelectorAll('circle').length===5 && objects.querySelector('path')?.getAttribute('d')===pathData;
    if(mode==='draw')return;
    verify.remove();
    document.body.insertAdjacentHTML('beforeend',
      '<div id="result_feedback_alert" aria-live="polite"><div style="display:inline-block;color:rgb(57,108,41)">Correcta</div></div>'+
      '<button type="button" id="smt_bottomnav_button_input_learningCorrect" class="learningCorrect"><div class="textContent">Siguiente</div></button>');
    document.querySelector('.learningCorrect')!.addEventListener('click',()=>{
      nexts++;
      const formula=document.querySelector('#algoPrompt [mathml]')!;
      formula.setAttribute('mathml',formula.getAttribute('mathml')!.replace('<mn> 1</mn>','<mn> 2</mn>'));
      resetGrid();
    },{once:true});
  });
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
    verify.disabled=false;
  });
  if(fault==='changed-after-draw') {
    // El hash del enunciado se pide otra vez entre la comprobación del
    // dibujante y el clic en Verificar. Cambia la curva durante esa espera.
    const digest=crypto.subtle.digest.bind(crypto.subtle);
    let reads=0;
    Object.defineProperty(crypto.subtle,'digest',{value:(...args:Parameters<SubtleCrypto['digest']>)=>{
      const path=objects.querySelector('path');
      if(path && ++reads===2)path.setAttribute('d','M 54 90 L 131 90');
      return digest(...args);
    }});
  }
  const before=await assistContext(document);
  const prompt=await readAleksPrompt(document);
  let success=false,error='';
  const plot=(fingerprint:string)=>withNativePlot(7,{signal:controller.signal,check:async()=>{controller.signal.throwIfAborted();}},async press=>{
    const click=(_step:number,locate:()=>Promise<PlotPoint|null>)=>press(locate);
    if(mode==='draw')await drawAleksParabola(document,prompt.fingerprint!,expected,controller.signal,click);
    else await submission.submitParabola(fingerprint,expected,controller.signal,click,async()=>{
      if(fault==='permission-before-verify')throw Error('Chrome desconectó el ratón de esta pestaña.');
    });
  });
  try {
    await plot(before.fingerprint);
    accepted=mode!=='draw';
    if(mode==='submit')await submission.next(controller.signal);
    if(mode==='repeat') {
      submission.reset();
      resetGrid();
      priorFingerprint=before.fingerprint;
      // Desplaza el eje X sin cambiar el enunciado ni la escala.
      for(const label of labels.querySelectorAll<HTMLElement>('[id^="xAxis"]'))label.style.left=(parseFloat(label.style.left)-10)+'px';
      for(const line of grid.querySelectorAll('line'))if(line.getAttribute('x1')===line.getAttribute('x2')) {
        for(const attribute of ['x1','x2'])line.setAttribute(attribute,String(Number(line.getAttribute(attribute))-10));
      }
      repeatFingerprint=(await assistContext(document)).fingerprint;
      try {await plot(repeatFingerprint);}
      catch(reason){repeatError=(reason as Error).message;}
    }
    success=true;
  } catch(reason) {
    error=reason instanceof Error?reason.message:String(reason);
  }
  const after=await assistContext(document);
  return {before:before.can_draw_parabola,after:after.can_draw_parabola,success,error,trace,
    accepted,nexts,renderedOnVerify,priorFingerprint,repeatFingerprint,repeatError};
};
