import { act } from 'react';
import { defaultAppServices, type AppServices } from '@/app/appServices';

const pendingDefaults = new Set<Promise<unknown>>();

function tracked<Arguments extends unknown[], Result>(operation: (...args: Arguments) => Result) {
  return (...args: Arguments): Result => {
    const result = operation(...args);
    const pending = Promise.resolve(result);
    pendingDefaults.add(pending);
    void pending.then(() => pendingDefaults.delete(pending), () => pendingDefaults.delete(pending));
    return result;
  };
}

/** Track real service completion, while intentionally deferred test overrides remain pending. */
export function trackedDefaultAppServices(overrides: Partial<AppServices> = {}, defaults: Partial<AppServices> = {}): AppServices {
  const real = { ...defaultAppServices, ...defaults };
  return {
    captureWorkbenchRecovery: tracked(real.captureWorkbenchRecovery),
    forgetWorkbenchDirectory: tracked(real.forgetWorkbenchDirectory),
    connectCachedWorkbench: tracked(real.connectCachedWorkbench),
    connectRememberedWorkbenchDirectory: tracked(real.connectRememberedWorkbenchDirectory),
    connectWorkbenchDirectory: tracked(real.connectWorkbenchDirectory),
    prepareDxfProjectImport: tracked(real.prepareDxfProjectImport),
    previewDxfProjectImport: tracked(real.previewDxfProjectImport),
    commitDxfProjectImport: tracked(real.commitDxfProjectImport),
    prepareDxfProjectReimport: tracked(real.prepareDxfProjectReimport),
    commitDxfProjectReimport: tracked(real.commitDxfProjectReimport),
    exportPortableUpidProject: tracked(real.exportPortableUpidProject),
    importPortableUpidProject: tracked(real.importPortableUpidProject),
    importExternalProgram: tracked(real.importExternalProgram),
    loadEditorProgram: tracked(real.loadEditorProgram),
    openWorkbenchProject: tracked(real.openWorkbenchProject),
    saveEditorProgram: tracked(real.saveEditorProgram),
    renameWorkbenchProject: tracked(real.renameWorkbenchProject),
    deleteWorkbenchProject: tracked(real.deleteWorkbenchProject),
    restoreStoredWorkbenchProject: tracked(real.restoreStoredWorkbenchProject),
    purgeArchivedWorkbenchProject: tracked(real.purgeArchivedWorkbenchProject),
    updateWorkbenchCatalogPreferences: tracked(real.updateWorkbenchCatalogPreferences),
    activateStoredMachinePostBinding: tracked(real.activateStoredMachinePostBinding),
    prepareStoredMachinePackageInstallation: tracked(real.prepareStoredMachinePackageInstallation),
    commitStoredMachinePackageInstallation: tracked(real.commitStoredMachinePackageInstallation),
    removeStoredMachineDefinition: tracked(real.removeStoredMachineDefinition),
    createSavedWireEdmJobRevision: tracked(real.createSavedWireEdmJobRevision),
    deleteStoredWireEdmJobRevisions: tracked(real.deleteStoredWireEdmJobRevisions),
    saveStoredWireEdmJobRevision: tracked(real.saveStoredWireEdmJobRevision),
    generateControllerArtifact: tracked(real.generateControllerArtifact),
    downloadTextFile: tracked(real.downloadTextFile),
    ...overrides
  };
}

/** IndexedDB uses real tasks. Await service receipts rather than assuming microtask counts. */
export async function settleDefaultAppServices() {
  for (let pass = 0; pass < 100; pass++) {
    await act(async () => {
      while (pendingDefaults.size) await Promise.allSettled([...pendingDefaults]);
      await Promise.resolve();
    });
    // React effects flushed by act may start the next real service operation.
    if (!pendingDefaults.size) return;
  }
  throw new Error('Default app services did not settle.');
}

export async function waitForWorkbenchInitialization(read: () => { workbenchStatus: string }) {
  for (let turn = 0; read().workbenchStatus === 'initializing'; turn++) {
    if (turn === 200) throw new Error('Workbench initialization did not finish.');
    await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
  }
}
