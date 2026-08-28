import {
  compileWireEdmExecutionPlan,
  type ExecutionPlanDiagnostic,
  type ExecutionSourceRef,
  type WireEdmExecutionEvent
} from '@/domain/execution-plan/executionPlan';
import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import type { PathOperation, PathPlanningDocument } from '@/domain/path-intel/types';

export interface UpidEditorSourceNode {
  readonly kind: 'source';
  readonly sourceKind: 'path-summary' | 'geometry' | 'initial-wire' | 'threading-default';
  readonly treeKey: string;
  readonly label: string;
  readonly detail: string;
  readonly sourceTrace: readonly [{ readonly kind: 'program' }];
}

export interface UpidEditorEventNode {
  readonly kind: 'event';
  readonly treeKey: string;
  readonly label: string;
  readonly eventId: string;
  readonly eventKind: WireEdmExecutionEvent['kind'];
  readonly operationId: string | null;
  readonly executionOperationId: string | null;
  readonly sourceTrace: WireEdmExecutionEvent['trace'];
}

export interface UpidEditorDiagnosticNode {
  readonly kind: 'diagnostic';
  readonly treeKey: string;
  readonly label: string;
  readonly operationId: string | null;
  readonly diagnostic: ExecutionPlanDiagnostic;
  readonly sourceTrace: readonly [ExecutionSourceRef];
}

interface UpidEditorOperationNodeBase {
  readonly kind: 'operation';
  readonly treeKey: string;
  readonly label: string;
  readonly operationId: string;
  readonly sourceTrace: readonly [{ readonly kind: 'operation'; readonly operationId: string }];
}

export type ReadyUpidEditorOperationNode = UpidEditorOperationNodeBase & (
  | {
      readonly execution: 'included';
      readonly executionOperationIds: readonly [string, ...string[]];
      readonly children: readonly UpidEditorEventNode[];
    }
  | {
      readonly execution: 'inactive';
      readonly executionOperationIds: readonly [];
      readonly children: readonly [];
    }
);

export type UnresolvedUpidEditorOperationNode = UpidEditorOperationNodeBase & {
  readonly execution: 'unresolved';
  readonly executionOperationIds: readonly [];
  readonly children: readonly UpidEditorDiagnosticNode[];
};

interface UpidEditorTreeBase {
  readonly sourceSetup: readonly UpidEditorSourceNode[];
}

export type UpidEditorTree =
  | (UpidEditorTreeBase & {
      readonly status: 'ready';
      readonly diagnostics: readonly [];
      readonly programEvents: readonly UpidEditorEventNode[];
      readonly operations: readonly ReadyUpidEditorOperationNode[];
    })
  | (UpidEditorTreeBase & {
      readonly status: 'invalid' | 'unresolved';
      readonly diagnostics: readonly UpidEditorDiagnosticNode[];
      readonly operations: readonly UnresolvedUpidEditorOperationNode[];
    });

export function buildUpidEditorTree(document: PathPlanningDocument): UpidEditorTree {
  const sourceSetup = buildSourceSetup(document);
  const sourceOperations = orderedPathOperations(document.plan.operations);
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) {
    const status = compiled.diagnostics.some(({ code }) => code === 'EXECUTION_PLAN_INVALID_UPID')
      ? 'invalid'
      : 'unresolved';
    const executionToSource = status === 'unresolved'
      ? executionOperationSources(document)
      : new Map<string, string>();
    const diagnostics = buildDiagnosticNodes(compiled.diagnostics, executionToSource);
    return {
      status,
      sourceSetup,
      diagnostics,
      operations: unresolvedOperationNodes(sourceOperations, diagnostics)
    };
  }

  const machining = deriveActiveMachiningOperations(document);
  if (machining.status === 'blocked') {
    const diagnostics = buildDiagnosticNodes([{
      code: 'EXECUTION_PLAN_MACHINING_UNRESOLVED',
      message: `Machining participation could not be resolved: ${machining.reason}.`,
      operationId: null
    }], new Map());
    return {
      status: 'unresolved',
      sourceSetup,
      diagnostics,
      operations: unresolvedOperationNodes(sourceOperations, diagnostics)
    };
  }

  const executionToSource = new Map(
    machining.operations.map((operation) => [
      operation.id,
      operation.machiningIntent?.sourceOperationId ?? operation.id
    ])
  );
  const executionIdsBySource = new Map<string, string[]>();
  for (const [executionOperationId, sourceOperationId] of executionToSource) {
    const ids = executionIdsBySource.get(sourceOperationId) ?? [];
    ids.push(executionOperationId);
    executionIdsBySource.set(sourceOperationId, ids);
  }
  const eventsBySource = new Map<string, UpidEditorEventNode[]>();
  const programEvents: UpidEditorEventNode[] = [];
  for (const event of compiled.plan.events) {
    if (event.operationId === null) {
      programEvents.push(eventNode(event, null));
      continue;
    }
    const sourceOperationId = executionToSource.get(event.operationId);
    if (sourceOperationId === undefined) {
      const diagnostics = buildDiagnosticNodes([{
        code: 'EXECUTION_PLAN_MACHINING_UNRESOLVED',
        message: `Execution operation ${event.operationId} has no source operation identity.`,
        operationId: event.operationId
      }], executionToSource);
      return {
        status: 'unresolved',
        sourceSetup,
        diagnostics,
        operations: unresolvedOperationNodes(sourceOperations, diagnostics)
      };
    }
    const events = eventsBySource.get(sourceOperationId) ?? [];
    events.push(eventNode(event, sourceOperationId));
    eventsBySource.set(sourceOperationId, events);
  }

  return {
    status: 'ready',
    sourceSetup,
    diagnostics: [],
    programEvents,
    operations: sourceOperations.map((operation) => {
      const executionIds = executionIdsBySource.get(operation.id) ?? [];
      const [firstExecutionId, ...remainingExecutionIds] = executionIds;
      const base = operationNodeBase(operation);
      return firstExecutionId === undefined
        ? { ...base, execution: 'inactive', executionOperationIds: [], children: [] }
        : {
            ...base,
            execution: 'included',
            executionOperationIds: [firstExecutionId, ...remainingExecutionIds],
            children: eventsBySource.get(operation.id) ?? []
          };
    })
  };
}

export function upidEditorOperationTreeKey(operationId: string) {
  return `operation:${encodeURIComponent(operationId)}`;
}

function buildSourceSetup(document: PathPlanningDocument): readonly UpidEditorSourceNode[] {
  const initialWire = document.setup?.initialWirePosition;
  const threading = document.setup?.threadingDefault;
  return [
    sourceNode(
      'path-summary',
      'setup:path-summary',
      'Path summary',
      `${document.plan.operations.length} operation${document.plan.operations.length === 1 ? '' : 's'}`
    ),
    sourceNode(
      'geometry',
      'setup:geometry',
      'Geometry',
      `${document.segments.length} segment${document.segments.length === 1 ? '' : 's'} · ${document.geometryBasis}`
    ),
    sourceNode(
      'initial-wire',
      'setup:initial-wire',
      'Initial wire',
      initialWire ? `${initialWire.kind} · ${initialWire.review}` : 'Not set'
    ),
    sourceNode(
      'threading-default',
      'setup:threading-default',
      'Threading default',
      threading ? `${threading.mode} · ${threading.wireSeparation}` : 'Not set'
    )
  ];
}

function sourceNode(
  sourceKind: UpidEditorSourceNode['sourceKind'],
  treeKey: string,
  label: string,
  detail: string
): UpidEditorSourceNode {
  return {
    kind: 'source',
    sourceKind,
    treeKey,
    label,
    detail,
    sourceTrace: [{ kind: 'program' }]
  };
}

function unresolvedOperationNodes(
  operations: readonly PathOperation[],
  diagnostics: readonly UpidEditorDiagnosticNode[]
): readonly UnresolvedUpidEditorOperationNode[] {
  const occurrences = new Map<string, number>();
  return operations.map((operation) => {
    const occurrence = (occurrences.get(operation.id) ?? 0) + 1;
    occurrences.set(operation.id, occurrence);
    return {
      ...operationNodeBase(operation, occurrence),
      execution: 'unresolved',
      executionOperationIds: [],
      children: diagnostics.filter(({ operationId }) => operationId === operation.id)
    };
  });
}

function operationNodeBase(
  operation: PathOperation,
  occurrence = 1
): UpidEditorOperationNodeBase {
  const baseKey = upidEditorOperationTreeKey(operation.id);
  return {
    kind: 'operation',
    treeKey: occurrence === 1 ? baseKey : `${baseKey}:duplicate:${occurrence}`,
    label: operation.displayName,
    operationId: operation.id,
    sourceTrace: [{ kind: 'operation', operationId: operation.id }]
  };
}

function eventNode(
  event: WireEdmExecutionEvent,
  sourceOperationId: string | null
): UpidEditorEventNode {
  const prefix = sourceOperationId === null
    ? 'program'
    : upidEditorOperationTreeKey(sourceOperationId);
  return {
    kind: 'event',
    treeKey: `${prefix}:event:${encodeURIComponent(event.id)}`,
    label: event.kind,
    eventId: event.id,
    eventKind: event.kind,
    operationId: sourceOperationId,
    executionOperationId: event.operationId,
    sourceTrace: event.trace
  };
}

function executionOperationSources(document: PathPlanningDocument) {
  const machining = deriveActiveMachiningOperations(document);
  return machining.status === 'ready'
    ? new Map(machining.operations.map((operation) => [
        operation.id,
        operation.machiningIntent?.sourceOperationId ?? operation.id
      ]))
    : new Map<string, string>();
}

function buildDiagnosticNodes(
  diagnostics: readonly ExecutionPlanDiagnostic[],
  executionToSource: ReadonlyMap<string, string>
): readonly UpidEditorDiagnosticNode[] {
  return diagnostics.map((diagnostic, index) => {
    const operationId = diagnostic.operationId === null
      ? null
      : executionToSource.get(diagnostic.operationId) ?? diagnostic.operationId;
    return {
      kind: 'diagnostic',
      treeKey: `diagnostic:${diagnostic.code}:${index}`,
      label: diagnostic.message,
      operationId,
      diagnostic,
      sourceTrace: operationId === null
        ? [{ kind: 'program' }]
        : [{ kind: 'operation', operationId }]
    };
  });
}
