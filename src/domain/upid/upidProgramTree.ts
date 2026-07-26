import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import {
  deriveActiveMachiningOperations,
  type ActiveMachiningDerivation
} from '@/domain/path-intel/machiningParticipation';
import { validateProgramStops } from '@/domain/path-intel/programStops';
import { resolveOperationThreadingTransition } from '@/domain/path-intel/threadingTransitions';
import type {
  OperationEntry,
  OperationExit,
  OperationProgramStop,
  PathDiagnostic,
  PathOperation,
  PathPlanningDocument
} from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

export type UpidProgramTreeStatus =
  | 'ready'
  | 'review-required'
  | 'blocked'
  | 'inactive';

export type UpidProgramTreeEditTarget =
  | { kind: 'path-summary' }
  | { kind: 'geometry-setup' }
  | { kind: 'machine-setup' }
  | { kind: 'initial-wire' }
  | { kind: 'threading-default' }
  | { kind: 'operation'; operationId: string }
  | { kind: 'cut-sequence'; operationId: string }
  | { kind: 'contour-start'; operationId: string }
  | { kind: 'incoming-connection'; operationId: string }
  | { kind: 'entry-exit'; operationId: string }
  | { kind: 'machining-participation'; operationId: string; spanId?: string }
  | { kind: 'program-stop'; operationId: string; stopId: string }
  | { kind: 'diagnostics'; diagnosticId?: string };

export interface UpidProgramTreeNode {
  treeKey: string;
  kind: 'setup' | 'operation' | 'phase' | 'stop' | 'span';
  label: string;
  detail?: string;
  status: UpidProgramTreeStatus;
  statusReason?: string;
  operationId?: string;
  pathElementId?: string;
  editTarget?: UpidProgramTreeEditTarget;
  sequenceEditTarget?: Extract<UpidProgramTreeEditTarget, { kind: 'cut-sequence' }>;
  children: UpidProgramTreeNode[];
}

export interface UpidProgramTree {
  status: UpidProgramTreeStatus;
  sourceSetupStatus?: UpidProgramTreeStatus;
  programStatus?: UpidProgramTreeStatus;
  programStatusReason?: string;
  sourceSetup: UpidProgramTreeNode[];
  operations: UpidProgramTreeNode[];
}

interface SourceMachiningProjection {
  effectiveOperations: PathOperation[];
  effectiveSegments: PathPlanningDocument['segments'];
  failureReason?: Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'];
}

export function buildUpidProgramTree(
  document: PathPlanningDocument,
  machine: MachineProfile
): UpidProgramTree {
  const executionDocument = withExecutionOrder(document);
  const diagnostics = readDiagnostics(executionDocument);
  const operationDiagnostics = new Map(
    executionDocument.plan.operations.map((operation) => [
      operation.id,
      diagnostics.filter((diagnostic) =>
        diagnosticAffectsOperation(executionDocument, operation, diagnostic)
      )
    ])
  );
  const ownedDiagnosticIds = new Set(
    [...operationDiagnostics.values()].flat().map((diagnostic) => diagnostic.id)
  );
  const sourceSetup = buildSourceSetupNodes(
    executionDocument,
    machine,
    diagnostics.filter((diagnostic) => !ownedDiagnosticIds.has(diagnostic.id))
  );
  const machiningProjection = projectMachiningBySource(executionDocument);
  const operations = executionDocument.plan.operations
    .map((operation) => {
      const projection = machiningProjection.bySourceOperationId.get(operation.id)!;
      return buildOperationNode(
        executionDocument,
        machine,
        operation,
        projection.effectiveOperations,
        operationDiagnostics.get(operation.id) ?? [],
        projection.failureReason,
        projection.effectiveSegments
      );
    });
  const sourceSetupStatus = rollUpStatus(sourceSetup);
  const programStatus = rollUpStatuses([
    rollUpStatus(operations),
    ...(machiningProjection.unownedFailureReason ? ['blocked' as const] : [])
  ]);

  return {
    status: rollUpStatuses([sourceSetupStatus, programStatus]),
    sourceSetupStatus,
    programStatus,
    programStatusReason: machiningProjection.unownedFailureReason,
    sourceSetup,
    operations
  };
}

function withExecutionOrder(document: PathPlanningDocument): PathPlanningDocument {
  return {
    ...document,
    plan: {
      ...document.plan,
      operations: [...document.plan.operations]
        .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
    }
  };
}

function buildSourceSetupNodes(
  document: PathPlanningDocument,
  machine: MachineProfile,
  sourceDiagnostics: readonly PathDiagnostic[]
): UpidProgramTreeNode[] {
  const diagnostics = buildDiagnosticNodes(sourceDiagnostics, 'setup');
  const initial = resolveInitialWirePosition(document);
  const initialStatus = initial.status === 'ready'
    ? 'ready'
    : initial.reason === 'review-required' ? 'review-required' : 'blocked';

  const summary: UpidProgramTreeNode = {
    treeKey: 'setup:path-summary',
    kind: 'setup',
    label: 'Path summary',
    detail: `${document.plan.operations.length} operation${document.plan.operations.length === 1 ? '' : 's'}`,
    status: diagnostics.length === 0 ? 'ready' : rollUpStatus(diagnostics),
    editTarget: { kind: 'path-summary' },
    children: diagnostics
  };
  const geometry: UpidProgramTreeNode = {
    treeKey: 'setup:geometry',
    kind: 'setup',
    label: 'Geometry setup',
    detail: document.geometryBasis === 'finished-contour' ? 'Finished contour' : 'Wire centre',
    status: 'ready',
    editTarget: { kind: 'geometry-setup' },
    children: []
  };
  const machineSetup: UpidProgramTreeNode = {
    treeKey: 'setup:machine',
    kind: 'setup',
    label: 'Machine setup',
    detail: machine.name,
    status: 'ready',
    editTarget: { kind: 'machine-setup' },
    children: []
  };
  const initialWire: UpidProgramTreeNode = {
    treeKey: 'setup:initial-wire',
    kind: 'setup',
    label: 'Initial wire position',
    detail: initial.status === 'ready' ? initial.source : initial.reason.replace(/-/g, ' '),
    status: initialStatus,
    statusReason: initial.status === 'ready' ? undefined : initial.reason,
    editTarget: { kind: 'initial-wire' },
    children: []
  };
  const threadingDefault = document.setup?.threadingDefault;
  const threading: UpidProgramTreeNode = {
    treeKey: 'setup:threading-default',
    kind: 'setup',
    label: 'Default threading',
    detail: threadingDefault ? describeThreading(threadingDefault.mode) : 'Manual rethread',
    status: 'ready',
    editTarget: { kind: 'threading-default' },
    children: []
  };

  return [summary, geometry, machineSetup, initialWire, threading];
}

function buildOperationNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation,
  effectiveOperations: readonly PathOperation[],
  diagnostics: readonly PathDiagnostic[],
  derivationFailure: Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'] | undefined,
  effectiveSegments: PathPlanningDocument['segments']
): UpidProgramTreeNode {
  const stopNodes = buildStopNodes(document, machine, operation);
  const stopsByPlacement = groupStopsByPlacement(operation, stopNodes);
  const incoming = buildIncomingConnectionNode(document, machine, operation);
  const entry = buildTransitionNode(operation, effectiveOperations, 'entry');
  const exit = buildTransitionNode(operation, effectiveOperations, 'exit');
  const cutPath = buildCutPathNode(
    document,
    machine,
    operation,
    effectiveOperations,
    effectiveSegments,
    stopsByPlacement.beforeOperationEnd,
    derivationFailure
  );
  const diagnosticNodes = buildDiagnosticNodes(diagnostics, `operation:${operation.id}`);
  const sourceOperationSuppressed = effectiveOperations.length === 0 && !derivationFailure;
  const children = [
    ...stopsByPlacement.beforeEntry,
    incoming,
    entry,
    cutPath,
    ...stopsByPlacement.afterContour,
    exit,
    ...stopsByPlacement.afterExit,
    ...diagnosticNodes
  ];
  const pathElement = document.pathElements.find((element) => element.operationId === operation.id);
  const status = sourceOperationSuppressed
    ? rollUpStatuses(['inactive', ...diagnosticNodes.map((node) => node.status)])
    : rollUpStatus(children);

  return {
    treeKey: `operation:${operation.id}`,
    kind: 'operation',
    label: `${String(operation.orderIndex + 1).padStart(2, '0')} · ${operation.displayName}`,
    detail: operation.classification,
    status,
    statusReason: status === 'inactive'
      ? 'operation-suppressed-by-machining-participation'
      : undefined,
    operationId: operation.id,
    pathElementId: pathElement?.id,
    editTarget: { kind: 'operation', operationId: operation.id },
    sequenceEditTarget: { kind: 'cut-sequence', operationId: operation.id },
    children
  };
}

function buildIncomingConnectionNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation
): UpidProgramTreeNode {
  const operationIndex = document.plan.operations.findIndex((candidate) => candidate.id === operation.id);
  if (operationIndex <= 0) {
    const initial = resolveInitialWirePosition(document);
    const status = initial.status === 'ready'
      ? 'ready'
      : initial.reason === 'review-required' ? 'review-required' : 'blocked';
    return {
      treeKey: `operation:${operation.id}:incoming`,
      kind: 'phase',
      label: 'Incoming connection',
      detail: 'Initial wire position',
      status,
      statusReason: initial.status === 'ready' ? undefined : initial.reason,
      operationId: operation.id,
      editTarget: { kind: 'incoming-connection', operationId: operation.id },
      children: []
    };
  }

  const resolution = resolveOperationThreadingTransition(document, operation.id, machine);
  return {
    treeKey: `operation:${operation.id}:incoming`,
    kind: 'phase',
    label: 'Incoming connection',
    detail: resolution.status === 'ready'
      ? describeThreading(resolution.transition.mode)
      : describeThreading(operation.threadingTransition?.mode ?? document.setup?.threadingDefault?.mode ?? 'manual'),
    status: resolution.status,
    statusReason: resolution.status === 'blocked' ? resolution.reason : undefined,
    operationId: operation.id,
    editTarget: { kind: 'incoming-connection', operationId: operation.id },
    children: []
  };
}

function buildTransitionNode(
  sourceOperation: PathOperation,
  effectiveOperations: readonly PathOperation[],
  phase: 'entry' | 'exit'
): UpidProgramTreeNode {
  const transition = sourceOperation.transitions?.[phase];
  const effectiveStatuses = (effectiveOperations.length > 0
    ? effectiveOperations
    : [sourceOperation]
  ).map((operation) => transitionStatus(operation.transitions?.[phase]));
  const status = rollUpStatuses(effectiveStatuses);
  return {
    treeKey: `operation:${sourceOperation.id}:${phase}`,
    kind: 'phase',
    label: phase === 'entry' ? 'Entry / lead-in' : 'Exit / lead-out',
    detail: transition?.strategy === 'none' || !transition ? 'None' : transition.strategy,
    status,
    statusReason: status === 'review-required' ? 'review-required' : undefined,
    operationId: sourceOperation.id,
    editTarget: { kind: 'entry-exit', operationId: sourceOperation.id },
    children: []
  };
}

function buildCutPathNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation,
  effectiveOperations: readonly PathOperation[],
  effectiveSegments: PathPlanningDocument['segments'],
  stopNodes: UpidProgramTreeNode[],
  derivationFailure: Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'] | undefined
): UpidProgramTreeNode {
  const contourStart: UpidProgramTreeNode = {
    treeKey: `operation:${operation.id}:contour-start`,
    kind: 'phase',
    label: 'Contour start',
    detail: operation.closed ? undefined : 'Closed contours only',
    status: operation.closed ? 'ready' : 'inactive',
    statusReason: operation.closed ? undefined : 'closed-contours-only',
    operationId: operation.id,
    ...(operation.closed
      ? { editTarget: { kind: 'contour-start' as const, operationId: operation.id } }
      : {}),
    children: []
  };
  const effectiveDocument = { ...document, segments: effectiveSegments };
  const effectivePathNodes = effectiveOperations
    .filter((effectiveOperation) => effectiveOperation.machiningIntent?.kind === 'partial-contour')
    .map((effectiveOperation) =>
      buildEffectiveMachiningPathNode(effectiveDocument, machine, operation, effectiveOperation)
    );
  const inactiveSpans = buildInactiveParticipationNodes(document, operation);
  const pathStatuses = effectiveOperations.length === 0 && !derivationFailure
    ? ['inactive' as const]
    : effectiveOperations.map((effectiveOperation) =>
      resolveCutPathStatus(effectiveDocument, machine, effectiveOperation)
    );
  const status = derivationFailure
    ? 'blocked'
    : rollUpStatuses([
        ...pathStatuses.map((resolution) =>
          typeof resolution === 'string' ? resolution : resolution.status
        ),
        ...stopNodes.map((node) => node.status),
        ...effectivePathNodes.map((node) => node.status),
        ...inactiveSpans.map((node) => node.status)
      ]);
  const pathFailure = pathStatuses.find(
    (resolution): resolution is { status: 'blocked'; reason: string } =>
      typeof resolution !== 'string' && resolution.status === 'blocked'
  );
  const statusReason = derivationFailure ??
    pathFailure?.reason ??
    (effectiveOperations.length === 0
      ? 'operation-suppressed-by-machining-participation'
      : undefined);

  return {
    treeKey: `operation:${operation.id}:cut-path`,
    kind: 'phase',
    label: 'Cut path',
    detail: describeEffectiveSegmentCount(effectiveOperations),
    status,
    statusReason,
    operationId: operation.id,
    children: [contourStart, ...stopNodes, ...effectivePathNodes, ...inactiveSpans]
  };
}

function buildEffectiveMachiningPathNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  sourceOperation: PathOperation,
  effectiveOperation: PathOperation
): UpidProgramTreeNode {
  const intent = effectiveOperation.machiningIntent!;
  const resolution = resolveCutPathStatus(document, machine, effectiveOperation);
  const status = typeof resolution === 'string' ? resolution : resolution.status;
  const statusReason = typeof resolution === 'string' ? undefined : resolution.reason;
  const spans: UpidProgramTreeNode[] = intent.spanIds.map((spanId) => ({
    treeKey: `operation:${sourceOperation.id}:effective:${effectiveOperation.id}:span:${spanId}`,
    kind: 'span',
    label: `Machining span · ${spanId}`,
    detail: 'Active cut',
    status,
    statusReason,
    operationId: sourceOperation.id,
    editTarget: {
      kind: 'machining-participation' as const,
      operationId: sourceOperation.id,
      spanId
    },
    children: []
  }));
  return {
    treeKey: `operation:${sourceOperation.id}:effective:${effectiveOperation.id}`,
    kind: 'phase',
    label: 'Effective machining path',
    detail: `${effectiveOperation.metrics.segmentCount} segment${
      effectiveOperation.metrics.segmentCount === 1 ? '' : 's'
    }`,
    status: rollUpStatus(spans),
    statusReason,
    operationId: sourceOperation.id,
    editTarget: { kind: 'machining-participation', operationId: sourceOperation.id },
    children: spans
  };
}

function buildInactiveParticipationNodes(
  document: PathPlanningDocument,
  operation: PathOperation
): UpidProgramTreeNode[] {
  const operationSegmentIds = new Set(operation.segmentRefs.map((ref) => ref.segmentId));
  return (document.machiningParticipation?.spans ?? [])
    .filter((span) =>
      span.participation === 'inactive-reference' &&
      operationSegmentIds.has(span.sourceSegmentId)
    )
    .map((span) => ({
      treeKey: `operation:${operation.id}:inactive-span:${span.id}`,
      kind: 'span',
      label: `Machining span · ${span.id}`,
      detail: 'Inactive reference',
      status: 'inactive',
      statusReason: 'inactive-reference',
      operationId: operation.id,
      editTarget: {
        kind: 'machining-participation',
        operationId: operation.id,
        spanId: span.id
      },
      children: []
    }));
}

function buildStopNodes(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation
): UpidProgramTreeNode[] {
  const validation = validateProgramStops(operation, machine, document.segments);
  const ordered = [...(operation.programStops ?? [])].sort(compareStops);
  return ordered.map((stop) => ({
    treeKey: `operation:${operation.id}:stop:${stop.id}`,
    kind: 'stop',
    label: `${machine.programStops.code} · ${stopPlacementLabel(stop)}`,
    detail: stop.note ?? stop.reason.replace(/-/g, ' '),
    status: !stop.enabled ? 'inactive' : validation.status === 'blocked' ? 'blocked' : 'ready',
    statusReason: !stop.enabled
      ? 'disabled'
      : validation.status === 'blocked' ? validation.reason : undefined,
    operationId: operation.id,
    editTarget: { kind: 'program-stop', operationId: operation.id, stopId: stop.id },
    children: []
  }));
}

function groupStopsByPlacement(operation: PathOperation, stops: UpidProgramTreeNode[]) {
  const stopsById = new Map((operation.programStops ?? []).map((stop) => [stop.id, stop]));
  const atPlacement = (placement: OperationProgramStop['placement']['kind']) => stops.filter((node) => {
    const target = node.editTarget;
    return target?.kind === 'program-stop' &&
      stopsById.get(target.stopId)?.placement.kind === placement;
  });
  return {
    beforeEntry: atPlacement('before-entry'),
    beforeOperationEnd: atPlacement('before-operation-end'),
    afterContour: atPlacement('after-contour'),
    afterExit: atPlacement('after-exit')
  };
}

function compareStops(left: OperationProgramStop, right: OperationProgramStop) {
  const placementOrder = stopPlacementOrder(left) - stopPlacementOrder(right);
  if (placementOrder !== 0) return placementOrder;
  if (
    left.placement.kind === 'before-operation-end' &&
    right.placement.kind === 'before-operation-end'
  ) {
    return right.placement.remainingCutLengthMm - left.placement.remainingCutLengthMm ||
      left.id.localeCompare(right.id);
  }
  return left.id.localeCompare(right.id);
}

function stopPlacementOrder(stop: OperationProgramStop) {
  switch (stop.placement.kind) {
    case 'before-entry': return 0;
    case 'before-operation-end': return 1;
    case 'after-contour': return 2;
    case 'after-exit': return 3;
  }
}

function stopPlacementLabel(stop: OperationProgramStop) {
  switch (stop.placement.kind) {
    case 'before-entry': return 'Before entry';
    case 'before-operation-end': return 'Before operation end';
    case 'after-contour': return 'After contour';
    case 'after-exit': return 'After exit';
  }
}

function describeThreading(mode: 'manual' | 'automatic' | 'continuous') {
  switch (mode) {
    case 'manual': return 'Manual rethread';
    case 'automatic': return 'Automatic rethread';
    case 'continuous': return 'Continuous threading';
  }
}

function projectMachiningBySource(document: PathPlanningDocument) {
  const globalDerivation = deriveActiveMachiningOperations(document);
  const bySourceOperationId = new Map<string, SourceMachiningProjection>(
    document.plan.operations.map((operation) => [
      operation.id,
      {
        effectiveOperations: [],
        effectiveSegments: document.segments
      }
    ])
  );

  if (globalDerivation.status === 'ready') {
    for (const operation of globalDerivation.operations) {
      const sourceOperationId =
        operation.machiningIntent?.sourceOperationId ?? operation.id;
      bySourceOperationId.get(sourceOperationId)?.effectiveOperations.push(operation);
    }
    bySourceOperationId.forEach((projection) => {
      projection.effectiveSegments = globalDerivation.segments;
    });
    return { bySourceOperationId, unownedFailureReason: undefined };
  }

  let isolatedFailureFound = false;
  for (const sourceOperation of document.plan.operations) {
    const derivation = deriveMachiningForSourceOperation(document, sourceOperation);
    const projection = bySourceOperationId.get(sourceOperation.id)!;
    if (derivation.status === 'ready') {
      projection.effectiveOperations = derivation.operations.filter((operation) =>
        operation.id === sourceOperation.id ||
        operation.machiningIntent?.sourceOperationId === sourceOperation.id
      );
      projection.effectiveSegments = derivation.segments;
    } else {
      projection.failureReason = derivation.reason;
      isolatedFailureFound = true;
    }
  }

  return {
    bySourceOperationId,
    unownedFailureReason: isolatedFailureFound ? undefined : globalDerivation.reason
  };
}

function deriveMachiningForSourceOperation(
  document: PathPlanningDocument,
  sourceOperation: PathOperation
): ActiveMachiningDerivation {
  const sourceSegmentIds = new Set(
    sourceOperation.segmentRefs.map((ref) => ref.segmentId)
  );
  const participation = document.machiningParticipation;
  const isolatedDocument: PathPlanningDocument = {
    ...document,
    plan: {
      ...document.plan,
      operations: [sourceOperation]
    },
    ...(participation
      ? {
          machiningParticipation: {
            ...participation,
            spans: participation.spans.filter((span) =>
              sourceSegmentIds.has(span.sourceSegmentId)
            ),
            partialContourCompensation:
              participation.partialContourCompensation?.filter(
                (setting) => setting.sourceOperationId === sourceOperation.id
              ),
            partialContourEntryReviews:
              participation.partialContourEntryReviews?.filter(
                (review) => review.sourceOperationId === sourceOperation.id
              )
          }
        }
      : {})
  };
  return deriveActiveMachiningOperations(isolatedDocument);
}

function transitionStatus(
  transition: OperationEntry | OperationExit | undefined
): UpidProgramTreeStatus {
  const review = transition?.strategy === 'none'
    ? transition.review
    : transition?.strategy === 'manual-straight' ? transition.review : 'reviewed';
  return review === 'required' ? 'review-required' : 'ready';
}

function resolveCutPathStatus(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation
): UpidProgramTreeStatus | { status: 'blocked'; reason: string } {
  if (operation.compensationIntent?.mode !== 'controller') return 'ready';
  if (!machine.compensation.supported) {
    return { status: 'blocked', reason: 'compensation-unsupported' };
  }
  const compensation = resolveControllerCompensation({ document, operation });
  return compensation.status === 'blocked'
    ? { status: 'blocked', reason: compensation.reason }
    : 'ready';
}

function describeEffectiveSegmentCount(
  effectiveOperations: readonly PathOperation[]
) {
  const segmentCount = effectiveOperations.reduce(
    (total, operation) => total + operation.metrics.segmentCount,
    0
  );
  return `${segmentCount} segment${segmentCount === 1 ? '' : 's'}`;
}

function buildDiagnosticNodes(
  diagnostics: readonly PathDiagnostic[],
  treeKeyPrefix: string
): UpidProgramTreeNode[] {
  return diagnostics.map((diagnostic) => ({
    treeKey: `${treeKeyPrefix}:diagnostic:${diagnostic.id}`,
    kind: 'phase',
    label: diagnostic.message,
    detail: diagnostic.code,
    status: diagnosticStatus(diagnostic),
    statusReason: diagnostic.code,
    editTarget: { kind: 'diagnostics', diagnosticId: diagnostic.id },
    children: []
  }));
}

function diagnosticAffectsOperation(
  document: PathPlanningDocument,
  operation: PathOperation,
  diagnostic: PathDiagnostic
) {
  const operationSegmentIds = new Set(operation.segmentRefs.map((ref) => ref.segmentId));
  if (diagnostic.relatedSegmentIds?.some((id) => operationSegmentIds.has(id))) return true;
  if (diagnostic.relatedChainIds?.includes(operation.chainId)) return true;
  if (diagnostic.relatedContourIds?.includes(operation.contourId)) return true;

  const relatedClusterIds = new Set(diagnostic.relatedClusterIds ?? []);
  if (relatedClusterIds.size > 0 && document.endpointClusters.some((cluster) =>
    relatedClusterIds.has(cluster.id) &&
    cluster.members.some((member) => operationSegmentIds.has(member.segmentId))
  )) return true;

  const associatedDiagnosticIds = new Set([
    ...(document.chains.find((chain) => chain.id === operation.chainId)?.diagnosticIds ?? []),
    ...(document.contours.find((contour) => contour.id === operation.contourId)?.diagnosticIds ?? []),
    ...(document.pathElements.find((element) => element.operationId === operation.id)?.diagnosticIds ?? [])
  ]);
  return associatedDiagnosticIds.has(diagnostic.id);
}

function diagnosticStatus(diagnostic: PathDiagnostic): UpidProgramTreeStatus {
  if (diagnostic.severity === 'error') return 'blocked';
  if (diagnostic.severity === 'warning') return 'review-required';
  return 'ready';
}

function readDiagnostics(document: PathPlanningDocument) {
  const diagnostics = [...document.diagnostics, ...document.plan.diagnostics];
  return diagnostics.filter((diagnostic, index) =>
    diagnostics.findIndex((candidate) => candidate.id === diagnostic.id) === index
  );
}

function rollUpStatus(nodes: readonly UpidProgramTreeNode[]): UpidProgramTreeStatus {
  return rollUpStatuses(nodes.map((node) => node.status));
}

function rollUpStatuses(
  statuses: readonly UpidProgramTreeStatus[]
): UpidProgramTreeStatus {
  if (statuses.some((status) => status === 'blocked')) return 'blocked';
  if (statuses.some((status) => status === 'review-required')) return 'review-required';
  if (statuses.some((status) => status === 'ready')) return 'ready';
  return 'inactive';
}
