import type { SingleEditorObservation } from './shared';
import { painted,visible,disabled } from './aleks-dom';
import { parseSupportedAnswer } from './answer-format';

const INPUT='input.ansed_input[aria-label="Answer Editor"][type="text"]';
const unsupported=(reason:string):SingleEditorObservation['readback']=>({status:'unsupported',reason});

/** Diagnóstico de un único editor visual, sin exigir controles de unidades.
 * Reconocer la raíz no valida su relación con el enunciado ni permite escribir.
 * El buffer del input, canvas y los IDs dinámicos no se leen.
 */
export function inspectSingleEditor(document:Document):SingleEditorObservation {
  const roots=new Set([...document.querySelectorAll<HTMLInputElement>(INPUT)]
    .map(input=>input.closest<HTMLElement>('.ansed_root'))
    .filter((root):root is HTMLElement=>root!==null && visible(root) && !root.closest('#algoPrompt')));
  const fail=(status:SingleEditorObservation['status'],reason:string):SingleEditorObservation=>({
    status,reason,rootCount:roots.size,autoSubmitSupported:false,readback:unsupported(reason)});
  if(roots.size!==1)return fail(roots.size?'ambiguous':'missing',roots.size?'Hay varios editores visuales; no se elige un recuadro sin sus etiquetas.':'No hay un editor visual único asociado al input conocido.');
  const root=[...roots][0],inputs=root.querySelectorAll<HTMLInputElement>(INPUT);
  const trees=root.querySelectorAll<HTMLElement>(':scope > .ansed_tree');
  if(inputs.length!==1 || root.querySelector('.ansed_root') || trees.length!==1 || !painted(trees[0]))return fail('unsupported','El recuadro no conserva un único input y árbol visual reconocidos.');
  const readback=readNumber(root,trees[0]);
  return {status:'observed',reason:'Un recuadro visual reconocido. Falta validar su correspondencia con el enunciado y la interacción del editor.',
    rootCount:1,disabled:disabled(inputs[0]) || inputs[0].readOnly,autoSubmitSupported:false,readback};
}

function readNumber(root:HTMLElement,tree:HTMLElement):SingleEditorObservation['readback'] {
  const nodes=[...tree.children] as HTMLElement[];
  if(nodes.length>24 || [...tree.childNodes].some(node=>node.nodeType!==1 && node.textContent?.trim()))return unsupported('El árbol visual contiene texto o tokens adicionales.');
  if(!nodes.length)return {status:'empty',reason:'Recuadro vacío.'};
  if(nodes.some(node=>node.tagName!=='SPAN' || !node.classList.contains('AnsedObject') || !painted(node) ||
    [...node.childNodes].some(child=>child.nodeType!==3) || !/^\d{1,12}$/u.test(node.textContent?.trim() || '')))return unsupported('La respuesta no tiene el formato de entero o fracción simple admitido para esta lectura.');
  const bounds=root.getBoundingClientRect(),rects=nodes.map(node=>node.getBoundingClientRect());
  if(rects.some(rect=>rect.width<=0 || rect.height<=0 || rect.left<bounds.left-1 || rect.right>bounds.right+1 || rect.top<bounds.top-1 || rect.bottom>bounds.bottom+1))return unsupported('Los dígitos no están completamente dentro del recuadro visible.');
  const rows:{nodes:HTMLElement[];rects:DOMRect[]}[]=[];
  for(const index of nodes.map((_,i)=>i).sort((a,b)=>rects[a].top-rects[b].top || rects[a].left-rects[b].left)) {
    const rect=rects[index];let row=rows.find(candidate=>Math.abs(candidate.rects[0].top-rect.top)<=Math.max(1,rect.height*.1));
    if(!row){row={nodes:[],rects:[]};rows.push(row);}
    row.nodes.push(nodes[index]);row.rects.push(rect);
  }
  if(rows.length>2)return unsupported('La respuesta ocupa más de dos líneas.');
  const values:string[]=[];
  for(const row of rows) {
    const first=row.rects[0],tolerance=Math.max(1,first.height*.1);
    if(row.rects.some((rect,i)=>Math.abs(rect.bottom-first.bottom)>tolerance ||
      (i>0 && (rect.left<row.rects[i-1].right-1 || rect.left-row.rects[i-1].right>first.height*.25))))return unsupported('Los dígitos no forman un número continuo.');
    const value=row.nodes.map(node=>node.textContent!.trim()).join('');
    if(!/^(0|[1-9]\d{0,11})$/u.test(value))return unsupported('El número excede el formato admitido.');
    values.push(value);
  }
  if(rows.length===1) {
    // Preserve DOM order for the integer reader; reordered glyphs are ambiguous.
    if(rows[0].nodes.some((node,i)=>node!==nodes[i]))return unsupported('El orden de los dígitos no coincide con su representación.');
    return {status:'readable',value:values[0],display:values[0],reason:'Entero leído del árbol visual. No confirma que sea la respuesta correcta ni una entrega aceptada.'};
  }
  const [n,d]=rows,top=n.rects[0],bottom=d.rects[0];
  const nCenter=(top.left+n.rects.at(-1)!.right)/2,dCenter=(bottom.left+d.rects.at(-1)!.right)/2;
  const gap=bottom.top-top.bottom;
  if(gap<2 || gap>Math.max(top.height,bottom.height)*1.5 || Math.abs(nCenter-dCenter)>Math.min(top.height,bottom.height)*.3 ||
    Math.abs(top.height-bottom.height)>Math.max(top.height,bottom.height)*.2)return unsupported('No se reconoce un numerador alineado encima de su denominador.');
  const value=values.join('/');
  if(parseSupportedAnswer(value)?.kind!=='fraction')return unsupported('La fracción debe tener denominador positivo y estar reducida.');
  return {status:'readable',value,display:value,reason:'Fracción leída de dos filas de glifos del editor. No confirma su aceptación por ALEKS.'};
}
