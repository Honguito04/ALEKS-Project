import { disabled,visible } from './aleks-dom';

export interface AleksRouteObservation {
  status:'missing'|'observed'|'disabled'|'ambiguous';
  labelCount:number;
  controlCount:number;
  markerCount:number;
}

const label='Continuar en Mi ruta',markerText='Temas restantes';
const text=(element:HTMLElement)=>element.textContent?.replace(/\s+/gu,' ').trim();

/** El fragmento observado aporta el texto, no un ID estable del botón.
 * Solo se acepta su ancestro con semántica de botón; un div aislado no basta.
 * No se devuelve HTML, URLs, números de progreso ni datos de la cuenta.
 */
export function resolveAleksRoute(document:Document):{
  observation:AleksRouteObservation;control?:HTMLElement;marker?:HTMLElement
} {
  const labels=[...document.querySelectorAll<HTMLElement>('div.textContent')]
    .filter(element=>visible(element) && text(element)===label);
  const controls=[...new Set(labels.map(element=>element.closest<HTMLElement>('button,[role="button"]'))
    .filter((element):element is HTMLElement=>Boolean(element && visible(element) && text(element)===label)))];
  // Solo las hojas: los div ancestros del mismo rótulo no son otros mensajes.
  const markers=[...document.querySelectorAll<HTMLElement>('div')].filter(element=>
    element.children.length===0 && visible(element) && text(element)===markerText &&
    !element.closest('button,[role="button"]'));
  let status:AleksRouteObservation['status']='missing';
  if(labels.length>1 || controls.length>1 || markers.length>1)status='ambiguous';
  else if(labels.length===1 && controls.length===1 && markers.length===1) {
    status=disabled(controls[0]) || disabled(labels[0]) || Boolean(controls[0].closest('[inert]'))?'disabled':'observed';
  }
  const observation={status,labelCount:labels.length,controlCount:controls.length,markerCount:markers.length};
  return status==='observed'?{observation,control:controls[0],marker:markers[0]}:{observation};
}

export function inspectAleksRoute(document:Document):AleksRouteObservation {
  return resolveAleksRoute(document).observation;
}
