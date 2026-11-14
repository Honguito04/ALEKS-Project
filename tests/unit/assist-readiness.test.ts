import { describe,expect,it } from 'vitest';
import { captureFillPolicy,proposalFillBlockers,proposalFillMessages } from '../../extension/src/assist-readiness';
import type { AssistView } from '../../extension/src/shared';

function proposal():AssistView {
  const fingerprint='a'.repeat(64);
  return {id:'proposal',context:{fingerprint,statement:'Probabilidad de dos giros.',fields:[{key:'answer',label:'Respuesta'}],
    diagram_required:false,can_fill_integer:true,can_fill_fraction:true,fill_blockers:[]},
    result:{fingerprint,provider:'ollama',model:'local',provider_calls:1,verified:false,verification:'none',
      proposal:{status:'proposed',answers:[{field_key:'answer',value:'15/64',unit:''}],explanation:'3/8 × 5/8 = 15/64.',missing_information:[]}}};
}

describe('diagnóstico compartido de escritura',()=>{
  it.each(['','h','horas','hora(s)'])('admite el número con una unidad predefinida coincidente: %s',unit=>{
    const candidate=proposal();candidate.context.fixed_unit='h';candidate.result.proposal.answers[0]={field_key:'answer',value:'7',unit};
    expect(proposalFillBlockers(candidate)).toEqual([]);
  });

  it('rechaza una unidad propuesta distinta aunque la cantidad sea válida',()=>{
    const candidate=proposal();candidate.context.fixed_unit='h';candidate.result.proposal.answers[0]={field_key:'answer',value:'7',unit:'min'};
    expect(proposalFillMessages(candidate).join(' ')).toContain('no coincide');
  });
  it('acepta 15/64 como propuesta aunque el modelo no esté verificado',()=>{
    const candidate=proposal();
    expect(proposalFillBlockers(candidate)).toEqual([]);expect(proposalFillMessages(candidate)).toEqual([]);
    expect(candidate.result.verified).toBe(false);
  });

  it.each([
    {field_key:'otro',value:'15/64',unit:'',detail:'El campo recibido es "otro"'},
    {field_key:'answer',value:'15/64',unit:'mm',detail:'La respuesta incluye la unidad "mm"'},
    {field_key:'answer',value:'0.23.45',unit:'',detail:'El valor recibido "0.23.45"'},
    {field_key:'answer',value:'30/128',unit:'',detail:'El valor recibido "30/128"'}
  ])('explica el dato concreto que impide escribir: $detail',({detail,...answer})=>{
    const candidate=proposal();candidate.result.proposal.answers=[answer];
    expect(proposalFillBlockers(candidate)).toEqual(['answer_format']);
    expect(proposalFillMessages(candidate).join(' ')).toContain(detail);
  });

  it('informa el número de respuestas y no elige una de varias',()=>{
    const candidate=proposal();candidate.result.proposal.answers.push({field_key:'other',value:'1/2',unit:''});
    expect(proposalFillMessages(candidate)).toEqual(['Se recibieron 2 respuestas; la escritura necesita una sola respuesta asociada al recuadro.']);
  });

  it('muestra caracteres invisibles y acota los valores que llegan del modelo',()=>{
    const candidate=proposal();candidate.result.proposal.answers[0].value='15/64\u200b\n'+ 'x'.repeat(450);
    const messages=proposalFillMessages(candidate).join(' ');
    expect(messages).toContain('15/64\\u200b\\n');expect(messages).not.toContain('\u200b');
    expect(messages).toContain('…');expect(messages.length).toBeLessThan(350);
  });

  it('conserva el motivo del editor aunque el formato sea válido',()=>{
    const candidate=proposal();candidate.context.can_fill_fraction=false;
    expect(proposalFillBlockers(candidate)).toEqual(['fraction_control']);
    expect(proposalFillMessages(candidate).join(' ')).toContain('editor vacío compatible con fracciones');
  });

  it('no convierte un cálculo exacto de ruleta en una propuesta visual por adjuntar una captura',()=>{
    const candidate=proposal();candidate.result={...candidate.result,provider:'deterministic',provider_calls:0,verified:true,verification:'independent_spins'};
    expect(captureFillPolicy(candidate.context,candidate.result,true)).toEqual(candidate.context);
    expect(captureFillPolicy({...candidate.context,diagram_required:true},candidate.result,true).fill_blockers).toContain('image_based_proposal');
  });
});

it.each(['correct','reversed','missing','duplicate','unknown','units','invalid','fraction-disabled'])('dos respuestas por clave: %s',mode=>{
  const candidate=proposal();candidate.context.fields=[{key:'field_1',label:'Recuadro 1'},{key:'field_2',label:'Recuadro 2'}];
  candidate.result.proposal.answers=[{field_key:'field_1',value:'12',unit:''},{field_key:'field_2',value:'1/2',unit:''}];
  const answers=candidate.result.proposal.answers;
  if(mode==='reversed')answers.reverse();
  if(mode==='missing')answers.pop();
  if(mode==='duplicate')answers[1].field_key='field_1';
  if(mode==='unknown')answers[1].field_key='field_3';
  if(mode==='units')answers[1].unit='mm';
  if(mode==='invalid')answers[1].value='1; 2';
  if(mode==='fraction-disabled')candidate.context.can_fill_fraction=false;
  expect(proposalFillBlockers(candidate)).toEqual(['correct','reversed'].includes(mode)?[]:[mode==='fraction-disabled'?'fraction_control':'answer_format']);
});

it.each(['cm','cm²','cm^2','cm³','cm^3'])('admite selección por campo de %s',unit=>{
  const candidate=proposal();candidate.context.fields=[{key:'field_1',label:'1'},{key:'field_2',label:'2'}];
  candidate.result.proposal.answers=[{field_key:'field_1',value:'12',unit:'cm'},{field_key:'field_2',value:'6',unit}];
  expect(proposalFillBlockers(candidate)).toEqual([]);
});

it('admite la propuesta reportada de un campo: 169,56 cm²',()=>{
  const candidate=proposal();candidate.result.proposal.answers=[{field_key:'answer',value:'169,56',unit:'cm²'}];
  expect(proposalFillBlockers(candidate)).toEqual([]);
});
