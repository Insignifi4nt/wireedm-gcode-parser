import type { DxfDrawingUnits, DxfEntity } from '@/domain/dxf/types';
import {
  createGCodeInterpreterState,
  interpretGCodeBlock
} from '@/domain/editor/gcodeBlockInterpreter';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import {
  postPathPlanToGcode,
  type GcodePostedMove,
  type GcodePostedOperation,
  type GcodePostResult,
  type GcodePostOptions
} from '@/domain/path-intel/postGcode';
import {
  composeGCodeProgramWithLineMap,
  formatProgramLineRangeForBodyRange,
  programLineForBodyLine,
  type GCodeProgramComposition
} from '@/domain/post/gcodeTemplates';
import {
  machineResultFromGenericPost,
  postUpidForMachine,
  type GcodePostedBlock,
  type UpidMachinePostResult
} from '@/domain/post/upidMachinePost';
import type { MachineProfile } from '@/domain/workbench/types';
import type {
  OperationOrderStrategy,
  PathDiagnostic,
  PathElement,
  PathPlanningDocument,
  PathPlanningOptions,
  PathPlanningSourceMetadata
} from '@/domain/path-intel/types';

import {
  readUpidManualDecisionDetails,
  summarizeUpidManualDecisions,
  upidManualDecisionKinds,
  type UpidManualClassificationDecision,
  type UpidManualDecisionKind,
  type UpidManualDirectionDecision,
  type UpidManualLeadInDecision,
  type UpidManualOrderDecision,
  type UpidManualStartDecision
} from './manualDecisions';
import { validateUpidDocument } from './validateUpidDocument';

export const UPID_FORMAT_NAME = 'Universal Path Intelligence Document';

export type UniversalPathIntelligenceDocument = PathPlanningDocument;

export interface ComposeUpidGCodeExportInput {
  coordinatePrecision?: number;
  footer?: string;
  header?: string;
  lineEnding?: 'lf' | 'crlf';
  machine?: MachineProfile;
}

export interface UpidGCodeExport {
  body: string;
  blockingDiagnostics: PathDiagnostic[];
  canDownload: boolean;
  diagnostics: PathDiagnostic[];
  documentTrace: UpidGCodeExportDocumentTrace;
  planning: UpidGCodeExportPlanning;
  post: UpidMachinePostResult;
  program: GCodeProgramComposition;
  programBlocks: UpidGCodeProgramBlock[];
  programOperations: UpidGCodeProgramOperation[];
  summary: UpidGCodeExportSummary;
}

export interface UpidGCodeExportDocumentTrace {
  contourCount: number;
  fileName: string | null;
  format: typeof UPID_FORMAT_NAME;
  importedAt: string | null;
  operationCount: number;
  pathElementCount: number;
  projectId: string | null;
  schemaVersion: UniversalPathIntelligenceDocument['schemaVersion'];
  segmentCount: number;
  sourceEntityCount: number;
  sourceKind: UniversalPathIntelligenceDocument['source']['kind'];
  sourceUnits: DxfDrawingUnits | null;
}

export interface UpidGCodeExportPlanning {
  manualDecisionCount: number;
  manualDecisionCounts: Record<UpidGCodeProgramManualDecisionKind, number>;
  manualOrderCount: number;
  operationOrderStrategy: OperationOrderStrategy;
}

export interface UpidGCodeExportSummary extends UpidGCodeExportPlanning {
  diagnosticCount: number;
  operationCount: number;
  postDiagnosticCount: number;
}

export interface UpidGCodeProgramMove extends GcodePostedMove {
  pathElementId: string | null;
  programLineNumber: number;
  segmentIndex: number | null;
  segmentOrdinal: number | null;
}

export interface UpidGCodeProgramBlock extends GcodePostedBlock {
  programLineNumber: number;
}

export interface UpidGCodeProgramOperation extends Omit<GcodePostedOperation, 'moves'> {
  editEventCount: number;
  editedSegmentCount: number;
  manualClassification: UpidGCodeProgramManualClassification | null;
  manualDecisionKinds: UpidGCodeProgramManualDecisionKind[];
  manualDirection: UpidGCodeProgramManualDirection | null;
  manualLeadIn: UpidGCodeProgramManualLeadIn | null;
  manualOrder: UpidGCodeProgramManualOrder | null;
  manualStart: UpidGCodeProgramManualStart | null;
  moves: UpidGCodeProgramMove[];
  pathElementId: string | null;
  programLineEnd: number;
  programLineRange: string;
  programLineStart: number;
}

export type UpidGCodeProgramManualDecisionKind = UpidManualDecisionKind;

export type UpidGCodeProgramManualOrder = UpidManualOrderDecision;

export type UpidGCodeProgramManualClassification = UpidManualClassificationDecision;

export type UpidGCodeProgramManualDirection = UpidManualDirectionDecision;

export type UpidGCodeProgramManualLeadIn = UpidManualLeadInDecision;

export type UpidGCodeProgramManualStart = UpidManualStartDecision;

export function createUpidFromDxfEntities(
  entities: DxfEntity[],
  options: PathPlanningOptions = {},
  sourceMetadata: PathPlanningSourceMetadata = {}
): UniversalPathIntelligenceDocument {
  return createPathPlanningDocumentFromDxfEntities(entities, options, sourceMetadata);
}

export function postUpidToGcodeBody(
  document: UniversalPathIntelligenceDocument,
  options: GcodePostOptions = {}
) {
  return postUpidToGcode(document, options).body;
}

export function postUpidToGcode(
  document: UniversalPathIntelligenceDocument,
  options: GcodePostOptions = {}
) {
  const validation = validateUpidDocument(document);
  if (!validation.valid) return blockedPost(validation.blockingDiagnostics);

  return postPathPlanToGcode(document.plan, document.segments, {
    ...document.options,
    ...options,
    endpointTolerance: effectiveDocumentEndpointTolerance(document),
    coincidenceEpsilon: document.options.coincidenceEpsilon
  });
}

export function composeUpidGCodeExport(
  document: UniversalPathIntelligenceDocument,
  input: ComposeUpidGCodeExportInput
): UpidGCodeExport {
  const machine = input.machine;
  const header = machine ? machine.templates.header : input.header ?? '';
  const footer = machine ? machine.templates.footer : input.footer ?? '';
  const post = machine
    ? postUpidForMachine(document, machine)
    : machineResultFromGenericPost(
        postUpidToGcode(document, {
          arcCenterMode: inferArcCenterModeFromHeader(header),
          coordinatePrecision: input.coordinatePrecision
        })
      );
  const body = post.body;
  const documentDiagnostics = Array.isArray(document?.diagnostics) ? document.diagnostics : [];
  const diagnostics = uniqueDiagnostics([...documentDiagnostics, ...post.diagnostics]);
  const blockingDiagnostics =
    post.status === 'blocked'
      ? uniqueDiagnostics(post.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'))
      : [];
  const planning = summarizeExportPlanning(document);
  const program = composeGCodeProgramWithLineMap({
    header: post.programOwned ? '' : header,
    body,
    footer: post.programOwned ? '' : footer,
    lineEnding: machine?.output.lineEnding ?? input.lineEnding
  });

  return {
    body,
    blockingDiagnostics,
    canDownload: post.status === 'ready',
    diagnostics,
    documentTrace: traceUpidDocumentForExport(document),
    planning,
    post,
    program,
    programBlocks: post.blocks.map((block) => ({
      ...block,
      programLineNumber: programLineForBodyLine(program.sections.body, block.bodyLineIndex)
    })),
    programOperations:
      post.status === 'ready' ? mapProgramOperations(document, post.operations, program) : [],
    summary: {
      ...planning,
      diagnosticCount: diagnostics.length,
      operationCount: post.operations.length,
      postDiagnosticCount: post.diagnostics.length
    }
  };
}

function blockedPost(diagnostics: PathDiagnostic[]): GcodePostResult {
  return {
    status: 'blocked',
    body: '',
    diagnostics: uniqueDiagnostics(diagnostics),
    metrics: { rapidCount: 0, cutMoveCount: 0 },
    moves: [],
    operations: []
  };
}

function effectiveDocumentEndpointTolerance(document: UniversalPathIntelligenceDocument) {
  return Math.max(
    document.options.endpointTolerance,
    document.options.coincidenceEpsilon,
    ...document.endpointClusters
      .filter((cluster) => cluster.method === 'within-tolerance')
      .map((cluster) => cluster.toleranceUsed)
  );
}

function uniqueDiagnostics(diagnostics: PathDiagnostic[]) {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    if (seen.has(diagnostic.id)) return false;
    seen.add(diagnostic.id);
    return true;
  });
}

function inferArcCenterModeFromHeader(header: string): GcodePostOptions['arcCenterMode'] {
  const state = createGCodeInterpreterState();
  header.split(/\r?\n/).forEach((line, index) => {
    interpretGCodeBlock(state, line, index + 1);
  });
  return state.ijMode;
}

function traceUpidDocumentForExport(
  document: UniversalPathIntelligenceDocument
): UpidGCodeExportDocumentTrace {
  const source = document?.source ?? ({ kind: 'dxf-entities', entityCount: 0 } as const);
  return {
    contourCount: Array.isArray(document?.contours) ? document.contours.length : 0,
    fileName: source.fileName ?? null,
    format: UPID_FORMAT_NAME,
    importedAt: source.importedAt ?? null,
    operationCount: Array.isArray(document?.plan?.operations)
      ? document.plan.operations.length
      : 0,
    pathElementCount: Array.isArray(document?.pathElements) ? document.pathElements.length : 0,
    projectId: source.projectId ?? null,
    schemaVersion: document?.schemaVersion ?? 1,
    segmentCount: Array.isArray(document?.segments) ? document.segments.length : 0,
    sourceEntityCount: Number.isInteger(source.entityCount) ? source.entityCount : 0,
    sourceKind: source.kind === 'dxf-entities' ? source.kind : 'dxf-entities',
    sourceUnits: source.units ?? null
  };
}

function summarizeExportPlanning(document: UniversalPathIntelligenceDocument): UpidGCodeExportPlanning {
  const operations = Array.isArray(document?.plan?.operations) ? document.plan.operations : [];
  const manualDecisionSummary = summarizeUpidManualDecisions(operations);
  const operationOrderStrategy = document?.options?.operationOrderStrategy;

  return {
    manualDecisionCount: manualDecisionSummary.count,
    manualDecisionCounts: manualDecisionSummary.counts,
    manualOrderCount: manualDecisionSummary.counts.order,
    operationOrderStrategy:
      operationOrderStrategy === 'nearest' ||
      operationOrderStrategy === 'source-order' ||
      operationOrderStrategy === 'inside-out-nearest'
        ? operationOrderStrategy
        : 'inside-out-nearest'
  };
}

function mapProgramOperations(
  document: UniversalPathIntelligenceDocument,
  operations: GcodePostedOperation[],
  program: GCodeProgramComposition
): UpidGCodeProgramOperation[] {
  const bodySection = program.sections.body;
  const pathElementsByOperationId = new Map(
    document.pathElements
      .filter((element) => element.operationId)
      .map((element) => [element.operationId!, element])
  );

  return operations.map((operation) => {
    const pathElement = pathElementsByOperationId.get(operation.operationId) ?? null;
    const manualDecisionDetails = readUpidManualDecisionDetails(pathElement);

    return {
      ...operation,
      editEventCount: pathElement?.provenance.edit?.events.length ?? 0,
      editedSegmentCount: pathElement?.provenance.edit?.derivedSegmentIds.length ?? 0,
      manualClassification: manualDecisionDetails.classification,
      manualDecisionKinds: upidManualDecisionKinds(pathElement),
      manualDirection: manualDecisionDetails.direction,
      manualLeadIn: manualDecisionDetails.leadIn,
      manualOrder: manualDecisionDetails.order,
      manualStart: manualDecisionDetails.start,
      moves: operation.moves.map((move) =>
        mapProgramMoveTrace(move, pathElement, programLineForBodyLine(bodySection, move.bodyLineIndex))
      ),
      pathElementId: pathElement?.id ?? null,
      programLineEnd: programLineForBodyLine(bodySection, operation.bodyLineEnd),
      programLineRange: formatProgramLineRangeForBodyRange(
        bodySection,
        operation.bodyLineStart,
        operation.bodyLineEnd
      ),
      programLineStart: programLineForBodyLine(bodySection, operation.bodyLineStart)
    };
  });
}

function mapProgramMoveTrace(
  move: GcodePostedMove,
  pathElement: PathElement | null,
  programLineNumber: number
): UpidGCodeProgramMove {
  const segmentIndex =
    move.segmentId && pathElement
      ? pathElement.segmentRefs.findIndex((ref) => ref.segmentId === move.segmentId)
      : -1;

  return {
    ...move,
    pathElementId: pathElement?.id ?? null,
    programLineNumber,
    segmentIndex: segmentIndex >= 0 ? segmentIndex : null,
    segmentOrdinal: segmentIndex >= 0 ? segmentIndex + 1 : null
  };
}
