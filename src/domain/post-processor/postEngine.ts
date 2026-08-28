import type {
  WireEdmExecutionEvent,
  WireEdmExecutionPlan
} from '@/domain/execution-plan/executionPlan';
import type { Point2 } from '@/domain/path-intel/types';

import { builtInPostPackage, resolveBuiltInPostKey, type BuiltInPostKey } from './builtInPostPackages';
import {
  auditControllerProgram,
  type ControllerMotionTrace,
  type ControllerProgram,
  type ControllerProgramAuditDiagnostic,
  type ControllerProgramBlock,
  type PostEventDisposition
} from './controllerProgram';
import { preflightPostCapabilities, type PostCapabilityDiagnostic } from './postCapabilityPreflight';
import type { PostInstallation } from './postLibrary';
import type { PostPropertyValue } from './postProperties';

export type PostEngineDiagnostic =
  | PostCapabilityDiagnostic
  | ControllerProgramAuditDiagnostic
  | {
      readonly code:
        | 'POST_BUILTIN_NOT_RUNNABLE'
        | 'POST_ENGINE_PROPERTY_INVALID'
        | 'POST_ENGINE_EVENT_UNSUPPORTED'
        | 'POST_ENGINE_LIFECYCLE_INVALID';
      readonly message: string;
      readonly eventId: string | null;
    };

export type ControllerProgramResult =
  | { readonly ok: true; readonly program: ControllerProgram }
  | { readonly ok: false; readonly diagnostics: readonly PostEngineDiagnostic[] };

export interface RunBuiltInPostInput {
  readonly installation: PostInstallation;
  readonly properties: Readonly<Record<string, PostPropertyValue>>;
}

interface RenderState {
  readonly plan: WireEdmExecutionPlan;
  readonly key: BuiltInPostKey;
  readonly precision: number;
  readonly offsetIndex: number | null;
  readonly arcCenterMode: 'absolute' | 'incremental';
  readonly lines: string[];
  readonly blocks: ControllerProgramBlock[];
  readonly acknowledged: Map<string, { reason: string }>;
  compensation: 'off' | 'pending-left' | 'pending-right' | 'active-left' | 'active-right';
  pendingPosition: Extract<WireEdmExecutionEvent, { kind: 'position' }> | null;
}

export function runBuiltInPost(
  plan: WireEdmExecutionPlan,
  input: RunBuiltInPostInput
): ControllerProgramResult {
  const capabilityDiagnostics = preflightPostCapabilities(plan, input.installation.package);
  if (capabilityDiagnostics.length > 0) return { ok: false, diagnostics: capabilityDiagnostics };

  const key = resolveBuiltInPostKey(input.installation.package);
  if (!key) {
    return blocked(
      'POST_BUILTIN_NOT_RUNNABLE',
      `Installed package ${input.installation.ref.packageId}@${input.installation.ref.version} does not exactly match a registered built-in implementation.`
    );
  }
  const properties = readEngineProperties(key, input.properties);
  if (!properties.ok) return properties;
  const policyIssue = validatePlanForBuiltIn(key, plan);
  if (policyIssue) return policyIssue;

  const state: RenderState = {
    plan,
    key,
    precision: properties.precision,
    offsetIndex: properties.offsetIndex,
    arcCenterMode: properties.arcCenterMode,
    lines: [],
    blocks: [],
    acknowledged: new Map(),
    compensation: 'off',
    pendingPosition: null
  };
  for (const event of plan.events) {
    const result = renderEvent(state, event);
    if (!result.ok) return result;
    acknowledge(state, event, result.reason);
  }
  if (state.pendingPosition) {
    return blocked(
      'POST_ENGINE_LIFECYCLE_INVALID',
      `Position event ${state.pendingPosition.id} was not emitted by ${input.installation.package.manifest.name}.`,
      state.pendingPosition.id
    );
  }

  const program = freezeProgram(state);
  const auditDiagnostics = auditControllerProgram(
    plan,
    program,
    new Set(Object.keys(input.installation.package.dialect.commands))
  );
  return auditDiagnostics.length > 0
    ? { ok: false, diagnostics: auditDiagnostics }
    : { ok: true, program };
}

function renderEvent(
  state: RenderState,
  event: WireEdmExecutionEvent
): { ok: true; reason: string } | Extract<ControllerProgramResult, { ok: false }> {
  switch (state.key) {
    case 'generic-iso':
      return renderGenericIso(state, event, false);
    case 'generic-explicit-linear':
      return renderGenericIso(state, event, true);
    case 'robofil-v1':
      return renderRobofilV1(state, event);
    case 'robofil-v2':
      return renderRobofilV2(state, event);
  }
}

function renderGenericIso(
  state: RenderState,
  event: WireEdmExecutionEvent,
  explicitCompensation: boolean
): ReturnType<typeof renderEvent> {
  switch (event.kind) {
    case 'program-start':
      emitCommands(state, event, [
        ['program.delimiter', '%'],
        ['distance.absolute', 'G90'],
        ['units.millimeters', 'G21'],
        ['plane.xy', 'G17'],
        ['compensation.cancel', 'G40'],
        ['work-offset.first', 'G54']
      ]);
      return rendered('generic ISO program setup');
    case 'operation-start':
      if (explicitCompensation) emit(state, event, 'G40', ['compensation.cancel']);
      return rendered('operation boundary');
    case 'pass-start':
    case 'pass-end':
      return rendered('single-cut pass boundary');
    case 'wire-continue':
      return rendered('wire remains threaded');
    case 'wire-separate':
      if (!explicitCompensation || event.method !== 'manual') return unsupported(event);
      emit(state, event, 'M00', ['program.stop']);
      return rendered('manual wire separation stop');
    case 'position':
      emitMotion(state, event, `G0 ${formatPoint(event.to, state.precision)}`, ['motion.rapid']);
      return rendered('explicit positioning move');
    case 'wire-thread':
      if (!explicitCompensation || event.method !== 'manual') return unsupported(event);
      emit(state, event, 'M00', ['program.stop']);
      return rendered('manual threading stop');
    case 'compensation-start':
      if (!explicitCompensation || state.compensation !== 'off') return invalidLifecycle(event);
      state.compensation = event.wireSide === 'left' ? 'pending-left' : 'pending-right';
      return rendered('activation is emitted with the reviewed entry motion');
    case 'motion':
      return renderGenericMotion(state, event, explicitCompensation);
    case 'program-stop':
      if (!explicitCompensation) return unsupported(event);
      emit(state, event, 'M00', ['program.stop']);
      return rendered('operator stop');
    case 'compensation-end':
      if (!explicitCompensation || state.compensation !== 'off') return invalidLifecycle(event);
      return rendered('cancellation was emitted with the reviewed exit motion');
    case 'operation-end':
      return rendered('operation completed');
    case 'program-end':
      if (state.compensation !== 'off') return invalidLifecycle(event);
      emitCommands(state, event, [
        ['compensation.cancel', 'G40'],
        ['program.end', 'M30'],
        ['program.delimiter', '%']
      ]);
      return rendered('generic ISO program ending');
  }
}

function renderGenericMotion(
  state: RenderState,
  event: Extract<WireEdmExecutionEvent, { kind: 'motion' }>,
  explicitCompensation: boolean
): ReturnType<typeof renderEvent> {
  if (state.compensation === 'pending-left' || state.compensation === 'pending-right') {
    if (!explicitCompensation || event.role !== 'entry' || event.motion !== 'linear') {
      return invalidLifecycle(event, 'Explicit compensation requires a reviewed linear entry motion.');
    }
    const commandId = state.compensation === 'pending-left'
      ? 'compensation.left'
      : 'compensation.right';
    const word = state.compensation === 'pending-left' ? 'G41' : 'G42';
    emitMotion(
      state,
      event,
      `${word} D${requiredOffset(state)} G1 ${formatPoint(event.end, state.precision)}`,
      [commandId, 'motion.linear']
    );
    state.compensation = state.compensation === 'pending-left' ? 'active-left' : 'active-right';
    return rendered('compensation activation and entry motion');
  }
  if (
    explicitCompensation &&
    event.role === 'exit' &&
    (state.compensation === 'active-left' || state.compensation === 'active-right')
  ) {
    if (event.motion !== 'linear') return invalidLifecycle(event);
    emitMotion(
      state,
      event,
      `G40 G1 ${formatPoint(event.end, state.precision)}`,
      ['compensation.cancel', 'motion.linear']
    );
    state.compensation = 'off';
    return rendered('compensation cancellation and exit motion');
  }
  emitCanonicalMotion(state, event);
  return rendered('cutting motion');
}

function renderRobofilV1(
  state: RenderState,
  event: WireEdmExecutionEvent
): ReturnType<typeof renderEvent> {
  switch (event.kind) {
    case 'program-start':
      emitCommands(state, event, [
        ['origin.set-wire-position', `G92 ${formatPoint(event.initialWirePosition, state.precision)}`],
        ['controller.prepare', 'G60'],
        ['compensation.prepare', 'G38']
      ]);
      return rendered('Robofil v1 program setup');
    case 'operation-start':
      return rendered('single operation begins');
    case 'pass-start':
    case 'pass-end':
      return rendered('single-cut pass boundary');
    case 'position':
      if (state.pendingPosition) return invalidLifecycle(event);
      state.pendingPosition = event;
      return rendered('position is emitted as a compensated linear approach');
    case 'compensation-start': {
      if (state.compensation !== 'off') return invalidLifecycle(event);
      const commandId = event.wireSide === 'left' ? 'compensation.left' : 'compensation.right';
      const word = event.wireSide === 'left' ? 'G41' : 'G42';
      emit(state, event, `${word} D${requiredOffset(state)}`, [commandId]);
      emit(state, event, 'G90', ['distance.absolute']);
      state.compensation = event.wireSide === 'left' ? 'active-left' : 'active-right';
      if (state.pendingPosition) {
        const position = state.pendingPosition;
        emitMotion(
          state,
          position,
          `G1 ${formatPoint(position.to, state.precision)}`,
          ['motion.linear']
        );
        state.pendingPosition = null;
      }
      return rendered('Robofil program-scoped compensation activation');
    }
    case 'motion':
      if (state.compensation !== 'active-left' && state.compensation !== 'active-right') {
        return invalidLifecycle(event);
      }
      emitCanonicalMotion(state, event, 'absolute');
      return rendered('Robofil compensated motion');
    case 'compensation-end':
      if (state.compensation !== 'active-left' && state.compensation !== 'active-right') {
        return invalidLifecycle(event);
      }
      return rendered('Robofil v1 compensation remains active until program end');
    case 'operation-end':
      return rendered('single operation completed');
    case 'program-end':
      emit(state, event, 'M02', ['program.end']);
      return rendered('Robofil v1 program ending');
    case 'wire-continue':
    case 'wire-separate':
    case 'wire-thread':
    case 'program-stop':
      return unsupported(event);
  }
}

function renderRobofilV2(
  state: RenderState,
  event: WireEdmExecutionEvent
): ReturnType<typeof renderEvent> {
  switch (event.kind) {
    case 'program-start':
      emitCommands(state, event, [
        ['origin.set-wire-position', `G92 ${formatPoint(event.initialWirePosition, state.precision)}`],
        ['controller.prepare', 'G60'],
        ['compensation.prepare', 'G38'],
        ['distance.absolute', 'G90']
      ]);
      return rendered('Robofil v2 program setup');
    case 'operation-start':
      emitCommands(state, event, [
        ['compensation.finish', 'G39'],
        ['compensation.cancel', 'G40']
      ]);
      state.compensation = 'off';
      return rendered('operation-scoped compensation boundary');
    case 'pass-start':
    case 'pass-end':
      return rendered('single-cut pass boundary');
    case 'wire-continue':
      return rendered('wire remains threaded');
    case 'wire-separate':
      if (event.method !== 'manual') return unsupported(event);
      emit(state, event, 'M00', ['program.stop']);
      return rendered('manual wire separation stop');
    case 'position':
      if (state.compensation !== 'off') return invalidLifecycle(event);
      emitMotion(state, event, `G0 ${formatPoint(event.to, state.precision)}`, ['motion.rapid']);
      return rendered('positioning while compensation is off');
    case 'wire-thread':
      if (event.method !== 'manual') return unsupported(event);
      emit(state, event, 'M00', ['program.stop']);
      return rendered('manual threading stop');
    case 'compensation-start': {
      if (state.compensation !== 'off') return invalidLifecycle(event);
      const commandId = event.wireSide === 'left' ? 'compensation.left' : 'compensation.right';
      const word = event.wireSide === 'left' ? 'G41' : 'G42';
      emit(state, event, `${word} D${requiredOffset(state)}`, [commandId]);
      state.compensation = event.wireSide === 'left' ? 'active-left' : 'active-right';
      return rendered('operation-scoped compensation activation');
    }
    case 'motion':
      emitCanonicalMotion(state, event, 'absolute');
      return rendered('Robofil cutting motion');
    case 'program-stop':
      emit(state, event, 'M00', ['program.stop']);
      return rendered('operator stop');
    case 'compensation-end':
      if (state.compensation !== 'active-left' && state.compensation !== 'active-right') {
        return invalidLifecycle(event);
      }
      emitCommands(state, event, [
        ['compensation.finish', 'G39'],
        ['compensation.cancel', 'G40']
      ]);
      state.compensation = 'off';
      return rendered('operation-scoped compensation cancellation');
    case 'operation-end':
      if (state.compensation !== 'off') return invalidLifecycle(event);
      return rendered('operation completed with compensation off');
    case 'program-end':
      if (state.compensation !== 'off') return invalidLifecycle(event);
      emit(state, event, 'M02', ['program.end']);
      return rendered('Robofil v2 program ending');
  }
}

function emitCanonicalMotion(
  state: RenderState,
  event: Extract<WireEdmExecutionEvent, { kind: 'motion' }>,
  arcCenterMode = state.arcCenterMode
) {
  if (event.motion === 'linear') {
    emitMotion(state, event, `G1 ${formatPoint(event.end, state.precision)}`, ['motion.linear']);
    return;
  }
  const command = event.clockwise ? 'G2' : 'G3';
  const commandId = event.clockwise
    ? 'motion.arc-clockwise'
    : 'motion.arc-counterclockwise';
  const center = requiredCenter(event);
  const arcCenter = arcCenterMode === 'absolute'
    ? center
    : { x: center.x - event.start.x, y: center.y - event.start.y };
  emitMotion(
    state,
    event,
    `${command} ${formatPoint(event.end, state.precision)} I${formatNumber(arcCenter.x, state.precision)} J${formatNumber(arcCenter.y, state.precision)}`,
    [commandId]
  );
}

function emitMotion(
  state: RenderState,
  event: Extract<WireEdmExecutionEvent, { kind: 'motion' | 'position' }>,
  text: string,
  commandIds: readonly string[]
) {
  const motion: ControllerMotionTrace = event.kind === 'position'
    ? {
        motion: 'linear',
        role: 'position',
        start: copyPoint(event.from),
        end: copyPoint(event.to)
      }
    : {
        motion: event.motion,
        role: event.role,
        start: copyPoint(event.start),
        end: copyPoint(event.end),
        ...(event.center ? { center: copyPoint(event.center) } : {}),
        ...(event.clockwise === undefined ? {} : { clockwise: event.clockwise }),
        ...(event.fullCircle === undefined ? {} : { fullCircle: event.fullCircle })
      };
  emit(state, event, text, commandIds, motion);
}

function emitCommands(
  state: RenderState,
  event: WireEdmExecutionEvent,
  commands: readonly (readonly [string, string])[]
) {
  for (const [commandId, text] of commands) emit(state, event, text, [commandId]);
}

function emit(
  state: RenderState,
  event: WireEdmExecutionEvent,
  text: string,
  commandIds: readonly string[],
  motion: ControllerMotionTrace | null = null
) {
  const lineIndex = state.lines.length;
  state.lines.push(text);
  state.blocks.push({
    id: `block-${String(lineIndex + 1).padStart(6, '0')}`,
    lineIndex,
    text,
    eventId: event.id,
    commandIds: [...commandIds],
    motion
  });
}

function acknowledge(state: RenderState, event: WireEdmExecutionEvent, reason: string) {
  if (state.acknowledged.has(event.id)) {
    throw new Error(`Built-in post acknowledged event ${event.id} more than once.`);
  }
  state.acknowledged.set(event.id, { reason });
}

function freezeProgram(state: RenderState): ControllerProgram {
  const dispositions: PostEventDisposition[] = state.plan.events.map((event) => {
    const blockIds = state.blocks
      .filter(({ eventId }) => eventId === event.id)
      .map(({ id }) => id);
    if (blockIds.length > 0) return { kind: 'emitted', eventId: event.id, blockIds };
    const acknowledgement = state.acknowledged.get(event.id);
    if (!acknowledgement) {
      throw new Error(`Built-in post did not acknowledge event ${event.id}.`);
    }
    return { kind: 'consumed', eventId: event.id, reason: acknowledgement.reason };
  });
  const program: ControllerProgram = {
    text: state.lines.join('\n'),
    lines: state.lines,
    blocks: state.blocks,
    eventDispositions: dispositions
  };
  return deepFreeze(program);
}

function readEngineProperties(
  key: BuiltInPostKey,
  properties: Readonly<Record<string, PostPropertyValue>>
):
  | { ok: true; precision: number; offsetIndex: number | null; arcCenterMode: 'absolute' | 'incremental' }
  | Extract<ControllerProgramResult, { ok: false }> {
  const precision = properties.coordinatePrecision;
  if (!Number.isSafeInteger(precision) || (precision as number) < 0 || (precision as number) > 6) {
    return blocked(
      'POST_ENGINE_PROPERTY_INVALID',
      'coordinatePrecision must be an explicit integer from 0 through 6.'
    );
  }
  const needsOffset = key !== 'generic-iso';
  const offsetIndex = properties.offsetIndex;
  if (
    needsOffset &&
    (!Number.isSafeInteger(offsetIndex) || (offsetIndex as number) < 0 || (offsetIndex as number) > 99)
  ) {
    return blocked(
      'POST_ENGINE_PROPERTY_INVALID',
      'offsetIndex must be an explicit integer from 0 through 99.'
    );
  }
  const needsArcMode = key === 'generic-iso' || key === 'generic-explicit-linear';
  const arcCenterMode = properties.arcCenterMode;
  if (needsArcMode && arcCenterMode !== 'absolute' && arcCenterMode !== 'incremental') {
    return blocked(
      'POST_ENGINE_PROPERTY_INVALID',
      'arcCenterMode must be explicitly set to absolute or incremental.'
    );
  }
  return {
    ok: true,
    precision: precision as number,
    offsetIndex: needsOffset ? offsetIndex as number : null,
    arcCenterMode: needsArcMode ? arcCenterMode as 'absolute' | 'incremental' : 'absolute'
  };
}

function validatePlanForBuiltIn(
  key: BuiltInPostKey,
  plan: WireEdmExecutionPlan
): Extract<ControllerProgramResult, { ok: false }> | null {
  const compensatedOperationCount = new Set(plan.events.flatMap((event) =>
    event.kind === 'compensation-start' && event.operationId ? [event.operationId] : []
  )).size;
  if (
    (key === 'robofil-v1' || key === 'robofil-v2') &&
    compensatedOperationCount !== plan.requirements.operationCount
  ) {
    return blocked(
      'POST_ENGINE_LIFECYCLE_INVALID',
      `${builtInPostPackage(key).manifest.name} requires explicit controller compensation on every operation.`
    );
  }
  if (key === 'robofil-v1' && plan.requirements.operationCount !== 1) {
    return blocked(
      'POST_ENGINE_LIFECYCLE_INVALID',
      'Robofil v1 requires exactly one operation.'
    );
  }
  return null;
}

function formatPoint(point: Point2, precision: number) {
  return `X${formatNumber(point.x, precision)} Y${formatNumber(point.y, precision)}`;
}

function formatNumber(value: number, precision: number) {
  if (!Number.isFinite(value)) throw new Error('Execution plan contains a non-finite coordinate.');
  const text = value.toFixed(precision);
  return Number(text) === 0 ? (0).toFixed(precision) : text;
}

function requiredOffset(state: RenderState) {
  if (state.offsetIndex === null) throw new Error(`${state.key} has no compensation offset property.`);
  return state.offsetIndex;
}

function requiredCenter(event: Extract<WireEdmExecutionEvent, { kind: 'motion' }>) {
  if (!event.center) throw new Error(`Circular event ${event.id} has no center.`);
  return event.center;
}

function rendered(reason: string) {
  return { ok: true as const, reason };
}

function unsupported(
  event: WireEdmExecutionEvent
): Extract<ControllerProgramResult, { ok: false }> {
  return blocked(
    'POST_ENGINE_EVENT_UNSUPPORTED',
    `Built-in post does not support execution event ${event.kind}.`,
    event.id
  );
}

function invalidLifecycle(
  event: WireEdmExecutionEvent,
  message = `Execution event ${event.kind} is invalid in the current post lifecycle.`
): Extract<ControllerProgramResult, { ok: false }> {
  return blocked('POST_ENGINE_LIFECYCLE_INVALID', message, event.id);
}

function blocked(
  code: Extract<PostEngineDiagnostic, { eventId: string | null }>['code'],
  message: string,
  eventId: string | null = null
): Extract<ControllerProgramResult, { ok: false }> {
  return { ok: false, diagnostics: [{ code, message, eventId }] };
}

function copyPoint(point: Point2): Point2 {
  return { x: point.x, y: point.y };
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
