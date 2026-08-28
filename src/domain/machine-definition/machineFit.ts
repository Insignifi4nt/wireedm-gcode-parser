import { mergeBounds } from '@/domain/path-intel/segments';
import type { Bounds2, PathPlanningDocument } from '@/domain/path-intel/types';

import type { MachineDefinition } from './machineDefinition';

export interface MachineEnvelopeBounds {
  readonly xSpanMm: number;
  readonly ySpanMm: number;
}

export interface MachineFitIssue {
  readonly axis: 'x' | 'y';
  readonly actualMm: number;
  readonly limitMm: number;
}

export type PhysicalMachineFitResult =
  | {
      readonly ok: true;
      readonly fit: {
        readonly status: 'not-evaluated';
        readonly reason: 'no-machine-selected';
        readonly bounds: MachineEnvelopeBounds;
      };
    }
  | {
      readonly ok: true;
      readonly fit: {
        readonly status: 'indeterminate';
        readonly bounds: MachineEnvelopeBounds;
        readonly unknownAxes: readonly ('x' | 'y')[];
      };
    }
  | {
      readonly ok: true;
      readonly fit: {
        readonly status: 'fits';
        readonly bounds: MachineEnvelopeBounds;
      };
    }
  | {
      readonly ok: true;
      readonly fit: {
        readonly status: 'too-large';
        readonly bounds: MachineEnvelopeBounds;
        readonly issues: readonly MachineFitIssue[];
      };
    }
  | {
      readonly ok: false;
      readonly error:
        | {
            readonly code: 'MACHINE_FIT_GEOMETRY_EMPTY';
            readonly message: string;
          }
        | {
            readonly code: 'MACHINE_FIT_BOUNDS_INVALID';
            readonly message: string;
          };
    };

export function evaluatePhysicalMachineFit(input: {
  readonly document: PathPlanningDocument;
  readonly machine: MachineDefinition | null;
}): PhysicalMachineFitResult {
  const measured = measureDocumentEnvelope(input.document);
  if (!measured.ok) return measured;
  if (input.machine === null) {
    return {
      ok: true,
      fit: {
        status: 'not-evaluated',
        reason: 'no-machine-selected',
        bounds: measured.bounds
      }
    };
  }

  const issues: MachineFitIssue[] = [];
  const unknownAxes: ('x' | 'y')[] = [];
  compareLimit('x', measured.bounds.xSpanMm, input.machine.limits.xTravel, issues, unknownAxes);
  compareLimit('y', measured.bounds.ySpanMm, input.machine.limits.yTravel, issues, unknownAxes);

  if (issues.length > 0) {
    return { ok: true, fit: { status: 'too-large', bounds: measured.bounds, issues } };
  }
  if (unknownAxes.length > 0) {
    return {
      ok: true,
      fit: { status: 'indeterminate', bounds: measured.bounds, unknownAxes }
    };
  }
  return { ok: true, fit: { status: 'fits', bounds: measured.bounds } };
}

function measureDocumentEnvelope(
  document: PathPlanningDocument
):
  | { readonly ok: true; readonly bounds: MachineEnvelopeBounds }
  | Extract<PhysicalMachineFitResult, { readonly ok: false }> {
  if (document.segments.length === 0) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_FIT_GEOMETRY_EMPTY',
        message: 'Machine fit cannot be evaluated because the UPID contains no geometry.'
      }
    };
  }
  let bounds: Bounds2 = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
  for (const segment of document.segments) bounds = mergeBounds(bounds, segment.bounds);
  const xSpanMm = bounds.maxX - bounds.minX;
  const ySpanMm = bounds.maxY - bounds.minY;
  if (
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, xSpanMm, ySpanMm].every(Number.isFinite) ||
    xSpanMm < 0 ||
    ySpanMm < 0
  ) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_FIT_BOUNDS_INVALID',
        message: 'Machine fit cannot be evaluated because the UPID geometry bounds are invalid.'
      }
    };
  }
  return {
    ok: true,
    bounds: { xSpanMm, ySpanMm }
  };
}

function compareLimit(
  axis: 'x' | 'y',
  actualMm: number,
  limit: MachineDefinition['limits']['xTravel'],
  issues: MachineFitIssue[],
  unknownAxes: ('x' | 'y')[]
) {
  if (limit.status === 'unknown') {
    unknownAxes.push(axis);
    return;
  }
  if (actualMm > limit.millimeters) {
    issues.push({ axis, actualMm, limitMm: limit.millimeters });
  }
}
