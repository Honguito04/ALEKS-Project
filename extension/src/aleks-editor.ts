import type { EditorObservation, EditorReadback, ControlObservation } from './shared';

function painted(element:HTMLElement) {
  const view=element.ownerDocument.defaultView;
  if(!view || !element.getClientRects().length || element.closest('[hidden]'))return false;
  for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement) {
    const style=view.getComputedStyle(parent);
    if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0')return false;
  }
  return true;
}
const visible=(element:HTMLElement)=>painted(element) && !element.closest('[aria-hidden="true"]');
const disabled=(element:HTMLElement)=>element.matches(':disabled') || Boolean(element.closest('[aria-disabled="true"]'));

/** Lectura muy limitada de la representación visual aportada: entero, cm, 3 elevado.
 * ansed_tree está aria-hidden porque duplica la representación accesible; ese
 * atributo no implica que sus glifos estén ocultos visualmente. Se comprueba CSS,
 * geometría relativa y un árbol plano conocido, sin leer canvas ni input.value.
 */
function readRenderedQuantity(input:HTMLInputElement):EditorReadback {
  const root=input.closest<HTMLElement>('.ansed_root');
  if(!root || !painted(root))return {status:'missing',reason:'No se encuentra la raíz visual del editor observado.'};
  const trees=root.querySelectorAll<HTMLElement>(':scope > .ansed_tree');
  if(trees.length!==1)return {status:trees.length?'ambiguous':'missing',reason:'Se necesita un único árbol visual asociado al campo.'};
  const tree=trees[0];
  if(!painted(tree))return {status:'missing',reason:'El árbol de respuesta no está visible.'};
  const nodes=[...tree.children] as HTMLElement[];
  if(nodes.length===0)return {status:'missing',reason:'El editor no tiene una respuesta representada.'};
  if(nodes.length!==3 || nodes.some(n=>n.tagName!=='SPAN' || !n.classList.contains('AnsedObject') || !painted(n) || [...n.childNodes].some(c=>c.nodeType!==3)) || [...tree.childNodes].some(n=>n.nodeType!==1 && Boolean(n.textContent?.trim()))) {
    return {status:'unsupported',reason:'La estructura matemática no coincide con el entero y unidad cúbica observados.'};
  }
  const [number,unit,power]=nodes;
  const value=number.textContent?.trim() || '';
  if(!/^(0|[1-9]\d{0,11})$/.test(value) || unit.textContent?.trim()!=='cm' || power.textContent?.trim()!=='3') {
    return {status:'unsupported',reason:'Solo se ha observado un entero con centímetros cúbicos; no se deducen otras formas.'};
  }
  const [n,u,p]=nodes.map(node=>node.getBoundingClientRect());
  const bounds=root.getBoundingClientRect(),tolerance=Math.max(1,Math.min(n.height,u.height)*.15);
  const inside=[n,u,p].every(r=>r.width>0 && r.height>0 && r.left>=bounds.left-1 && r.right<=bounds.right+1 && r.top>=bounds.top-1 && r.bottom<=bounds.bottom+1);
  const sameLine=Math.abs(n.top-u.top)<=tolerance && Math.abs(n.bottom-u.bottom)<=tolerance;
  const ordered=n.right<=u.left+1 && u.left-n.right<=u.height*2 && p.left>=u.right-2 && p.left-u.right<=u.height;
  const superscript=p.top<u.top-u.height*.2 && p.bottom<u.bottom-u.height*.15 && p.height<=u.height;
  if(!inside || !sameLine || !ordered || !superscript)return {status:'unsupported',reason:'No se puede confirmar que el 3 sea el exponente de cm o que la respuesta esté visible completa.'};
  return {status:'readable',reason:'Leído del árbol visual; la aceptación de ALEKS aún no está comprobada.',value,unit:'cm^3',display:`${value} cm³`};
}

function observeButton(document:Document,selector:string,label:string):ControlObservation {
  // ID, tipo, clase funcional y etiqueta aportados por el usuario. Nunca se hace clic.
  const controls=[...document.querySelectorAll<HTMLButtonElement>(selector)]
    .filter(button=>visible(button) && button.querySelectorAll('div.textContent').length===1 && button.querySelector('div.textContent')?.textContent?.trim()===label);
  return {status:controls.length>1?'ambiguous':controls.length===0?'missing':disabled(controls[0])?'disabled':'observed',count:controls.length};
}

/** Inspección de SOLO LECTURA de los atributos aportados por el usuario.
 * Un input encontrado no demuestra que input.value sea el valor completo del
 * editor. Un botón cm³ encontrado no demuestra que la unidad esté registrada.
 * La respuesta visible y la presencia del botón no demuestran un envío aceptado.
 */
export function inspectAleksEditor(document:Document):EditorObservation {
  const inputs=[...document.querySelectorAll<HTMLInputElement>('input.ansed_input[aria-label="Answer Editor"][type="text"]')].filter(visible);
  const units=[...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Centímetros cúbicos"]')].filter(visible);
  const labels=[...document.querySelectorAll<HTMLElement>('div.textContent')].filter(el=>visible(el) && el.textContent?.trim()==='Entregar');
  let status:EditorObservation['status']='observed';
  if(inputs.length>1 || units.length>1)status='ambiguous';
  else if(inputs.length!==1 || units.length!==1)status='missing';
  else if(disabled(inputs[0]) || inputs[0].readOnly || disabled(units[0]))status='disabled';
  const renderedAnswer:EditorReadback=inputs.length===1 ? readRenderedQuantity(inputs[0]):{status:inputs.length?'ambiguous':'missing',reason:'No hay un único campo visible al que asociar la respuesta.'};
  return {status,inputCount:inputs.length,unitButtonCount:units.length,submitLabelCount:labels.length,renderedAnswer,
    submitControl:observeButton(document,'button#smt_bottomnav_button_input_nextItemAssess.nextItemAssess[type="button"]','Entregar'),
    // Solo se identifica este control aportado; learningCorrect por sí solo no
    // acredita un resultado ni lo vincula a una actividad/huella o envío nuestro.
    nextControl:observeButton(document,'button#smt_bottomnav_button_input_learningCorrect.learningCorrect[type="button"]','Siguiente')};
}
