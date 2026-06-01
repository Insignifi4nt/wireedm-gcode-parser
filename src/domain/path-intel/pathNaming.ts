import type { ContourClassification, PathContour } from './types';

export function buildContourDisplayNames(contours: PathContour[]) {
  const counts = new Map<ContourClassification, number>();
  const names = new Map<string, string>();

  for (const contour of contours) {
    const count = (counts.get(contour.classification) ?? 0) + 1;
    counts.set(contour.classification, count);
    names.set(contour.id, `${displayBaseForClassification(contour.classification)} ${count}`);
  }

  return names;
}

function displayBaseForClassification(classification: ContourClassification) {
  if (classification === 'exterior') return 'Exterior';
  if (classification === 'hole') return 'Hole';
  if (classification === 'island') return 'Island';
  if (classification === 'open-chain') return 'Open Chain';
  return 'Ambiguous';
}
