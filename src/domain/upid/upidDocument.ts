import type { DxfDrawingUnits, DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import {
  pathPlanToGcodeBody,
  postPathPlanToGcode,
  type GcodePostedMove,
  type GcodePostedOperation
} from '@/domain/path-intel/postGcode';
import {
  composeGCodeProgramWithLineMap,
  formatProgramLineRangeForBodyRange,
  programLineForBodyLine,
  type GCodeProgramComposition
} from '@/domain/post/gcodeTemplates';
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

export const UPID_FORMAT_NAME = 'Universal Path Intelligence Document';

export type UniversalPathIntelligenceDocument = PathPlanningDocument;

export interface ComposeUpidGCodeExportInput {
  footer: string;
  header: string;
  lineEnding?: 'lf' | 'crlf';
}

export interface UpidGCodeExport {
  body: string;
  diagnostics: PathDiagnostic[];
  documentTrace: UpidGCodeExportDocumentTrace;
  planning: UpidGCodeExportPlanning;
  post: ReturnType<typeof postUpidToGcode>;
  program: GCodeProgramComposition;
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

export function postUpidToGcodeBody(document: UniversalPathIntelligenceDocument) {
  return pathPlanToGcodeBody(document.plan, document.segments, document.options);
}

export function postUpidToGcode(document: UniversalPathIntelligenceDocument) {
  return postPathPlanToGcode(document.plan, document.segments, document.options);
}

export function composeUpidGCodeExport(
  document: UniversalPathIntelligenceDocument,
  input: ComposeUpidGCodeExportInput
): UpidGCodeExport {
  const post = postUpidToGcode(document);
  const body = post.body;
  const diagnostics = [...document.diagnostics, ...post.diagnostics];
  const planning = summarizeExportPlanning(document);
  const program = composeGCodeProgramWithLineMap({
    header: input.header,
    body,
    footer: input.footer,
    lineEnding: input.lineEnding
  });

  return {
    body,
    diagnostics,
    documentTrace: traceUpidDocumentForExport(document),
    planning,
    post,
    program,
    programOperations: mapProgramOperations(document, post.operations, program),
    summary: {
      ...planning,
      diagnosticCount: diagnostics.length,
      operationCount: document.plan.operations.length,
      postDiagnosticCount: post.diagnostics.length
    }
  };
}

function traceUpidDocumentForExport(
  document: UniversalPathIntelligenceDocument
): UpidGCodeExportDocumentTrace {
  return {
    contourCount: document.contours.length,
    fileName: document.source.fileName ?? null,
    format: UPID_FORMAT_NAME,
    importedAt: document.source.importedAt ?? null,
    operationCount: document.plan.operations.length,
    pathElementCount: document.pathElements.length,
    projectId: document.source.projectId ?? null,
    schemaVersion: document.schemaVersion,
    segmentCount: document.segments.length,
    sourceEntityCount: document.source.entityCount,
    sourceKind: document.source.kind,
    sourceUnits: document.source.units ?? null
  };
}

function summarizeExportPlanning(document: UniversalPathIntelligenceDocument): UpidGCodeExportPlanning {
  const manualDecisionSummary = summarizeUpidManualDecisions(document.plan.operations);

  return {
    manualDecisionCount: manualDecisionSummary.count,
    manualDecisionCounts: manualDecisionSummary.counts,
    manualOrderCount: manualDecisionSummary.counts.order,
    operationOrderStrategy: document.options.operationOrderStrategy
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
