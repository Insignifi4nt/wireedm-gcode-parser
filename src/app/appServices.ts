import {
  commitDxfProjectImport,
  type DxfImportDecision,
  type ImportDxfProjectResult
} from '@/domain/dxf/importDxfProject';
import {
  prepareDxfProjectImport,
  previewDxfProjectImport,
  type DxfImportPreparation
} from '@/domain/dxf/prepareDxfProjectImport';
import {
  commitDxfProjectReimport,
  prepareDxfProjectReimport
} from '@/domain/dxf/reimportDxfProjectUnits';
import {
  importExternalProgram,
  type ImportExternalProgramInput,
  type ImportExternalProgramResult
} from '@/domain/editor/importExternalProgram';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';
import { openWorkbenchProject } from '@/domain/editor/openWorkbenchProject';
import { saveEditorProgram } from '@/domain/editor/saveEditorProgram';
import {
  createStoredMachinePostBinding,
  installStoredMachineDefinition,
  removeStoredMachineDefinition,
  removeStoredMachinePostBinding,
  replaceStoredMachineDefinition
} from '@/domain/machine-definition/machineLibraryMutations';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import {
  installStoredPostPackage,
  removeStoredPostInstallation
} from '@/domain/post-processor/postLibraryMutations';
import { connectCachedWorkbench } from '@/domain/storage/connectCachedWorkbench';
import {
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory
} from '@/domain/storage/connectWorkbenchDirectory';
import { deleteWorkbenchProject } from '@/domain/storage/deleteWorkbenchProject';
import { renameWorkbenchProject } from '@/domain/storage/renameWorkbenchProject';
import {
  exportPortableUpidProject,
  importPortableUpidProject
} from '@/domain/upid/portableUpidProject';
import {
  createSavedWireEdmJobRevision,
  generateControllerArtifact,
  saveStoredWireEdmJobRevision
} from '@/domain/wire-edm-job';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { updateWorkbenchCatalogPreferences } from '@/domain/workbench-catalog/storage/updateWorkbenchCatalogPreferences';

export interface AppServices {
  readonly connectCachedWorkbench: typeof connectCachedWorkbench;
  readonly connectRememberedWorkbenchDirectory: typeof connectRememberedWorkbenchDirectory;
  readonly connectWorkbenchDirectory: typeof connectWorkbenchDirectory;
  readonly prepareDxfProjectImport: typeof prepareDxfProjectImport;
  readonly previewDxfProjectImport: typeof previewDxfProjectImport;
  readonly commitDxfProjectImport: (
    workbench: ConnectedWorkbenchCatalog,
    preparation: DxfImportPreparation,
    decision: DxfImportDecision
  ) => Promise<ImportDxfProjectResult>;
  readonly prepareDxfProjectReimport: typeof prepareDxfProjectReimport;
  readonly commitDxfProjectReimport: typeof commitDxfProjectReimport;
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
  readonly updateWorkbenchCatalogPreferences: typeof updateWorkbenchCatalogPreferences;
  readonly installStoredMachineDefinition: typeof installStoredMachineDefinition;
  readonly replaceStoredMachineDefinition: typeof replaceStoredMachineDefinition;
  readonly removeStoredMachineDefinition: typeof removeStoredMachineDefinition;
  readonly createStoredMachinePostBinding: typeof createStoredMachinePostBinding;
  readonly removeStoredMachinePostBinding: typeof removeStoredMachinePostBinding;
  readonly installStoredPostPackage: typeof installStoredPostPackage;
  readonly removeStoredPostInstallation: typeof removeStoredPostInstallation;
  readonly createSavedWireEdmJobRevision: typeof createSavedWireEdmJobRevision;
  readonly saveStoredWireEdmJobRevision: typeof saveStoredWireEdmJobRevision;
  readonly generateControllerArtifact: typeof generateControllerArtifact;
  readonly downloadTextFile: typeof downloadProgramFile;
}

export const defaultAppServices: AppServices = {
  connectCachedWorkbench,
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory,
  prepareDxfProjectImport,
  previewDxfProjectImport,
  commitDxfProjectImport,
  prepareDxfProjectReimport,
  commitDxfProjectReimport,
  exportPortableUpidProject,
  importPortableUpidProject,
  importExternalProgram,
  loadEditorProgram,
  openWorkbenchProject,
  saveEditorProgram,
  renameWorkbenchProject,
  deleteWorkbenchProject,
  updateWorkbenchCatalogPreferences,
  installStoredMachineDefinition,
  replaceStoredMachineDefinition,
  removeStoredMachineDefinition,
  createStoredMachinePostBinding,
  removeStoredMachinePostBinding,
  installStoredPostPackage,
  removeStoredPostInstallation,
  createSavedWireEdmJobRevision,
  saveStoredWireEdmJobRevision,
  generateControllerArtifact,
  downloadTextFile: downloadProgramFile
};
