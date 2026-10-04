import { previewDxfProjectImport } from '@/domain/dxf/prepareDxfProjectImport';
import {
  importExternalProgram,
  type ImportExternalProgramInput,
  type ImportExternalProgramResult
} from '@/domain/editor/importExternalProgram';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';
import { openWorkbenchProject } from '@/domain/editor/openWorkbenchProject';
import { saveEditorProgram } from '@/domain/editor/saveEditorProgram';
import {
  activateStoredMachinePostBinding,
  removeStoredMachineDefinition,
} from '@/domain/machine-definition/machineLibraryMutations';
import type {
  commitStoredMachinePackageInstallation,
  prepareStoredMachinePackageInstallation
} from '@/domain/machine-package/machinePackageInstallation';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import { connectCachedWorkbench } from '@/domain/storage/connectCachedWorkbench';
import { captureWorkbenchRecovery } from '@/domain/storage/workbenchRecovery';
import {
  forgetWorkbenchDirectory,
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory
} from '@/domain/storage/connectWorkbenchDirectory';
import { deleteWorkbenchProject } from '@/domain/storage/deleteWorkbenchProject';
import { purgeArchivedWorkbenchProject, restoreStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import { renameWorkbenchProject } from '@/domain/storage/renameWorkbenchProject';
import {
  exportPortableUpidProject,
  importPortableUpidProject
} from '@/domain/upid/portableUpidProject';
import {
  createSavedWireEdmJobRevision,
  saveStoredWireEdmJobRevision
} from '@/domain/wire-edm-job/savedWireEdmJobRevision';
import type { deleteStoredWireEdmJobRevisions } from '@/domain/wire-edm-job/deleteSavedWireEdmJobRevisions';
import type { generateControllerArtifact } from '@/domain/wire-edm-job/controllerArtifact';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { updateWorkbenchCatalogPreferences } from '@/domain/workbench-catalog/storage/updateWorkbenchCatalogPreferences';
import { dxfImportServices } from './dxfImportServices';

export interface AppServices {
  readonly captureWorkbenchRecovery: typeof captureWorkbenchRecovery;
  readonly forgetWorkbenchDirectory: typeof forgetWorkbenchDirectory;
  readonly connectCachedWorkbench: typeof connectCachedWorkbench;
  readonly connectRememberedWorkbenchDirectory: typeof connectRememberedWorkbenchDirectory;
  readonly connectWorkbenchDirectory: typeof connectWorkbenchDirectory;
  readonly prepareDxfProjectImport: typeof dxfImportServices.prepareDxfProjectImport;
  readonly previewDxfProjectImport: typeof previewDxfProjectImport;
  readonly commitDxfProjectImport: typeof dxfImportServices.commitDxfProjectImport;
  readonly prepareDxfProjectReimport: typeof dxfImportServices.prepareDxfProjectReimport;
  readonly commitDxfProjectReimport: typeof dxfImportServices.commitDxfProjectReimport;
  readonly exportPortableUpidProject: typeof exportPortableUpidProject;
  readonly importPortableUpidProject: typeof importPortableUpidProject;
  readonly importExternalProgram: (
    workbench: ConnectedWorkbenchCatalog,
    input: ImportExternalProgramInput
  ) => Promise<ImportExternalProgramResult>;
  readonly loadEditorProgram: typeof loadEditorProgram;
  readonly openWorkbenchProject: typeof openWorkbenchProject;
  readonly saveEditorProgram: typeof saveEditorProgram;
  readonly renameWorkbenchProject: typeof renameWorkbenchProject;
  readonly deleteWorkbenchProject: typeof deleteWorkbenchProject;
  readonly restoreStoredWorkbenchProject: typeof restoreStoredWorkbenchProject;
  readonly purgeArchivedWorkbenchProject: typeof purgeArchivedWorkbenchProject;
  readonly updateWorkbenchCatalogPreferences: typeof updateWorkbenchCatalogPreferences;
  readonly activateStoredMachinePostBinding: typeof activateStoredMachinePostBinding;
  readonly prepareStoredMachinePackageInstallation: typeof prepareStoredMachinePackageInstallation;
  readonly commitStoredMachinePackageInstallation: typeof commitStoredMachinePackageInstallation;
  readonly removeStoredMachineDefinition: typeof removeStoredMachineDefinition;
  readonly createSavedWireEdmJobRevision: typeof createSavedWireEdmJobRevision;
  readonly deleteStoredWireEdmJobRevisions: typeof deleteStoredWireEdmJobRevisions;
  readonly saveStoredWireEdmJobRevision: typeof saveStoredWireEdmJobRevision;
  readonly generateControllerArtifact: typeof generateControllerArtifact;
  readonly downloadTextFile: typeof downloadProgramFile;
}

export const defaultAppServices: AppServices = {
  captureWorkbenchRecovery,
  forgetWorkbenchDirectory,
  connectCachedWorkbench,
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory,
  ...dxfImportServices,
  previewDxfProjectImport,
  exportPortableUpidProject,
  importPortableUpidProject,
  importExternalProgram,
  loadEditorProgram,
  openWorkbenchProject,
  saveEditorProgram,
  renameWorkbenchProject,
  deleteWorkbenchProject,
  restoreStoredWorkbenchProject,
  purgeArchivedWorkbenchProject,
  updateWorkbenchCatalogPreferences,
  activateStoredMachinePostBinding,
  prepareStoredMachinePackageInstallation: async (...args) =>
    (await import('@/domain/machine-package/machinePackageInstallation')).prepareStoredMachinePackageInstallation(...args),
  commitStoredMachinePackageInstallation: async (...args) =>
    (await import('@/domain/machine-package/machinePackageInstallation')).commitStoredMachinePackageInstallation(...args),
  removeStoredMachineDefinition,
  createSavedWireEdmJobRevision,
  deleteStoredWireEdmJobRevisions: async (...args) =>
    (await import('@/domain/wire-edm-job/deleteSavedWireEdmJobRevisions')).deleteStoredWireEdmJobRevisions(...args),
  saveStoredWireEdmJobRevision,
  generateControllerArtifact: async (...args) =>
    (await import('@/domain/wire-edm-job/controllerArtifact')).generateControllerArtifact(...args),
  downloadTextFile: downloadProgramFile
};
