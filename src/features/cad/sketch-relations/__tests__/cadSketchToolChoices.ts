import type { CadSketchGraph, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchPickOrders } from '@/domain/cad/sketch-relations/cadSketchRelationPlanning';
import { isCadSketchVirtualId } from '@/domain/cad/sketch-relations/cadSketchVirtualElements';
import { CAD_SKETCH_CONSTRAINT_TOOLS, cadSketchConstraintStep, type CadSketchConstraintPick, type CadSketchConstraintTool } from '../../cadSketchConstraintTool';

/** What one tool-first constraint makes of a whole selection. */
export type CadSketchConstraintChoice =
  | { readonly tool: CadSketchConstraintTool; readonly state: 'available'; readonly relations: readonly CadSketchGraphRelation[] }
  | { readonly tool: CadSketchConstraintTool; readonly state: 'applied'; readonly relationIds: readonly string[] }
  | { readonly tool: CadSketchConstraintTool; readonly state: 'blocked'; readonly reason: string };

/**
 * The reference the relation offers are checked against: what each Constrain tool would do with exactly the selected operands, picked in
 * any order. A tool is available, applied (with the relations that hold it) or blocked with its reason, or absent when it takes other
 * operands; only its own steps decide. A tool that does not offer the origin or an axis the selection names is blocked when its planning
 * says why, such as Equal with an axis, which has no length. A selection of only the origin and the axes relates nothing that can move,
 * so it gets nothing.
 */
export function cadSketchConstraintChoices(graph: CadSketchGraph, picks: readonly CadSketchConstraintPick[], newId: () => string): readonly CadSketchConstraintChoice[] {
  if (!picks.length || picks.length > 3 || picks.every(pick => isCadSketchVirtualId(pick.id))) return [];
  return CAD_SKETCH_CONSTRAINT_TOOLS.flatMap((tool): CadSketchConstraintChoice[] => {
    let blocked: string | null = null;
    for (const order of cadSketchPickOrders(picks)) {
      const step = completedStep(graph, tool, order, newId);
      if (step?.status === 'ready') return [{ tool, state: 'available', relations: step.relations }];
      if (step?.status === 'invalid' && step.applied) return [{ tool, state: 'applied', relationIds: step.applied }];
      if (step?.status === 'invalid') blocked ??= step.reason;
    }
    return blocked ? [{ tool, state: 'blocked', reason: blocked }] : [];
  });
}

/**
 * The final step when every pick is one the tool asked for in turn, or null when the tool takes different operands. The origin or an
 * axis the tool did not offer, or a pick the step names refusable, is still let through as the last pick, where the tool reads every
 * pick, but only to say why it refuses it.
 */
function completedStep(graph: CadSketchGraph, tool: CadSketchConstraintTool, picks: readonly CadSketchConstraintPick[], newId: () => string) {
  let unoffered = false;
  for (let index = 0; index < picks.length; index++) {
    const step = cadSketchConstraintStep(graph, tool, picks.slice(0, index), newId), pick = picks[index];
    if (step.status !== 'more') return null;
    if ((pick.kind === 'point' ? step.pointIds : step.entityIds).includes(pick.id)) continue;
    const refusable = step.refusable && (pick.kind === 'point' ? step.refusable.pointIds : step.refusable.entityIds).includes(pick.id);
    if (index < picks.length - 1 || !refusable && !isCadSketchVirtualId(pick.id)) return null;
    unoffered = true;
  }
  const step = cadSketchConstraintStep(graph, tool, picks, newId);
  return step.status === 'more' || unoffered && (step.status !== 'invalid' || step.applied) ? null : step;
}
