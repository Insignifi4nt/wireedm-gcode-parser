import type { PathPlanningDocument } from '@/domain/path-intel/types';

/** Give execution fixtures an explicit operator choice without changing their geometry. */
export function reviewCenterline(document: PathPlanningDocument): PathPlanningDocument {
  for (const operation of document.plan.operations) {
    operation.compensationIntent = { mode: 'centerline', source: 'manual' };
    const element = document.pathElements.find((candidate) => candidate.operationId === operation.id);
    if (element) element.compensationIntent = { mode: 'centerline', source: 'manual' };
  }
  return document;
}
