import type { WorkbenchProject, WorkbenchUpidState } from '@/domain/workbench/types';

import type { UniversalPathIntelligenceDocument } from './upidDocument';

export function createProjectUpid(document: UniversalPathIntelligenceDocument): WorkbenchUpidState {
  return {
    format: 'upid',
    schemaVersion: 1,
    document
  };
}

export function projectUpidDocument(project: WorkbenchProject | null | undefined) {
  return project?.upid?.document ?? null;
}

export function withProjectUpid(
  project: WorkbenchProject,
  document: UniversalPathIntelligenceDocument
): WorkbenchProject {
  const nextProject: WorkbenchProject = {
    ...project,
    upid: createProjectUpid(document)
  };
  delete (nextProject as WorkbenchProject & { generated?: unknown }).generated;

  return nextProject;
}
