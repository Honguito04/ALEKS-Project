import type { CircleTableObservation, EditorMenuObservation, PiReadback } from './shared';
import { painted,visible,disabled } from './aleks-dom';

const INPUT='input.ansed_input[aria-label="Answer Editor"][type="text"]';
const normalize=(text:string)=>text.replace(/\s+/gu,' ').replace(/\s+:/gu,':').trim();
const integer=(text:string)=>/^(0|[1-9]\d{0,7})$/u.test(text);
const unsupported=(reason:string):PiReadback=>({status:'unsupported',reason});

function glyphs(tree:HTMLElement):HTMLElement[]|undefined {
  const nodes=[...tree.children] as HTMLElement[];
  if(nodes.length>12 || [...tree.childNodes].some(n=>n.nodeType!==1 && n.textContent?.trim()))return;
  if(nodes.some(node=>node.tagName!=='SPAN' || !node.classList.contains('AnsedObject') || !painted(node) ||
    [...node.childNodes].some(n=>n.nodeType!==3) || (node.textContent || '').length>80))return;
  return nodes;
}

/** Solo los dos formatos con pi aportados. No evalúa canvas, input.value ni HTML. */
function readPi(root:HTMLElement,kind:'arc_length'|'shaded_area'):PiReadback {
  const trees=root.querySelectorAll<HTMLElement>(':scope > .ansed_tree');
  if(trees.length!==1 || !painted(trees[0]))return unsupported('No hay un único árbol visual pintado.');
  const nodes=glyphs(trees[0]);
  if(!nodes)return unsupported('La estructura visual incluye tokens no admitidos.');
  if(!nodes.length)return {status:'empty',reason:'Recuadro vacío.'};
  const tokens=nodes.map(node=>node.textContent?.trim() || '');
  const bounds=root.getBoundingClientRect(),rects=nodes.map(node=>node.getBoundingClientRect());
  if(rects.some(r=>r.width<=0 || r.height<=0 || r.left<bounds.left-1 || r.right>bounds.right+1 || r.top<bounds.top-1 || r.bottom>bounds.bottom+1))return unsupported('Hay glifos fuera del contenedor o sin tamaño visible.');
  const tolerance=Math.max(1,rects[0].height*.15);
  const sameLine=(a:DOMRect,b:DOMRect)=>Math.abs(a.top-b.top)<=tolerance && Math.abs(a.bottom-b.bottom)<=tolerance;
  const ordered=(a:DOMRect,b:DOMRect)=>a.right<=b.left+1 && b.left-a.right<=Math.max(a.height,b.height)*2;
  const readable=(display:string,unit?:'cm'|'cm^2',denominator?:string):PiReadback=>({status:'readable',display,coefficient:tokens[0],
    ...(unit?{unit}:{}),...(denominator?{denominator}:{}),reason:unit?'Representación visual observada; no acredita una entrega de la extensión.':'Representación visual observada sin unidad.'});
  if(!integer(tokens[0]) || tokens[1]!=='π' || !sameLine(rects[0],rects[1]) || !ordered(rects[0],rects[1]))return unsupported('No coincide con un coeficiente entero seguido de pi.');
  if(nodes.length===2)return readable(`${tokens[0]}π`);
  if(kind==='arc_length' && nodes.length===3 && tokens[2]==='cm' && sameLine(rects[1],rects[2]) && ordered(rects[1],rects[2]))return readable(`${tokens[0]}π cm`,'cm');
  if(nodes.length===4 && kind==='shaded_area' && tokens[2]==='cm' && tokens[3]==='2') {
    const [number,pi,unit,power]=rects;
    const raised=power.top<unit.top-unit.height*.2 && power.bottom<unit.bottom-unit.height*.15 && power.height<=unit.height;
    if(sameLine(number,unit) && ordered(pi,unit) && ordered(unit,power) && raised)return readable(`${tokens[0]}π cm²`,'cm^2');
  }
  if(nodes.length===4 && kind==='arc_length' && integer(tokens[2]) && tokens[2]!=='0' && tokens[3]==='cm') {
    const [number,pi,denominator,unit]=rects;
    const numeratorCenter=(number.left+pi.right)/2,denominatorCenter=(denominator.left+denominator.right)/2;
    const fractionCenter=(number.bottom+denominator.top)/2,unitCenter=(unit.top+unit.bottom)/2;
    const fraction=denominator.top>Math.max(number.bottom,pi.bottom)+1 &&
      Math.abs(numeratorCenter-denominatorCenter)<=number.height*.3 && Math.abs(fractionCenter-unitCenter)<=tolerance &&
      unit.left>=Math.max(number.right,pi.right,denominator.right)+1 && unit.left-pi.right<=unit.height*2;
    if(fraction)return readable(`${tokens[0]}π/${tokens[2]} cm`,'cm',tokens[2]);
  }
  return unsupported('La unidad o la disposición no coincide con los formatos de arco y área observados.');
}

function rowKind(cell:HTMLTableCellElement):'arc_length'|'shaded_area'|undefined {
  const accessible=cell.querySelectorAll<HTMLElement>('.visually-hidden.never_read');
  const roots=cell.querySelectorAll<HTMLElement>('.ansed_root');
  if(accessible.length!==1 || roots.length!==1 || !painted(roots[0]))return;
  const trees=roots[0].querySelectorAll<HTMLElement>(':scope > .ansed_tree');
  if(trees.length!==1)return;
  const nodes=glyphs(trees[0]);
  if(!nodes)return;
  const text=normalize(nodes.map(n=>n.textContent || '').join(' '));
  const alternative=normalize(accessible[0].textContent || '');
  if(text==='Longitud de AB:' && alternative==='Longitud de comienza arco A B termina barra arc:')return 'arc_length';
  if(text==='Área de la región sombreada:' && alternative===text)return 'shaded_area';
}

export function inspectCircleTable(document:Document):CircleTableObservation {
  const fail=(status:CircleTableObservation['status'],reason:string):CircleTableObservation=>({status,reason,fields:[],autoSubmitSupported:false});
  const tables=[...document.querySelectorAll<HTMLTableElement>('table[role="presentation"]')].filter(table=>visible(table) &&
    table.querySelectorAll(INPUT).length===2 && [...table.rows].some(row=>row.cells.length===2 && !row.cells[0].querySelector(INPUT) && rowKind(row.cells[0])));
  if(tables.length!==1)return fail(tables.length?'ambiguous':'missing',tables.length?'Hay varias tablas de arco y área visibles.':'No hay una tabla única con las etiquetas observadas de arco y área.');
  const table=tables[0],rows=[...table.rows];
  if(rows.length!==2 || rows.some(row=>row.cells.length!==2))return fail('unsupported','La tabla no conserva dos filas con etiqueta y respuesta.');
  const fields:CircleTableObservation['fields']=[];
  for(const row of rows) {
    const kind=rowKind(row.cells[0]),cell=row.cells[1];
    const inputs=cell.querySelectorAll<HTMLInputElement>(INPUT),roots=cell.querySelectorAll<HTMLElement>('.ansed_root');
    if(!kind || fields.some(field=>field.kind===kind) || inputs.length!==1 || roots.length!==1 || inputs[0].closest('.ansed_root')!==roots[0] || !painted(roots[0]))return fail('unsupported','No se pueden asociar ambas etiquetas a un editor visual único.');
    fields.push({kind,label:kind==='arc_length'?'Longitud del arco AB':'Área de la región sombreada',readback:readPi(roots[0],kind)});
  }
  fields.sort((a,b)=>a.kind.localeCompare(b.kind));
  const locked=disabled(table) || [...table.querySelectorAll<HTMLInputElement>(INPUT)].some(input=>disabled(input) || input.readOnly);
  return {status:'observed',reason:'Dos recuadros asociados por las etiquetas de sus filas. La opacidad del input no sustituye la lectura del contenedor visual.',disabled:locked,fields,autoSubmitSupported:false};
}

export function inspectEditorMenu(document:Document):EditorMenuObservation {
  const menus=[...document.querySelectorAll<HTMLElement>('.aleks-editor-menu')].filter(visible);
  const labels={fraction:'Fraction',pi:'π',cm:'Centímetros',cmSquared:'Centímetros cuadrados'} as const;
  const controls={} as EditorMenuObservation['controls'];
  for(const key of Object.keys(labels) as (keyof typeof labels)[]) {
    const buttons=menus.length===1 ? [...menus[0].querySelectorAll<HTMLButtonElement>('button')].filter(button=>button.getAttribute('aria-label')===labels[key] && visible(button)):[];
    controls[key]={status:menus.length>1 || buttons.length>1?'ambiguous':!buttons.length?'missing':disabled(buttons[0])?'disabled':'observed',count:buttons.length};
  }
  return {status:menus.length>1?'ambiguous':menus.length===1?'observed':'missing',controls};
}

export function observedCircleTopic(document:Document):string|undefined {
  const title='Longitud de un arco y el área de un sector circular';
  const nodes=[...document.querySelectorAll<HTMLElement>('div[title]')].filter(node=>node.getAttribute('title')===title && node.textContent?.trim()===title && visible(node));
  return nodes.length===1?title:undefined;
}
