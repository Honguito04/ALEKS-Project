import { parseSupportedAnswer } from './answer-format';
import { answerUnit } from './answer-units';
import type { AssistContext,AssistResult,AssistView,FillBlocker } from './shared';

export const fillBlockerMessages:Record<FillBlocker,string>={
  unreadable_prompt:'No se pudo leer el enunciado como texto. La escritura asistida necesita esa lectura.',
  editor_missing:'No se encontró un recuadro visual asociado. Abre el ejercicio y vuelve a leer la actividad.',
  multiple_editors:'Hay varios recuadros. La escritura admite uno o dos recuadros reconocidos.',
  editor_structure:'No se reconoce una estructura única del editor para comprobar lo escrito.',
  editor_disabled:'El recuadro está deshabilitado o es de solo lectura.',
  editor_not_empty:'El recuadro ya contiene una respuesta. Vacíalo manualmente y vuelve a consultar.',
  unsupported_readback:'No se puede comprobar que el recuadro esté vacío. Revisa su contenido.',
  result_present:'Se observa un resultado o un botón de avance. Abre un ejercicio sin resolver y vuelve a consultar.',
  diagram_required:'Esta respuesta depende de un diagrama que la escritura asistida no valida.',
  image_based_proposal:'La propuesta depende de una captura. Si el ejercicio se resuelve solo con el texto, desmarca la captura y vuelve a consultar.',
  answer_format:'La escritura admite un entero, decimal o una fracción reducida no negativa por recuadro (hasta doce dígitos por componente). La unidad debe estar predefinida o tener un botón cm/cm²/cm³ reconocido.',
  fraction_control:'La lectura actual no confirmó un editor vacío compatible con fracciones. Vuelve a leer la actividad.',
  no_answer:'No hay una respuesta estructurada disponible para introducir.',
  unknown:'Esta consulta no confirmó que pueda escribir. Vuelve a leer la actividad y consultar.'
};

export function requireAssistImage(context:AssistContext,required:boolean):AssistContext {
  if(!required || context.diagram_required)return context;
  return {...context,diagram_required:true,can_fill_integer:false,can_fill_fraction:false,fill_blockers:[...new Set([...context.fill_blockers,'diagram_required' as const])]};
}

export function captureFillPolicy(context:AssistContext,result:AssistResult,includeImage:boolean):AssistContext {
  const textVerified=result.verified && result.provider==='deterministic' && ['ordered_prizes','independent_boxes','independent_spins'].includes(result.verification) && !context.diagram_required;
  if(!includeImage || textVerified)return context;
  return {...context,can_fill_integer:false,can_fill_fraction:false,fill_blockers:[...new Set([...context.fill_blockers,'image_based_proposal' as const])]};
}

/** Un mismo contrato de elegibilidad para el botón del panel y el worker. */
export function proposalFillBlockers(view:AssistView):FillBlocker[] {
  const blockers=[...view.context.fill_blockers];
  if(!view.context.can_fill_integer && !view.context.can_fill_fraction && !blockers.length)blockers.push('unknown');
  const {proposal}=view.result;
  if(proposal.status!=='proposed')blockers.push('no_answer');
  else if(view.context.fields.length===2 && view.context.fields.every(field=>/^field_[12]$/.test(field.key))) {
    if(proposal.answers.length!==2 || new Set(proposal.answers.map(answer=>answer.field_key)).size!==2 ||
      view.context.fields.some(field=>!proposal.answers.some(answer=>answer.field_key===field.key && (answer.unit==='' || ['cm','cm^2','cm^3'].includes(answerUnit(answer.unit) || '')) && parseSupportedAnswer(answer.value))))blockers.push('answer_format');
    else if(proposal.answers.some(answer=>parseSupportedAnswer(answer.value)?.kind==='fraction') && !view.context.can_fill_fraction)blockers.push('fraction_control');
  }
  else if(proposal.answers.length!==1 || proposal.answers[0].field_key!=='answer' || !unitMatches(view) ||
    !parseSupportedAnswer(proposal.answers[0].value))blockers.push('answer_format');
  else if(parseSupportedAnswer(proposal.answers[0].value)?.kind==='fraction' && !view.context.can_fill_fraction)blockers.push('fraction_control');
  return [...new Set(blockers)];
}

function unitMatches(view:AssistView) {
  const unit=view.result.proposal.answers[0]?.unit;
  return unit==='' || (!view.context.fixed_unit && ['cm','cm^2','cm^3'].includes(answerUnit(unit || '') || '')) || Boolean(view.context.fixed_unit && answerUnit(unit || '')===view.context.fixed_unit);
}

/** Acota el diagnóstico y hace visibles los caracteres de control/formato. */
function quotedDiagnostic(value:string):string {
  const bounded=value.length>80?`${value.slice(0,80)}…`:value;
  return JSON.stringify(bounded).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,char=>`\\u${char.codePointAt(0)!.toString(16).padStart(4,'0')}`);
}

function answerFormatMessage(view:AssistView):string {
  const answers=view.result.proposal.answers;
  if(view.context.fields.length===2)return 'Se necesitan exactamente dos respuestas con claves field_1 y field_2, unidad vacía o cm/cm²/cm³ y con un entero, decimal o fracción reducida por campo.';
  if(answers.length!==1)return `Se recibieron ${answers.length} respuestas; la escritura necesita una sola respuesta asociada al recuadro.`;
  const answer=answers[0],reasons:string[]=[];
  if(answer.field_key!=='answer')reasons.push(`El campo recibido es ${quotedDiagnostic(answer.field_key)}; no corresponde al recuadro «answer».`);
  if(!unitMatches(view))reasons.push(view.context.fixed_unit?
    `La unidad propuesta ${quotedDiagnostic(answer.unit)} no coincide con la unidad predefinida ${quotedDiagnostic(view.context.fixed_unit)}.`:
    `La respuesta incluye la unidad ${quotedDiagnostic(answer.unit)}; no se reconoció una unidad predefinida en el recuadro.`);
  if(!parseSupportedAnswer(answer.value))reasons.push(`El valor recibido ${quotedDiagnostic(answer.value)} no tiene el formato admitido: entero, decimal o fracción reducida no negativa (por ejemplo, 15/64), hasta doce dígitos por componente.`);
  return reasons.join(' ') || fillBlockerMessages.answer_format;
}

/** Mismos motivos concretos en el panel, la escritura y el recorrido. */
export function proposalFillMessages(view:AssistView):string[] {
  return proposalFillBlockers(view).map(blocker=>blocker==='answer_format'?answerFormatMessage(view):fillBlockerMessages[blocker]);
}

export function answerPayload(view:AssistView) {
  const answers=view.result.proposal.answers;
  return view.context.fields.length===2 || (!view.context.fixed_unit && Boolean(answers[0]?.unit))?answers:answers[0].value;
}
