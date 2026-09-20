import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

import { distance, interpolateLine, interpolateMotion, motionLength, motionPolyline } from './geometry';
import { compileReleasedPieces, releasedPieceSnapshots, settlingDuration } from './releasedPieces';
import { compileObstructions } from './obstructions';
import type {
  ResolvedSimulationSettings, SimulationCompileResult, SimulationDiagnostic, SimulationPlan,
  SimulationSettings, SimulationSnapshot, SimulationStep
} from './types';

export function compileSimulation(document: PathPlanningDocument, input: SimulationSettings): SimulationCompileResult {
  const settings = resolveSimulationSettings(input);
  if (!settings) return { ok: false, diagnostics: [{ code: 'SIMULATION_INVALID_SETTINGS', severity: 'error', operationId: null,
    message: 'Simulation needs finite positive stock dimensions, wire diameter and viewing speeds; nonnegative hold/guide values; and a support floor at or below the stock bottom.' }] };
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) return { ok: false, diagnostics: compiled.diagnostics.map((diagnostic) => ({ ...diagnostic, severity: 'error' })) };
  let elapsed = 0;
  let point: Point2 = { x: 0, y: 0 };
  let wireThreaded = true;
  let operationCount = 0;
  const steps: SimulationStep[] = compiled.plan.events.map((event) => {
    if (event.kind === 'program-start') point = { ...event.initialWirePosition };
    if (event.kind === 'operation-start' && operationCount++ > 0) {
      const sourceId = event.trace.find((ref) => ref.kind === 'operation')?.operationId ?? event.operationId;
      const operation = document.plan.operations.find(({ id }) => id === sourceId);
      const threading = operation?.threadingTransition ?? document.setup?.threadingDefault;
      if (threading?.wireSeparation === 'already-separated') wireThreaded = false;
    }
    if (event.kind === 'wire-separate' || (event.kind === 'position' && event.separatesWire)) wireThreaded = false;
    const lengthMm = event.kind === 'motion' ? motionLength(event) : event.kind === 'position' ? distance(event.from, event.to) : 0;
    const duration = event.kind === 'motion' ? lengthMm / settings.cutSpeedMmPerSecond
      : event.kind === 'position' ? lengthMm / settings.rapidSpeedMmPerSecond
        : ['program-stop', 'wire-separate', 'wire-thread'].includes(event.kind) ? settings.eventHoldSeconds : 0;
    const path = event.kind === 'motion' ? motionPolyline(event) : event.kind === 'position' ? [{ ...event.from }, { ...event.to }] : [{ ...point }];
    const step: SimulationStep = { event, startSeconds: elapsed, endSeconds: elapsed + duration, lengthMm, path, wireThreaded };
    elapsed += duration;
    if (event.kind === 'wire-thread') wireThreaded = true;
    if (event.kind === 'position') point = { ...event.to };
    if (event.kind === 'motion') point = { ...event.end };
    return step;
  });
  if (!Number.isFinite(elapsed)) return { ok: false, diagnostics: [{ code: 'SIMULATION_DURATION_OVERFLOW', severity: 'error', operationId: null,
    message: 'These geometry and speed values exceed the finite simulation timeline range.' }] };
  const releases = compileReleasedPieces(document, steps, settings);
  const diagnostics: SimulationDiagnostic[] = [
    { code: 'SIMULATION_ESTIMATE', severity: 'info', operationId: null,
      message: 'Playback uses viewing speeds and illustrative stop/rethread holds, not machine feeds or cycle-time estimates.' },
    { code: 'SIMULATION_MATERIAL_ASSUMPTIONS', severity: 'warning', operationId: null,
      message: 'Material uses constant-thickness extrusions and sampled nominal boundaries; wire kerf and spark gap are not subtracted from the solids. Released pieces move vertically under gravity or remain retained as selected; no tilt, fluid forces, clamps, stacking or rigid-body contacts are predicted. Obstruction findings are approximate and do not certify clearance.' },
    ...releases.diagnostics
  ];
  if (compiled.plan.requirements.controllerCompensation) diagnostics.push({ code: 'SIMULATION_NOMINAL_COMPENSATION', severity: 'warning', operationId: null,
    message: 'Controller compensation is present. The simulation displays nominal UPID paths; controller offsets and spark gap are not solved.' });
  const lastRelease = releases.pieces.reduce((last, piece) => Math.max(last, piece.releaseSeconds), 0);
  const plan: SimulationPlan = { format: 'wire-edm-simulation', settings, executionPlan: compiled.plan,
    machiningDurationSeconds: elapsed,
    durationSeconds: Math.max(elapsed, releases.pieces.length ? lastRelease + settlingDuration(settings) : elapsed),
    steps, pieces: releases.pieces, diagnostics, warnings: [] };
  const obstructions = compileObstructions(plan);
  return { ok: true, plan: deepFreeze({ ...plan, diagnostics: [...diagnostics, ...obstructions.diagnostics], warnings: obstructions.warnings }) };
}

export function sampleSimulation(plan: SimulationPlan, requestedSeconds: number): SimulationSnapshot {
  const elapsedSeconds = Number.isNaN(requestedSeconds) ? 0 : Math.max(0, Math.min(plan.durationSeconds, requestedSeconds));
  const completedStepCount = completedStepsAt(plan.steps, elapsedSeconds);
  const next = plan.steps[completedStepCount];
  const active = next && next.startSeconds <= elapsedSeconds ? next : null;
  const activeStepIndex = active ? completedStepCount : null;
  const previous = plan.steps[completedStepCount - 1];
  const activeStepFraction = active ? (elapsedSeconds - active.startSeconds) / (active.endSeconds - active.startSeconds) : 1;
  const event = active?.event;
  const point = event?.kind === 'motion' ? interpolateMotion(event, activeStepFraction)
    : event?.kind === 'position' ? interpolateLine(event.from, event.to, activeStepFraction)
      : active?.path[0] ?? previous?.path.at(-1) ?? { x: 0, y: 0 };
  const phase: SimulationSnapshot['phase'] = elapsedSeconds >= plan.durationSeconds ? 'complete'
    : event?.kind === 'motion' ? 'cutting' : event?.kind === 'position' ? 'positioning'
      : event?.kind === 'program-stop' ? 'paused'
        : event?.kind === 'wire-separate' || event?.kind === 'wire-thread' ? 'rethreading' : 'idle';
  return { elapsedSeconds, progress: plan.durationSeconds > 0 ? elapsedSeconds / plan.durationSeconds : 1,
    phase, activeEventId: event?.id ?? null, operationId: event?.operationId ?? null,
    wire: { point: { ...point }, bottomZ: plan.settings.stock.bottomZ - plan.settings.guideClearanceMm,
      topZ: plan.settings.stock.bottomZ + plan.settings.stock.thickness + plan.settings.guideClearanceMm,
      threaded: active?.wireThreaded ?? (previous?.event.kind === 'wire-thread' || previous?.wireThreaded === true),
      cutting: phase === 'cutting' },
    completedStepCount, activeStepIndex, activeStepFraction,
    ...releasedPieceSnapshots(plan.pieces, plan.settings, elapsedSeconds),
    warnings: plan.warnings.filter((warning) => warning.elapsedSeconds <= elapsedSeconds) };
}

/** Compiled steps have monotonic end times; consume every instantaneous event at a boundary. */
function completedStepsAt(steps: readonly SimulationStep[], elapsedSeconds: number): number {
  let low = 0;
  let high = steps.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (steps[middle].endSeconds <= elapsedSeconds) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function resolveSimulationSettings(input: SimulationSettings): ResolvedSimulationSettings | null {
  const settings: ResolvedSimulationSettings = { ...input, stock: { ...input.stock },
    eventHoldSeconds: input.eventHoldSeconds ?? 1, retention: input.retention ?? 'fall',
    supportFloorZ: input.supportFloorZ === undefined ? input.stock.bottomZ - 50 : input.supportFloorZ,
    guideClearanceMm: input.guideClearanceMm ?? 20, guideRadiusMm: input.guideRadiusMm ?? 2 };
  const stock = settings.stock;
  const finite = [stock.originX, stock.originY, stock.bottomZ, stock.originX + stock.width, stock.originY + stock.depth,
    stock.bottomZ + stock.thickness + settings.guideClearanceMm, stock.bottomZ - settings.guideClearanceMm,
    settings.eventHoldSeconds, settings.guideClearanceMm, settings.guideRadiusMm].every(Number.isFinite);
  if (!finite || ![stock.width, stock.depth, stock.thickness, settings.wireDiameter, settings.cutSpeedMmPerSecond,
    settings.rapidSpeedMmPerSecond].every((value) => Number.isFinite(value) && value > 0)
    || settings.eventHoldSeconds < 0 || settings.guideClearanceMm < 0 || settings.guideRadiusMm < 0
    || !['fall', 'retain'].includes(settings.retention)
    || (settings.supportFloorZ !== null && (!Number.isFinite(settings.supportFloorZ) || settings.supportFloorZ > stock.bottomZ))) return null;
  return settings;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
