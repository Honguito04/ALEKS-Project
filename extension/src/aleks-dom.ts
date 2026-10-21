/** Visibilidad CSS observada, separada de la copia accesible del renderizador. */
export function painted(element:HTMLElement) {
  const view=element.ownerDocument.defaultView;
  if(!view || !element.getClientRects().length || element.closest('[hidden]'))return false;
  for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement) {
    const style=view.getComputedStyle(parent);
    if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0')return false;
  }
  return true;
}
export const visible=(element:HTMLElement)=>painted(element) && !element.closest('[aria-hidden="true"]');
export const disabled=(element:HTMLElement)=>element.matches(':disabled') || Boolean(element.closest('[aria-disabled="true"],.disabled_tabed'));
