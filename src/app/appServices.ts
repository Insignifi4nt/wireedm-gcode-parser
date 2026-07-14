import {
  commitDxfProjectImport,
  type DxfImportDecision,
  type ImportDxfProjectResult
} from '@/domain/dxf/importDxfProject';
import {
  prepareDxfProjectImport,
  previewDxfProjectImport,
  unitCandidatesForDxfImport,
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
import {
  loadEditorProgram
} from '@/domain/editor/loadEditorProgram';
import {
  openWorkbenchProject,
  type OpenWorkbenchProjectResult
} from '@/domain/editor/openWorkbenchProject';
import {
  saveEditorProgram,
  type SaveEditorProgramInput,
  type SaveEditorProgramResult
} from '@/domain/editor/saveEditorProgram';
import {
  downloadProgramFile,
  type DownloadProgramFileInput
} from '@/domain/post/downloadProgramFile';
import { connectCachedWorkbench } from '@/domain/storage/connectCachedWorkbench';
import {
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory
} from '@/domain/storage/connectWorkbenchDirectory';
import {
  updateWorkbenchSettings,
  type UpdateWorkbenchSettingsInput
} from '@/domain/storage/updateWorkbenchSettings';
import {
  addMachineProfile,
  deleteMachineProfile,
  duplicateMachineProfile,
  importMachineProfile,
  setActiveMachineProfile,
  updateMachineProfileLibrary
} from '@/domain/storage/updateMachineProfileLibrary';
import {
  renameWorkbenchProject,
  type RenameWorkbenchProjectInput,
  type RenameWorkbenchProjectResult
} from '@/domain/storage/renameWorkbenchProject';
import {
  deleteWorkbenchProject,
  type DeleteWorkbenchProjectInput,
  type DeleteWorkbenchProjectResult
} from '@/domain/storage/deleteWorkbenchProject';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { MachineProfile } from '@/domain/workbench/types';
import {
  exportPortableUpidProject,
  importPortableUpidProject
} from '@/domain/upid/portableUpidProject';

export interface AppServices {
  connectCachedWorkbench: () => Promise<ConnectedWorkbench>;
  connectRememberedWorkbenchDirectory: typeof connectRememberedWorkbenchDirectory;
  connectWorkbenchDirectory: () => Promise<ConnectedWorkbench>;
  prepareDxfProjectImport: typeof prepareDxfProjectImport;
  previewDxfProjectImport: typeof previewDxfProjectImport;
  unitCandidatesForDxfImport: typeof unitCandidatesForDxfImport;
  commitDxfProjectImport: (
    workbench: ConnectedWorkbench,
    preparation: DxfImportPreparation,
    decision: DxfImportDecision
  ) => Promise<ImportDxfProjectResult>;
  prepareDxfProjectReimport: typeof prepareDxfProjectReimport;
  commitDxfProjectReimport: typeof commitDxfProjectReimport;
  exportPortableUpidProject: typeof exportPortableUpidProject;
  importPortableUpidProject: typeof importPortableUpidProject;
  importExternalProgram: (
    workbench: ConnectedWorkbench,
    input: ImportExternalProgramInput
  ) => Promise<ImportExternalProgramResult>;
  loadEditorProgram: typeof loadEditorProgram;
  openWorkbenchProject: (
    workbench: ConnectedWorkbench,
    projectPath: string
  ) => Promise<OpenWorkbenchProjectResult>;
  saveEditorProgram: (
    workbench: ConnectedWorkbench,
    input: SaveEditorProgramInput
  ) => Promise<SaveEditorProgramResult>;
  renameWorkbenchProject: (
    workbench: ConnectedWorkbench,
    input: RenameWorkbenchProjectInput
  ) => Promise<RenameWorkbenchProjectResult>;
  deleteWorkbenchProject: (
    workbench: ConnectedWorkbench,
    input: DeleteWorkbenchProjectInput
  ) => Promise<DeleteWorkbenchProjectResult>;
  updateWorkbenchSettings: (
    workbench: ConnectedWorkbench,
    input: UpdateWorkbenchSettingsInput
  ) => Promise<ConnectedWorkbench>;
  addMachineProfile: typeof addMachineProfile;
  duplicateMachineProfile: typeof duplicateMachineProfile;
  deleteMachineProfile: typeof deleteMachineProfile;
  setActiveMachineProfile: typeof setActiveMachineProfile;
  importMachineProfile: typeof importMachineProfile;
  replaceMachineProfile: (
    workbench: ConnectedWorkbench,
    profile: MachineProfile
  ) => Promise<ConnectedWorkbench>;
  downloadGeneratedProgram: (input: DownloadProgramFileInput) => void;
  downloadTextFile: (input: DownloadProgramFileInput) => void;
}

export const defaultAppServices: AppServices = {
  connectCachedWorkbench,
  connectRememberedWorkbenchDirectory,
  connectWorkbenchDirectory,
  prepareDxfProjectImport,
  previewDxfProjectImport,
  unitCandidatesForDxfImport,
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
  updateWorkbenchSettings,
  addMachineProfile,
  duplicateMachineProfile,
  deleteMachineProfile,
  setActiveMachineProfile,
  importMachineProfile,
  replaceMachineProfile: (workbench, profile) =>
    updateMachineProfileLibrary(workbench, { kind: 'replace', profile }),
  downloadGeneratedProgram: downloadProgramFile,
  downloadTextFile: downloadProgramFile
};
