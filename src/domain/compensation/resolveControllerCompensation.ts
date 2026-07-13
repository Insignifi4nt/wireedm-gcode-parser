import { operationHasEligibleClosedTopology } from '@/domain/compensation/intent';
import { segmentMap, signedAreaOfPath } from '@/domain/path-intel/segments';
import type { PathOperation, PathPlanningDocument } from '@/domain/path-intel/types';

export interface ResolveControllerCompensationInput {
  document: PathPlanningDocument;
  operation: PathOperation;
}

export type CompensationResolution =
  | {
      status: 'ready';
      signedArea: number;
      winding: 'cw' | 'ccw';
      keptMaterial: 'inside' | 'outside';
      wireSide: 'left' | 'right';
      code: 'G41' | 'G42';
    }
  | {
      status: 'blocked';
      reason:
        | 'wire-centre'
        | 'missing-intent'
        | 'open-path'
        | 'missing-segment'
        | 'degenerate'
        | 'ineligible-topology';
    };

export function resolveControllerCompensation({
  document,
  operation
}: ResolveControllerCompensationInput): CompensationResolution {
  if (document.geometryBasis !== 'finished-contour') {
    return { status: 'blocked', reason: 'wire-centre' };
  }
  if (operation.compensationIntent?.mode !== 'controller') {
    return { status: 'blocked', reason: 'missing-intent' };
  }
  if (!operation.closed) return { status: 'blocked', reason: 'open-path' };

  const segmentsById = segmentMap(document.segments);
  if (operation.segmentRefs.some((ref) => !segmentsById.has(ref.segmentId))) {
    return { status: 'blocked', reason: 'missing-segment' };
  }

  const signedArea = signedAreaOfPath(operation.segmentRefs, segmentsById);
  if (!Number.isFinite(signedArea) || signedArea === 0) {
    return { status: 'blocked', reason: 'degenerate' };
  }
  if (!operationHasEligibleClosedTopology(document, operation)) {
    return { status: 'blocked', reason: 'ineligible-topology' };
  }

  const winding = signedArea > 0 ? 'ccw' : 'cw';
  const keptMaterial = operation.compensationIntent.keptMaterial;
  const wireSide = keptMaterial === 'inside'
    ? winding === 'ccw' ? 'right' : 'left'
    : winding === 'ccw' ? 'left' : 'right';

  return {
    status: 'ready',
    signedArea,
    winding,
    keptMaterial,
    wireSide,
    code: wireSide === 'left' ? 'G41' : 'G42'
  };
}
