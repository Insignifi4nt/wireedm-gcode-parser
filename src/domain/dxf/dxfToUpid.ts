import type { PathPlanningOptions } from '@/domain/path-intel/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import type { DxfEntity } from './types';

export const DEFAULT_DXF_UPID_OPTIONS: PathPlanningOptions = {
  endpointTolerance: 0,
  allowReverseOpenChains: false
};

export function dxfEntitiesToUpidDocument(
  entities: DxfEntity[],
  options: PathPlanningOptions = {}
) {
  return createUpidFromDxfEntities(entities, {
    ...DEFAULT_DXF_UPID_OPTIONS,
    ...options
  });
}
