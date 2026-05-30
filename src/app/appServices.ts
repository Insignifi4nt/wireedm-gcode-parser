import {
  importDxfProject,
  type ImportDxfProjectInput,
  type ImportDxfProjectResult
} from '@/domain/dxf/importDxfProject';
import {
  importExternalProgram,
  type ImportExternalProgramInput,
  type ImportExternalProgramResult
} from '@/domain/editor/importExternalProgram';
import {
  loadEditorProgram,
  type LoadedEditorProgram
} from '@/domain/editor/loadEditorProgram';
import {
  openWorkbenchProject,
  type OpenWorkbenchProjectResult
} from '@/domain/editor/openWorkbenchProject';
import {
  saveEditorProgram,
  type SaveEditorProgramInput
} from '@/domain/editor/saveEditorProgram';
import {
  downloadProgramFile,
  type DownloadProgramFileInput
} from '@/domain/post/downloadProgramFile';
import { connectCachedWorkbench } from '@/domain/storage/connectCachedWorkbench';
import {
  updateWorkbenchSettings,
  type UpdateWorkbenchSettingsInput
} from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

export interface AppServices {
  connectCachedWorkbench: () => Promise<ConnectedWorkbench>;
  importDxfProject: (
    workbench: ConnectedWorkbench,
    input: ImportDxfProjectInput
  ) => Promise<ImportDxfProjectResult>;
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
  ) => Promise<LoadedEditorProgram>;
  updateWorkbenchSettings: (
    workbench: ConnectedWorkbench,
    input: UpdateWorkbenchSettingsInput
  ) => Promise<ConnectedWorkbench>;
  downloadGeneratedProgram: (input: DownloadProgramFileInput) => void;
}

export const defaultAppServices: AppServices = {
  connectCachedWorkbench,
  importDxfProject,
  importExternalProgram,
  loadEditorProgram,
  openWorkbenchProject,
  saveEditorProgram,
  updateWorkbenchSettings,
  downloadGeneratedProgram: downloadProgramFile
};
