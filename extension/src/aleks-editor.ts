import type { EditorObservation, EditorReadback, ControlObservation, ResultObservation } from './shared';
import { painted,visible,disabled } from './aleks-dom';
import { inspectCircleTable,inspectEditorMenu } from './aleks-circle';

function inputBlockers(element:HTMLInputElement) {
  const reasons=new Set<keyof EditorObservation['inputDiagnostics']['blockedBy']>();
  const view=element.ownerDocument.defaultView;
  if(!view){reasons.add('noView');return reasons;}
  if(!element.getClientRects().length)reasons.add('noLayout');
  if(element.closest('[hidden]'))reasons.add('hiddenAttribute');
  for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement) {
    const style=view.getComputedStyle(parent);
    if(style.display==='none')reasons.add('displayNone');
    if(style.visibility==='hidden' || style.visibility==='collapse')reasons.add('visibilityHidden');
    if(style.opacity==='0')reasons.add('opacityZero');
  }
  return reasons;
}

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

function matchingButtons(document:Document,selector:string,label:string) {
  // ID, tipo, clase funcional y etiqueta aportados por el usuario. Nunca se hace clic.
  return [...document.querySelectorAll<HTMLButtonElement>(selector)]
    .filter(button=>visible(button) && button.querySelectorAll('div.textContent').length===1 && button.querySelector('div.textContent')?.textContent?.trim()===label);
}
function describeButtons(controls:HTMLButtonElement[]):ControlObservation {
  return {status:controls.length>1?'ambiguous':controls.length===0?'missing':disabled(controls[0])?'disabled':'observed',count:controls.length};
}
function observeButton(document:Document,selector:string,label:string):ControlObservation {
  return describeButtons(matchingButtons(document,selector,label));
}
function observeSubmit(document:Document):EditorObservation['submitControl'] {
  const variants=[
    {selector:'button#smt_bottomnav_button_input_nextItemAssess.nextItemAssess[type="button"]',label:'Entregar'},
    {selector:'button#smt_bottomnav_button_input_checkAnswer.checkAnswer[type="button"]',label:'Verificar'}
  ] as const;
  const matches=variants.flatMap(variant=>matchingButtons(document,variant.selector,variant.label).map(button=>({button,label:variant.label})));
  const observation=describeButtons(matches.map(match=>match.button));
  return matches.length===1 ? {...observation,label:matches[0].label}:observation;
}

function observeResult(document:Document,next:ControlObservation,nextTopic:ControlObservation,submit:ControlObservation):ResultObservation {
  // Fragmento confirmado tras entregar 226 cm³: texto plano «Correcta» y
  // Siguiente. En el tema del círculo se aportó además el alert completo y
  // Siguiente tema: se exige ese contenedor para esta segunda variante.
  // El color no se interpreta por sí solo y el texto de un enunciado, wrapper
  // o mensaje oculto no cuenta. Esto observa una señal, no resuelve su asociación
  // a la actividad/huella de un envío iniciado por la extensión.
  const messages=[...document.querySelectorAll<HTMLDivElement>('div')].filter(element=>
    element.childNodes.length===1 && element.firstChild?.nodeType===3 && element.textContent?.trim()==='Correcta' &&
    element.style.display==='inline-block' && element.style.color==='rgb(57, 108, 41)' && visible(element));
  const count=messages.length;
  const alerts=[...document.querySelectorAll<HTMLDivElement>('#result_feedback_alert[aria-live="polite"]')].filter(visible);
  const topicMarker=nextTopic.status==='observed' && alerts.length===1 && count===1 && alerts[0].contains(messages[0]) && alerts[0].style.borderColor==='rgb(57, 108, 41)';
  const ambiguous=count>1 || next.status==='ambiguous' || nextTopic.status==='ambiguous' || next.count+nextTopic.count>1 ||
    (count>0 && submit.status!=='missing') || (nextTopic.count>0 && alerts.length>1);
  const status=ambiguous?'ambiguous':count===0?'missing':next.status==='observed' || topicMarker?'positive_marker':'incomplete';
  return {status,positiveMessageCount:count,...(status==='positive_marker' && topicMarker?{continuation:'topic' as const}:{})};
}

/** Inspección de SOLO LECTURA de los atributos aportados por el usuario.
 * Un input encontrado no demuestra que input.value sea el valor completo del
 * editor. Un botón cm³ encontrado no demuestra que la unidad esté registrada.
 * La respuesta visible y la presencia del botón no demuestran un envío aceptado.
 */
export function inspectAleksEditor(document:Document):EditorObservation {
  const matches=[...document.querySelectorAll<HTMLInputElement>('input.ansed_input[aria-label="Answer Editor"][type="text"]')];
  const inputs=matches.filter(visible);
  const blockedBy={noLayout:0,hiddenAttribute:0,displayNone:0,visibilityHidden:0,opacityZero:0,noView:0};
  for(const input of matches)for(const reason of inputBlockers(input))blockedBy[reason]++;
  const roots=new Set(matches.map(input=>input.closest<HTMLElement>('.ansed_root')).filter((root):root is HTMLElement=>root!==null));
  // Solo conteos: no se leen valores, IDs, HTML ni URLs de marcos. Un input
  // transitorio oculto no se convierte en un campo listo para escribir.
  const inputDiagnostics={presentCount:matches.length,paintedCount:matches.filter(painted).length,
    ariaHiddenCount:matches.filter(input=>input.closest('[aria-hidden="true"]')).length,
    frameCount:document.querySelectorAll('iframe,frame').length,visibleRootCount:[...roots].filter(painted).length,blockedBy};
  const units=[...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Centímetros cúbicos"]')].filter(visible);
  const labels=[...document.querySelectorAll<HTMLElement>('div.textContent')].filter(el=>visible(el) && ['Entregar','Verificar'].includes(el.textContent?.trim() || ''));
  let status:EditorObservation['status']='observed';
  if(inputs.length>1 || units.length>1)status='ambiguous';
  else if(inputs.length!==1 || units.length!==1)status='missing';
  else if(disabled(inputs[0]) || inputs[0].readOnly || disabled(units[0]))status='disabled';
  const renderedAnswer:EditorReadback=inputs.length===1 ? readRenderedQuantity(inputs[0]):{status:inputs.length?'ambiguous':'missing',reason:'No hay un único campo visible al que asociar la respuesta.'};
  const submitControl=observeSubmit(document);
  const nextControl=observeButton(document,'button#smt_bottomnav_button_input_learningCorrect.learningCorrect[type="button"]','Siguiente');
  const nextTopicControl=observeButton(document,'button#smt_bottomnav_button_input_learningCorrect.learningCorrect[type="button"]','Siguiente tema');
  return {status,inputCount:inputs.length,unitButtonCount:units.length,submitLabelCount:labels.length,inputDiagnostics,renderedAnswer,
    submitControl,nextTopicControl,circleTable:inspectCircleTable(document),menu:inspectEditorMenu(document),
    // Solo se identifica este control aportado; learningCorrect por sí solo no
    // acredita un resultado ni lo vincula a una actividad/huella o envío nuestro.
    nextControl,resultMarker:observeResult(document,nextControl,nextTopicControl,submitControl)};
}
