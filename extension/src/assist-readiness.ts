import type { AssistContext,AssistResult,AssistView,FillBlocker } from './shared';

export const fillBlockerMessages:Record<FillBlocker,string>={
  unreadable_prompt:'No se pudo leer el enunciado como texto. La escritura asistida necesita esa lectura.',
  editor_missing:'No se encontró un recuadro visual asociado. Abre el ejercicio y vuelve a leer la actividad.',
  multiple_editors:'Hay varios recuadros. La escritura actual admite un único recuadro.',
  editor_structure:'No se reconoce una estructura única del editor para comprobar lo escrito.',
  editor_disabled:'El recuadro está deshabilitado o es de solo lectura.',
  editor_not_empty:'El recuadro ya contiene una respuesta. Vacíalo manualmente y vuelve a consultar.',
  unsupported_readback:'No se puede comprobar que el recuadro esté vacío. Revisa su contenido.',
  result_present:'Se observa un resultado o un botón de avance. Abre un ejercicio sin resolver y vuelve a consultar.',
  diagram_required:'Esta respuesta depende de un diagrama que la escritura asistida no valida.',
  image_based_proposal:'La propuesta depende de una captura. Si el ejercicio se resuelve solo con el texto, desmarca la captura y vuelve a consultar.',
  answer_format:'La escritura actual admite un entero no negativo de hasta doce dígitos, sin unidad, en un único recuadro.',
  no_answer:'No hay una respuesta estructurada disponible para introducir.',
  unknown:'Esta consulta no confirmó que pueda escribir. Vuelve a leer la actividad y consultar.'
};

export function requireAssistImage(context:AssistContext,required:boolean):AssistContext {
  if(!required || context.diagram_required)return context;
  return {...context,diagram_required:true,can_fill_integer:false,fill_blockers:[...new Set([...context.fill_blockers,'diagram_required' as const])]};
}

export function captureFillPolicy(context:AssistContext,result:AssistResult,includeImage:boolean):AssistContext {
  const textVerified=result.verified && result.provider==='deterministic' && result.verification==='ordered_prizes' && !context.diagram_required;
  if(!includeImage || textVerified)return context;
  return {...context,can_fill_integer:false,fill_blockers:[...new Set([...context.fill_blockers,'image_based_proposal' as const])]};
}

/** Un mismo contrato de elegibilidad para el botón del panel y el worker. */
export function proposalFillBlockers(view:AssistView):FillBlocker[] {
  const blockers=[...view.context.fill_blockers];
  if(!view.context.can_fill_integer && !blockers.length)blockers.push('unknown');
  const {proposal}=view.result;
  if(proposal.status!=='proposed')blockers.push('no_answer');
  else if(proposal.answers.length!==1 || proposal.answers[0].field_key!=='answer' || proposal.answers[0].unit!=='' ||
    !/^(0|[1-9]\d{0,11})$/u.test(proposal.answers[0].value))blockers.push('answer_format');
  return [...new Set(blockers)];
}
