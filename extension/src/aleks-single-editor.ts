import type { SingleEditorObservation } from './shared';
import { painted,visible,disabled } from './aleks-dom';

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
  const readback=readInteger(root,trees[0]);
  return {status:'observed',reason:'Un recuadro visual reconocido. Falta validar su correspondencia con el enunciado y la interacción del editor.',
    rootCount:1,disabled:disabled(inputs[0]) || inputs[0].readOnly,autoSubmitSupported:false,readback};
}

function readInteger(root:HTMLElement,tree:HTMLElement):SingleEditorObservation['readback'] {
  const nodes=[...tree.children] as HTMLElement[];
  if(nodes.length>12 || [...tree.childNodes].some(node=>node.nodeType!==1 && node.textContent?.trim()))return unsupported('El árbol visual contiene texto o tokens adicionales.');
  if(!nodes.length)return {status:'empty',reason:'Recuadro vacío.'};
  if(nodes.some(node=>node.tagName!=='SPAN' || !node.classList.contains('AnsedObject') || !painted(node) ||
    [...node.childNodes].some(child=>child.nodeType!==3) || !/^\d{1,12}$/u.test(node.textContent?.trim() || '')))return unsupported('La respuesta no tiene el formato de entero simple admitido para esta lectura.');
  const value=nodes.map(node=>node.textContent!.trim()).join('');
  if(!/^(0|[1-9]\d{0,11})$/u.test(value))return unsupported('El entero excede el formato admitido.');
  const bounds=root.getBoundingClientRect(),rects=nodes.map(node=>node.getBoundingClientRect());
  if(rects.some(rect=>rect.width<=0 || rect.height<=0 || rect.left<bounds.left-1 || rect.right>bounds.right+1 || rect.top<bounds.top-1 || rect.bottom>bounds.bottom+1))return unsupported('Los dígitos no están completamente dentro del recuadro visible.');
  const first=rects[0],tolerance=Math.max(1,first.height*.1);
  if(rects.some((rect,i)=>Math.abs(rect.top-first.top)>tolerance || Math.abs(rect.bottom-first.bottom)>tolerance ||
    (i>0 && (rect.left<rects[i-1].right-1 || rect.left-rects[i-1].right>first.height*.25))))return unsupported('Los dígitos no forman un entero continuo en la misma línea.');
  return {status:'readable',value,display:value,reason:'Entero leído del árbol visual. No confirma que sea la respuesta correcta ni una entrega aceptada.'};
}
