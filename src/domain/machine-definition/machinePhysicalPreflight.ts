import type { WireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { executionPlanBounds } from '@/domain/execution-plan/executionPlanBounds';

import type { MachineDefinition } from './machineDefinition';
import { evaluatePhysicalMachineEnvelopeFit, type MachineFitIssue } from './machineFit';

export type MachinePhysicalPreflightError =
  | {
      readonly code: 'MACHINE_PHYSICAL_PREFLIGHT_GEOMETRY_INVALID';
      readonly message: string;
    }
  | {
      readonly code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_UNKNOWN';
      readonly message: string;
      readonly unknownAxes: readonly ('x' | 'y')[];
    }
  | {
      readonly code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_EXCEEDED';
      readonly message: string;
      readonly issues: readonly MachineFitIssue[];
    }
  | {
      readonly code: 'MACHINE_PHYSICAL_PREFLIGHT_THREADING_UNSUPPORTED';
      readonly message: string;
      readonly methods: readonly ('manual' | 'automatic')[];
    };

export type MachinePhysicalPreflightResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: MachinePhysicalPreflightError };

export function preflightMachinePhysicalRequirements(input: {
  readonly machine: MachineDefinition;
  readonly plan: WireEdmExecutionPlan;
}): MachinePhysicalPreflightResult {
  const bounds = executionPlanBounds(input.plan);
  const fit = evaluatePhysicalMachineEnvelopeFit({
    bounds: { xSpanMm: bounds.maxX - bounds.minX, ySpanMm: bounds.maxY - bounds.minY },
    machine: input.machine
  });
  if (!fit.ok) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_PHYSICAL_PREFLIGHT_GEOMETRY_INVALID',
        message: fit.error.message
      }
    };
  }
  if (fit.fit.status === 'indeterminate') {
    return {
      ok: false,
      error: {
        code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_UNKNOWN',
        message: `Machine-ready revision requires known travel for: ${fit.fit.unknownAxes.join(', ')}.`,
        unknownAxes: fit.fit.unknownAxes
      }
    };
  }
  if (fit.fit.status === 'too-large') {
    return {
      ok: false,
      error: {
        code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_EXCEEDED',
        message: 'Planned cutting and positioning exceed the selected machine travel.',
        issues: fit.fit.issues
      }
    };
  }
  if (fit.fit.status === 'not-evaluated') {
    return {
      ok: false,
      error: {
        code: 'MACHINE_PHYSICAL_PREFLIGHT_GEOMETRY_INVALID',
        message: 'Machine-ready revision requires an explicit physical machine.'
      }
    };
  }

  const unsupported = input.plan.requirements.threading.filter((method) => (
    method === 'manual'
      ? !input.machine.hardware.manualThreading
      : !input.machine.hardware.automaticThreading
  ));
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_PHYSICAL_PREFLIGHT_THREADING_UNSUPPORTED',
        message: `Selected machine lacks required threading hardware: ${unsupported.join(', ')}.`,
        methods: unsupported
      }
    };
  }
  return { ok: true };
}
