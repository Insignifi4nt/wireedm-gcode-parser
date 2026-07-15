import { operationHasEligibleClosedTopology } from '@/domain/compensation/intent';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  pointsEqual,
  segmentMap,
  signedAreaOfPath
} from '@/domain/path-intel/segments';
import type { PathOperation, PathPlanningDocument } from '@/domain/path-intel/types';

export interface ResolveControllerCompensationInput {
  document: PathPlanningDocument;
  operation: PathOperation;
}

export type CompensationResolution =
  | {
      status: 'ready';
      signedArea: number | null;
      winding: 'cw' | 'ccw' | null;
      keptMaterial: 'inside' | 'outside' | null;
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

  const segmentsById = segmentMap(document.segments);
  if (operation.segmentRefs.some((ref) => !segmentsById.has(ref.segmentId))) {
    return { status: 'blocked', reason: 'missing-segment' };
  }

  if (!operation.closed) {
    const intent = operation.compensationIntent;
    if (
      operation.machiningIntent?.kind !== 'partial-contour' ||
      intent.source !== 'manual' ||
      !('wireSide' in intent) ||
      !openRefsFormContinuousPath(document, operation)
    ) {
      return { status: 'blocked', reason: 'open-path' };
    }
    return {
      status: 'ready',
      signedArea: null,
      winding: null,
      keptMaterial: null,
      wireSide: intent.wireSide,
      code: intent.wireSide === 'left' ? 'G41' : 'G42'
    };
  }

  const signedArea = signedAreaOfPath(operation.segmentRefs, segmentsById);
  if (!Number.isFinite(signedArea) || signedArea === 0) {
    return { status: 'blocked', reason: 'degenerate' };
  }
  if (!operationHasEligibleClosedTopology(document, operation)) {
    return { status: 'blocked', reason: 'ineligible-topology' };
  }

  const winding = signedArea > 0 ? 'ccw' : 'cw';
  if (!('keptMaterial' in operation.compensationIntent)) {
    return { status: 'blocked', reason: 'ineligible-topology' };
  }
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

function openRefsFormContinuousPath(
  document: PathPlanningDocument,
  operation: PathOperation
) {
  if (operation.segmentRefs.length === 0) return false;
  const segmentsById = segmentMap(document.segments);
  const tolerance = Number.isFinite(document.options.coincidenceEpsilon)
    ? Math.max(0, document.options.coincidenceEpsilon)
    : 0;
  for (let index = 0; index < operation.segmentRefs.length - 1; index++) {
    const currentRef = operation.segmentRefs[index];
    const nextRef = operation.segmentRefs[index + 1];
    const current = segmentsById.get(currentRef.segmentId);
    const next = segmentsById.get(nextRef.segmentId);
    if (!current || !next) return false;
    if (!pointsEqual(
      orientedSegmentEnd(current, currentRef),
      orientedSegmentStart(next, nextRef),
      tolerance
    )) return false;
  }
  return true;
}
