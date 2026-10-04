import { commitDxfProjectImport, type DxfImportDecision } from '@/domain/dxf/importDxfProject';
import type { DxfImportPreparation } from '@/domain/dxf/prepareDxfProjectImport';
import { prepareDxfProjectReimport, commitDxfProjectReimport, type DxfProjectReimportPreparation, type DxfProjectReimportDecision } from '@/domain/dxf/reimportDxfProjectUnits';
import type { DxfProcessingOptions, DxfProcessor, DxfSourceInput } from '@/domain/dxf/dxfProcessing';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { browserDxfProcessor } from '@/features/dxf-import/dxfProcessor';

/** One processor seam for ordinary imports, unit reimports and browser-agent actions. */
export function createDxfImportServices(processor: DxfProcessor = browserDxfProcessor) {
  return {
    prepareDxfProjectImport: (workbench: ConnectedWorkbenchCatalog, input: DxfSourceInput, signal?: AbortSignal) =>
      processor.prepare(workbench.manifest.preferences.importUnits, input, signal),
    commitDxfProjectImport: (workbench: ConnectedWorkbenchCatalog, preparation: DxfImportPreparation, decision: DxfImportDecision, options: DxfProcessingOptions = {}) =>
      commitDxfProjectImport(workbench, preparation, decision, { ...options, processor }),
    prepareDxfProjectReimport: (workbench: ConnectedWorkbenchCatalog, projectId: string, options: DxfProcessingOptions & { readonly now?: Date } = {}) =>
      prepareDxfProjectReimport(workbench, projectId, { ...options, processor }),
    commitDxfProjectReimport: (workbench: ConnectedWorkbenchCatalog, preparation: DxfProjectReimportPreparation, decision: DxfProjectReimportDecision, options: DxfProcessingOptions = {}) =>
      commitDxfProjectReimport(workbench, preparation, decision, { ...options, processor })
  };
}

export const dxfImportServices = createDxfImportServices();
