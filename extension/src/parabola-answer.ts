import { z } from 'zod';
import type { AssistView } from './shared';

export type PlotPoint = [number, number];
const coordinate = z.number().int().min(-50_000).max(50_000);
export const parabolaPointsSchema = z.array(z.tuple([coordinate, coordinate])).length(5).refine(points => {
  if(points.length!==5)return false;
  const [h,k]=points[0],a=points[2][1]-k;
  return a!==0 && [0,-2,-1,1,2].every((dx,i)=>points[i][0]===h+dx && points[i][1]===k+a*dx**2);
});

/** Solo permite puntos de un cálculo exacto y vigente para una gráfica vacía. */
export function drawableParabola(view:AssistView|undefined):PlotPoint[]|undefined {
  if(!view || !view.context.can_draw_parabola || view.context.diagram_required || !view.context.fill_blockers.includes('graph_editor') ||
    view.context.fill_blockers.some(blocker=>blocker!=='graph_editor'))return;
  const {result}=view;
  const proposal=result.proposal;
  if(result.verification!=='parabola_points' || result.provider!=='deterministic' || !result.verified ||
    result.fingerprint!==view.context.fingerprint || proposal.status!=='proposed' || proposal.answers.length!==1)return;
  const [answer]=proposal.answers;
  if(answer.field_key!=='answer' || answer.unit)return;
  const points=[...answer.value.matchAll(/\((-?[0-9]{1,5}), (-?[0-9]{1,5})\)/gu)].map(([,x,y])=>[Number(x),Number(y)]);
  if(points.map(([x,y])=>`(${x}, ${y})`).join(', ')!==answer.value)return;
  const parsed=parabolaPointsSchema.safeParse(points);
  return parsed.success?parsed.data:undefined;
}
