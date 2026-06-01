import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { pathPlanToGcodeBody, postPathPlanToGcode } from '@/domain/path-intel/postGcode';
import {
  composeGCodeProgramWithLineMap,
  type GCodeProgramComposition
} from '@/domain/post/gcodeTemplates';
import type {
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
  post: ReturnType<typeof postUpidToGcode>;
  program: GCodeProgramComposition;
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

  return {
    body,
    post,
    program: composeGCodeProgramWithLineMap({
      header: input.header,
      body,
      footer: input.footer,
      lineEnding: input.lineEnding
    })
  };
}
