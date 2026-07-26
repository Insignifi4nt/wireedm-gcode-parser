import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import {
  deriveActiveMachiningOperations,
  type ActiveMachiningDerivation
} from '@/domain/path-intel/machiningParticipation';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import { resolveOperationTransitionOwnership } from '@/domain/path-intel/operationTransitionOwnership';
import { validateProgramStops } from '@/domain/path-intel/programStops';
import { resolveOperationThreadingTransition } from '@/domain/path-intel/threadingTransitions';
import type {
  OperationEntry,
  OperationExit,
  OperationProgramStop,
  PathDiagnostic,
  PathOperation,
  PathPlanningDocument,
  Point2
} from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';
import {
  prepareUpidMachinePost,
  type ReadyUpidMachinePostPreparation,
  type UpidMachinePostPreparationIssue
} from '@/domain/post/upidMachinePost';

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
  | { kind: 'machining-participation'; operationId?: string; spanId?: string }
  | { kind: 'program-stop'; operationId: string; stopId: string }
  | { kind: 'diagnostics'; diagnosticId?: string };

export interface UpidProgramTreeEffectiveTransitionMove {
  effectiveOperationId: string;
  origin: 'generated-explicit-linear';
  startPoint: Point2;
  endPoint: Point2;
}

export interface UpidProgramTreeNode {
  treeKey: string;
  kind: 'setup' | 'operation' | 'phase' | 'stop' | 'span';
  label: string;
  detail?: string;
  status: UpidProgramTreeStatus;
  statusReason?: string;
  statusActionTarget?: UpidProgramTreeEditTarget;
  operationId?: string;
  pathElementId?: string;
  editTarget?: UpidProgramTreeEditTarget;
  sequenceEditTarget?: Extract<UpidProgramTreeEditTarget, { kind: 'cut-sequence' }>;
  effectiveTransitionMoves?: readonly UpidProgramTreeEffectiveTransitionMove[];
  children: UpidProgramTreeNode[];
}

export interface UpidProgramTree {
  status: UpidProgramTreeStatus;
  sourceSetupStatus?: UpidProgramTreeStatus;
  sourceSetupStatusReason?: string;
  sourceSetupStatusActionTarget?: UpidProgramTreeEditTarget;
  programStatus?: UpidProgramTreeStatus;
  programStatusReason?: string;
  programStatusActionTarget?: UpidProgramTreeEditTarget;
  sourceSetup: UpidProgramTreeNode[];
  operations: UpidProgramTreeNode[];
}

interface SourceMachiningProjection {
  effectiveOperations: PathOperation[];
  effectiveSegments: PathPlanningDocument['segments'];
  postIssues: UpidMachinePostPreparationIssue[];
  failureReason?: Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'];
}

type ExplicitLinearReadinessByOperationId = Extract<
  ReadyUpidMachinePostPreparation,
  { route: 'explicit-linear' }
>['readinessByOperationId'];

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
  const postPreparation = prepareUpidMachinePost(executionDocument, machine);
  const postIssues = postPreparation.issues;
  const authoritativeGlobalPostBlocker = postIssues.some((issue) =>
    !issue.sourceOperationId &&
    (
      issue.scope === 'machine-setup' ||
      issue.scope === 'geometry-setup'
    )
  );
  const sourceSetup = applyPreparationIssuesToSourceSetup(
    buildSourceSetupNodes(
      executionDocument,
      machine,
      diagnostics.filter((diagnostic) => !ownedDiagnosticIds.has(diagnostic.id))
    ),
    postIssues
  );
  const machiningProjection = projectMachiningBySource(
    executionDocument,
    postPreparation.machining
  );
  for (const issue of postIssues) {
    if (!issue.sourceOperationId) continue;
    machiningProjection.bySourceOperationId
      .get(issue.sourceOperationId)
      ?.postIssues.push(issue);
  }
  const effectiveExecutionDocument = postPreparation.document;
  const explicitLinearReadinessByOperationId =
    postPreparation.status === 'ready' &&
    postPreparation.route === 'explicit-linear'
      ? postPreparation.readinessByOperationId
      : undefined;
  const operations = executionDocument.plan.operations
    .map((operation, executionIndex) => {
      const projection = machiningProjection.bySourceOperationId.get(operation.id)!;
      return buildOperationNode(
        executionDocument,
        machine,
        operation,
        executionIndex,
        projection.effectiveOperations,
        operationDiagnostics.get(operation.id) ?? [],
        projection.failureReason,
        projection.effectiveSegments,
        projection.postIssues,
        effectiveExecutionDocument,
        explicitLinearReadinessByOperationId,
        authoritativeGlobalPostBlocker
      );
    });
  const sourceSetupMetadata = rollUpNodeStatusMetadata(sourceSetup);
  const unownedPostReason =
    postPreparation.status === 'blocked' &&
    postPreparation.reason &&
    (
      postPreparation.reason !== 'machining-participation-blocked' ||
      postPreparation.machining?.status === 'ready'
    ) &&
    postPreparation.issues.length === 0
      ? postPreparation.reason
      : undefined;
  const programPostIssue = postIssues.find((issue) => issue.scope === 'program');
  const programMetadata =
    machiningProjection.unownedFailureReason ||
    unownedPostReason ||
    programPostIssue
    ? {
        status: 'blocked' as const,
        statusReason:
          machiningProjection.unownedFailureReason ??
          unownedPostReason ??
          programPostIssue?.reason,
        statusActionTarget:
          machiningProjection.unownedFailureReason || unownedPostReason
            ? { kind: 'machining-participation' as const }
            : programPostIssue
              ? preparationIssueActionTarget(programPostIssue)
              : undefined
      }
    : rollUpNodeStatusMetadata(operations);

  return {
    status: rollUpStatuses([sourceSetupMetadata.status, programMetadata.status]),
    sourceSetupStatus: sourceSetupMetadata.status,
    sourceSetupStatusReason: sourceSetupMetadata.statusReason,
    sourceSetupStatusActionTarget: sourceSetupMetadata.statusActionTarget,
    programStatus: programMetadata.status,
    programStatusReason: programMetadata.statusReason,
    programStatusActionTarget: programMetadata.statusActionTarget,
    sourceSetup,
    operations
  };
}

function withExecutionOrder(document: PathPlanningDocument): PathPlanningDocument {
  return {
    ...document,
    plan: {
      ...document.plan,
      operations: orderedPathOperations(document.plan.operations)
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
    ...statusDetailsFromNodes(diagnostics),
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
    statusActionTarget: isActionableStatus(initialStatus)
      ? { kind: 'initial-wire' }
      : undefined,
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

function applyPreparationIssuesToSourceSetup(
  nodes: readonly UpidProgramTreeNode[],
  issues: readonly UpidMachinePostPreparationIssue[]
): UpidProgramTreeNode[] {
  return nodes.map((node) => {
    const issue = issues.find((candidate) =>
      (candidate.scope === 'machine-setup' &&
        node.editTarget?.kind === 'machine-setup') ||
      (candidate.scope === 'geometry-setup' &&
        node.editTarget?.kind === 'geometry-setup') ||
      (candidate.scope === 'initial-wire' &&
        node.editTarget?.kind === 'initial-wire')
    );
    if (!issue) return node;
    return {
      ...node,
      status: 'blocked',
      statusReason: issue.reason,
      statusActionTarget: preparationIssueActionTarget(issue)
    };
  });
}

function buildOperationNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation,
  executionIndex: number,
  effectiveOperations: readonly PathOperation[],
  diagnostics: readonly PathDiagnostic[],
  derivationFailure: Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'] | undefined,
  effectiveSegments: PathPlanningDocument['segments'],
  postIssues: readonly UpidMachinePostPreparationIssue[],
  effectiveExecutionDocument: PathPlanningDocument | undefined,
  explicitLinearReadinessByOperationId: ExplicitLinearReadinessByOperationId | undefined,
  authoritativeGlobalPostBlocker: boolean
): UpidProgramTreeNode {
  const stopNodes = buildStopNodes(
    document,
    machine,
    operation,
    effectiveOperations,
    effectiveSegments,
    postIssues
  );
  const stopsByPlacement = groupStopsByPlacement(operation, stopNodes);
  const incoming = buildIncomingConnectionNode(
    document,
    effectiveExecutionDocument,
    machine,
    operation,
    effectiveOperations
  );
  const entry = buildTransitionNode(
    operation,
    effectiveOperations,
    'entry',
    postIssues,
    machine,
    explicitLinearReadinessByOperationId
  );
  const exit = buildTransitionNode(
    operation,
    effectiveOperations,
    'exit',
    postIssues,
    machine,
    explicitLinearReadinessByOperationId
  );
  const cutPath = buildCutPathNode(
    document,
    machine,
    operation,
    effectiveOperations,
    effectiveSegments,
    stopsByPlacement.beforeOperationEnd,
    derivationFailure,
    postIssues,
    authoritativeGlobalPostBlocker
  );
  const operationKey = operationTreeKey(operation.id);
  const diagnosticNodes = buildDiagnosticNodes(diagnostics, operationKey);
  const sourceOperationSuppressed = effectiveOperations.length === 0 && !derivationFailure;
  const projectedChildren = [
    ...stopsByPlacement.beforeEntry,
    incoming,
    entry,
    cutPath,
    ...stopsByPlacement.afterContour,
    exit,
    ...stopsByPlacement.afterExit,
    ...diagnosticNodes
  ];
  const children = sourceOperationSuppressed
    ? projectedChildren.map((node) =>
        diagnosticNodes.includes(node) ? node : inactiveExecutionNode(node)
      )
    : projectedChildren;
  const pathElement = document.pathElements.find((element) => element.operationId === operation.id);
  const status = sourceOperationSuppressed
    ? rollUpStatuses(['inactive', ...diagnosticNodes.map((node) => node.status)])
    : rollUpStatus(children);
  const rolledStatusDetails = statusDetailsFromNodes(children, status);
  const statusReason = status === 'inactive'
    ? 'operation-suppressed-by-machining-participation'
    : rolledStatusDetails.statusReason;

  return {
    treeKey: operationKey,
    kind: 'operation',
    label: `${String(executionIndex + 1).padStart(2, '0')} · ${operation.displayName}`,
    detail: operation.classification,
    status,
    statusReason,
    statusActionTarget: rolledStatusDetails.statusActionTarget,
    operationId: operation.id,
    pathElementId: pathElement?.id,
    editTarget: { kind: 'operation', operationId: operation.id },
    sequenceEditTarget: { kind: 'cut-sequence', operationId: operation.id },
    children
  };
}

function buildIncomingConnectionNode(
  sourceDocument: PathPlanningDocument,
  effectiveDocument: PathPlanningDocument | undefined,
  machine: MachineProfile,
  operation: PathOperation,
  effectiveOperations: readonly PathOperation[]
): UpidProgramTreeNode {
  const effectiveOperation = effectiveOperations[0];
  const document = effectiveDocument ?? sourceDocument;
  const operationId = effectiveOperation?.id ?? operation.id;
  const operationIndex = document.plan.operations.findIndex(
    (candidate) => candidate.id === operationId
  );
  if (operationIndex <= 0) {
    const initial = resolveInitialWirePosition(document);
    const status = initial.status === 'ready'
      ? 'ready'
      : initial.reason === 'review-required' ? 'review-required' : 'blocked';
    return {
      treeKey: `${operationTreeKey(operation.id)}:incoming`,
      kind: 'phase',
      label: 'Incoming connection',
      detail: 'Initial wire position',
      status,
      statusReason: initial.status === 'ready' ? undefined : initial.reason,
      statusActionTarget: isActionableStatus(status)
        ? { kind: 'initial-wire' }
        : undefined,
      operationId: operation.id,
      editTarget: { kind: 'incoming-connection', operationId: operation.id },
      children: []
    };
  }

  const resolution = resolveOperationThreadingTransition(document, operationId, machine);
  return {
    treeKey: `${operationTreeKey(operation.id)}:incoming`,
    kind: 'phase',
    label: 'Incoming connection',
    detail: resolution.status === 'ready'
      ? describeThreading(resolution.transition.mode)
      : describeThreading(
          effectiveOperation?.threadingTransition?.mode ??
          operation.threadingTransition?.mode ??
          document.setup?.threadingDefault?.mode ??
          'manual'
        ),
    status: resolution.status,
    statusReason: resolution.status === 'blocked' ? resolution.reason : undefined,
    statusActionTarget: isActionableStatus(resolution.status)
      ? { kind: 'incoming-connection', operationId: operation.id }
      : undefined,
    operationId: operation.id,
    editTarget: { kind: 'incoming-connection', operationId: operation.id },
    children: []
  };
}

function buildTransitionNode(
  sourceOperation: PathOperation,
  effectiveOperations: readonly PathOperation[],
  phase: 'entry' | 'exit',
  postIssues: readonly UpidMachinePostPreparationIssue[],
  machine: MachineProfile,
  explicitLinearReadinessByOperationId: ExplicitLinearReadinessByOperationId | undefined
): UpidProgramTreeNode {
  const transition = sourceOperation.transitions?.[phase];
  const projectedOperations = effectiveOperations.length > 0
    ? effectiveOperations
    : [sourceOperation];
  const projections = projectedOperations.map((operation) => {
    const ownership = resolveOperationTransitionOwnership(operation, machine);
    const generatedTransition =
      ownership === 'generated-explicit-linear'
        ? explicitLinearReadinessByOperationId?.get(operation.id)?.transition
        : undefined;
    return {
      ownership,
      status:
        ownership === 'generated-explicit-linear'
          ? 'ready' as const
          : transitionStatus(operation.transitions?.[phase]),
      move: generatedTransition
        ? {
            effectiveOperationId: operation.id,
            origin: 'generated-explicit-linear' as const,
            startPoint:
              phase === 'entry'
                ? generatedTransition.leadIn.start
                : generatedTransition.leadOut.start,
            endPoint:
              phase === 'entry'
                ? generatedTransition.leadIn.end
                : generatedTransition.leadOut.end
          }
        : undefined
    };
  });
  const effectiveStatuses = projections.map((projection) => projection.status);
  const generatedCount = projections.filter(
    (projection) => projection.ownership === 'generated-explicit-linear'
  ).length;
  const effectiveTransitionMoves = projections.flatMap((projection) =>
    projection.move ? [projection.move] : []
  );
  const postIssue = phase === 'entry'
    ? postIssues.find((issue) => issue.scope === 'entry-exit')
    : undefined;
  const status = postIssue ? 'blocked' : rollUpStatuses(effectiveStatuses);
  return {
    treeKey: `${operationTreeKey(sourceOperation.id)}:${phase}`,
    kind: 'phase',
    label: phase === 'entry' ? 'Entry / lead-in' : 'Exit / lead-out',
    detail:
      generatedCount === projections.length
        ? 'Generated explicit linear'
        : generatedCount > 0
          ? `${generatedCount} generated · ${projections.length - generatedCount} authored`
          : transition?.strategy === 'none' || !transition
            ? 'None'
            : transition.strategy,
    status,
    statusReason:
      postIssue?.reason ??
      (status === 'review-required' ? 'review-required' : undefined),
    statusActionTarget: isActionableStatus(status)
      ? { kind: 'entry-exit', operationId: sourceOperation.id }
      : undefined,
    operationId: sourceOperation.id,
    editTarget: { kind: 'entry-exit', operationId: sourceOperation.id },
    effectiveTransitionMoves:
      effectiveTransitionMoves.length > 0 ? effectiveTransitionMoves : undefined,
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
  derivationFailure: Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'] | undefined,
  postIssues: readonly UpidMachinePostPreparationIssue[],
  authoritativeGlobalPostBlocker: boolean
): UpidProgramTreeNode {
  const postIssue = postIssues.find((issue) => issue.scope === 'contour-start');
  const contourStart: UpidProgramTreeNode = {
    treeKey: `${operationTreeKey(operation.id)}:contour-start`,
    kind: 'phase',
    label: 'Contour start',
    detail: operation.closed ? undefined : 'Closed contours only',
    status: !operation.closed ? 'inactive' : postIssue ? 'blocked' : 'ready',
    statusReason: !operation.closed
      ? 'closed-contours-only'
      : postIssue?.reason,
    statusActionTarget: operation.closed && postIssue
      ? { kind: 'contour-start', operationId: operation.id }
      : undefined,
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
      buildEffectiveMachiningPathNode(
        effectiveDocument,
        machine,
        operation,
        effectiveOperation,
        postIssues,
        authoritativeGlobalPostBlocker
      )
    );
  const inactiveSpans = buildInactiveParticipationNodes(document, operation);
  const pathStatuses = effectiveOperations.length === 0 && !derivationFailure
    ? ['inactive' as const]
    : effectiveOperations.map((effectiveOperation) =>
      resolveCutPathStatus(
        effectiveDocument,
        machine,
        effectiveOperation,
        postIssues,
        authoritativeGlobalPostBlocker
      )
    );
  const status = derivationFailure
    ? 'blocked'
    : rollUpStatuses([
        contourStart.status,
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
  const children = [contourStart, ...stopNodes, ...effectivePathNodes, ...inactiveSpans];
  const childStatusDetails = statusDetailsFromNodes(children, status);
  const statusReason = derivationFailure ??
    pathFailure?.reason ??
    childStatusDetails.statusReason ??
    (effectiveOperations.length === 0
      ? 'operation-suppressed-by-machining-participation'
      : undefined);
  const statusActionTarget = derivationFailure
    ? { kind: 'machining-participation' as const, operationId: operation.id }
    : pathFailure
      ? { kind: 'operation' as const, operationId: operation.id }
      : childStatusDetails.statusActionTarget;

  return {
    treeKey: `${operationTreeKey(operation.id)}:cut-path`,
    kind: 'phase',
    label: 'Cut path',
    detail: describeEffectiveSegmentCount(effectiveOperations),
    status,
    statusReason,
    statusActionTarget,
    operationId: operation.id,
    children
  };
}

function buildEffectiveMachiningPathNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  sourceOperation: PathOperation,
  effectiveOperation: PathOperation,
  postIssues: readonly UpidMachinePostPreparationIssue[],
  authoritativeGlobalPostBlocker: boolean
): UpidProgramTreeNode {
  const intent = effectiveOperation.machiningIntent!;
  const resolution = resolveCutPathStatus(
    document,
    machine,
    effectiveOperation,
    postIssues,
    authoritativeGlobalPostBlocker
  );
  const status = typeof resolution === 'string' ? resolution : resolution.status;
  const statusReason = typeof resolution === 'string' ? undefined : resolution.reason;
  const spans: UpidProgramTreeNode[] = intent.spanIds.map((spanId) => ({
    treeKey: `${
      operationTreeKey(sourceOperation.id)
    }:effective:${treeKeyComponent(effectiveOperation.id)}:span:${treeKeyComponent(spanId)}`,
    kind: 'span',
    label: `Machining span · ${spanId}`,
    detail: 'Active cut',
    status,
    statusReason,
    statusActionTarget: isActionableStatus(status)
      ? {
          kind: 'machining-participation' as const,
          operationId: sourceOperation.id,
          spanId
        }
      : undefined,
    operationId: sourceOperation.id,
    editTarget: {
      kind: 'machining-participation' as const,
      operationId: sourceOperation.id,
      spanId
    },
    children: []
  }));
  return {
    treeKey: `${
      operationTreeKey(sourceOperation.id)
    }:effective:${treeKeyComponent(effectiveOperation.id)}`,
    kind: 'phase',
    label: 'Effective machining path',
    detail: `${effectiveOperation.metrics.segmentCount} segment${
      effectiveOperation.metrics.segmentCount === 1 ? '' : 's'
    }`,
    status: rollUpStatus(spans),
    statusReason,
    statusActionTarget: isActionableStatus(status)
      ? { kind: 'machining-participation', operationId: sourceOperation.id }
      : undefined,
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
      treeKey: `${operationTreeKey(operation.id)}:inactive-span:${treeKeyComponent(span.id)}`,
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
  operation: PathOperation,
  effectiveOperations: readonly PathOperation[],
  effectiveSegments: PathPlanningDocument['segments'],
  postIssues: readonly UpidMachinePostPreparationIssue[]
): UpidProgramTreeNode[] {
  const validationOperation = effectiveOperations[0] ?? operation;
  const validation = validateProgramStops(
    validationOperation,
    machine,
    effectiveOperations.length > 0 ? effectiveSegments : document.segments
  );
  const postIssue = postIssues.find((issue) => issue.scope === 'program-stop');
  const blockedReason = postIssue?.programStopReason ??
    postIssue?.reason ??
    (validation.status === 'blocked' ? validation.reason : undefined);
  const ordered = [...(operation.programStops ?? [])].sort(compareStops);
  return ordered.map((stop) => {
    const status = !stop.enabled
      ? 'inactive'
      : blockedReason ? 'blocked' : 'ready';
    const editTarget = {
      kind: 'program-stop' as const,
      operationId: operation.id,
      stopId: stop.id
    };
    return {
      treeKey: `${operationTreeKey(operation.id)}:stop:${treeKeyComponent(stop.id)}`,
      kind: 'stop',
      label: `${machine.programStops.code} · ${stopPlacementLabel(stop)}`,
      detail: stop.note ?? stop.reason.replace(/-/g, ' '),
      status,
      statusReason: !stop.enabled
        ? 'disabled'
        : blockedReason,
      statusActionTarget: isActionableStatus(status) ? editTarget : undefined,
      operationId: operation.id,
      editTarget,
      children: []
    };
  });
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

function projectMachiningBySource(
  document: PathPlanningDocument,
  preparedDerivation?: ReturnType<typeof deriveActiveMachiningOperations>
) {
  const globalDerivation =
    preparedDerivation ?? deriveActiveMachiningOperations(document);
  const bySourceOperationId = new Map<string, SourceMachiningProjection>(
    document.plan.operations.map((operation) => [
      operation.id,
      {
        effectiveOperations: [],
        effectiveSegments: document.segments,
        postIssues: []
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

  const unownedFailureReason = deriveUnownedParticipationFailure(document);
  return {
    bySourceOperationId,
    unownedFailureReason:
      unownedFailureReason ??
      (isolatedFailureFound ? undefined : globalDerivation.reason)
  };
}

function deriveUnownedParticipationFailure(
  document: PathPlanningDocument
): Extract<ActiveMachiningDerivation, { status: 'blocked' }>['reason'] | undefined {
  const ownedSegmentIds = new Set(
    document.plan.operations.flatMap((operation) =>
      operation.segmentRefs.map((ref) => ref.segmentId)
    )
  );
  const unownedSpans = (document.machiningParticipation?.spans ?? []).filter(
    (span) => !ownedSegmentIds.has(span.sourceSegmentId)
  );
  if (unownedSpans.length === 0) return undefined;

  const derivation = deriveActiveMachiningOperations({
    ...document,
    machiningParticipation: { spans: unownedSpans },
    plan: {
      ...document.plan,
      operations: []
    }
  });
  return derivation.status === 'blocked' ? derivation.reason : undefined;
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
  operation: PathOperation,
  postIssues: readonly UpidMachinePostPreparationIssue[],
  authoritativeGlobalPostBlocker: boolean
): UpidProgramTreeStatus | { status: 'blocked'; reason: string } {
  const postIssue = postIssues.find((issue) =>
    issue.scope === 'cut-path' &&
    (
      !issue.effectiveOperationId ||
      issue.effectiveOperationId === operation.id ||
      issue.sourceOperationId ===
        (operation.machiningIntent?.sourceOperationId ?? operation.id)
    )
  );
  if (postIssue) return { status: 'blocked', reason: postIssue.reason };
  if (authoritativeGlobalPostBlocker) return 'ready';
  if (operation.compensationIntent?.mode !== 'controller') return 'ready';
  if (!machine.compensation.supported) {
    return { status: 'blocked', reason: 'compensation-unsupported' };
  }
  const compensation = resolveControllerCompensation({ document, operation });
  return compensation.status === 'blocked'
    ? { status: 'blocked', reason: compensation.reason }
    : 'ready';
}

function preparationIssueActionTarget(
  issue: UpidMachinePostPreparationIssue
): UpidProgramTreeEditTarget | undefined {
  switch (issue.scope) {
    case 'machine-setup':
      return { kind: 'machine-setup' };
    case 'geometry-setup':
      return { kind: 'geometry-setup' };
    case 'initial-wire':
      return { kind: 'initial-wire' };
    case 'entry-exit':
      return issue.sourceOperationId
        ? { kind: 'entry-exit', operationId: issue.sourceOperationId }
        : undefined;
    case 'contour-start':
      return issue.sourceOperationId
        ? { kind: 'contour-start', operationId: issue.sourceOperationId }
        : undefined;
    case 'cut-path':
      return issue.sourceOperationId
        ? { kind: 'operation', operationId: issue.sourceOperationId }
        : undefined;
    case 'program':
      return { kind: 'path-summary' };
    case 'program-stop':
      return undefined;
  }
}

function inactiveExecutionNode(node: UpidProgramTreeNode): UpidProgramTreeNode {
  return {
    ...node,
    status: 'inactive',
    statusReason: 'operation-suppressed-by-machining-participation',
    statusActionTarget: undefined,
    children: node.children.map(inactiveExecutionNode)
  };
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
  return diagnostics.map((diagnostic) => {
    const status = diagnosticStatus(diagnostic);
    const editTarget = { kind: 'diagnostics' as const, diagnosticId: diagnostic.id };
    return {
      treeKey: `${treeKeyPrefix}:diagnostic:${treeKeyComponent(diagnostic.id)}`,
      kind: 'phase',
      label: diagnostic.message,
      detail: diagnostic.code,
      status,
      statusReason: diagnostic.code,
      statusActionTarget: isActionableStatus(status) ? editTarget : undefined,
      editTarget,
      children: []
    };
  });
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

function rollUpNodeStatusMetadata(nodes: readonly UpidProgramTreeNode[]) {
  const status = rollUpStatus(nodes);
  return {
    status,
    ...statusDetailsFromNodes(nodes, status)
  };
}

function statusDetailsFromNodes(
  nodes: readonly UpidProgramTreeNode[],
  status = rollUpStatus(nodes)
): Pick<UpidProgramTreeNode, 'statusReason' | 'statusActionTarget'> {
  if (!isActionableStatus(status)) return {};
  const owner = nodes.find(
    (node) => node.status === status && node.statusActionTarget
  );
  const reasonOwner = owner ?? nodes.find(
    (node) => node.status === status && node.statusReason
  );
  return {
    statusReason: reasonOwner?.statusReason,
    statusActionTarget: owner?.statusActionTarget
  };
}

function isActionableStatus(
  status: UpidProgramTreeStatus
): status is 'blocked' | 'review-required' {
  return status === 'blocked' || status === 'review-required';
}

function operationTreeKey(operationId: string) {
  return `operation:${treeKeyComponent(operationId)}`;
}

function treeKeyComponent(value: string) {
  return encodeURIComponent(value);
}
