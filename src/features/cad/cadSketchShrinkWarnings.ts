import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchDrivenSizes, cadSketchMirrorShrinkage, type CadSketchMirrorShrink } from '@/domain/cad/cadSketchSymmetryRelations';
import { createCadSketchRelationLabels } from './cadSketchRelationNames';

/**
 * A committed solve that keeps a curve Symmetric only by shrinking mirrored curves to less than `mirrorCollapseRelative` of their size
 * before the solve, where no dimension or expression sets those sizes (see `cadSketchDrivenSizes`). Each curve gives its size, a line's
 * length or an arc's or circle's radius, before and after, in millimetres; `message` says the same in words.
 */
export interface CadSketchShrinkWarning {
  readonly code: 'mirror-shrank';
  readonly relationId: string;
  readonly curves: CadSketchMirrorShrink['curves'];
  readonly message: string;
}

/**
 * The warnings for a solve from `before` to `after`: one for each curve Symmetric that shrinks a curve whose size no dimension or
 * expression sets, naming those curves. A solve keeps such a shrink only where no start it tries avoids it (see
 * `attemptCadSketchNativeSolve`). A shrink the sketch asks for is not warned of; one that relations only set together still is. Edit
 * preparation runs this for a committed edit's solves, never for a preview or a drag, and finds the driven sizes only after a shrink.
 */
export function cadSketchShrinkWarnings(before: CadSketchGraph, after: CadSketchGraph, parameters: Readonly<Record<string, number>>): readonly CadSketchShrinkWarning[] {
  const shrinks = cadSketchMirrorShrinkage(before, after, parameters);
  if (!shrinks.length) return [];
  const driven = cadSketchDrivenSizes(before), labels = createCadSketchRelationLabels(before);
  const kinds = new Map(before.entities.map(entity => [entity.id, entity.kind]));
  return shrinks.flatMap((shrink): CadSketchShrinkWarning[] => {
    const curves = shrink.curves.filter(curve => !driven.has(curve.entityId));
    if (!curves.length) return [];
    const named = curves.map(curve => `${kinds.get(curve.entityId) === 'line' ? '' : 'the radius of '}${labels.entity(curve.entityId)} from ${millimetres(curve.beforeMm)} mm to ${millimetres(curve.afterMm)} mm`);
    const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0];
    return [{ code: 'mirror-shrank', relationId: shrink.relationId, curves, message: `Symmetric shrank ${list}. Check the mirror and its relations.` }];
  });
}

/** A size for reading: three decimals, or for one below 0.001 mm its first significant digit, at most 12 decimals. */
function millimetres(size: number): string {
  return size >= 0.001 || size <= 0 ? size.toFixed(3) : size.toFixed(Math.min(12, -Math.floor(Math.log10(size))));
}
