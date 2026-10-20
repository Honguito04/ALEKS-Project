import type { EditorObservation } from './shared';

/** Inspección de SOLO LECTURA de los atributos aportados por el usuario.
 * Un input encontrado no demuestra que input.value sea el valor completo del
 * editor. Un botón cm³ encontrado no demuestra que la unidad esté registrada.
 * El fragmento «Entregar» no contiene su ancestro clicable: no se infiere uno.
 */
export function inspectAleksEditor(document:Document):EditorObservation {
  const view=document.defaultView;
  function visible(element:HTMLElement) {
    if(!view || !element.getClientRects().length || element.closest('[aria-hidden="true"],[hidden]'))return false;
    for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement) {
      const style=view.getComputedStyle(parent);
      if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0')return false;
    }
    return true;
  }
  const inputs=[...document.querySelectorAll<HTMLInputElement>('input.ansed_input[aria-label="Answer Editor"][type="text"]')].filter(visible);
  const units=[...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Centímetros cúbicos"]')].filter(visible);
  const labels=[...document.querySelectorAll<HTMLElement>('div.textContent')].filter(el=>visible(el) && el.textContent?.trim()==='Entregar');
  const disabled=(el:HTMLElement)=>el.matches(':disabled') || Boolean(el.closest('[aria-disabled="true"]'));
  let status:EditorObservation['status']='observed';
  if(inputs.length>1 || units.length>1)status='ambiguous';
  else if(inputs.length!==1 || units.length!==1)status='missing';
  else if(disabled(inputs[0]) || inputs[0].readOnly || disabled(units[0]))status='disabled';
  return {status,inputCount:inputs.length,unitButtonCount:units.length,submitLabelCount:labels.length};
}
