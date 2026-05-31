import { postPathPlanToGcode, type GcodePostResult } from '@/domain/path-intel/postGcode';
import type {
  PathDiagnostic,
  PathPlanningDocument,
  PathPlanningOptions
} from '@/domain/path-intel/types';

import { dxfEntitiesToUpidDocument } from './dxfToUpid';
import type { DxfEntity } from './types';

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
  const document = dxfEntitiesToUpidDocument(entities, options);
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
