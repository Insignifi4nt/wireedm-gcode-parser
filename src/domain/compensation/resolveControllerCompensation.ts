import {
  createCompensationTopologyLookup,
  operationHasEligibleClosedTopology,
  type CompensationTopologyLookup
} from '@/domain/compensation/intent';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  pointsEqual,
  signedAreaOfPath
} from '@/domain/path-intel/segments';
import type { PathOperation, PathPlanningDocument, PathSegment, SegmentId } from '@/domain/path-intel/types';

export interface ResolveControllerCompensationInput {
  document: PathPlanningDocument;
  operation: PathOperation;
  /** Share one lookup when resolving many operations of the same document. */
  lookup?: CompensationTopologyLookup;
}

export type CompensationResolution =
  | {
      status: 'ready';
      signedArea: number | null;
      winding: 'cw' | 'ccw' | null;
      keptMaterial: 'inside' | 'outside' | null;
      wireSide: 'left' | 'right';
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
  operation,
  lookup
}: ResolveControllerCompensationInput): CompensationResolution {
  if (document.geometryBasis !== 'finished-contour') {
    return { status: 'blocked', reason: 'wire-centre' };
  }
  if (operation.compensationIntent?.mode !== 'controller') {
    return { status: 'blocked', reason: 'missing-intent' };
  }

  const topology = lookup ?? createCompensationTopologyLookup(document);
  const { segmentsById } = topology;
  if (operation.segmentRefs.some((ref) => !segmentsById.has(ref.segmentId))) {
    return { status: 'blocked', reason: 'missing-segment' };
  }

  if (!operation.closed) {
    const intent = operation.compensationIntent;
    if (
      operation.machiningIntent?.kind !== 'partial-contour' ||
      intent.source !== 'manual' ||
      !('wireSide' in intent) ||
      !openRefsFormContinuousPath(document, operation, segmentsById)
    ) {
      return { status: 'blocked', reason: 'open-path' };
    }
    return {
      status: 'ready',
      signedArea: null,
      winding: null,
      keptMaterial: null,
      wireSide: intent.wireSide
    };
  }

  const signedArea = signedAreaOfPath(operation.segmentRefs, segmentsById);
  if (!Number.isFinite(signedArea) || signedArea === 0) {
    return { status: 'blocked', reason: 'degenerate' };
  }
  if (!operationHasEligibleClosedTopology(document, operation, topology)) {
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
    wireSide
  };
}

function openRefsFormContinuousPath(
  document: PathPlanningDocument,
  operation: PathOperation,
  segmentsById: ReadonlyMap<SegmentId, PathSegment>
) {
  if (operation.segmentRefs.length === 0) return false;
  const tolerance = Number.isFinite(document.options.coincidenceEpsilon)
    ? Math.max(0, document.options.coincidenceEpsilon)
    : 0;
  for (const ref of operation.segmentRefs) {
    const segment = segmentsById.get(ref.segmentId);
    if (!segment) return false;
    const start = orientedSegmentStart(segment, ref);
    const end = orientedSegmentEnd(segment, ref);
    if (![start.x, start.y, end.x, end.y, segment.length].every(Number.isFinite) ||
      segment.length <= 0) return false;
  }
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
