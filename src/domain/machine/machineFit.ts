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
  if (!input.document) return unchecked();

  const bounds = documentBounds(input.document);
  return evaluateMachineFitBounds({ bounds, profile: input.profile });
}

export function evaluateMachineFitBounds(input: {
  bounds: Bounds2 | null | undefined;
  profile: MachineProfile | null | undefined;
}): MachineFitResult {
  if (!validBounds(input.bounds)) return unchecked();

  const widthMm = input.bounds.maxX - input.bounds.minX;
  const lengthMm = input.bounds.maxY - input.bounds.minY;
  if (!Number.isFinite(widthMm) || !Number.isFinite(lengthMm)) return unchecked();

  const size = {
    widthMm: round(widthMm),
    lengthMm: round(lengthMm)
  };
  const widthLimit = input.profile?.workArea?.widthMm ?? null;
  const lengthLimit = input.profile?.workArea?.lengthMm ?? null;
  if (!widthLimit && !lengthLimit) {
    return { status: 'unchecked', bounds: size, issues: [] };
  }
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

function validBounds(bounds: Bounds2 | null | undefined): bounds is Bounds2 {
  return Boolean(
    bounds &&
    [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) &&
    bounds.maxX >= bounds.minX &&
    bounds.maxY >= bounds.minY
  );
}

function unchecked(): MachineFitResult {
  return { status: 'unchecked', bounds: null, issues: [] };
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
