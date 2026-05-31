import { mergeBounds, segmentMap } from '@/domain/path-intel/segments';
import type { Bounds2, PathPlanningDocument } from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

export type MachineFitStatus = 'unchecked' | 'fits' | 'too-large';

export interface MachineFitIssue {
  axis: 'width' | 'length';
  actualMm: number;
  limitMm: number;
}

export interface MachineFitResult {
  status: MachineFitStatus;
  bounds: {
    widthMm: number;
    lengthMm: number;
  } | null;
  issues: MachineFitIssue[];
}

export function evaluateMachineFit(input: {
  document: PathPlanningDocument | null | undefined;
  profile: MachineProfile | null | undefined;
}): MachineFitResult {
  const widthLimit = input.profile?.workArea?.widthMm ?? null;
  const lengthLimit = input.profile?.workArea?.lengthMm ?? null;

  if (!input.document || (!widthLimit && !lengthLimit)) {
    return { status: 'unchecked', bounds: null, issues: [] };
  }

  const bounds = documentBounds(input.document);
  if (!bounds) return { status: 'unchecked', bounds: null, issues: [] };

  const size = {
    widthMm: round(bounds.maxX - bounds.minX),
    lengthMm: round(bounds.maxY - bounds.minY)
  };
  const issues: MachineFitIssue[] = [];

  if (widthLimit && size.widthMm > widthLimit) {
    issues.push({ axis: 'width', actualMm: size.widthMm, limitMm: widthLimit });
  }
  if (lengthLimit && size.lengthMm > lengthLimit) {
    issues.push({ axis: 'length', actualMm: size.lengthMm, limitMm: lengthLimit });
  }

  return {
    status: issues.length > 0 ? 'too-large' : 'fits',
    bounds: size,
    issues
  };
}

function documentBounds(document: PathPlanningDocument): Bounds2 | null {
  if (document.segments.length === 0) return null;

  const segmentsById = segmentMap(document.segments);
  let bounds: Bounds2 = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity
  };

  for (const segment of segmentsById.values()) {
    bounds = mergeBounds(bounds, segment.bounds);
  }

  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return null;
  return bounds;
}

function round(value: number) {
  return Number(value.toFixed(6));
}
