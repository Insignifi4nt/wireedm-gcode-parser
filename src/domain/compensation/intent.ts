import {
  orientedSegmentEnd,
  orientedSegmentStart,
  pointsEqual,
  segmentMap,
  signedAreaOfPath
} from '@/domain/path-intel/segments';
import type {
  ClosedContourCompensationIntent,
  PathChain,
  PathContour,
  PathDiagnostic,
  PathOperation,
  PathPlanningDocument,
  PathSegment,
  SegmentId
} from '@/domain/path-intel/types';

export interface CompensationIntentSuggestionInput {
  document: PathPlanningDocument;
  operation: PathOperation;
}

export type ManualCompensationSelection =
  | 'automatic'
  | 'inside'
  | 'outside'
  | 'left'
  | 'right'
  | 'centerline';

const AUTOMATIC_KEPT_MATERIAL = {
  exterior: 'inside',
  island: 'inside',
  hole: 'outside'
} as const;

const BLOCKING_TOPOLOGY_CODES = new Set<PathDiagnostic['code']>([
  'zero-length-segment',
  'non-finite-geometry',
  'overlapping-segment',
  'intersecting-topology',
  'invalid-arc',
  'invalid-polyline',
  'ambiguous-endpoint-cluster',
  'branching-topology',
  'open-chain',
  'closed-chain-gap',
  'self-intersection',
  'degenerate-contour',
  'upid-discontinuity',
  'upid-broken-closure'
]);

export function suggestCompensationIntent({
  document,
  operation
}: CompensationIntentSuggestionInput): ClosedContourCompensationIntent | undefined {
  const keptMaterial = AUTOMATIC_KEPT_MATERIAL[
    operation.classification as keyof typeof AUTOMATIC_KEPT_MATERIAL
  ];
  if (
    document.geometryBasis !== 'finished-contour' ||
    !keptMaterial ||
    !operationHasEligibleClosedTopology(document, operation)
  ) {
    return undefined;
  }

  const segmentsById = segmentMap(document.segments);
  if (operation.segmentRefs.some((ref) => !segmentsById.has(ref.segmentId))) return undefined;

  const signedArea = signedAreaOfPath(operation.segmentRefs, segmentsById);
  if (!Number.isFinite(signedArea) || signedArea === 0) return undefined;

  return {
    mode: 'controller',
    keptMaterial,
    source: 'automatic'
  };
}

export function setManualCompensationIntent(
  document: PathPlanningDocument,
  operationId: string,
  selection: ManualCompensationSelection
): PathPlanningDocument | null {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return null;
  const selectingKeptMaterial = selection === 'inside' || selection === 'outside';
  const selectingWireSide = selection === 'left' || selection === 'right';
  if (selection === 'automatic' && !operation.closed) return null;
  if (selectingKeptMaterial && !operation.closed) return null;
  if (
    selectingWireSide &&
    (operation.closed || operation.machiningIntent?.kind !== 'partial-contour')
  ) return null;

  const next = structuredClone(document);
  const edited = next.plan.operations.find((candidate) => candidate.id === operationId)!;
  edited.compensationIntent = selection === 'automatic'
    ? suggestCompensationIntent({ document: next, operation: edited })
    : selection === 'centerline'
    ? { mode: 'centerline', source: 'manual' }
    : selectingWireSide
      ? { mode: 'controller', wireSide: selection, source: 'manual' }
      : { mode: 'controller', keptMaterial: selection, source: 'manual' };
  if (!edited.compensationIntent) return null;
  const pathElement = next.pathElements.find((candidate) => candidate.operationId === operationId);
  if (pathElement) pathElement.compensationIntent = structuredClone(edited.compensationIntent);
  return next;
}

/**
 * Document-wide indexes for checking compensation on many operations. Build it
 * once per document version; the document must not change while it is in use.
 */
export interface CompensationTopologyLookup {
  readonly segmentsById: ReadonlyMap<SegmentId, PathSegment>;
  readonly chainsById: ReadonlyMap<string, PathChain>;
  readonly contoursById: ReadonlyMap<string, PathContour>;
  readonly blockingDiagnosticIds: ReadonlySet<string>;
  readonly blockedChainIds: ReadonlySet<string>;
  readonly blockedContourIds: ReadonlySet<string>;
  readonly blockedSegmentIds: ReadonlySet<SegmentId>;
}

export function createCompensationTopologyLookup(document: PathPlanningDocument): CompensationTopologyLookup {
  const blockingDiagnosticIds = new Set<string>();
  const blockedChainIds = new Set<string>();
  const blockedContourIds = new Set<string>();
  const blockedSegmentIds = new Set<SegmentId>();
  for (const diagnostic of document.diagnostics) {
    if (!BLOCKING_TOPOLOGY_CODES.has(diagnostic.code)) continue;
    blockingDiagnosticIds.add(diagnostic.id);
    for (const id of diagnostic.relatedChainIds ?? []) blockedChainIds.add(id);
    for (const id of diagnostic.relatedContourIds ?? []) blockedContourIds.add(id);
    for (const id of diagnostic.relatedSegmentIds ?? []) blockedSegmentIds.add(id);
  }
  return {
    segmentsById: segmentMap(document.segments),
    chainsById: firstById(document.chains),
    contoursById: firstById(document.contours),
    blockingDiagnosticIds,
    blockedChainIds,
    blockedContourIds,
    blockedSegmentIds
  };
}

function firstById<T extends { id: string }>(items: readonly T[]) {
  const byId = new Map<string, T>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return byId;
}

export function operationHasEligibleClosedTopology(
  document: PathPlanningDocument,
  operation: PathOperation,
  lookup: CompensationTopologyLookup = createCompensationTopologyLookup(document)
): boolean {
  if (!operation.closed || operation.segmentRefs.length === 0) return false;

  const chain = lookup.chainsById.get(operation.chainId);
  const contour = lookup.contoursById.get(operation.contourId);
  if (!chain?.closed || !contour?.closed || chain.kind !== 'closed-contour') return false;
  if (!orientedRefsFormContinuousClosedPath(document, operation, lookup.segmentsById)) return false;

  return !(
    chain.diagnosticIds.some((id) => lookup.blockingDiagnosticIds.has(id)) ||
    contour.diagnosticIds.some((id) => lookup.blockingDiagnosticIds.has(id)) ||
    lookup.blockedChainIds.has(operation.chainId) ||
    lookup.blockedContourIds.has(operation.contourId) ||
    operation.segmentRefs.some((ref) => lookup.blockedSegmentIds.has(ref.segmentId))
  );
}

function orientedRefsFormContinuousClosedPath(
  document: PathPlanningDocument,
  operation: PathOperation,
  segmentsById: ReadonlyMap<SegmentId, PathSegment>
) {
  const tolerance = Number.isFinite(document.options.coincidenceEpsilon)
    ? Math.max(0, document.options.coincidenceEpsilon)
    : 0;

  for (let index = 0; index < operation.segmentRefs.length; index++) {
    const currentRef = operation.segmentRefs[index];
    const nextRef = operation.segmentRefs[(index + 1) % operation.segmentRefs.length];
    const current = segmentsById.get(currentRef.segmentId);
    const next = segmentsById.get(nextRef.segmentId);
    if (!current || !next) return false;

    const end = orientedSegmentEnd(current, currentRef);
    const start = orientedSegmentStart(next, nextRef);
    if (
      !Number.isFinite(end.x) ||
      !Number.isFinite(end.y) ||
      !Number.isFinite(start.x) ||
      !Number.isFinite(start.y) ||
      !pointsEqual(end, start, tolerance)
    ) {
      return false;
    }
  }

  return true;
}
