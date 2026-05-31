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
  return {
    ...project,
    upid: createProjectUpid(document)
  };
}

export function withoutProjectUpid(project: WorkbenchProject): WorkbenchProject {
  const nextProject: WorkbenchProject = { ...project };
  delete nextProject.upid;
  return nextProject;
}
