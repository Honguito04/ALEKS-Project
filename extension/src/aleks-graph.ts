import { disabled, visible } from './aleks-dom';
import { readAleksPrompt } from './aleks-prompt';
import { parabolaPointsSchema, type PlotPoint } from './parabola-answer';

type Axis = { origin: number; step: number };
type Grid = {
  root: HTMLElement;
  grid: SVGSVGElement;
  objects: SVGSVGElement;
  objectLabels: HTMLElement;
  overlay: HTMLElement;
  pencil: HTMLButtonElement;
  curve: HTMLButtonElement;
  x: Axis;
  y: Axis;
  signature: string;
};
export type GraphClick = (step: number, target: () => Promise<PlotPoint|null>) => Promise<void>;
const tolerance = 0.75;
const numberText = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u;
const closeTo = (a: number,b: number,epsilon=tolerance) => Math.abs(a-b)<=epsilon;
const delay = () => new Promise(resolve=>setTimeout(resolve,40));

function finiteNumber(text: string|null|undefined) {
  return text && numberText.test(text) ? Number(text) : NaN;
}

function axis(labels:HTMLElement, prefix:string, position:'left'|'top', lines:number[]):Axis|undefined {
  const ticks=[...labels.querySelectorAll<HTMLElement>('.figed_grid_label')].filter(label=>label.id.startsWith(prefix));
  if(ticks.length<3 || ticks.length>40)return;
  const values=ticks.map(tick=>({
    value:finiteNumber(tick.textContent?.trim().replace('−','-').replace(',','.')),
    pixel:finiteNumber(tick.style[position].endsWith('px')?tick.style[position].slice(0,-2):null),
  })).sort((a,b)=>a.value-b.value);
  if(values.some(({value,pixel})=>!Number.isFinite(value) || !lines.some(line=>closeTo(line,pixel,0.1))) ||
    new Set(values.map(({value})=>value)).size!==values.length)return;
  const first=values[0],last=values[values.length-1];
  const step=(last.pixel-first.pixel)/(last.value-first.value);
  const origin=first.pixel-first.value*step;
  if(!Number.isFinite(origin) || (position==='left'?step<4:step>-4) ||
    !values.every(({value,pixel})=>closeTo(origin+value*step,pixel,0.1)))return;
  return {origin,step};
}

/** Calibra los dos ejes con las etiquetas y líneas del mismo SVG de ALEKS. */
export function inspectParabolaGrid(document:Document):Grid|undefined {
  const roots=[...document.querySelectorAll<HTMLElement>('.figed_main > .figed_root[role="application"]')].filter(visible);
  if(roots.length!==1)return;
  const root=roots[0];
  const id=/^editor_(Figed__worksheet_[0-9]+_[0-9]+)$/u.exec(root.parentElement?.id||'')?.[1];
  if(!id || disabled(root))return;
  const layer=(name:string)=>[...root.children].find(node=>node.id===`figed_${name}_#${id}` && node.classList.contains('figed_top_container'));
  const grid=layer('grid_graphics') as SVGSVGElement|undefined;
  const objects=layer('objects_graphics') as SVGSVGElement|undefined;
  const overlay=layer('events') as HTMLElement|undefined;
  const labels=layer('grid_text') as HTMLElement|undefined;
  const objectLabels=layer('objects_text') as HTMLElement|undefined;
  if(grid?.localName!=='svg' || objects?.localName!=='svg' || overlay?.localName!=='div' || labels?.localName!=='div' || objectLabels?.localName!=='div' ||
    !grid.hasAttribute('viewBox') || grid.getAttribute('viewBox')!==objects.getAttribute('viewBox') || !visible(overlay))return;
  const pencils=[...document.querySelectorAll<HTMLButtonElement>('button[id^="menubar_"][id$="_figed_pencilgraph"][aria-label="Pencil"]')].filter(visible);
  const curves=[...document.querySelectorAll<HTMLButtonElement>('button[id^="menubar_"][id$="_figed_graphfunction"][aria-label="Graph-a-function"]')].filter(visible);
  if(pencils.length!==1 || curves.length!==1 || pencils[0].id.replace(/pencilgraph$/u,'graphfunction')!==curves[0].id)return;

  const {width,height,x:left,y:top}=grid.viewBox.baseVal;
  const lines=grid.querySelectorAll('line');
  if(left!==0 || top!==0 || !(width>=40 && height>=40) || lines.length>600)return;
  const vertical:number[]=[],horizontal:number[]=[];
  for(const line of lines) {
    const x1=finiteNumber(line.getAttribute('x1')),x2=finiteNumber(line.getAttribute('x2'));
    const y1=finiteNumber(line.getAttribute('y1')),y2=finiteNumber(line.getAttribute('y2'));
    if(x1===x2 && closeTo(Math.abs(y1-y2),height,0.1))vertical.push(x1);
    if(y1===y2 && closeTo(Math.abs(x1-x2),width,0.1))horizontal.push(y1);
  }
  const x=axis(labels,`xAxis${id}_`,'left',vertical),y=axis(labels,`yAxis${id}_`,'top',horizontal);
  if(!x || !y)return;
  return {root,grid,objects,objectLabels,overlay,pencil:pencils[0],curve:curves[0],x,y,
    signature:JSON.stringify([id,width,height,x,y])};
}

export function isEmptyParabolaGrid(grid:Grid) {
  const pressed=grid.pencil.getAttribute('aria-pressed');
  return !grid.objects.children.length && !grid.objectLabels.children.length && !grid.objectLabels.textContent?.trim() &&
    !disabled(grid.pencil) && (pressed==='true' || pressed==='false');
}

function observedObjects(grid:Grid) {
  const points:PlotPoint[]=[];
  let curve:Element|undefined;
  const id=grid.objects.id.slice('figed_objects_graphics_#'.length);
  const view=grid.objects.ownerDocument.defaultView;
  if(!view || grid.objects.children.length>6)return;
  for(const group of grid.objects.children) {
    if(group.localName!=='g' || group.children.length!==1 || group.hasAttribute('transform') ||
      !group.id.endsWith('_#'+id))return;
    const shape=group.children[0];
    if(shape.hasAttribute('transform'))return;
    const style=view.getComputedStyle(shape);
    if(!shape.getClientRects().length || style.display==='none' || style.visibility!=='visible' ||
      Number(style.opacity)===0 || Number(view.getComputedStyle(group).opacity)===0)return;
    if(/^figed_point_\d+_#/u.test(group.id) && shape.localName==='circle') {
      const x=finiteNumber(shape.getAttribute('cx')),y=finiteNumber(shape.getAttribute('cy'));
      if(!Number.isFinite(x) || !Number.isFinite(y) || !(finiteNumber(shape.getAttribute('r'))>0))return;
      points.push([x,y]);
    } else if(/^figed_function_\d+_#/u.test(group.id) && shape.localName==='path' && !curve) {
      if(style.stroke==='none' || !(Number.parseFloat(style.strokeWidth)>0))return;
      curve=shape;
    } else return;
  }
  return {points,curve};
}

function graphPosition(grid:Grid,[x,y]:PlotPoint):PlotPoint {
  return [grid.x.origin+x*grid.x.step,grid.y.origin+y*grid.y.step];
}

function matchesPoints(actual:PlotPoint[],expected:PlotPoint[]) {
  return actual.length===expected.length && expected.every(([x,y])=>
    actual.some(([ox,oy])=>closeTo(x,ox) && closeTo(y,oy)));
}

/** ALEKS dibuja la función con un M y segmentos L en coordenadas de su SVG. */
function matchesCurve(grid:Grid,curve:Element,points:PlotPoint[]) {
  const data=curve.getAttribute('d');
  if(!data || data.length>200_000)return false;
  const tokens=data.trim().split(/\s+/u),segments:PlotPoint[]=[];
  if(tokens.length%3 || tokens.length>12_288)return false;
  for(let i=0;i<tokens.length;i+=3) {
    const x=finiteNumber(tokens[i+1]),y=finiteNumber(tokens[i+2]);
    if(tokens[i]!== (i?'L':'M') || !Number.isFinite(x) || !Number.isFinite(y) ||
      (i && x<=segments[segments.length-1][0]))return false;
    segments.push([x,y]);
  }
  const [h,k]=points[0],a=points[2][1]-k;
  // Comprueba también los puntos intermedios para rechazar una unión lineal.
  for(let dx=-2;dx<=2;dx+=0.5) {
    const [x,y]=graphPosition(grid,[h+dx,k+a*dx**2]);
    const next=segments.findIndex(([sx])=>sx>=x-0.01);
    if(next<0)return false;
    const [sx,sy]=segments[next];
    if(closeTo(sx,x,0.01)) {
      if(!closeTo(sy,y))return false;
      continue;
    }
    if(!next)return false;
    const [px,py]=segments[next-1];
    if(!closeTo(py+(sy-py)*(x-px)/(sx-px),y))return false;
  }
  return true;
}

function safeTarget(element:HTMLElement,x:number,y:number):PlotPoint {
  const hit=element.ownerDocument.elementFromPoint(x,y);
  const control=hit?.closest('button,a,input,[role="button"]');
  if(!hit || !element.contains(hit) || (control && control!==element)) {
    throw Error('La cuadrícula o sus controles están fuera de la vista o cubiertos.');
  }
  return [x,y];
}

function buttonTarget(button:HTMLButtonElement):PlotPoint {
  const rect=button.getBoundingClientRect();
  return safeTarget(button,rect.x+rect.width/2,rect.y+rect.height/2);
}

function pointTarget(grid:Grid,position:PlotPoint):PlotPoint {
  const [x,y]=position,{width,height}=grid.grid.viewBox.baseVal;
  const matrix=grid.objects.getScreenCTM();
  if(!matrix || x<=0 || x>=width || y<=0 || y>=height)throw Error('Algún punto queda fuera de la cuadrícula visible. Ajusta la vista en ALEKS y vuelve a leer la actividad.');
  const screen=new DOMPoint(x,y).matrixTransform(matrix);
  return safeTarget(grid.overlay,screen.x,screen.y);
}

export async function drawAleksParabola(document:Document,promptFingerprint:string,points:PlotPoint[],signal:AbortSignal,click:GraphClick) {
  parabolaPointsSchema.parse(points);
  const grid=inspectParabolaGrid(document);
  if(!grid || !isEmptyParabolaGrid(grid))throw Error('Abre una cuadrícula de ALEKS vacía y compatible antes de dibujar.');
  const checkFocus=()=>{
    signal.throwIfAborted();
    if(!document.hasFocus())throw Error('ALEKS perdió el foco. Revisa la cuadrícula antes de continuar.');
  };
  const guard=async(expected:PlotPoint[],withCurve=false)=>{
    checkFocus();
    const prompt=await readAleksPrompt(document);
    checkFocus();
    const current=inspectParabolaGrid(document);
    if(prompt.fingerprint!==promptFingerprint || !prompt.graphingExerciseDetected || prompt.diagramReferenceDetected ||
      !current || current.signature!==grid.signature || current.root!==grid.root || current.grid!==grid.grid ||
      current.overlay!==grid.overlay || current.objects!==grid.objects || current.pencil!==grid.pencil || current.curve!==grid.curve) {
      throw Error('Cambió el ejercicio o la escala de la cuadrícula. Revisa ALEKS y vuelve a leer la actividad.');
    }
    if(!reflected(expected,withCurve))throw Error('ALEKS no reflejó los puntos o la curva esperados. Revisa el dibujo antes de continuar.');
  };
  const reflected=(expected:PlotPoint[],withCurve=false)=>{
    const objects=observedObjects(grid);
    return Boolean(objects && matchesPoints(objects.points,expected) &&
      (withCurve ? objects.curve && matchesCurve(grid,objects.curve,points) : !objects.curve));
  };
  const waitFor=async(predicate:()=>boolean,message:string)=>{
    const end=performance.now()+1500;
    do {
      checkFocus();
      if(predicate())return;
      await delay();
    } while(performance.now()<end);
    throw Error(message);
  };
  checkFocus();
  grid.root.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  const positions=points.map(point=>graphPosition(grid,point));
  await click(0,async()=>{
    await guard([]);
    if(!isEmptyParabolaGrid(grid))throw Error('La cuadrícula dejó de estar vacía o disponible.');
    positions.forEach(position=>pointTarget(grid,position));
    if(!disabled(grid.curve))buttonTarget(grid.curve);
    return grid.pencil.getAttribute('aria-pressed')==='true'?null:buttonTarget(grid.pencil);
  });
  await waitFor(()=>grid.pencil.getAttribute('aria-pressed')==='true','ALEKS no activó el lápiz.');
  for(const [index,position] of positions.entries()) {
    await click(index+1,async()=>{
      await guard(positions.slice(0,index));
      if(grid.pencil.getAttribute('aria-pressed')!=='true')throw Error('El lápiz de ALEKS dejó de estar activo.');
      return pointTarget(grid,position);
    });
    await waitFor(()=>reflected(positions.slice(0,index+1)),`ALEKS no confirmó el punto ${index+1}. Revisa la cuadrícula.`);
  }
  await click(6,async()=>{
    await guard(positions);
    if(disabled(grid.curve))throw Error('El botón de la curva sigue deshabilitado. Revisa los cinco puntos en ALEKS.');
    return buttonTarget(grid.curve);
  });
  await waitFor(()=>reflected(positions,true),'ALEKS no mostró la parábola esperada. Revisa el dibujo en la cuadrícula.');
  await guard(positions,true);
}
