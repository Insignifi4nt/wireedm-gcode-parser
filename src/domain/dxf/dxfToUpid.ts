import type { PathPlanningOptions, PathPlanningSourceMetadata } from '@/domain/path-intel/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import type { DxfEntity } from './types';

export const DEFAULT_DXF_UPID_OPTIONS: PathPlanningOptions = {
  endpointTolerance: 0,
  coincidenceEpsilon: 0.000001,
  allowReverseOpenChains: false
};

export function dxfEntitiesToUpidDocument(
  entities: DxfEntity[],
  options: PathPlanningOptions = {},
  sourceMetadata: PathPlanningSourceMetadata = {}
) {
  return createUpidFromDxfEntities(
    entities,
    {
      ...DEFAULT_DXF_UPID_OPTIONS,
      ...options
    },
    sourceMetadata
  );
}
