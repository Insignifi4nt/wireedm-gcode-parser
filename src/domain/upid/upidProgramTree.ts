import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import { validateProgramStops } from '@/domain/path-intel/programStops';
import { resolveOperationThreadingTransition } from '@/domain/path-intel/threadingTransitions';
import type {
  OperationProgramStop,
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
  children: UpidProgramTreeNode[];
}

export interface UpidProgramTree {
  status: UpidProgramTreeStatus;
  sourceSetup: UpidProgramTreeNode[];
  operations: UpidProgramTreeNode[];
}

export function buildUpidProgramTree(
  document: PathPlanningDocument,
  machine: MachineProfile
): UpidProgramTree {
  const executionDocument = withExecutionOrder(document);
  const sourceSetup = buildSourceSetupNodes(executionDocument, machine);
  const operations = executionDocument.plan.operations
    .map((operation) => buildOperationNode(executionDocument, machine, operation));

  return {
    status: rollUpStatus([...sourceSetup, ...operations]),
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
  machine: MachineProfile
): UpidProgramTreeNode[] {
  const diagnostics: UpidProgramTreeNode[] = readDiagnostics(document).map((diagnostic) => ({
    treeKey: `diagnostic:${diagnostic.id}`,
    kind: 'phase' as const,
    label: diagnostic.message,
    detail: diagnostic.code,
    status: diagnostic.severity === 'error' ? 'blocked' : diagnostic.severity === 'warning'
      ? 'review-required'
      : 'ready',
    statusReason: diagnostic.code,
    editTarget: { kind: 'diagnostics' as const, diagnosticId: diagnostic.id },
    children: []
  }));
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
  operation: PathOperation
): UpidProgramTreeNode {
  const stopNodes = buildStopNodes(document, machine, operation);
  const stopsByPlacement = groupStopsByPlacement(operation, stopNodes);
  const incoming = buildIncomingConnectionNode(document, machine, operation);
  const entry = buildTransitionNode(operation, 'entry');
  const exit = buildTransitionNode(operation, 'exit');
  const cutPath = buildCutPathNode(document, machine, operation, stopsByPlacement.beforeOperationEnd);
  const children = [
    ...stopsByPlacement.beforeEntry,
    incoming,
    entry,
    cutPath,
    ...stopsByPlacement.afterContour,
    exit,
    ...stopsByPlacement.afterExit
  ];
  const pathElement = document.pathElements.find((element) => element.operationId === operation.id);

  return {
    treeKey: `operation:${operation.id}`,
    kind: 'operation',
    label: `${String(operation.orderIndex + 1).padStart(2, '0')} · ${operation.displayName}`,
    detail: operation.classification,
    status: rollUpStatus(children),
    operationId: operation.id,
    pathElementId: pathElement?.id,
    editTarget: { kind: 'operation', operationId: operation.id },
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
  operation: PathOperation,
  phase: 'entry' | 'exit'
): UpidProgramTreeNode {
  const transition = operation.transitions?.[phase];
  const review = transition?.strategy === 'none'
    ? transition.review
    : transition?.strategy === 'manual-straight' ? transition.review : 'reviewed';
  return {
    treeKey: `operation:${operation.id}:${phase}`,
    kind: 'phase',
    label: phase === 'entry' ? 'Entry / lead-in' : 'Exit / lead-out',
    detail: transition?.strategy === 'none' || !transition ? 'None' : transition.strategy,
    status: review === 'required' ? 'review-required' : 'ready',
    statusReason: review === 'required' ? 'review-required' : undefined,
    operationId: operation.id,
    editTarget: { kind: 'entry-exit', operationId: operation.id },
    children: []
  };
}

function buildCutPathNode(
  document: PathPlanningDocument,
  machine: MachineProfile,
  operation: PathOperation,
  stopNodes: UpidProgramTreeNode[]
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
  const spans = buildParticipationNodes(document, operation);
  const compensation = operation.compensationIntent?.mode === 'controller'
    ? resolveControllerCompensation({ document, operation })
    : null;
  const blockedByMachine = operation.compensationIntent?.mode === 'controller' && !machine.compensation.supported;
  const status = blockedByMachine || compensation?.status === 'blocked' ? 'blocked' : 'ready';
  const statusReason = blockedByMachine
    ? 'compensation-unsupported'
    : compensation?.status === 'blocked' ? compensation.reason : undefined;

  return {
    treeKey: `operation:${operation.id}:cut-path`,
    kind: 'phase',
    label: 'Cut path',
    detail: `${operation.metrics.segmentCount} segment${operation.metrics.segmentCount === 1 ? '' : 's'}`,
    status: rollUpStatus([
      { treeKey: '', kind: 'phase', label: '', status, statusReason, children: [] },
      ...stopNodes,
      ...spans
    ]),
    statusReason,
    operationId: operation.id,
    editTarget: { kind: 'cut-sequence', operationId: operation.id },
    children: [contourStart, ...stopNodes, ...spans]
  };
}

function buildParticipationNodes(
  document: PathPlanningDocument,
  operation: PathOperation
): UpidProgramTreeNode[] {
  const intent = operation.machiningIntent;
  if (!intent) return [];
  const source = document.plan.operations.find((candidate) => candidate.id === intent.sourceOperationId);
  const status = source ? 'ready' : 'blocked';
  const statusReason = source ? undefined : 'source-operation-not-found';
  return intent.spanIds.map((spanId) => ({
    treeKey: `operation:${operation.id}:span:${spanId}`,
    kind: 'span',
    label: `Machining span · ${spanId}`,
    detail: source ? `Source · ${source.displayName}` : 'Missing source operation',
    status,
    statusReason,
    operationId: operation.id,
    editTarget: {
      kind: 'machining-participation',
      operationId: intent.sourceOperationId,
      spanId
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

function readDiagnostics(document: PathPlanningDocument) {
  const diagnostics = [...document.diagnostics, ...document.plan.diagnostics];
  return diagnostics.filter((diagnostic, index) =>
    diagnostics.findIndex((candidate) => candidate.id === diagnostic.id) === index
  );
}

function rollUpStatus(nodes: readonly UpidProgramTreeNode[]): UpidProgramTreeStatus {
  if (nodes.some((node) => node.status === 'blocked')) return 'blocked';
  if (nodes.some((node) => node.status === 'review-required')) return 'review-required';
  if (nodes.some((node) => node.status === 'ready')) return 'ready';
  return 'inactive';
}
