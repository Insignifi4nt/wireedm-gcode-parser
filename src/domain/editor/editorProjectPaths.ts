import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { WorkbenchProject } from '@/domain/workbench/types';

export function upidEditorDocumentPath(
  workbench: Pick<ConnectedWorkbench, 'manifest'>,
  project: WorkbenchProject
) {
  return (
    workbench.manifest.projects.find((entry) => entry.id === project.id)?.path ??
    `projects/${project.id}/project.json`
  );
}
