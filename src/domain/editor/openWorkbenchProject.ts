import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { WorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';

import {
  loadEditorProgram,
  type LoadedEditorProgram,
  type LoadEditorProgramError
} from './loadEditorProgram';

export type OpenWorkbenchProjectResult =
  | {
      readonly ok: true;
      readonly project: WorkbenchProjectDocument;
      readonly editorProgram: LoadedEditorProgram;
    }
  | { readonly ok: false; readonly error: LoadEditorProgramError };

export async function openWorkbenchProject(
  workbench: ConnectedWorkbenchCatalog,
  projectId: string
): Promise<OpenWorkbenchProjectResult> {
  const loaded = await loadEditorProgram(workbench, projectId);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    project: loaded.editorProgram.project,
    editorProgram: loaded.editorProgram
  };
}
