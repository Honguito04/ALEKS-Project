import { z } from 'zod';
export const BACKEND = 'http://127.0.0.1:8000';
export const ALEKS = 'https://latam.aleks.com';
export const ALEKS_ACTIVITY = 'https://latam-awu.aleks.com';
export const ALEKS_ORIGINS:string[] = [ALEKS,ALEKS_ACTIVITY];
export const mathSchema = z.object({
  family:z.enum(['arithmetic','percentage','proportion','linear','quadratic','single_choice','cylinder_volume']),
  expression:z.string().max(240).nullable().optional(), lhs:z.string().max(240).nullable().optional(), rhs:z.string().max(240).nullable().optional(),
  percent:z.string().max(240).nullable().optional(), base:z.string().max(240).nullable().optional(),
  a:z.string().max(240).nullable().optional(), b:z.string().max(240).nullable().optional(), c:z.string().max(240).nullable().optional(),
  radius:z.string().max(240).nullable().optional(), height:z.string().max(240).nullable().optional(),pi_value:z.string().max(240).nullable().optional(),
  radius_unit:z.enum(['mm','cm','m']).nullable().optional(),height_unit:z.enum(['mm','cm','m']).nullable().optional(),height_is_perpendicular:z.boolean().nullable().optional()
}).strict();
export const exerciseSchema = z.object({
  source:z.enum(['simulator','aleks']), activity_id:z.string().min(1).max(80), fingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  statement:z.string().min(1).max(2000), math:mathSchema.nullable(),
  fields:z.array(z.object({id:z.string().min(1).max(40),kind:z.enum(['text','radio','quantity'])}).strict()).length(1),
  choices:z.array(z.object({id:z.string().min(1).max(40),expression:z.string().max(240)}).strict()).max(12),
  domain:z.enum(['real','rational','integer']),units:z.string().max(30),format:z.enum(['exact','decimal']),decimal_places:z.number().int().min(0).max(8),
  evidence:z.array(z.string().max(500)).min(1).max(10), ambiguities:z.array(z.string().max(500)).max(10)
}).strict();
export type Exercise = z.infer<typeof exerciseSchema>;
export const solutionSchema = z.object({
  status:z.enum(['verified','unverifiable']),answer:z.string().max(300),values:z.array(z.string().max(300)).max(4),explanation:z.string().max(2000),
  provider:z.enum(['deterministic','openai']),proposed_by_ai:z.boolean(),provider_calls:z.number().int().min(0).max(1),unit:z.string().max(30).optional()
}).strict();
export type Solution = z.infer<typeof solutionSchema>;
export const limitsSchema = z.object({maxExercises:z.number().int().min(1).max(100),maxMinutes:z.number().min(.01).max(120),maxAICalls:z.number().int().min(0).max(100),preview:z.boolean()}).strict();
export type Limits = z.infer<typeof limitsSchema>;
export type State = 'INACTIVO'|'LEYENDO'|'RESOLVIENDO'|'VERIFICANDO'|'ESCRIBIENDO'|'ENVIANDO'|'COMPROBANDO'|'AVANZANDO'|'PAUSADO'|'COMPLETADO'|'ERROR';
export interface EditorReadback {
  status:'readable'|'missing'|'ambiguous'|'unsupported';reason:string;value?:string;unit?:'cm^3';display?:string;
}
export interface ControlObservation {status:'observed'|'missing'|'ambiguous'|'disabled';count:number}
export interface ResultObservation {
  status:'positive_marker'|'missing'|'ambiguous'|'incomplete';positiveMessageCount:number;continuation?:'topic';
}
export interface PiReadback {
  status:'empty'|'readable'|'unsupported';reason:string;display?:string;coefficient?:string;denominator?:string;unit?:'cm'|'cm^2';
}
export interface CircleTableObservation {
  status:'observed'|'missing'|'ambiguous'|'unsupported';reason:string;disabled?:boolean;autoSubmitSupported:false;
  fields:{kind:'arc_length'|'shaded_area';label:string;readback:PiReadback}[];
}
export interface EditorMenuObservation {
  status:'observed'|'missing'|'ambiguous';
  controls:{fraction:ControlObservation;pi:ControlObservation;cm:ControlObservation;cmSquared:ControlObservation};
}
export interface SingleEditorObservation {
  status:'observed'|'missing'|'ambiguous'|'unsupported';reason:string;rootCount:number;disabled?:boolean;autoSubmitSupported:false;
  readback:{status:'empty'|'readable'|'unsupported';reason:string;value?:string;display?:string};
}
export const fillBlockerSchema=z.enum(['unreadable_prompt','editor_missing','multiple_editors','editor_structure','editor_disabled',
  'editor_not_empty','unsupported_readback','result_present','diagram_required','image_based_proposal','answer_format','no_answer','unknown']);
export type FillBlocker=z.infer<typeof fillBlockerSchema>;
export const assistContextSchema=z.object({
  fingerprint:z.string().regex(/^[a-f0-9]{64}$/),statement:z.string().min(1).max(8000),
  fields:z.array(z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),label:z.string().min(1).max(200)}).strict()).min(1).max(12),
  diagram_required:z.boolean(),can_fill_integer:z.boolean(),fill_blockers:z.array(fillBlockerSchema).max(13).default([])
}).strict();
export type AssistContext=z.infer<typeof assistContextSchema>;
export const assistResultSchema=z.object({
  fingerprint:z.string().regex(/^[a-f0-9]{64}$/),model:z.string().max(200),provider:z.enum(['ollama','deterministic']),provider_calls:z.number().int().min(0).max(1),verified:z.boolean(),
  verification:z.enum(['none','ordered_prizes']).default('none'),
  proposal:z.object({status:z.enum(['proposed','needs_context','unable_to_solve']),answers:z.array(z.object({field_key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),value:z.string().min(1).max(500),unit:z.string().max(40)}).strict()).max(12),
    explanation:z.string().min(1).max(4000),missing_information:z.array(z.string().trim().min(1).max(300)).max(10)}).strict()
}).strict().superRefine((result,ctx)=>{
  const exact=result.provider==='deterministic';
  if(result.verified!==exact || (result.verification==='ordered_prizes')!==exact || (exact && result.provider_calls!==0))ctx.addIssue({code:'custom',message:'Verificación sin comprobador independiente'});
  const proposal=result.proposal;
  if((proposal.status==='proposed')!==Boolean(proposal.answers.length) || (proposal.status==='needs_context')!==Boolean(proposal.missing_information.length) ||
    new Set(proposal.answers.map(answer=>answer.field_key)).size!==proposal.answers.length || (exact && proposal.status!=='proposed'))ctx.addIssue({code:'custom',message:'Estado de propuesta incoherente'});
});
export type AssistResult=z.infer<typeof assistResultSchema>;
export interface AssistView {id:string;context:AssistContext;result:AssistResult}
export interface EditorObservation {
  status:'observed'|'missing'|'ambiguous'|'disabled';inputCount:number;unitButtonCount:number;submitLabelCount:number;
  inputDiagnostics:{presentCount:number;paintedCount:number;ariaHiddenCount:number;frameCount:number;visibleRootCount:number;
    blockedBy:{noLayout:number;hiddenAttribute:number;displayNone:number;visibilityHidden:number;opacityZero:number;noView:number}};
  renderedAnswer:EditorReadback;submitControl:ControlObservation & {label?:'Entregar'|'Verificar'};nextControl:ControlObservation;nextTopicControl:ControlObservation;resultMarker:ResultObservation;
  circleTable:CircleTableObservation;menu:EditorMenuObservation;singleEditor:SingleEditorObservation;
}
export type PromptMath = {kind:'number'|'identifier'|'operator'|'text';value:string} |
  {kind:'space'} |
  {kind:'row';items:PromptMath[]} | {kind:'sqrt';items:PromptMath[]} |
  {kind:'fraction';numerator:PromptMath;denominator:PromptMath} |
  {kind:'power';base:PromptMath;exponent:PromptMath} |
  {kind:'root';radicand:PromptMath;index:PromptMath} |
  {kind:'subscript';base:PromptMath;index:PromptMath} |
  {kind:'over';base:PromptMath;mark:PromptMath};
export interface PromptObservation {
  status:'readable'|'missing'|'ambiguous'|'unsupported';reason:string;
  statement?:string;mathematics?:PromptMath[];fingerprint?:string;multiplePartsDetected?:boolean;diagramReferenceDetected?:boolean;
  autoSubmitSupported:false;
}
export interface Detection {origin:string; activity:string; session:boolean; complete:boolean; human:boolean; supported:boolean; reason?:string;editorObservation?:EditorObservation;promptObservation?:PromptObservation;observedTopic?:string}
export interface Feedback {status:'accepted'|'rejected'|'unknown'; fingerprint:string}
export interface Adapter {
  detect():Promise<Detection>;
  read():Promise<Exercise>;
  write(exercise:Exercise,answer:string,signal:AbortSignal):Promise<void>;
  submit(exercise:Exercise,operation:string,signal:AbortSignal):Promise<void>;
  result(fingerprint:string,signal:AbortSignal):Promise<Feedback>;
  next(signal:AbortSignal):Promise<void>;
}
export interface Run {
  id:string;origin:string;activity:string;state:State;limits:Limits;started:number;count:number;aiCalls:number;
  current?:string;message:string;operations:Record<string,{id:string;status:'submitting'|'accepted'|'rejected'|'uncertain'}>;
  events:{at:number;state:State;message:string}[];
}
export const runSchema = z.object({
  id:z.uuid(),origin:z.literal(BACKEND),activity:z.string().min(1).max(80),
  state:z.enum(['INACTIVO','LEYENDO','RESOLVIENDO','VERIFICANDO','ESCRIBIENDO','ENVIANDO','COMPROBANDO','AVANZANDO','PAUSADO','COMPLETADO','ERROR']),
  limits:limitsSchema,started:z.number(),count:z.number().int().min(0).max(100),aiCalls:z.number().int().min(0).max(100),
  current:z.string().regex(/^[a-f0-9]{64}$/).optional(),message:z.string().max(2200),
  operations:z.record(z.string().regex(/^[a-f0-9]{64}$/),z.object({id:z.string().max(180),status:z.enum(['submitting','accepted','rejected','uncertain'])})).refine(x=>Object.keys(x).length<=1000),
  events:z.array(z.object({at:z.number(),state:z.string().max(20),message:z.string().max(2200)})).max(100)
}).strict();
export function simulatorURL(raw:string) {
  const u=new URL(raw);
  return u.origin===BACKEND && (u.pathname==='/simulator' || u.pathname.startsWith('/simulator/'));
}
export function allowedTab(raw:string) { const u=new URL(raw); return simulatorURL(raw) || ALEKS_ORIGINS.includes(u.origin); }
