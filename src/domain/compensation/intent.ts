import {
  machineProfileVerificationFingerprint,
  normalizeMachineProfile
} from '@/domain/machine/machineProfiles';
import {
  orientedSegmentEnd,
  orientedSegmentStart,
  pointsEqual,
  segmentMap,
  signedAreaOfPath
} from '@/domain/path-intel/segments';
import type {
  ClosedContourCompensationIntent,
  PathDiagnostic,
  PathOperation,
  PathPlanningDocument
} from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

export interface CompensationIntentSuggestionInput {
  document: PathPlanningDocument;
  operation: PathOperation;
}

export type ManualCompensationSelection = 'inside' | 'outside' | 'centerline';

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

export function initializeProjectCompensationIntents(
  document: PathPlanningDocument,
  projectMachineSnapshot: MachineProfile
): PathPlanningDocument {
  const next = structuredClone(document);
  const compensationEnabled = machineSnapshotAuthorizesAutomaticCompensation(
    projectMachineSnapshot
  );

  next.geometryBasis = compensationEnabled ? 'finished-contour' : 'wire-centre';
  next.plan.operations.forEach((operation) => {
    if (operation.compensationIntent?.source === 'manual') return;

    const suggestion = compensationEnabled
      ? suggestCompensationIntent({ document: next, operation })
      : undefined;
    if (suggestion) operation.compensationIntent = suggestion;
    else delete operation.compensationIntent;
  });
  const operationsById = new Map(next.plan.operations.map((operation) => [operation.id, operation]));
  next.pathElements.forEach((element) => {
    const intent = element.operationId
      ? operationsById.get(element.operationId)?.compensationIntent
      : undefined;
    if (intent) element.compensationIntent = structuredClone(intent);
    else delete element.compensationIntent;
  });

  return next;
}

export function machineSnapshotAuthorizesAutomaticCompensation(
  projectMachineSnapshot: MachineProfile | null | undefined
) {
  if (!projectMachineSnapshot) return false;
  const machine = normalizeMachineProfile(projectMachineSnapshot);
  const verification = machine.controller.verification;
  return (
    machine.compensation.supported &&
    machine.compensation.enabledByDefault &&
    verification.status === 'user-verified' &&
    verification.verifiedFingerprint === machineProfileVerificationFingerprint(machine)
  );
}

export function setManualCompensationIntent(
  document: PathPlanningDocument,
  operationId: string,
  selection: ManualCompensationSelection
): PathPlanningDocument | null {
  const operation = document.plan.operations.find((candidate) => candidate.id === operationId);
  if (!operation || (selection !== 'centerline' && !operation.closed)) return null;

  const next = structuredClone(document);
  const edited = next.plan.operations.find((candidate) => candidate.id === operationId)!;
  edited.compensationIntent = selection === 'centerline'
    ? { mode: 'centerline', source: 'manual' }
    : { mode: 'controller', keptMaterial: selection, source: 'manual' };
  const pathElement = next.pathElements.find((candidate) => candidate.operationId === operationId);
  if (pathElement) pathElement.compensationIntent = structuredClone(edited.compensationIntent);
  return next;
}

export function operationHasEligibleClosedTopology(
  document: PathPlanningDocument,
  operation: PathOperation
): boolean {
  if (!operation.closed || operation.segmentRefs.length === 0) return false;

  const chain = document.chains.find((candidate) => candidate.id === operation.chainId);
  const contour = document.contours.find((candidate) => candidate.id === operation.contourId);
  if (!chain?.closed || !contour?.closed || chain.kind !== 'closed-contour') return false;
  if (!orientedRefsFormContinuousClosedPath(document, operation)) return false;

  const associatedDiagnosticIds = new Set([...chain.diagnosticIds, ...contour.diagnosticIds]);
  const operationSegmentIds = new Set(operation.segmentRefs.map((ref) => ref.segmentId));
  return !document.diagnostics.some((diagnostic) => {
    if (!BLOCKING_TOPOLOGY_CODES.has(diagnostic.code)) return false;
    if (associatedDiagnosticIds.has(diagnostic.id)) return true;
    if (diagnostic.relatedChainIds?.includes(operation.chainId)) return true;
    if (diagnostic.relatedContourIds?.includes(operation.contourId)) return true;
    return diagnostic.relatedSegmentIds?.some((id) => operationSegmentIds.has(id)) ?? false;
  });
}

function orientedRefsFormContinuousClosedPath(
  document: PathPlanningDocument,
  operation: PathOperation
) {
  const segmentsById = segmentMap(document.segments);
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
