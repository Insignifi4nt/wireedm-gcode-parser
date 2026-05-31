import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { postPathPlanToGcode, type GcodePostResult } from '@/domain/path-intel/postGcode';
import type {
  PathDiagnostic,
  PathPlanningDocument,
  PathPlanningOptions
} from '@/domain/path-intel/types';

import type { DxfEntity } from './types';

const DEFAULT_DXF_GCODE_OPTIONS: PathPlanningOptions = {
  endpointTolerance: 0,
  allowReverseOpenChains: false
};

export interface DxfToGcodeResult {
  body: string;
  document: PathPlanningDocument;
  post: GcodePostResult;
  diagnostics: PathDiagnostic[];
}

export function dxfEntitiesToGcode(
  entities: DxfEntity[],
  options: PathPlanningOptions = {}
): DxfToGcodeResult {
  const document = dxfEntitiesToPathPlanningDocument(entities, options);
  const post = postPathPlanToGcode(document.plan, document.segments, document.options);

  return {
    body: post.body,
    document,
    post,
    diagnostics: [...document.diagnostics, ...post.diagnostics]
  };
}

export function dxfEntitiesToGcodeBody(entities: DxfEntity[], options: PathPlanningOptions = {}) {
  return dxfEntitiesToGcode(entities, options).body;
}

export function dxfEntitiesToPathPlanningDocument(
  entities: DxfEntity[],
  options: PathPlanningOptions = {}
) {
  return createPathPlanningDocumentFromDxfEntities(entities, {
    ...DEFAULT_DXF_GCODE_OPTIONS,
    ...options
  });
}
