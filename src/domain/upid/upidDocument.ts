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
  OperationOrderStrategy,
  PathDiagnostic,
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
  manualOrderCount: number;
  operationOrderStrategy: OperationOrderStrategy;
}

export interface UpidGCodeExportSummary extends UpidGCodeExportPlanning {
  diagnosticCount: number;
  operationCount: number;
  postDiagnosticCount: number;
}

export interface UpidGCodeProgramMove extends GcodePostedMove {
  programLineNumber: number;
}

export interface UpidGCodeProgramOperation extends Omit<GcodePostedOperation, 'moves'> {
  moves: UpidGCodeProgramMove[];
  programLineEnd: number;
  programLineRange: string;
  programLineStart: number;
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
    programOperations: mapProgramOperations(post.operations, program),
    summary: {
      ...planning,
      diagnosticCount: diagnostics.length,
      operationCount: document.plan.operations.length,
      postDiagnosticCount: post.diagnostics.length
    }
  };
}

function summarizeExportPlanning(document: UniversalPathIntelligenceDocument): UpidGCodeExportPlanning {
  return {
    manualOrderCount: document.plan.operations.filter((operation) => operation.overrides?.order).length,
    operationOrderStrategy: document.options.operationOrderStrategy
  };
}

function mapProgramOperations(
  operations: GcodePostedOperation[],
  program: GCodeProgramComposition
): UpidGCodeProgramOperation[] {
  const bodySection = program.sections.body;

  return operations.map((operation) => ({
    ...operation,
    moves: operation.moves.map((move) => ({
      ...move,
      programLineNumber: programLineForBodyLine(bodySection, move.bodyLineIndex)
    })),
    programLineEnd: programLineForBodyLine(bodySection, operation.bodyLineEnd),
    programLineRange: formatProgramLineRangeForBodyRange(
      bodySection,
      operation.bodyLineStart,
      operation.bodyLineEnd
    ),
    programLineStart: programLineForBodyLine(bodySection, operation.bodyLineStart)
  }));
}
