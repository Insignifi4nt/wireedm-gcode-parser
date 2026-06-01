import type { DxfEntity } from '@/domain/dxf/types';
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
  ManualClassificationOverride,
  ManualDirectionOverride,
  ManualOrderOverride,
  ManualStartOverride,
  OperationOrderStrategy,
  PathDiagnostic,
  PathElement,
  PathPlanningDocument,
  PathPlanningOptions,
  PathPlanningSourceMetadata
} from '@/domain/path-intel/types';

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
  planning: UpidGCodeExportPlanning;
  post: ReturnType<typeof postUpidToGcode>;
  program: GCodeProgramComposition;
  programOperations: UpidGCodeProgramOperation[];
  summary: UpidGCodeExportSummary;
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
  manualOrder: UpidGCodeProgramManualOrder | null;
  manualStart: UpidGCodeProgramManualStart | null;
  moves: UpidGCodeProgramMove[];
  pathElementId: string | null;
  programLineEnd: number;
  programLineRange: string;
  programLineStart: number;
}

export type UpidGCodeProgramManualDecisionKind = 'order' | 'role' | 'direction' | 'start';

export interface UpidGCodeProgramManualOrder {
  orderIndex: ManualOrderOverride['orderIndex'];
}

export interface UpidGCodeProgramManualClassification {
  classification: ManualClassificationOverride['classification'];
}

export interface UpidGCodeProgramManualDirection {
  direction: ManualDirectionOverride['direction'];
}

export interface UpidGCodeProgramManualStart {
  createdSegmentIds: string[];
  point: ManualStartOverride['point'];
  pointRole: ManualStartOverride['pointRole'] | null;
  relation: ManualStartOverride['relation'];
  sourceSegmentId: string;
  sourceSegmentIndex: number;
}

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

function summarizeExportPlanning(document: UniversalPathIntelligenceDocument): UpidGCodeExportPlanning {
  const manualDecisionCounts = summarizeManualDecisionCounts(document);

  return {
    manualDecisionCount: Object.values(manualDecisionCounts).reduce((total, count) => total + count, 0),
    manualDecisionCounts,
    manualOrderCount: manualDecisionCounts.order,
    operationOrderStrategy: document.options.operationOrderStrategy
  };
}

function summarizeManualDecisionCounts(
  document: UniversalPathIntelligenceDocument
): Record<UpidGCodeProgramManualDecisionKind, number> {
  const counts: Record<UpidGCodeProgramManualDecisionKind, number> = {
    direction: 0,
    order: 0,
    role: 0,
    start: 0
  };

  for (const operation of document.plan.operations) {
    if (operation.overrides?.order) counts.order += 1;
    if (operation.overrides?.classification) counts.role += 1;
    if (operation.overrides?.direction) counts.direction += 1;
    if (operation.overrides?.start) counts.start += 1;
  }

  return counts;
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

    return {
      ...operation,
      editEventCount: pathElement?.provenance.edit?.events.length ?? 0,
      editedSegmentCount: pathElement?.provenance.edit?.derivedSegmentIds.length ?? 0,
      manualClassification: upidGCodeProgramManualClassification(pathElement),
      manualDecisionKinds: upidGCodeProgramManualDecisionKinds(pathElement),
      manualDirection: upidGCodeProgramManualDirection(pathElement),
      manualOrder: upidGCodeProgramManualOrder(pathElement),
      manualStart: upidGCodeProgramManualStart(pathElement),
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

function upidGCodeProgramManualDecisionKinds(
  pathElement: PathElement | null
): UpidGCodeProgramManualDecisionKind[] {
  const overrides = pathElement?.overrides;
  if (!overrides) return [];

  const decisions: UpidGCodeProgramManualDecisionKind[] = [];
  if (overrides.order) decisions.push('order');
  if (overrides.classification) decisions.push('role');
  if (overrides.direction) decisions.push('direction');
  if (overrides.start) decisions.push('start');
  return decisions;
}

function upidGCodeProgramManualStart(
  pathElement: PathElement | null
): UpidGCodeProgramManualStart | null {
  const start = pathElement?.overrides?.start;
  if (!start) return null;

  return {
    createdSegmentIds: [...start.createdSegmentIds],
    point: { ...start.point },
    pointRole: start.pointRole ?? null,
    relation: start.relation,
    sourceSegmentId: start.sourceSegmentId,
    sourceSegmentIndex: start.sourceSegmentIndex
  };
}

function upidGCodeProgramManualOrder(
  pathElement: PathElement | null
): UpidGCodeProgramManualOrder | null {
  const order = pathElement?.overrides?.order;
  return order ? { orderIndex: order.orderIndex } : null;
}

function upidGCodeProgramManualClassification(
  pathElement: PathElement | null
): UpidGCodeProgramManualClassification | null {
  const classification = pathElement?.overrides?.classification;
  return classification ? { classification: classification.classification } : null;
}

function upidGCodeProgramManualDirection(
  pathElement: PathElement | null
): UpidGCodeProgramManualDirection | null {
  const direction = pathElement?.overrides?.direction;
  return direction ? { direction: direction.direction } : null;
}
