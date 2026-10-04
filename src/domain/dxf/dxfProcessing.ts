import type { PathPlanningDocument, PathPlanningSourceMetadata } from '@/domain/path-intel/types';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { DxfEntity } from './types';
import type { DxfImportPreparationResult } from './prepareDxfProjectImport';

export interface DxfSourceInput {
  readonly fileName: string;
  readonly text: string;
  readonly now?: Date;
}

/** Storage adapters and workbench objects never cross this CPU-only boundary. */
export interface DxfProcessor {
  prepare(preference: ConnectedWorkbenchCatalog['manifest']['preferences']['importUnits'], input: DxfSourceInput, signal?: AbortSignal): Promise<DxfImportPreparationResult>;
  plan(entities: DxfEntity[], metadata: PathPlanningSourceMetadata, signal?: AbortSignal): Promise<PathPlanningDocument>;
}

export interface DxfProcessingOptions {
  readonly processor?: DxfProcessor;
  readonly signal?: AbortSignal;
  /** Runs immediately before the first transaction journal write, under the storage lock. */
  readonly beforeWrite?: () => void;
}

export class DxfProcessingError extends Error {
  constructor(readonly code: 'DXF_IMPORT_WORKER_FAILED' | 'DXF_IMPORT_TIMEOUT', message: string) {
    super(message);
    this.name = 'DxfProcessingError';
  }
}
