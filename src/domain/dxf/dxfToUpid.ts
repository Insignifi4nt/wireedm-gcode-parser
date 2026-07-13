import type { PathPlanningOptions, PathPlanningSourceMetadata } from '@/domain/path-intel/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { normalizeDxfGeometry } from './normalizeDxfGeometry';
import type { DxfEntity } from './types';

export const DEFAULT_DXF_UPID_OPTIONS: PathPlanningOptions = {
  endpointTolerance: 0,
  coincidenceEpsilon: 0.000002,
  allowReverseOpenChains: false
};

export function dxfEntitiesToUpidDocument(
  entities: DxfEntity[],
  options: PathPlanningOptions = {},
  sourceMetadata: PathPlanningSourceMetadata = {}
) {
  const normalized = normalizeDxfGeometry({
    entities,
    options: {
      ...DEFAULT_DXF_UPID_OPTIONS,
      ...options
    },
    sourceMetadata
  });

  return createUpidFromDxfEntities(
    normalized.entities,
    normalized.options,
    normalized.sourceMetadata
  );
}
