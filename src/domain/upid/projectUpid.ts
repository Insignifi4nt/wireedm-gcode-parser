import type { PathDiagnostic } from '@/domain/path-intel/types';
import type { WorkbenchProject, WorkbenchUpidState } from '@/domain/workbench/types';

import type { UniversalPathIntelligenceDocument } from './upidDocument';

export function createProjectUpid(
  document: UniversalPathIntelligenceDocument,
  postDiagnostics: PathDiagnostic[] = []
): WorkbenchUpidState {
  return {
    format: 'upid',
    schemaVersion: 1,
    document,
    postDiagnostics
  };
}

export function projectUpidDocument(project: WorkbenchProject | null | undefined) {
  return project?.upid?.document ?? null;
}

export function projectUpidPostDiagnostics(project: WorkbenchProject | null | undefined) {
  return project?.upid?.postDiagnostics ?? [];
}

export function withProjectUpid(
  project: WorkbenchProject,
  document: UniversalPathIntelligenceDocument,
  postDiagnostics: PathDiagnostic[] = []
): WorkbenchProject {
  return {
    ...project,
    upid: createProjectUpid(document, postDiagnostics)
  };
}

export function withoutProjectUpid(project: WorkbenchProject): WorkbenchProject {
  const nextProject: WorkbenchProject = { ...project };
  delete nextProject.upid;
  return nextProject;
}
